/**
 * Bulk delivery — the shared contract and the factory.
 *
 * `sendCampaignBatch` in lib/campaign-send.ts takes its sender as an argument
 * and has no default. This module is where the implementations behind that
 * argument live, and as of 7900a5c it IS wired up:
 * `app/api/cron/campaigns/route.ts` calls `createCampaignDeliverer()` on every
 * scheduled sweep, and `vercel.json` schedules that route nightly. Phase two of
 * the pipeline is reachable. Do not read this file as if it were inert.
 *
 * What stops it mailing a real person is therefore no longer the absence of a
 * caller. It is the environment gates below and the unfinished prerequisites in
 * docs/NEWSLETTER.md §2.
 *
 * ── THE DEFAULT IS THE LOG DELIVERER, AND THAT IS THE POINT ──
 *
 * `createCampaignDeliverer()` returns the log deliverer unless
 * `CAMPAIGN_DELIVERY_MODE` is set to exactly `"ses"` or exactly `"resend"`. A
 * mode string that is absent, empty, misspelled, or set to anything else at all
 * yields the log deliverer. There is no "auto-detect the provider" path,
 * because the failure mode of auto-detection here is mailing forty thousand
 * real people — which is also why AWS credentials, or a `RESEND_API_KEY` that
 * every transactional send already uses, merely being present in the
 * environment is deliberately not read as consent to send a campaign.
 *
 * ── WHY THERE ARE TWO REAL PROVIDERS ──
 *
 * SES is the one the design argued for (docs/NEWSLETTER.md §1.2): per-tenant
 * reputation isolation is a thing only it offers. It is also still in the
 * sandbox — production access was DENIED on 26 Aug 2026 — so it can reach
 * verified addresses only. Resend is live, already carries every transactional
 * message, and can reach a stranger today. `"resend"` is the mode that actually
 * mails a subscriber; `"ses"` stays because the sandbox is a state the account
 * can leave, and deleting a working adapter to celebrate a support ticket would
 * be the wrong order.
 *
 * The cron route carries a second, independent gate that trips BEFORE this
 * factory is ever called: it returns 503 when `CAMPAIGN_FROM_ADDRESS` is unset,
 * and that variable has no fallback to the transactional sender. A third gate
 * sits in front of both — `authorizeCronRequest` refuses every caller, Vercel
 * included, while `CRON_SECRET` is unset.
 *
 * The prerequisites that must exist before the mode is flipped are listed in
 * docs/NEWSLETTER.md §2 and §7. The durable worker is now one of them that IS
 * done — the cron route is it. The rest are not, as of 22 August 2026: no
 * cross-invocation rate limiter (lib/rate-limit.ts is still an in-memory Map,
 * correct only within one instance), no bounce/complaint webhook, no postal
 * address column on `workspaces` for the CAN-SPAM footer, and — the one with
 * legal teeth — no consent enforcement. `selectAudience` still takes exactly
 * two arguments, candidates and a suppression set; it never reads `consentAt`,
 * so the audience this deliverer would be handed today includes addresses whose
 * provenance we cannot demonstrate.
 *
 * ── CONFIG ──
 *
 * This module reads `process.env` in exactly one function (`sesConfigFromEnv`)
 * and passes the values on as ARGUMENTS. It does not import lib/config, and
 * neither does anything it imports — see the header of lib/newsletter.ts for
 * what happened the one time that boundary was crossed.
 */
import "server-only";
// The deliverer shape is OWNED by lib/campaign-send.ts — it is the consumer, so
// it defines the interface. Imported and re-exported TYPE-ONLY, so nothing here
// pulls in db/index.ts and its DATABASE_URL-at-import-time throw; that is what
// lets tests/deliver*.test.ts run in CI with no database.
import type { CampaignDeliverer } from "./campaign-send";
import { createLogDeliverer, type DeliveryLogRecord } from "./deliver-log";
import { createSesDeliverer, type SesDelivererConfig } from "./deliver-ses";
import {
  createResendDeliverer,
  type ResendDelivererConfig,
} from "./deliver-resend";

export type {
  CampaignDeliverer,
  OutboundCampaignEmail,
} from "./campaign-send";

export type { DeliveryLogRecord };
export { createLogDeliverer } from "./deliver-log";
export {
  createSesDeliverer,
  SesDeliveryError,
  classifySesError,
  isRetryableFailure,
  buildRawMessage,
  type DeliveryFailureKind,
  type SesDelivererConfig,
} from "./deliver-ses";
export {
  createResendDeliverer,
  ResendDeliveryError,
  classifyResendError,
  idempotencyKeyFor,
  type ResendDelivererConfig,
} from "./deliver-resend";

