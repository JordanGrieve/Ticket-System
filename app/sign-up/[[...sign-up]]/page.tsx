import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import AuthProvider from "@/components/AuthProvider";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { PostboxLockup } from "@/components/Logo";

// Same reasoning as the sign-in page: no search value, and declaring no
// metadata meant inheriting the homepage's canonical.
export const metadata: Metadata = {
  title: "Sign up",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
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
          <SignUp appearance={clerkAppearance} />
        </div>
      </div>
    </AuthProvider>
  );
}
