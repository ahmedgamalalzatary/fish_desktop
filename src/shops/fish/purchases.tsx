import { Plus, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Column } from "../../components/DataTable";
import { Button, Input, Select, Toggle } from "../../components/ui";
import { formatAmount, parseMoney } from "../../lib/format";
import { useSession } from "../../lib/session";
import type { PurchaseForm } from "../../lib/shop";
import type { Purchase } from "../../lib/types";
import { useResource } from "../../lib/useResource";
import { api } from "./api";
import { formatGramPrice, formatWeight, parseGrams, perGram } from "./format";
import type { Product, PurchaseItem } from "./types";

interface Line {
  key: number;
  productId: string;
  grams: string;
  cost: string;
}

let lineKey = 0;
const newLine = (productId = ""): Line => ({
  key: ++lineKey,
  productId,
  grams: "",
  cost: "",
});

/** The invoice's lines: a product, its weight and what it cost. `productId` pre-fills the first line. */
export function usePurchaseLines(productId?: number): PurchaseForm {
  const { settings } = useSession();
  const [products] = useResource(useCallback(() => api.listProducts(), []));
  const [lines, setLines] = useState<Line[]>(() => [newLine(productId ? String(productId) : "")]);
  const [updateCost, setUpdateCost] = useState(true);

  const byId = useMemo(() => new Map((products ?? []).map((p) => [String(p.id), p])), [products]);
  const groups = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products ?? []) {
      const group = p.parent_category_name
        ? `${p.parent_category_name} / ${p.category_name}`
        : p.category_name;
      map.set(group, [...(map.get(group) ?? []), p]);
    }
    return [...map.entries()];
  }, [products]);

  const parsed = lines.map((l) => ({ grams: parseGrams(l.grams), cost: parseMoney(l.cost || "0") }));
  const total = parsed.reduce((s, l) => s + (l.cost ?? 0), 0);
  const grams = parsed.reduce((s, l) => s + (l.grams ?? 0), 0);
  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const read = () => {
    const filled = lines
      .map((l, i) => ({ l, ...parsed[i] }))
      .filter(({ l }) => l.productId || l.grams || l.cost);
    if (filled.length === 0) return { items: { update_cost: updateCost, lines: [] } };
    if (filled.some(({ l, grams, cost }) => !l.productId || !grams || cost === null))
      return { error: "أكمل المنتج والوزن والتكلفة لكل صنف" };
    return {
      items: {
        update_cost: updateCost,
        lines: filled.map(({ l, grams, cost }) => ({
          product_id: Number(l.productId),
          grams: grams!,
          cost_total: cost!,
        })),
      },
    };
  };

  const editor = (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-white">
        <div className="grid grid-cols-[1fr_8rem_9rem_8rem_2.25rem] gap-3 border-b border-line px-4 py-2.5 text-sm font-medium text-muted">
          <span>المنتج</span>
          <span>الوزن (جم)</span>
          <span>التكلفة ({settings.currency})</span>
          <span className="text-end">تكلفة الجرام</span>
          <span />
        </div>
        {lines.map((l, i) => {
          const { grams, cost } = parsed[i];
          const product = byId.get(l.productId);
          const unitCost = grams && cost ? perGram(cost, grams) : null;
          return (
            <div
              key={l.key}
              className="grid grid-cols-[1fr_8rem_9rem_8rem_2.25rem] items-center gap-3 border-b border-line/70 px-4 py-2.5"
            >
              <Select
                value={l.productId}
                onChange={(e) => setLine(l.key, { productId: e.target.value })}
                aria-label="المنتج"
              >
                <option value="" disabled>
                  اختر المنتج
                </option>
                {groups.map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <Input
                dir="ltr"
                inputMode="numeric"
                value={l.grams}
                onChange={(e) => setLine(l.key, { grams: e.target.value })}
                aria-label="الوزن بالجرام"
                className={l.grams && !grams ? "border-danger" : undefined}
              />
              <Input
                dir="ltr"
                inputMode="decimal"
                value={l.cost}
                onChange={(e) => setLine(l.key, { cost: e.target.value })}
                aria-label="التكلفة"
                className={l.cost && cost === null ? "border-danger" : undefined}
              />
              <div className="text-end text-sm leading-5">
                <div className="font-medium">{unitCost !== null ? formatGramPrice(unitCost) : "—"}</div>
                {product && (
                  <div className="text-xs text-muted" title="تكلفة الجرام المسجّلة حالياً">
                    الحالية {formatGramPrice(product.cost_per_gram)}
                  </div>
                )}
              </div>
              <Button
                tone="ghost"
                size="icon"
                onClick={() =>
                  setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))
                }
                aria-label="حذف الصنف"
              >
                <X className="size-4" />
              </Button>
            </div>
          );
        })}
        <div className="px-4 py-2.5">
          <Button tone="ghost" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
            <Plus className="size-4" />
            إضافة صنف
          </Button>
        </div>
      </div>
      <Toggle
        checked={updateCost}
        onChange={setUpdateCost}
        label="تحديث تكلفة الجرام للمنتجات"
        description="تصبح تكلفة كل منتج هي تكلفة الجرام في هذه الفاتورة، فيُحسب الربح بالسعر الجديد."
      />
    </div>
  );

  const empty = lines.every((l) => !l.productId && !l.grams && !l.cost);
  return { editor, total, count: formatWeight(grams), empty, read };
}

export function purchaseItemColumns(p: Purchase): Column<PurchaseItem>[] {
  return [
    { header: "المنتج", cell: (i) => i.product_name },
    {
      header: "الوزن",
      numeric: true,
      cell: (i) => formatWeight(i.grams),
      total: formatWeight(p.units),
    },
    {
      header: "تكلفة الجرام",
      numeric: true,
      cell: (i) => formatGramPrice(perGram(i.cost_total, i.grams)),
    },
    {
      header: "التكلفة",
      numeric: true,
      cell: (i) => formatAmount(i.cost_total),
      total: formatAmount(p.items.reduce((s, i) => s + i.cost_total, 0)),
    },
  ];
}
