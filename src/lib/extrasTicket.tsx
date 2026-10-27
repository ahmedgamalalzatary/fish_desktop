// The extras logic that each shop's till, the purchases page and the reports use; the components are in
// src/components/Extras.tsx.
import { shop } from "@shop";
import { Plus, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Column } from "../components/DataTable";
import { Button, Input, Select } from "../components/ui";
import {
  addPiece,
  changePieces,
  extrasApi,
  extrasTotal,
  piecesLeft,
  toExtraLines,
  type Extra,
  type ExtraCartLine,
  type ExtraPurchaseLine,
  type ExtrasReportRow,
  type PurchaseExtra,
} from "./extras";
import { formatAmount, parseCount, parseMoney } from "./format";
import { useSession } from "./session";
import { reportTab } from "./shop";
import type { Purchase } from "./types";
import { useResource } from "./useResource";

export type ExtrasTicket = ReturnType<typeof useExtrasTicket>;

/** The extras on the ticket, with the items and categories to pick them from. */
export function useExtrasTicket(allowNegative: boolean) {
  const [data, reload] = useResource(
    useCallback(() => Promise.all([extrasApi.list(), extrasApi.listCategories()]), []),
  );
  const [extras, categories] = useMemo(() => data ?? [[], []], [data]);
  const [lines, setLines] = useState<ExtraCartLine[]>([]);
  return {
    extras,
    categories,
    lines,
    add: (extra: Extra) => setLines((ls) => addPiece(ls, extra, allowNegative)),
    change: (extraId: number, delta: number) => setLines((ls) => changePieces(ls, extraId, delta)),
    left: (extra: Extra) => piecesLeft(extra, lines),
    allowNegative,
    clear: () => setLines([]),
    total: extrasTotal(lines),
    toSend: () => toExtraLines(lines),
    reload,
  };
}

// ---- Supplier invoices ----

interface PurchaseDraft {
  key: number;
  extraId: string;
  quantity: string;
  cost: string;
}

let draftKey = 0;
const newDraft = (): PurchaseDraft => ({ key: ++draftKey, extraId: "", quantity: "", cost: "" });

