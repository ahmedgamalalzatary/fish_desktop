import { shop } from "@shop";
import { save } from "@tauri-apps/plugin-dialog";
import { DatabaseBackup } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Receipt } from "../components/Receipt";
import { Button, Field, Input, PageHeader, Panel } from "../components/ui";
import { api } from "../lib/api";
import { isoDate } from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import type { Settings } from "../lib/types";

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Panel className="grid grid-cols-[260px_1fr] gap-8 p-6">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
      </div>
      <div>{children}</div>
    </Panel>
  );
}

export function SettingsPage() {
  const { settings, reloadSettings } = useSession();
  const toast = useToast();
  const [draft, setDraft] = useState<Settings>(settings);
  const set = (key: string) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = Object.keys(draft).some((k) => draft[k] !== settings[k]);

  const saveSettings = async () => {
    try {
      await api.updateSettings(draft);
      await reloadSettings();
      toast("حُفظت الإعدادات");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6 p-8">
      <PageHeader
        title="الإعدادات"
        actions={
          <Button onClick={saveSettings} disabled={!dirty}>
            حفظ الإعدادات
          </Button>
        }
      />

      <Section title="بيانات المحل" description="تظهر في أعلى الإيصال وفي التقارير المطبوعة.">
        <div className="grid grid-cols-[1fr_auto] gap-6">
          <div className="flex flex-col gap-4">
            <Field label="اسم المحل">
              {(id) => (
                <Input id={id} value={draft.shop_name} onChange={(e) => set("shop_name")(e.target.value)} />
              )}
            </Field>
            <Field label="العنوان">
              {(id) => (
                <Input
                  id={id}
                  value={draft.shop_address}
                  onChange={(e) => set("shop_address")(e.target.value)}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="رقم الهاتف">
                {(id) => (
                  <Input
                    id={id}
                    dir="ltr"
                    value={draft.shop_phone}
                    onChange={(e) => set("shop_phone")(e.target.value)}
                  />
                )}
              </Field>
              <Field label="رمز العملة" hint="مثل: ج.م أو ر.س">
                {(id) => (
                  <Input id={id} value={draft.currency} onChange={(e) => set("currency")(e.target.value)} />
                )}
              </Field>
            </div>
            <Field label="رسالة أسفل الإيصال">
              {(id) => (
                <Input
                  id={id}
                  value={draft.receipt_footer}
                  onChange={(e) => set("receipt_footer")(e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="w-[300px] rounded-lg border border-line shadow-sm">
            <Receipt
              sale={{
                id: 1024,
                created_at: "2026-01-01 12:30:00",
                cashier_name: "الكاشير",
                ...shop.sampleSale,
              }}
              settings={draft}
            />
          </div>
        </div>
      </Section>

      {shop.SettingsSection && <shop.SettingsSection draft={draft} set={set} />}

      <ChangePassword />
      <Backup />
    </div>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const submit = async () => {
    if (next !== confirm) return toast("كلمتا المرور الجديدتان غير متطابقتين", "error");
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast("تم تغيير كلمة المرور");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Section
      title="كلمة المرور"
      description="غيّر كلمة مرور حسابك. لتغيير كلمة مرور موظف آخر استخدم صفحة الموظفين."
    >
      <form
        className="grid grid-cols-3 items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="الحالية">
          {(id) => (
            <Input
              id={id}
              type="password"
              dir="ltr"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field label="الجديدة">
          {(id) => (
            <Input id={id} type="password" dir="ltr" value={next} onChange={(e) => setNext(e.target.value)} />
          )}
        </Field>
        <Field label="تأكيد الجديدة">
          {(id) => (
            <Input
              id={id}
              type="password"
              dir="ltr"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        <div>
          <Button type="submit" tone="outline" disabled={!current || !next}>
            تغيير كلمة المرور
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Backup() {
  const toast = useToast();
  const backup = async () => {
    const path = await save({
      defaultPath: `نسخة-احتياطية-${isoDate(new Date())}.db`,
      filters: [{ name: "قاعدة بيانات", extensions: ["db"] }],
    });
    if (!path) return;
    try {
      await api.backupDatabase(path);
      toast("حُفظت النسخة الاحتياطية");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Section
      title="النسخ الاحتياطي"
      description="كل البيانات محفوظة على هذا الجهاز فقط. احفظ نسخة على فلاشة أو مكان آخر بانتظام."
    >
      <Button tone="outline" onClick={backup}>
        <DatabaseBackup className="size-4" />
        حفظ نسخة احتياطية
      </Button>
    </Section>
  );
}
