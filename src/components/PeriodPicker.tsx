import { cx } from "../lib/cx";
import { presetRange, presets, type Preset, type Range } from "../lib/periods";
import { Input } from "./ui";

/** Period chips, plus two date fields when "فترة محددة" is chosen. */
export function PeriodPicker({
  preset,
  range,
  onChange,
}: {
  preset: Preset;
  range: Range;
  onChange: (preset: Preset, range: Range) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onChange(p.value, p.value === "custom" ? range : presetRange(p.value))}
          aria-pressed={preset === p.value}
          className={cx(
            "h-9 rounded-full border px-4 text-sm font-medium transition-colors",
            preset === p.value
              ? "border-ink bg-ink text-white"
              : "border-line bg-white text-ink-2 hover:border-ink-3/40",
          )}
        >
          {p.label}
        </button>
      ))}
      {preset === "custom" && (
        <div className="flex items-center gap-2 ps-2">
          <Input
            type="date"
            className="w-40"
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && onChange(preset, { ...range, from: e.target.value })}
            aria-label="من"
          />
          <span className="text-muted">إلى</span>
          <Input
            type="date"
            className="w-40"
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && onChange(preset, { ...range, to: e.target.value })}
            aria-label="إلى"
          />
        </div>
      )}
    </div>
  );
}
