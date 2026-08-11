import { SignIn } from "@clerk/nextjs";
import { PostboxLockup } from "@/components/Logo";

export default function SignInPage() {
  return (
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
        <SignIn />
      </div>
    </div>
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
