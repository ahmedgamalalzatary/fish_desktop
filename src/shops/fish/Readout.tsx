import { cx } from "../../lib/cx";
import type { ReadoutProps } from "../../lib/shop";

/** The scale-style readout used for totals, weights and change. */
export function Readout({ label, value, unit, size = "lg", warn = false, className }: ReadoutProps) {
  const valueSize = { md: "text-2xl", lg: "text-4xl", xl: "text-5xl" }[size];
  return (
    <div
      className={cx(
        "rounded-md bg-readout px-4 py-3 text-readout-ink shadow-[inset_0_2px_10px_rgb(0_0_0/0.45),inset_0_0_0_1px_rgb(159_232_224/0.08)]",
        className,
      )}
    >
      <div className="text-xs text-readout-ink/60" dir="rtl">
        {label}
      </div>
      <div
        dir="ltr"
        className={cx(
          "flex items-baseline justify-end gap-2 leading-tight font-light tracking-wide [text-shadow:0_0_12px_rgb(159_232_224/0.35)]",
          valueSize,
          // A light red the dark glass keeps readable, e.g. when the customer has not paid enough.
          warn && "text-[#ff9e94]",
        )}
      >
        <span>{value}</span>
        {unit && <span className="text-sm font-normal text-readout-ink/70">{unit}</span>}
      </div>
    </div>
  );
}
