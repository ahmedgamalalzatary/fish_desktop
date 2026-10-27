import { Toggle } from "../../components/ui";
import type { Settings } from "../../lib/types";
import { Section } from "../../pages/SettingsPage";

/** Selling more than the recorded stock, off by default. */
export function SettingsSection({
  draft,
  set,
}: {
  draft: Settings;
  set: (key: string) => (value: string) => void;
}) {
  return (
    <Section title="البيع" description="يمنع البرنامج افتراضياً بيع كمية أكبر من المخزون المسجّل.">
      <Toggle
        checked={draft.allow_negative_stock === "1"}
        onChange={(v) => set("allow_negative_stock")(v ? "1" : "0")}
        label="السماح بالبيع عند نفاد المخزون"
        description="فعّله إن كنت لا تسجّل كل البضاعة الواردة. يصبح المخزون سالباً حتى تسجّل الاستلام أو الجرد."
      />
    </Section>
  );
}
