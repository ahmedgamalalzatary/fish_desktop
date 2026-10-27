import { shop } from "@shop";
import { Copy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Field } from "../components/ui";
import { api } from "../lib/api";

/** First start on a new PC: the app works only after the owner's activation code for this PC. */
export function ActivationPage({ deviceCode, onActive }: { deviceCode: string; onActive: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.activate(code);
      onActive();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(deviceCode);
    setCopied(true);
  };

  return (
    <div className="flex h-full">
      <shop.LoginArt />
      <section className="flex flex-1 flex-col items-center p-8">
        <form onSubmit={submit} className="my-auto w-full max-w-md">
          <h1 className="text-3xl font-semibold">تفعيل البرنامج</h1>
          <p className="mt-2 mb-8 leading-7 text-muted">
            هذا أول تشغيل على هذا الجهاز. أرسل كود الجهاز إلى المطوّر، وأدخل كود التفعيل الذي يرسله لك.
          </p>

          <div className="flex flex-col gap-5">
            <div>
              <div className="mb-1.5 text-sm font-medium">كود الجهاز</div>
              <div className="flex items-center gap-2">
                <output
                  dir="ltr"
                  className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-center font-mono text-lg tracking-wider select-all"
                >
                  {deviceCode}
                </output>
                <Button tone="outline" onClick={copy}>
                  <Copy className="size-4" />
                  {copied ? "تم النسخ" : "نسخ"}
                </Button>
              </div>
            </div>
            <Field label="كود التفعيل">
              {(id) => (
                <textarea
                  id={id}
                  dir="ltr"
                  rows={4}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  className="w-full resize-none rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm break-all text-ink transition-colors select-text focus:border-ink-3 focus:ring-2 focus:ring-ink-3/15 focus:outline-none"
                />
              )}
            </Field>
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            className="mt-6 w-full justify-center"
            disabled={busy || !code.trim()}
          >
            تفعيل
          </Button>
        </form>
      </section>
    </div>
  );
}
