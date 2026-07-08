import { requireAdmin } from "@/lib/viewer";
import { accentVars } from "@/lib/theme";

/**
 * Admin-only chrome. requireAdmin() redirects any non-admin (a tenant client)
 * back to their own dashboard, so everything under (admin) is operator-only.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <div
      style={{
        ...accentVars("terracotta"),
        minHeight: "100vh",
        background: "var(--app-bg)",
        color: "var(--ink)",
      }}
    >
      {children}
    </div>
  );
}
