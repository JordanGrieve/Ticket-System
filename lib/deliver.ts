/**
 * Bulk delivery — the shared contract and the factory.
 *
 * `sendCampaignBatch` in lib/campaign-send.ts takes its sender as an argument
 * and has no default. This module is where the implementations behind that
 * argument live. It does NOT wire anything up: nothing under `app/` imports
 * this file, and phase two of the pipeline is still unreachable for the reasons
 * in docs/NEWSLETTER.md §2.
 *
 * ── THE DEFAULT IS THE LOG DELIVERER, AND THAT IS THE POINT ──
 *
 * `createCampaignDeliverer()` returns the log deliverer unless
 * `CAMPAIGN_DELIVERY_MODE` is set to exactly `"ses"`. That variable does not
 * exist in this repo, in .env.local, or in any deployment; a mode string that
 * is absent, empty, misspelled, or set to anything else at all yields the log
 * deliverer. There is no "auto-detect the provider" path, because the failure
 * mode of auto-detection here is mailing forty thousand real people.
 *
 * The prerequisites that must exist BEFORE that variable is set are listed in
 * docs/NEWSLETTER.md §2 and §7 and none of them are finished: no durable
 * worker, no cross-invocation rate limiter, no bounce/complaint webhook, no
 * verified marketing sending domain, and — the one with legal teeth — no
 * consent enforcement. `selectAudience` does not yet refuse subscribers with a
 * null `consentAt`, so the audience this deliverer would be handed today
 * includes addresses whose provenance we cannot demonstrate.
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

/**
 * The one environment variable that can turn real sending on.
 *
 * Named as a mode rather than a boolean so that adding a second provider later
 * is a new value rather than a second flag, and so that a stray `=1` or `=true`
 * left over from some other setting cannot enable it by accident.
 */
export const DELIVERY_MODE_ENV = "CAMPAIGN_DELIVERY_MODE";

/** The only value that selects a real provider. Anything else means "log". */
export const SES_DELIVERY_MODE = "ses";

export type DeliveryMode = "log" | "ses";

/** A read-only view of the environment. Passed in so the factory is testable. */
export type DeliveryEnv = Record<string, string | undefined>;

/**
 * Which mode the environment selects.
 *
 * Deliberately exact-match and case-sensitive after trimming. "SES", "ses ",
 * "true", "1", "aws" and "" all mean log. Being generous here would be being
 * generous about the one decision in this codebase that cannot be undone.
 */
export function deliveryModeFromEnv(env: DeliveryEnv): DeliveryMode {
  return (env[DELIVERY_MODE_ENV] ?? "").trim() === SES_DELIVERY_MODE
    ? "ses"
    : "log";
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
};

/**
 * Build the deliverer this environment permits.
 *
 * Returns the LOG deliverer unless `CAMPAIGN_DELIVERY_MODE=ses`.
 *
 * When the mode IS `ses` but the credentials are incomplete this THROWS rather
 * than falling back to the log deliverer. Silently degrading would mean an
 * operator who believes they are running a live send watches a campaign march
 * to `sent` with synthetic message ids, which is indistinguishable from success
 * until the reports come back empty. Refusing to construct is loud, immediate,
 * and cannot mail anybody.
 */
export function createCampaignDeliverer(
  options: DelivererFactoryOptions = {},
): CampaignDeliverer {
  const env = options.env ?? (process.env as DeliveryEnv);
  const mode = deliveryModeFromEnv(env);

  if (mode === "log") {
    return createLogDeliverer({ sink: options.sink });
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