/** The counted extras on a supplier invoice: an item, how many pieces and what they cost in all. */
export function useExtraPurchaseLines() {
  const { settings } = useSession();
  const [extras] = useResource(useCallback(() => extrasApi.list(), []));
  const [drafts, setDrafts] = useState<PurchaseDraft[]>([]);
  const counted = (extras ?? []).filter((x) => x.track_stock);
  const byId = new Map(counted.map((x) => [String(x.id), x]));
  const groups = new Map<string, Extra[]>();
  for (const x of counted) {
    const group = (x.parent_category_name ? `${x.parent_category_name} / ` : "") + x.category_name;
    groups.set(group, [...(groups.get(group) ?? []), x]);
  }

  const filled = drafts.filter((d) => d.extraId || d.quantity || d.cost);
  const parsed = drafts.map((d) => ({ quantity: parseCount(d.quantity), cost: parseMoney(d.cost || "0") }));
  const total = parsed.reduce((s, p) => s + (p.cost ?? 0), 0);
  const pieces = parsed.reduce((s, p) => s + (p.quantity ?? 0), 0);
  const setDraft = (key: number, patch: Partial<PurchaseDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const read = (): { lines: ExtraPurchaseLine[] } | { error: string } => {
    const lines: ExtraPurchaseLine[] = [];
    for (const d of filled) {
      const quantity = parseCount(d.quantity);
      const cost = parseMoney(d.cost || "0");
      if (!d.extraId || !quantity || cost === null)
        return { error: `أكمل الصنف والعدد والتكلفة لكل صف في ${shop.extras.title}` };
      lines.push({ extra_id: Number(d.extraId), quantity, cost_total: cost });
    }
    return { lines };
  };

  const editor =
    counted.length === 0 ? null : (
      <div className="rounded-xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="font-medium">{shop.extras.title}</span>
          <Button tone="ghost" size="sm" onClick={() => setDrafts((ds) => [...ds, newDraft()])}>
            <Plus className="size-4" />
            {shop.extras.one}
          </Button>
        </div>
        {drafts.length > 0 && (
          <div className="grid grid-cols-[1fr_7rem_9rem_8rem_2.25rem] gap-3 border-b border-line px-4 py-2.5 text-sm font-medium text-muted">
            <span>{shop.extras.one}</span>
            <span>العدد</span>
            <span>التكلفة ({settings.currency})</span>
            <span className="text-end">تكلفة القطعة</span>
            <span />
          </div>
        )}
        {drafts.map((d, i) => {
          const { quantity, cost } = parsed[i];
          const extra = byId.get(d.extraId);
          return (
            <div
              key={d.key}
              className="grid grid-cols-[1fr_7rem_9rem_8rem_2.25rem] items-center gap-3 border-b border-line/70 px-4 py-2.5"
            >
              <Select
                value={d.extraId}
                onChange={(e) => setDraft(d.key, { extraId: e.target.value })}
                aria-label={shop.extras.one}
              >
                <option value="" disabled>
                  اختر الصنف
                </option>
                {[...groups].map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <Input
                dir="ltr"
                inputMode="numeric"
                value={d.quantity}
                onChange={(e) => setDraft(d.key, { quantity: e.target.value })}
                aria-label="العدد"
                className={d.quantity && !quantity ? "border-danger" : undefined}
              />
              <Input
                dir="ltr"
                inputMode="decimal"
                value={d.cost}
                onChange={(e) => setDraft(d.key, { cost: e.target.value })}
                aria-label="التكلفة"
                className={d.cost && cost === null ? "border-danger" : undefined}
              />
              <div className="text-end text-sm leading-5">
                <div className="font-medium">
                  {quantity && cost ? formatAmount(Math.round(cost / quantity)) : "—"}
                </div>
                {extra && <div className="text-xs text-muted">الحالية {formatAmount(extra.cost)}</div>}
              </div>
              <Button
                tone="ghost"
                size="icon"
                onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                aria-label="حذف الصنف"
              >
                <X className="size-4" />
              </Button>
            </div>
          );
        })}
        {drafts.length > 0 && (
          <p className="px-4 py-2.5 text-xs text-muted">تصبح تكلفة كل صنف هي تكلفة القطعة في هذه الفاتورة.</p>
        )}
      </div>
    );

  return { editor, total, count: `${pieces} قطعة`, empty: filled.length === 0, read };
}

/** Columns of an invoice's extras, on screen and printed. */
export function extraPurchaseColumns(p: Purchase): Column<PurchaseExtra>[] {
  return [
    { header: shop.extras.one, cell: (x) => x.name },
    {
      header: "العدد",
      numeric: true,
      cell: (x) => x.quantity,
      total: p.extras.reduce((s, x) => s + x.quantity, 0),
    },
    {
      header: "تكلفة القطعة",
      numeric: true,
      cell: (x) => formatAmount(Math.round(x.cost_total / x.quantity)),
    },
    {
      header: "التكلفة",
      numeric: true,
      cell: (x) => formatAmount(x.cost_total),
      total: formatAmount(p.extras.reduce((s, x) => s + x.cost_total, 0)),
    },
  ];
}

// ---- Reports ----

const total = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

/** The reports tab of the shop's extras: what each item sold, and what came in on invoices. */
export const extrasReportTab = () =>
  reportTab<ExtrasReportRow>({
    value: "extras",
    label: shop.extras.title,
    place: "sales",
    empty: `لم يُبع أو يُشترَ أي صنف من ${shop.extras.title} في هذه الفترة`,
    inFullReport: shop.extras.title,
    load: (range) => extrasApi.report(range),
    rowKey: (r) => r.extra_id,
    columns: (rows) => [
      { header: shop.extras.one, cell: (r) => r.name },
      { header: "التصنيف", cell: (r) => (r.parent_name ? `${r.parent_name} / ` : "") + r.category_name },
      { header: "العدد المباع", numeric: true, cell: (r) => r.sold, total: total(rows, (r) => r.sold) },
      {
        header: "المبيعات",
        numeric: true,
        cell: (r) => formatAmount(r.revenue),
        total: formatAmount(total(rows, (r) => r.revenue)),
      },
      {
        header: "التكلفة",
        numeric: true,
        cell: (r) => formatAmount(r.cost),
        total: formatAmount(total(rows, (r) => r.cost)),
      },
      {
        header: "الربح",
        numeric: true,
        cell: (r) => formatAmount(r.profit),
        total: formatAmount(total(rows, (r) => r.profit)),
      },
      {
        header: "العدد المشترى",
        numeric: true,
        cell: (r) => r.bought || "—",
        total: total(rows, (r) => r.bought),
      },
      {
        header: "تكلفة المشتريات",
        numeric: true,
        cell: (r) => (r.bought ? formatAmount(r.bought_cost) : "—"),
        total: formatAmount(total(rows, (r) => r.bought_cost)),
      },
    ],
  });
