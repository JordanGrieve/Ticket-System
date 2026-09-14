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
 * `CAMPAIGN_DELIVERY_MODE` is set to exactly `"resend"`. A mode string that is
 * absent, empty, misspelled, or set to anything else at all yields the log
 * deliverer. There is no "auto-detect the provider" path, because the failure
 * mode of auto-detection here is mailing forty thousand real people — which is
 * also why a `RESEND_API_KEY` that every transactional send already uses,
 * merely being present in the environment, is deliberately not read as consent
 * to send a campaign.
 *
 * ── ONE PROVIDER, SINCE 14 SEP 2026 ──
 *
 * There were two. SES was the one the design argued for — per-tenant
 * reputation isolation is a thing only it offers — and AWS denied production
 * access on 26 Aug 2026, leaving it sandboxed and able to reach only verified
 * addresses. It was never what production ran. It is gone now, adapter,
 * webhook and env vars together; see the note by `RESEND_DELIVERY_MODE` for
 * why an unused provider is worse than no provider.
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
 * This module reads `process.env` in exactly one function (`resendConfigFromEnv`)
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
  isRetryableFailure,
  type DeliveryFailureKind,
} from "./delivery-failure";
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

/** Selects Resend's `/emails` API. The mode that can reach a stranger. */
export const RESEND_DELIVERY_MODE = "resend";

/*
  ── SES WAS HERE, AND IS NOT COMING BACK ──

  A second mode, "ses", sent campaigns through Amazon SES. It was the original
  plan — one SES tenant per workspace, so one client's complaint rate could not
  sink another's — and AWS refused production access on 26 Aug 2026, leaving it
  sandboxed and able to reach only verified addresses. It was never the mode
  production ran. Jordan, 14 Sep 2026: "we are not using amazon anymore."

  Removed entirely rather than left switched off, because a provider nobody
  uses is a provider nobody maintains: the deliverer, its raw-MIME builder, its
  error classifier, an SNS webhook with signature verification, and a set of
  env vars all had to stay correct against an API no call would ever reach
  again. The webhook was the sharp end — a public endpoint parsing signed
  messages from a service we had stopped using.

  If a second provider is ever wanted, this constant and `DeliveryMode` are
  where it goes; the shape that made two modes possible is still here.
*/
export type DeliveryMode = "log" | "resend";

/**
 * The modes that transmit. Still a list rather than an equality check, so
 * adding a provider does not mean finding every `=== "resend"` in the product.
 */
export const LIVE_DELIVERY_MODES: readonly DeliveryMode[] = [
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
  if (raw === RESEND_DELIVERY_MODE) return "resend";
  // Includes "ses", which is now just another unrecognised string and so means
  // log — the safe answer, and the same one an environment left over from the
  // SES experiment gets.
  return "log";
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

  /*
    Unreachable, and deliberately an exhaustiveness check rather than a
    fallthrough to the log deliverer.

    `DeliveryMode` is "log" | "resend" and both are handled above, so this
    cannot run today. If a third mode is added and its branch forgotten, the
    alternative — quietly returning the log deliverer — is a campaign that
    reports every recipient delivered and mails nobody. Failing to compile is
    the better outcome, and `never` is what produces it.
  */
  const unhandled: never = mode;
  throw new Error(`Unhandled ${DELIVERY_MODE_ENV}: ${String(unhandled)}`);
}
