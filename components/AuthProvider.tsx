import { ClerkProvider } from "@clerk/nextjs";

/**
 * Clerk, wrapped so it appears exactly where authentication does — and
 * nowhere else.
 *
 * ── WHY IT MOVED OUT OF THE ROOT LAYOUT ──
 * ClerkProvider used to wrap the whole application. That put it on the
 * marketing homepage, the pricing page, both legal pages, the hosted signup
 * form and the unsubscribe pages — every surface whose visitors are, by
 * definition, not signing in.
 *
 * Measured on a production build of "/", before this change: eight scripts
 * from a third-party origin (clerk.accounts.dev), plus /v1/environment and
 * /v1/client at 173ms each, plus a beacon to clerk-telemetry.com at 218ms.
 * None of it does anything on a page with no Clerk component on it.
 *
 * The privacy half matters more than the milliseconds. Postbox is sold to
 * British businesses and its own privacy policy is part of the pitch; a
 * third-party analytics beacon firing for every visitor to the marketing site,
 * before any consent and with no way to decline, is not a position to be in
 * under PECR. On /u/ — the unsubscribe pages — it would be worse still: those
 * are reached by somebody exercising an opt-out.
 *
 * ── WHAT ACTUALLY NEEDS IT ──
 * Only client-side Clerk components do. That is `<SignIn>`, `<SignUp>`, and
 * AuditedSignOutButton — so the five places this is mounted are the two auth
 * pages, the dashboard, the admin console and /no-access. Server-side `auth()`
 * from @clerk/nextjs/server does NOT need a provider, which is why
 * app/page.tsx still redirects signed-in visitors to their inbox without one.
 *
 * ── ONE COMPONENT, NOT FIVE PROVIDERS ──
 * The telemetry setting below is the reason this is a component rather than
 * five copies of <ClerkProvider>. A privacy decision spread over five call
 * sites is a privacy decision that comes back on the one nobody edited.
 */
export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      /*
        Clerk's product analytics, off. It reports usage to clerk-telemetry.com
        from the visitor's browser; there is no consent flow in front of it and
        it is not necessary for authentication to work, which is the test that
        matters under PECR for anything that is not strictly required.
      */
      telemetry={{ disabled: true }}
    >
      {children}
    </ClerkProvider>
  );
}
