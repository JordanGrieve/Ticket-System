import SettingsTabs from "./SettingsTabs";
import "../../settings.css";

/**
 * Shared chrome for the three settings surfaces.
 *
 * Contacts, Auto-reply and Install used to be three separate entries in the
 * mail nav, which made an already long sidebar longer and put three
 * unrelated-looking links beside the folders. They are all "things you
 * configure about this workspace", so they collapse into one nav entry and
 * become tabs here.
 *
 * Deliberately no page heading: each tab already renders its own, and a
 * "Settings" title above an "Auto-reply" title is one heading too many. The tab
 * strip and the highlighted nav entry say where you are.
 *
 * The stylesheet is imported here so all three tabs share it.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="pbm-page pb-scroll">
      <SettingsTabs />
      {children}
    </div>
  );
}
