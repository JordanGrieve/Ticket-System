import { requireAdmin } from "@/lib/viewer";
import "../admin.css";

/**
 * Admin-only chrome. requireAdmin() redirects any non-admin (a tenant client)
 * back to their own dashboard, so everything under (admin) is operator-only.
 *
 * The console is always dark, whatever theme the workspace is on, so it carries
 * its own data-theme instead of inheriting the document's. The dark palette is
 * restated on .pba-root in app/admin.css — globals.css only declares it at
 * :root, where an element-level attribute can't reach it.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <div className="pba-root" data-theme="dark">
      {children}
    </div>
  );
}
