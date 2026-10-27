import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useUpdater } from "../lib/updater";
import { installsNow, updateStatus, type UpdateState } from "../lib/updateState";
import { Button } from "./ui";

export function InstallButton({ state, install }: { state: UpdateState; install: () => void }) {
  return (
    <Button
      size="sm"
      tone="outline"
      onClick={install}
      disabled={state.step === "downloading" || state.step === "installing"}
    >
      <Download className="size-4" />
      تحديث وإعادة التشغيل
    </Button>
  );
}

/** A strip at the top of the screen when a newer version is out. Checks once when shown. */
export function UpdateBanner() {
  const { state, find, install } = useUpdater();
  // A failed check on start stays quiet (no internet is normal); a failed install is shown.
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    find();
  }, [find]);

  const showing =
    state.step === "available" ||
    state.step === "downloading" ||
    state.step === "installing" ||
    (state.step === "failed" && installing);
  if (!showing) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 bg-ink px-8 py-2.5 text-sm text-white print:hidden"
    >
      <span className="flex items-center gap-2">
        <RefreshCw className="size-4" />
        {updateStatus(state)}
      </span>
      {state.step === "failed" ? (
        <Button size="sm" tone="outline" onClick={find}>
          إعادة المحاولة
        </Button>
      ) : (
        <InstallButton
          state={state}
          install={() => {
            setInstalling(true);
            install();
          }}
        />
      )}
    </div>
  );
}

/**
 * On the screens before sign-in: checks for an update as the app opens and, when there is one,
 * installs it straight away (nobody is working yet), then the app restarts on the new version.
 */
export function StartupUpdate() {
  const { state, find, install } = useUpdater();

  useEffect(() => {
    find();
  }, [find]);

  useEffect(() => {
    if (installsNow(state, false)) install();
  }, [state, install]);

  if (state.step !== "downloading" && state.step !== "installing") return null;
  return (
    <div
      role="status"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-ink/95 text-white"
    >
      <RefreshCw className="size-10 animate-spin" strokeWidth={1.5} />
      <p className="text-2xl font-semibold">جارٍ تحديث البرنامج</p>
      <p className="text-white/80">{updateStatus(state)}</p>
      <p className="text-sm text-white/60">سيُعاد تشغيل البرنامج وحده بعد التحديث، وبياناتك كما هي.</p>
    </div>
  );
}
