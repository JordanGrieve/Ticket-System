import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import {
  DEFAULT_WELCOME,
  getWelcomeEmail,
  upsertWelcomeEmail,
  type WelcomeConfig,
} from "@/lib/welcome-store";

/**
 * GET   /api/welcome  (authed) → this workspace's welcome email
 * PATCH /api/welcome  (authed) → partial update, upserted
 *
 * Workspace scoping is identical to app/api/auto-reply/route.ts: Clerk decides
 * whether there is a caller at all, and `activeWorkspace()` decides WHICH
 * workspace they may act in — their own, or the client an admin is currently
 * inside. No workspace id is ever read from the request body.
 */

const MAX_SUBJECT = 200;
const MAX_BODY = 5000;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const row = await getWelcomeEmail(workspace.id);
  // `configured` is the difference between "never opened this screen" and
  // "turned it off on purpose". The form shows the defaults for the first and
  // what they saved for the second.
  return json({
    ok: true,
    config: row
      ? { enabled: row.enabled, subject: row.subject, body: row.body }
      : DEFAULT_WELCOME,
    configured: !!row,
  });
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

  const existing = await getWelcomeEmail(workspace.id);
  const base: WelcomeConfig = existing
    ? { enabled: existing.enabled, subject: existing.subject, body: existing.body }
    : DEFAULT_WELCOME;

  const next: WelcomeConfig = { ...base };

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return json({ error: "enabled must be true or false." }, { status: 400 });
    }
    next.enabled = body.enabled;
  }

  if (body.subject !== undefined) {
    if (typeof body.subject !== "string") {
      return json({ error: "subject must be text." }, { status: 400 });
    }
    const subject = body.subject.trim();
    if (!subject) {
      return json({ error: "Give the email a subject line." }, { status: 400 });
    }
    if (subject.length > MAX_SUBJECT) {
      return json(
        { error: `Keep the subject under ${MAX_SUBJECT} characters.` },
        { status: 400 },
      );
    }
    next.subject = subject;
  }

  if (body.body !== undefined) {
    if (typeof body.body !== "string") {
      return json({ error: "body must be text." }, { status: 400 });
    }
    const text = body.body.trim();
    if (!text) {
      return json({ error: "Write something to send." }, { status: 400 });
    }
    if (text.length > MAX_BODY) {
      return json(
        { error: `Keep the message under ${MAX_BODY} characters.` },
        { status: 400 },
      );
    }
    next.body = text;
  }

  const saved = await upsertWelcomeEmail(workspace.id, next);
  return json({
    ok: true,
    config: {
      enabled: saved.enabled,
      subject: saved.subject,
      body: saved.body,
    },
  });
}
