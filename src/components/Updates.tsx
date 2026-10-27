import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useUpdater } from "../lib/updater";
import { updateStatus, type UpdateState } from "../lib/updateState";
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
