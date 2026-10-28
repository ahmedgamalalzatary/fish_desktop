import { shop } from "@shop";
import { ArrowRight, Copy } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Input, Select } from "../components/ui";
import { api } from "../lib/api";
import type { SessionUser } from "../lib/types";

type Admin = { id: number; name: string; username: string };

/** Forgotten admin password: the owner answers this PC's reset code, then a new password is set. */
export function ResetPasswordPage({
  onLogin,
  onBack,
}: {
  onLogin: (user: SessionUser) => void;
  onBack: () => void;
}) {
  const [resetCode, setResetCode] = useState("");
  const [reply, setReply] = useState("");
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [adminId, setAdminId] = useState(0);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.passwordResetCode().then(setResetCode, (err: Error) => setError(err.message));
  }, []);

  const run = async (action: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  const checkReply = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const found = await api.checkPasswordReset(reply);
      setAdmins(found);
      setAdminId(found[0]?.id ?? 0);
    });
  };

  const setNewPassword = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("كلمتا المرور غير متطابقتين");
    run(async () => onLogin(await api.resetAdminPassword(adminId, password)));
  };

  const copy = async () => {
    await navigator.clipboard.writeText(resetCode);
    setCopied(true);
  };

  return (
    <div className="flex h-full">
      <shop.LoginArt />
      <section className="flex flex-1 flex-col items-center p-8">
        <div className="my-auto w-full max-w-md">
          <Button tone="ghost" size="sm" onClick={onBack} className="-ms-2 mb-4">
            <ArrowRight className="size-4" />
            رجوع لتسجيل الدخول
          </Button>
          <h1 className="text-3xl font-semibold">استعادة كلمة مرور المدير</h1>

          {!admins ? (
            <form onSubmit={checkReply}>
              <p className="mt-2 mb-8 leading-7 text-muted">
                أرسل كود الاستعادة إلى المطوّر، وأدخل الكود الذي يرسله لك. الكود يصلح لهذا الجهاز ولمرة
                واحدة فقط.
              </p>
              <div className="flex flex-col gap-5">
                <div>
                  <div className="mb-1.5 text-sm font-medium">كود الاستعادة</div>
                  <div className="flex items-center gap-2">
                    <output
                      dir="ltr"
                      className="min-h-[46px] flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-center font-mono text-lg tracking-wider select-all"
                    >
                      {resetCode}
                    </output>
                    <Button tone="outline" onClick={copy} disabled={!resetCode}>
                      <Copy className="size-4" />
                      {copied ? "تم النسخ" : "نسخ"}
                    </Button>
                  </div>
                </div>
                <Field label="الكود من المطوّر">
                  {(id) => (
                    <textarea
                      id={id}
                      dir="ltr"
                      rows={4}
                      autoFocus
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      required
                      className="w-full resize-none rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm break-all text-ink transition-colors select-text focus:border-ink-3 focus:ring-2 focus:ring-ink-3/15 focus:outline-none"
                    />
                  )}
                </Field>
              </div>
              {error && <ErrorNote message={error} />}
              <Button
                type="submit"
                size="lg"
                className="mt-6 w-full justify-center"
                disabled={busy || !reply.trim()}
              >
                متابعة
              </Button>
            </form>
          ) : (
            <form onSubmit={setNewPassword}>
              <p className="mt-2 mb-8 leading-7 text-muted">اختر حساب المدير واكتب كلمة مرور جديدة له.</p>
              <div className="flex flex-col gap-4">
                <Field label="حساب المدير">
                  {(id) => (
                    <Select id={id} value={adminId} onChange={(e) => setAdminId(Number(e.target.value))}>
                      {admins.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.username})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="كلمة المرور الجديدة">
                  {(id) => (
                    <Input
                      id={id}
                      type="password"
                      dir="ltr"
                      autoFocus
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  )}
                </Field>
                <Field label="تأكيد كلمة المرور">
                  {(id) => (
                    <Input
                      id={id}
                      type="password"
                      dir="ltr"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                    />
                  )}
                </Field>
              </div>
              {error && <ErrorNote message={error} />}
              <Button
                type="submit"
                size="lg"
                className="mt-6 w-full justify-center"
                disabled={busy || !adminId}
              >
                حفظ كلمة المرور والدخول
              </Button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}
