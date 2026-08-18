/**
 * The log deliverer — the default, and the only one that is safe today.
 *
 * It satisfies `CampaignDeliverer` completely: it takes a fully rendered
 * message, records what WOULD have gone out, and returns a synthetic message
 * id so the claim-before-send loop writes a `providerMessageId` and the
 * campaign report fills in exactly as it would on a live send. That makes the
 * whole pipeline — materialise, claim, send, record — runnable end to end with
 * no provider account, no credentials, and no network.
 *
 * ── IT SENDS NOTHING, AND SAYS SO ──
 *
 * There is no network call in this file and nothing imported that could make
 * one. The synthetic id is prefixed `not-sent-` rather than made to look like a
 * provider id: a plausible-looking fake id in `campaign_recipients` would be
 * indistinguishable from a real one six months later, and the reconciliation
 * sweep (docs/NEWSLETTER.md §4) would try to resolve it against a provider that
 * never saw it. The prefix is the thing that keeps that honest.
 *
 * Pure apart from the sink. The sink defaults to `console.info`; tests pass
 * their own and assert on the records, which is why the record is a structured
 * object and the formatting is a separate function.
 */
import type { OutboundCampaignEmail } from "./campaign-send";

/** The prefix on every synthetic id. Never produced by a real provider. */
export const NOT_SENT_ID_PREFIX = "not-sent-";

/**
 * What a would-be send is recorded as.
 *
 * Sizes rather than bodies. A campaign body is up to 50,000 characters and a
 * log line per recipient at that size is a way to make an incident unreadable;
 * the bytes are what you actually want when a message is silently dropped for
 * being oversized. The recipient address IS included — this is a server log of
 * an operation on that address, the same as the send itself would be — but the
 * rendered body, which carries the per-recipient merge values, is not.
 */
export type DeliveryLogRecord = {
  messageId: string;
  to: string;
  from: string;
  subject: string;
  /** Byte length of the plain-text part. */
  textBytes: number;
  /** Byte length of the HTML part. */
  htmlBytes: number;
  /**
   * The headers as handed over, verbatim. List-Unsubscribe and
   * List-Unsubscribe-Post are the two that must be here on every bulk message;
   * logging them is how their absence is caught before a provider is involved.
   */
  headers: Record<string, string>;
  /** True when both RFC 8058 headers are present and non-empty. */
  hasOneClickUnsubscribe: boolean;
  at: Date;
};

export type LogDelivererOptions = {
  /** Where records go. Defaults to a formatted `console.info`. */
  sink?: (record: DeliveryLogRecord) => void;
  /** Injected in tests. Defaults to a random suffix. */
  idFactory?: () => string;
  /** Injected in tests. Defaults to `Date`. */
  now?: () => Date;
};

function byteLength(s: string): number {
  return Buffer.byteLength(s ?? "", "utf8");
}

/** Case-insensitive header lookup — providers and RFCs both treat them so. */
function header(headers: Record<string, string>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === wanted) return v;
  }
  return null;
}

/**
 * Does this message carry a working one-click unsubscribe?
 *
 * BOTH headers, both non-empty. `List-Unsubscribe` on its own is a hint that
 * mail clients may ignore; it is `List-Unsubscribe-Post` that makes the HTTPS
 * entry one-click under RFC 8058, and without it Gmail keeps offering the spam
 * button as the easier route. Exported because it is the single most useful
 * assertion a test of the send path can make.
 */
export function hasOneClickUnsubscribe(headers: Record<string, string>): boolean {
  const list = header(headers, "List-Unsubscribe");
  const post = header(headers, "List-Unsubscribe-Post");
  return !!list?.trim() && !!post?.trim();
}

/** The structured record for one would-be send. Pure. */
export function describeDelivery(
  email: OutboundCampaignEmail,
  messageId: string,
  at: Date,
): DeliveryLogRecord {
  const headers = email.headers ?? {};
  return {
    messageId,
    to: email.to,
    from: email.from,
    subject: email.subject,
    textBytes: byteLength(email.text),
    htmlBytes: byteLength(email.html),
    headers: { ...headers },
    hasOneClickUnsubscribe: hasOneClickUnsubscribe(headers),
    at,
  };
}

/**
 * One line, and it leads with the fact that nothing was sent.
 *
 * The wording is deliberate: somebody scanning production logs at 2am must not
 * have to know what "log deliverer" means to work out whether real people
 * received this.
 */
export function formatDeliveryLog(record: DeliveryLogRecord): string {
  const unsub = record.hasOneClickUnsubscribe
    ? "one-click unsubscribe OK"
    : "NO ONE-CLICK UNSUBSCRIBE — this message would violate Gmail/Yahoo bulk rules";
  return (
    `[deliver:log] NOT SENT (no provider configured) — ` +
    `to=${record.to} from=${record.from} ` +
    `subject=${JSON.stringify(record.subject)} ` +
    `text=${record.textBytes}B html=${record.htmlBytes}B ` +
    `${unsub} id=${record.messageId}`
  );
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Build a deliverer that records instead of sending.
 *
 * Never rejects. A delivery function that can fail is useful for testing the
 * failure branch of the send loop, but this one is also the DEFAULT, and a
 * default that intermittently marks recipients `failed` would be a fake outage.
 * Tests that need the failure path pass their own throwing function.
 */
export function createLogDeliverer(
  options: LogDelivererOptions = {},
): (email: OutboundCampaignEmail) => Promise<{ id?: string }> {
  const sink =
    options.sink ??
    ((record: DeliveryLogRecord) => {
      console.info(formatDeliveryLog(record));
    });
  const idFactory = options.idFactory ?? randomSuffix;
  const now = options.now ?? (() => new Date());

  return async (email: OutboundCampaignEmail) => {
    const messageId = `${NOT_SENT_ID_PREFIX}${idFactory()}`;
    sink(describeDelivery(email, messageId, now()));
    return { id: messageId };
  };
}
