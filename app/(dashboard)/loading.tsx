import { PostboxMark, LITERAL_COLORS } from "@/components/Logo";

/** Route-transition state — previously a blank pause. */
export default function DashboardLoading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#faf8f4",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          opacity: 0.65,
        }}
      >
        <PostboxMark className="pb-pulse" colors={LITERAL_COLORS} />
        <span style={{ fontSize: 20, fontWeight: 700, color: "#26221d" }}>
          Postbox
        </span>
      </div>
    </div>
  );
}
