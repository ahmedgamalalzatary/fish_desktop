import { cx } from "../../lib/cx";
import type { ReadoutProps } from "../../lib/shop";

/** A phone lock screen inside its frame: the readout for totals and change. */
export function Readout({ label, value, unit, size = "lg", warn = false, className }: ReadoutProps) {
  const valueSize = { md: "text-3xl", lg: "text-4xl", xl: "text-5xl" }[size];
  return (
    <div
      className={cx("rounded-[26px] bg-ink-3 p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]", className)}
    >
      <div className="relative rounded-[22px] bg-readout px-5 pt-3 pb-3 text-readout-ink">
        {size !== "md" && (
          <div
            className="mx-auto mb-1 h-[18px] w-[72px] rounded-full bg-black ring-1 ring-white/5"
            aria-hidden
          />
        )}
        <div className="text-xs text-readout-ink/60">{label}</div>
        <div
          dir="ltr"
          className={cx(
            "flex items-baseline justify-end gap-2 font-display leading-tight font-extralight",
            valueSize,
            warn && "text-[#ff6a60]",
          )}
        >
          <span>{value}</span>
          {unit && <span className="font-sans text-sm font-normal text-readout-ink/60">{unit}</span>}
        </div>
      </div>
    </div>
  );
}