/**
 * The one environment variable that can turn real sending on.
 *
 * Named as a mode rather than a boolean so that adding a second provider later
 * is a new value rather than a second flag, and so that a stray `=1` or `=true`
 * left over from some other setting cannot enable it by accident.
 */
export const DELIVERY_MODE_ENV = "CAMPAIGN_DELIVERY_MODE";

/** Selects Amazon SES. Sandbox-bound as of 26 Aug 2026 — see the header. */
export const SES_DELIVERY_MODE = "ses";

/** Selects Resend's `/emails` API. The mode that can reach a stranger. */
export const RESEND_DELIVERY_MODE = "resend";

export type DeliveryMode = "log" | "ses" | "resend";

/**
 * The modes that transmit. Used wherever a screen or a health check has to say
 * whether real people receive this — written once, so a third provider does not
 * need every `=== "ses"` in the product found and corrected.
 */
export const LIVE_DELIVERY_MODES: readonly DeliveryMode[] = [
  SES_DELIVERY_MODE,
  RESEND_DELIVERY_MODE,
];

/** True when this mode puts messages on the wire. False for "log". */
export function isLiveDeliveryMode(mode: DeliveryMode): boolean {
  return mode !== "log";
}

/** A read-only view of the environment. Passed in so the factory is testable. */
export type DeliveryEnv = Record<string, string | undefined>;

/**
 * Which mode the environment selects.
 *
 * Deliberately exact-match and case-sensitive after trimming. "SES", "Resend",
 * "true", "1", "aws" and "" all mean log. Being generous here would be being
 * generous about the one decision in this codebase that cannot be undone.
 */
export function deliveryModeFromEnv(env: DeliveryEnv): DeliveryMode {
  const raw = (env[DELIVERY_MODE_ENV] ?? "").trim();
  if (raw === SES_DELIVERY_MODE) return "ses";
  if (raw === RESEND_DELIVERY_MODE) return "resend";
  return "log";
}

export type SesConfigResult =
  | { ok: true; config: SesDelivererConfig }
  | { ok: false; missing: string[] };

/**
 * Gather the SES settings from the environment.
 *
 * Region and credentials are required; the configuration set, the tenant and
 * the return path are optional but each is called out in the report below,
 * because "it sent, but with no configuration set" means the bounce and
 * complaint events go nowhere and the feedback loop in docs/NEWSLETTER.md §6
 * silently does not exist.
 */
export function sesConfigFromEnv(env: DeliveryEnv): SesConfigResult {
  const region = (env.SES_REGION ?? env.AWS_REGION ?? "").trim();
  const accessKeyId = (env.AWS_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (env.AWS_SECRET_ACCESS_KEY ?? "").trim();

  const missing: string[] = [];
  if (!region) missing.push("SES_REGION (or AWS_REGION)");
  if (!accessKeyId) missing.push("AWS_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("AWS_SECRET_ACCESS_KEY");
  if (missing.length > 0) return { ok: false, missing };

  const optional = (name: string): string | null => {
    const value = (env[name] ?? "").trim();
    return value || null;
  };

  return {
    ok: true,
    config: {
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken: optional("AWS_SESSION_TOKEN"),
      },
      configurationSetName: optional("SES_CONFIGURATION_SET"),
      tenantName: optional("SES_TENANT_NAME"),
      returnPath: optional("SES_RETURN_PATH"),
    },
  };
}

export type ResendConfigResult =
  | { ok: true; config: ResendDelivererConfig }
  | { ok: false; missing: string[] };

/**
 * The placeholder in .env.example. Present so a developer can boot the app; it
 * is not a key and must never be treated as one — lib/email.ts refuses it for
 * the same reason, and a campaign that "sent" against it would report every
 * recipient delivered.
 */
const RESEND_PLACEHOLDER_KEY = "re_placeholder";

/**
 * Gather the Resend settings from the environment.
 *
 * One variable, and it is the SAME `RESEND_API_KEY` every transactional send
 * already uses. Deliberately not a second key: the rate limit and the quota are
 * per TEAM, not per key (resend.com/docs/api-reference/introduction), so a
 * separate key would buy no isolation at all while adding one more secret to
 * rotate and one more way for the two paths to disagree about which account
 * they are on.
 */
export function resendConfigFromEnv(env: DeliveryEnv): ResendConfigResult {
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, missing: ["RESEND_API_KEY"] };
  if (apiKey === RESEND_PLACEHOLDER_KEY) {
    return { ok: false, missing: ["RESEND_API_KEY (still the placeholder)"] };
  }
  return { ok: true, config: { apiKey } };
}

