import { SignUp } from "@clerk/nextjs";
import { PostboxLockup } from "@/components/Logo";

export default function SignUpPage() {
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
        <SignUp />
      </div>
    </div>
  );
}
