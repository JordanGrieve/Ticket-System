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
        <div
          className="pb-pulse"
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: "#d6552f",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 18,
          }}
        >
          p
        </div>
        <span style={{ fontSize: 20, fontWeight: 700, color: "#26221d" }}>
          postbox
        </span>
      </div>
    </div>
  );
}
