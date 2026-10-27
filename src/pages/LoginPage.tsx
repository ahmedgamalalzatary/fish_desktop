import { useState, type FormEvent } from "react";
import { shop } from "@shop";
import { Button, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import type { SessionUser } from "../lib/types";

/** Sign-in, or creation of the first admin account on first run. */
export function LoginPage({
  firstRun,
  onLogin,
}: {
  firstRun: boolean;
  onLogin: (user: SessionUser) => void;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (firstRun && password !== confirm) return setError("كلمتا المرور غير متطابقتين");
    setBusy(true);
    try {
      onLogin(
        firstRun ? await api.setupAdmin(name, username, password) : await api.login(username, password),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full">
      <section className="relative hidden w-[44%] flex-col items-center justify-center gap-10 overflow-hidden bg-ink p-12 text-white lg:flex">
        <shop.LoginArt />
        <p className="max-w-xs text-center text-lg leading-8 text-white/65">{shop.tagline}</p>
      </section>
      <section className="flex flex-1 flex-col items-center p-8">
        <form onSubmit={submit} className="my-auto w-full max-w-sm">
          <h1 className="text-3xl font-semibold">{firstRun ? "إنشاء حساب المدير" : "تسجيل الدخول"}</h1>
          <p className="mt-2 mb-8 text-muted">
            {firstRun
              ? "هذا أول تشغيل للبرنامج. أنشئ حساب المدير لتضيف المنتجات والموظفين بعد ذلك."
              : "أدخل اسم المستخدم وكلمة المرور."}
          </p>

          <div className="flex flex-col gap-4">
            {firstRun && (
              <Field label="الاسم">
                {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}
              </Field>
            )}
            <Field label="اسم المستخدم">
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  autoFocus={!firstRun}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="كلمة المرور">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              )}
            </Field>
            {firstRun && (
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
            )}
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-6 w-full justify-center" disabled={busy}>
            {firstRun ? "إنشاء الحساب والدخول" : "دخول"}
          </Button>
        </form>
        <footer className="flex items-center gap-3 text-sm text-muted">
          <img src="/logo.jpeg" alt="" className="size-10 rounded-full" />
          <span>
            تصميم وتطوير{" "}
            <span dir="ltr" className="font-medium text-ink-2">
              BIT Technologies
            </span>{" "}
            © {new Date().getFullYear()}
          </span>
        </footer>
      </section>
    </div>
  );
}
