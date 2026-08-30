import { SignUp } from "@clerk/nextjs";
import AuthProvider from "@/components/AuthProvider";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { PostboxLockup } from "@/components/Logo";

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
