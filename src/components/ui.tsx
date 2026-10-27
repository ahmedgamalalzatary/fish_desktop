import { Delete, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { cx } from "../lib/cx";

const buttonTones = {
  primary: "bg-ink text-white hover:bg-ink-2 active:bg-ink-3",
  // Only for taking money.
  pay: "bg-pay text-ink hover:bg-pay-hover active:bg-pay-deep active:text-white shadow-[inset_0_-3px_0_rgb(0_0_0/0.14)]",
  outline: "border border-line bg-white text-ink hover:border-ink-3/40 hover:bg-surface",
  ghost: "text-ink-2 hover:bg-ink/5",
  danger: "bg-danger text-white hover:bg-danger-hover",
  "danger-ghost": "text-danger hover:bg-danger-soft",
};

const buttonSizes = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-14 px-6 text-lg gap-2.5 rounded-xl",
  icon: "size-9 justify-center rounded-lg",
};

export function Button({
  tone = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: keyof typeof buttonTones;
  size?: keyof typeof buttonSizes;
}) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-3 disabled:pointer-events-none disabled:opacity-45",
        buttonTones[tone],
        buttonSizes[size],
        className,
      )}
    />
  );
}

const fieldClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-ink transition-colors select-text placeholder:text-muted/60 focus:border-ink-3 focus:ring-2 focus:ring-ink-3/15 focus:outline-none disabled:bg-surface disabled:text-muted";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldClass, className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldClass, "h-[42px]", className)} />;
}

/** Label + control + optional hint. The control is passed as a render function to receive the id. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-3",
          checked ? "bg-ok" : "bg-line",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-5 rounded-full bg-white shadow transition-[inset-inline-start]",
            checked ? "start-[22px]" : "start-0.5",
          )}
        />
      </button>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  size?: "md" | "lg";
}) {
  return (
    <div role="radiogroup" className="flex gap-1 rounded-xl bg-ink/[0.06] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex flex-1 items-center justify-center gap-2 rounded-lg font-medium transition-colors",
            size === "lg" ? "h-12 text-base" : "h-9 text-sm",
            value === o.value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = "max-w-lg",
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Focus the first field so the cashier can type immediately.
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea, [data-autofocus]");
    (first ?? panel.current)?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-6 backdrop-blur-[2px]">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cx(
          "relative flex max-h-full w-full flex-col overflow-hidden rounded-2xl bg-page shadow-2xl shadow-ink/30 outline-none",
          width,
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line bg-white px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button tone="ghost" size="icon" onClick={onClose} aria-label="إغلاق">
            <X className="size-5" />
          </Button>
        </header>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-white px-6 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width="max-w-md"
      footer={
        <>
          <Button tone="outline" onClick={onCancel}>
            تراجع
          </Button>
          <Button tone="danger" onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="leading-7 text-ink-2">{message}</p>
    </Modal>
  );
}

/** Touch-friendly numeric pad that edits a decimal string. Always laid out left-to-right like a calculator. */
export function Keypad({
  value,
  onChange,
  maxDecimals,
}: {
  value: string;
  onChange: (value: string) => void;
  maxDecimals: number;
}) {
  const press = (key: string) => {
    if (key === "back") return onChange(value.slice(0, -1));
    if (key === "." && (value.includes(".") || maxDecimals === 0)) return;
    const decimals = value.split(".")[1];
    if (key !== "." && decimals !== undefined && decimals.length >= maxDecimals) return;
    if (value === "0" && key !== ".") return onChange(key);
    onChange(value + key);
  };
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"];
  return (
    <div dir="ltr" className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          aria-label={k === "back" ? "مسح" : k}
          className="flex h-14 items-center justify-center rounded-2xl border border-line bg-white font-display text-2xl font-light text-ink transition-colors hover:bg-surface active:bg-ink/10"
        >
          {k === "back" ? <Delete className="size-6" /> : k}
        </button>
      ))}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "danger" | "ink";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-ink/[0.07] text-ink-2",
    success: "bg-ok-soft text-ok",
    danger: "bg-danger-soft text-danger",
    ink: "bg-ink text-white",
  };
  return (
    <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-base font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

/** White surface for tables and forms on admin pages. */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-xl border border-line bg-white", className)}>{children}</section>;
}
