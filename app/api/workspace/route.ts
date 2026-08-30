import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { updateWorkspace } from "@/lib/data";
import { THEMES } from "@/lib/theme";
import { SIGN_OFF_MAX } from "@/lib/newsletter";
import { parseHex, toHex } from "@/lib/email-colour";

/**
 * PATCH /api/workspace  (authed)
 * Body: { name?, accent? } — updates the caller's own workspace.
 * (sendingEmail was removed: replies always send from our verified domain.)
 */
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    name?: string;
    accent?: string;
    legalName?: string;
    postalAddress?: string;
    brandAccentHex?: string;
    brandSignOff?: string;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const patch: {
    name?: string;
    accent?: string;
    legalName?: string | null;
    postalAddress?: string | null;
    brandAccentHex?: string | null;
    brandSignOff?: string | null;
  } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim().slice(0, 80);
  }

  // The CAN-SPAM identity. Both accept "" as an explicit CLEAR, which is why
  // they are not guarded by a truthiness check the way `name` is above: a
  // client who realises they typed the wrong address must be able to remove it,
  // and an address that cannot be removed is one that keeps going out.
  // Clearing the postal address stops that workspace sending — which is the
  // correct consequence, not a side effect to design around.
  if (typeof body.legalName === "string") {
    const trimmed = body.legalName.trim().slice(0, 200);
    patch.legalName = trimmed || null;
  }
  if (typeof body.postalAddress === "string") {
    const trimmed = body.postalAddress.trim().slice(0, 500);
    patch.postalAddress = trimmed || null;
  }
  /*
    Newsletter branding. Same "" means clear rule as the identity above, and
    for a gentler version of the same reason: somebody who picked a colour they
    dislike must be able to go back to the default.

    The hex is canonicalised on the way IN as well as on the way out. The
    renderer already refuses to trust the stored value, so this is not what
    makes the email safe — it is what stops the settings screen reading back a
    value the email will never use, which is how a client ends up certain the
    feature is broken.
  */
  if (typeof body.brandAccentHex === "string") {
    const raw = body.brandAccentHex.trim();
    if (!raw) {
      patch.brandAccentHex = null;
    } else {
      const parsed = parseHex(raw);
      if (!parsed) {
        return json(
          { error: "That is not a colour. Pick one, or clear the field." },
          { status: 400 },
        );
      }
      patch.brandAccentHex = toHex(parsed);
    }
  }
  if (typeof body.brandSignOff === "string") {
    // Single line: newlines here would become <br /> in every campaign footer,
    // and a sign-off is a sign-off, not a second body.
    const trimmed = body.brandSignOff
      .replace(/s+/g, " ")
      .trim()
      .slice(0, SIGN_OFF_MAX);
    patch.brandSignOff = trimmed || null;
  }

  if (typeof body.accent === "string") {
    // The column is still named `accent`; since the pivot it stores a theme key.
    // Renaming it needs a migration — tracked with the design-system task.
    if (!THEMES.some((t) => t.key === body.accent)) {
      return json({ error: "Unknown theme." }, { status: 400 });
    }
    patch.accent = body.accent;
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: "Nothing to update." }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }
  const updated = await updateWorkspace(workspace.id, patch);
  return json({ ok: true, workspace: updated });
}
