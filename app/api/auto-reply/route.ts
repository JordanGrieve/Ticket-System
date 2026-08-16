import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import {
  DEFAULT_CONFIG,
  isDelaySupported,
  type AutoReplyConfig,
} from "@/lib/auto-reply";
import { getAutoReplyConfig, saveAutoReplyConfig } from "@/lib/auto-reply-send";
import { isValidBusinessHours, isValidTimeZone } from "@/lib/business-hours";
import type {
  AutoReplyDelay,
  AutoReplySchedule,
  BusinessHours,
} from "@/db/schema";

/**
 * GET  /api/auto-reply   (authed) → the caller's workspace config
 * PATCH /api/auto-reply  (authed) → partial update, upserted
 *
 * Workspace scoping is identical to app/api/workspace/route.ts: Clerk decides
 * whether there is a caller at all, and `activeWorkspace()` decides WHICH
 * workspace they are allowed to act in (their own, or an admin's currently
 * selected client). No workspace id is ever read from the request body.
 */

const DELAYS: AutoReplyDelay[] = ["immediate", "5min", "1hr"];
const SCHEDULES: AutoReplySchedule[] = ["always", "business_hours", "out_of_hours"];

const MAX_SUBJECT = 200;
const MAX_BODY = 5000;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const config = await getAutoReplyConfig(workspace.id);
  return json({ ok: true, config: config ?? DEFAULT_CONFIG, configured: !!config });
}

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  // Start from what is stored (or the defaults) so a PATCH really is partial.
  const current = (await getAutoReplyConfig(workspace.id)) ?? DEFAULT_CONFIG;
  const next: AutoReplyConfig = { ...current };

  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return json({ error: "`enabled` must be true or false." }, { status: 400 });
    }
    next.enabled = body.enabled;
  }

  if ("subject" in body) {
    const subject = String(body.subject ?? "").trim();
    if (!subject) return json({ error: "Subject is required." }, { status: 400 });
    if (subject.length > MAX_SUBJECT) {
      return json(
        { error: `Subject is too long (${MAX_SUBJECT} character max).` },
        { status: 400 },
      );
    }
    next.subject = subject;
  }

  if ("body" in body) {
    const text = String(body.body ?? "").trim();
    if (!text) return json({ error: "Message body is required." }, { status: 400 });
    if (text.length > MAX_BODY) {
      return json(
        { error: `Message is too long (${MAX_BODY} character max).` },
        { status: 400 },
      );
    }
    next.body = text;
  }

  if ("outOfHoursBody" in body) {
    const raw = body.outOfHoursBody;
    if (raw == null || String(raw).trim() === "") {
      next.outOfHoursBody = null;
    } else {
      const text = String(raw).trim();
      if (text.length > MAX_BODY) {
        return json(
          { error: `Out-of-hours message is too long (${MAX_BODY} character max).` },
          { status: 400 },
        );
      }
      next.outOfHoursBody = text;
    }
  }

  if ("delay" in body) {
    const delay = String(body.delay ?? "") as AutoReplyDelay;
    if (!DELAYS.includes(delay)) {
      return json({ error: "Unknown delay." }, { status: 400 });
    }
    // Refused rather than stored: this deployment has no queue and no cron, so
    // a delayed auto-reply would simply never be sent. Accepting the value
    // would turn "enabled" into a silent no-op, which is worse than an error.
    if (!isDelaySupported(delay)) {
      return json(
        {
          error:
            "Delayed sending isn't available yet — it needs a job queue or scheduled worker, which this deployment doesn't have. Only immediate sending can be honoured.",
        },
        { status: 400 },
      );
    }
    next.delay = delay;
  }

  if ("scheduleMode" in body) {
    const mode = String(body.scheduleMode ?? "") as AutoReplySchedule;
    if (!SCHEDULES.includes(mode)) {
      return json({ error: "Unknown schedule mode." }, { status: 400 });
    }
    next.scheduleMode = mode;
  }

  if ("timezone" in body) {
    const tz = String(body.timezone ?? "").trim();
    if (!isValidTimeZone(tz)) {
      return json({ error: "Unknown timezone." }, { status: 400 });
    }
    next.timezone = tz;
  }

  if ("businessHours" in body) {
    const raw = body.businessHours;
    if (raw == null) {
      next.businessHours = null;
    } else {
      const parsed = parseBusinessHours(raw);
      if (!parsed || !isValidBusinessHours(parsed)) {
        return json(
          {
            error:
              "Business hours need at least one day and a start time different from the end time (HH:MM).",
          },
          { status: 400 },
        );
      }
      next.businessHours = parsed;
    }
  }

  if ("skipIfTeammateReplied" in body) {
    if (typeof body.skipIfTeammateReplied !== "boolean") {
      return json(
        { error: "`skipIfTeammateReplied` must be true or false." },
        { status: 400 },
      );
    }
    next.skipIfTeammateReplied = body.skipIfTeammateReplied;
  }

  // Turning it on with a schedule that can never match is a configuration
  // trap — catch it here rather than at 3am when nobody gets an acknowledgement.
  if (next.enabled && next.scheduleMode === "business_hours" && !next.businessHours) {
    return json(
      { error: "Set your business hours before limiting replies to them." },
      { status: 400 },
    );
  }

  const saved = await saveAutoReplyConfig(workspace.id, next);
  return json({ ok: true, config: saved });
}

function parseBusinessHours(raw: unknown): BusinessHours | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.days)) return null;
  const days = [...new Set(o.days.map((d) => Number(d)))].sort((a, b) => a - b);
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return null;
  if (days.length === 0) return null;
  return {
    days,
    start: String(o.start ?? ""),
    end: String(o.end ?? ""),
  };
}