export type DelivererFactoryOptions = {
  /** Defaults to `process.env`. Injected in tests so no real env is consulted. */
  env?: DeliveryEnv;
  /** Where the log deliverer writes. Defaults to console.info. */
  sink?: (record: DeliveryLogRecord) => void;
  /**
   * Per-workspace SES tenant name, when the caller knows it. Overrides
   * SES_TENANT_NAME — one SES tenant per workspace is the whole reason SES was
   * chosen (docs/NEWSLETTER.md §1.4), and a per-process env var cannot express
   * that. Ignored in log mode.
   */
  tenantName?: string | null;
  /**
   * Called after each send the provider ACCEPTED. Resend mode only.
   *
   * This is the seam that lets a campaign recipient reach the platform-wide
   * daily counter without this module importing lib/email-quota-store.ts —
   * which reaches the database, and would take db/index.ts and its
   * DATABASE_URL-at-import-time throw with it into every test that imports this
   * file. The cron route and the test-send route pass
   * `recordTransactionalSend`; a caller that omits it gets an uncounted send,
   * which is why both of them pass it.
   */
  onSent?: () => void | Promise<void>;
};

/**
 * Build the deliverer this environment permits.
 *
 * Returns the LOG deliverer unless `CAMPAIGN_DELIVERY_MODE` is `ses` or
 * `resend`.
 *
 * When a real mode is selected but its credentials are incomplete this THROWS
 * rather than falling back to the log deliverer. Silently degrading would mean
 * an operator who believes they are running a live send watches a campaign
 * march to `sent` with synthetic message ids, which is indistinguishable from
 * success until the reports come back empty. Refusing to construct is loud,
 * immediate, and cannot mail anybody.
 */
export function createCampaignDeliverer(
  options: DelivererFactoryOptions = {},
): CampaignDeliverer {
  const env = options.env ?? (process.env as DeliveryEnv);
  const mode = deliveryModeFromEnv(env);

  if (mode === "log") {
    return createLogDeliverer({ sink: options.sink });
  }

  if (mode === "resend") {
    const resend = resendConfigFromEnv(env);
    if (!resend.ok) {
      throw new Error(
        `${DELIVERY_MODE_ENV}=${RESEND_DELIVERY_MODE} but Resend is not ` +
          `configured. Missing: ${resend.missing.join(", ")}. Refusing to ` +
          `construct a deliverer rather than falling back to the log ` +
          `deliverer, which would look like a successful send.`,
      );
    }
    // Loud on purpose, and it says which pool the sending spends from —
    // campaigns go through the same `/emails` API and the same allowance as
    // every ticket acknowledgement. See the header of lib/deliver-resend.ts.
    console.warn(
      `[deliver] ${DELIVERY_MODE_ENV}=${RESEND_DELIVERY_MODE}: REAL bulk ` +
        `email is enabled. Campaign recipients spend from the SAME Resend ` +
        `allowance as transactional mail` +
        `${options.onSent ? "" : ", and this deliverer was built with no send counter"}.`,
    );
    return createResendDeliverer({ ...resend.config, onSent: options.onSent });
  }

  const result = sesConfigFromEnv(env);
  if (!result.ok) {
    throw new Error(
      `${DELIVERY_MODE_ENV}=${SES_DELIVERY_MODE} but SES is not configured. ` +
        `Missing: ${result.missing.join(", ")}. Refusing to construct a ` +
        `deliverer rather than falling back to the log deliverer, which would ` +
        `look like a successful send.`,
    );
  }

  const config: SesDelivererConfig = {
    ...result.config,
    tenantName:
      options.tenantName !== undefined
        ? options.tenantName
        : result.config.tenantName,
  };

  // Loud on purpose. This line appearing in production logs is the signal that
  // the safety catch described at the top of this file has been released.
  console.warn(
    `[deliver] ${DELIVERY_MODE_ENV}=${SES_DELIVERY_MODE}: REAL bulk email is ` +
      `enabled (region ${config.region}` +
      `${config.tenantName ? `, tenant ${config.tenantName}` : ", NO tenant"}` +
      `${
        config.configurationSetName
          ? `, configuration set ${config.configurationSetName}`
          : ", NO configuration set — bounce/complaint events will not be delivered"
      }).`,
  );

  return createSesDeliverer(config);
}
