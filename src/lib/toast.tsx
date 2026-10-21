import { CircleAlert, CircleCheck } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Tone = "success" | "error";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: Tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`flex max-w-lg items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium shadow-lg shadow-ink/20 ${
              t.tone === "error" ? "bg-gill text-white" : "bg-ink text-white"
            }`}
          >
            {t.tone === "error" ? (
              <CircleAlert className="size-5 shrink-0" />
            ) : (
              <CircleCheck className="size-5 shrink-0 text-lcd-glow" />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Message to show for anything thrown by an api call. */
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
