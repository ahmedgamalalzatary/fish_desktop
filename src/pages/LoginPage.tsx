import { useState, type FormEvent } from "react";
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
      <section className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <Waves />
        <div className="relative font-sign text-7xl leading-[1.15] text-tag">
          سمك
          <br />
          طازة
        </div>
        <p className="relative max-w-xs text-lg leading-8 text-white/70">
          البيع بالكيلو أو بالأوزان الجاهزة، والمخزون يُخصم مع كل فاتورة.
        </p>
      </section>

      <section className="flex flex-1 items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h1 className="text-3xl font-semibold">{firstRun ? "إنشاء حساب المدير" : "تسجيل الدخول"}</h1>
          <p className="mt-2 mb-8 text-mist">
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
            <p role="alert" className="mt-4 rounded-lg bg-gill-soft px-3 py-2 text-sm text-gill">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-6 w-full justify-center" disabled={busy}>
            {firstRun ? "إنشاء الحساب والدخول" : "دخول"}
          </Button>
        </form>
      </section>
    </div>
  );
}

/** Quiet water lines behind the sign. */
function Waves() {
  return (
    <svg className="absolute inset-0 size-full text-white/[0.06]" preserveAspectRatio="none" aria-hidden>
      <defs>
        <pattern id="waves" width="120" height="36" patternUnits="userSpaceOnUse">
          <path d="M0 18 Q 30 6 60 18 T 120 18" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#waves)" />
    </svg>
  );
}
