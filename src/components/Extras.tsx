import { shop } from "@shop";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { cx } from "../lib/cx";
import { inCategory, type ExtraCategory } from "../lib/extras";
import type { ExtrasTicket } from "../lib/extrasTicket";
import { formatAmount } from "../lib/format";
import { Button, Empty, Select } from "./ui";

// The extras part of a till: each shop puts the catalogue and the ticket lines in its own layout
// (the logic is in src/lib/extrasTicket.tsx).

/** Category picker with sub categories indented under their main category. */
export function ExtraCategorySelect({
  categories,
  value,
  onChange,
  placeholder,
  mainOnly,
  id,
  className,
}: {
  categories: ExtraCategory[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder: string;
  mainOnly?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <Select
      id={id}
      className={className}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{placeholder}</option>
      {categories
        .filter((c) => c.parent_id === null)
        .map((main) => [
          <option key={main.id} value={main.id}>
            {main.name}
          </option>,
          ...(mainOnly
            ? []
            : categories
                .filter((c) => c.parent_id === main.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {"   — "}
                    {c.name}
                  </option>
                ))),
        ])}
    </Select>
  );
}

function Chip({
  active,
  small,
  onClick,
  children,
}: {
  active: boolean;
  small?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "rounded-full border font-medium transition-colors",
        small ? "h-8 px-3 text-sm" : "h-10 px-4",
        active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:border-ink-3/40",
      )}
    >
      {children}
    </button>
  );
}

/** Category chips (main, then the picked main's sub categories) over the item tiles; a tap adds a piece. */
export function ExtrasCatalog({
  ticket,
  query,
  currency,
}: {
  ticket: ExtrasTicket;
  query: string;
  currency: string;
}) {
  const [main, setMain] = useState<number | null>(null);
  const [sub, setSub] = useState<number | null>(null);
  const mains = ticket.categories.filter((c) => c.parent_id === null);
  const subs = ticket.categories.filter((c) => c.parent_id !== null && c.parent_id === main);
  const q = query.trim().toLowerCase();
  const visible = ticket.extras.filter(
    (x) => inCategory(x, main, sub) && (!q || x.name.toLowerCase().includes(q)),
  );

  return (
    <div className="flex flex-col gap-4">
      {mains.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Chip active={main === null} onClick={() => (setMain(null), setSub(null))}>
              الكل
            </Chip>
            {mains.map((c) => (
              <Chip key={c.id} active={main === c.id} onClick={() => (setMain(c.id), setSub(null))}>
                {c.name}
              </Chip>
            ))}
          </div>
          {subs.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-dashed border-line pt-3">
              <Chip small active={sub === null} onClick={() => setSub(null)}>
                الكل
              </Chip>
              {subs.map((c) => (
                <Chip key={c.id} small active={sub === c.id} onClick={() => setSub(c.id)}>
                  {c.name}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}
      {visible.length === 0 ? (
        <Empty title={ticket.extras.length === 0 ? `لا توجد ${shop.extras.title} بعد` : "لا توجد نتائج"}>
          {ticket.extras.length === 0
            ? `يضيف المدير ${shop.extras.title} من صفحتها، ثم تظهر هنا للبيع.`
            : "جرّب اسماً آخر أو اختر تصنيفاً مختلفاً."}
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
          {visible.map((x) => {
            const left = ticket.left(x);
            const out = left <= 0;
            const low = x.track_stock && !out && x.low_stock_qty > 0 && left <= x.low_stock_qty;
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => ticket.add(x)}
                disabled={out && !ticket.allowNegative}
                className="flex min-h-28 flex-col rounded-xl border border-line bg-white p-3 text-start transition-colors hover:border-ink-3/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-3 disabled:opacity-50"
              >
                <div className="text-xs text-muted">{x.category_name}</div>
                <div dir="auto" className="text-right leading-6 font-semibold">
                  {x.name}
                </div>
                <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                  <span className={cx("text-xs", out || low ? "font-medium text-danger" : "text-muted")}>
                    {!x.track_stock ? "" : out ? "نفد المخزون" : `${low ? "منخفض · " : ""}${left} قطعة`}
                  </span>
                  <span className="font-semibold">
                    {formatAmount(x.price)}{" "}
                    <span className="text-[11px] font-normal text-muted">{currency}</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The extras on the ticket, each with its count and line total. */
export function ExtraTicketLines({ ticket }: { ticket: ExtrasTicket }) {
  return ticket.lines.map((l) => (
    <li key={`x${l.extra.id}`} className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div dir="auto" className="truncate text-right font-medium">
          {l.extra.name}
        </div>
        <div className="text-sm text-muted">
          {shop.extras.one} · {formatAmount(l.extra.price)}
        </div>
      </div>
      <div className="flex items-center gap-1 rounded-lg bg-page p-0.5">
        <Button
          tone="ghost"
          size="icon"
          className="size-7"
          onClick={() => ticket.add(l.extra)}
          disabled={!ticket.allowNegative && ticket.left(l.extra) <= 0}
          aria-label="زيادة"
        >
          <Plus className="size-4" />
        </Button>
        <span className="w-6 text-center font-medium">{l.quantity}</span>
        <Button
          tone="ghost"
          size="icon"
          className="size-7"
          onClick={() => ticket.change(l.extra.id, -1)}
          aria-label="نقص"
        >
          <Minus className="size-4" />
        </Button>
      </div>
      <div className="w-20 text-end font-semibold">{formatAmount(l.extra.price * l.quantity)}</div>
    </li>
  ));
}
