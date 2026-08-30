import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import AuthProvider from "@/components/AuthProvider";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { PostboxLockup } from "@/components/Logo";

/**
 * Not indexed, and that is two fixes rather than one.
 *
 * A sign-in form has no search value — nobody looking for a shared support
 * inbox is served by landing on a Google button. And because it declared no
 * metadata of its own it inherited the root layout's canonical, so it was
 * telling search engines it was a duplicate of the marketing homepage. An
 * inherited canonical is not a harmless default; see app/pricing/page.tsx.
 *
 * noindex settles both: nothing to index, so nothing to canonicalise.
 */
export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <AuthProvider>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--app-bg)",
          padding: 24,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <Brand />
          <SignIn appearance={clerkAppearance} />
        </div>
      </div>
    </AuthProvider>
  );
}

function Brand() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        marginBottom: 24,
      }}
    >
      <PostboxLockup color="var(--ink)" />
    </div>
  );
}
