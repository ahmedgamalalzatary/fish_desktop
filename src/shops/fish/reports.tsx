import { formatAmount, formatDateTime } from "../../lib/format";
import { reportTab } from "../../lib/shop";
import { api } from "./api";
import { formatWeight, movementLabels } from "./format";
import { stockColumns, stockValue } from "./stock";
import type { CategoryReportRow, MovementReason, MovementRow, Product, ProductReportRow } from "./types";

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const margin = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/** Sub-categories folded into their main category, biggest sales first. */
function mergeSubCategories(rows: CategoryReportRow[]): CategoryReportRow[] {
  const merged = new Map<number, CategoryReportRow>();
  for (const r of rows) {
    const id = r.parent_id ?? r.category_id;
    const m = merged.get(id) ?? {
      category_id: id,
      name: r.parent_name ?? r.name,
      parent_id: null,
      parent_name: null,
      grams: 0,
      revenue: 0,
      profit: 0,
    };
    merged.set(id, {
      ...m,
      grams: m.grams + r.grams,
      revenue: m.revenue + r.revenue,
      profit: m.profit + r.profit,
    });
  }
  return [...merged.values()].sort((a, b) => b.revenue - a.revenue);
}

export const reportTabs = [
  reportTab<ProductReportRow>({
    value: "products",
    label: "المنتجات",
    place: "sales",
    empty: "لم يُبع أي منتج في هذه الفترة",
    inFullReport: "المنتجات",
    load: (range) => api.reportByProduct(range),
    rowKey: (r) => r.product_id,
    columns: (rows, s) => [
      { header: "المنتج", cell: (r) => r.name },
      { header: "التصنيف", cell: (r) => r.category_name },
      {
        header: "الوزن المباع",
        numeric: true,
        cell: (r) => formatWeight(r.grams),
        total: formatWeight(sum(rows, (r) => r.grams)),
      },
      { header: "قطع جاهزة", numeric: true, cell: (r) => r.units || "—" },
      {
        header: "المبيعات",
        numeric: true,
        cell: (r) => formatAmount(r.revenue),
        total: formatAmount(s.revenue),
      },
      { header: "التكلفة", numeric: true, cell: (r) => formatAmount(r.cost), total: formatAmount(s.cost) },
      { header: "الربح", numeric: true, cell: (r) => formatAmount(r.profit), total: formatAmount(s.profit) },
      { header: "الهامش", numeric: true, cell: (r) => margin(r.profit, r.revenue) },
    ],
  }),
  reportTab<CategoryReportRow>({
    value: "categories",
    label: "التصنيفات",
    place: "sales",
    empty: "لا توجد مبيعات في هذه الفترة",
    inFullReport: "التصنيفات",
    load: (range) => api.reportByCategory(range),
    rowKey: (r) => r.category_id,
    filter: {
      label: "عرض التصنيفات",
      all: "كل تصنيف فرعي وحده",
      options: [{ value: "merged", label: "دمج التصنيفات الفرعية في الرئيسي" }],
      apply: (rows) => mergeSubCategories(rows),
    },
    columns: (rows, s) => [
      { header: "التصنيف", cell: (r) => (r.parent_name ? `${r.parent_name} / ${r.name}` : r.name) },
      {
        header: "الوزن المباع",
        numeric: true,
        cell: (r) => formatWeight(r.grams),
        total: formatWeight(sum(rows, (r) => r.grams)),
      },
      {
        header: "المبيعات",
        numeric: true,
        cell: (r) => formatAmount(r.revenue),
        total: formatAmount(s.revenue),
      },
      { header: "الربح", numeric: true, cell: (r) => formatAmount(r.profit), total: formatAmount(s.profit) },
      { header: "من إجمالي المبيعات", numeric: true, cell: (r) => margin(r.revenue, s.revenue) },
    ],
  }),
  reportTab<Product>({
    value: "stock",
    label: "المخزون",
    place: "stock",
    snapshot: true,
    intro: "المخزون الحالي لكل المنتجات، بغض النظر عن الفترة المختارة.",
    empty: "لا توجد منتجات",
    inFullReport: "المخزون الحالي",
    load: () => api.listProducts(),
    rowKey: (p) => p.id,
    columns: (rows, _s, currency) =>
      stockColumns(currency).map((c, i, all) =>
        i === all.length - 1 ? { ...c, total: formatAmount(sum(rows, stockValue)) } : c,
      ),
  }),
  reportTab<MovementRow>({
    value: "movements",
    label: "حركة المخزون",
    place: "stock",
    empty: "لا توجد حركات في هذه الفترة",
    load: (range) => api.reportMovements(range),
    rowKey: (r) => r.id,
    filter: {
      label: "نوع الحركة",
      all: "كل الحركات",
      options: (Object.keys(movementLabels) as MovementReason[]).map((r) => ({
        value: r,
        label: movementLabels[r],
      })),
      apply: (rows, reason) => rows.filter((r) => r.reason === reason),
    },
    columns: () => [
      { header: "التاريخ", cell: (r) => <span dir="ltr">{formatDateTime(r.created_at)}</span> },
      { header: "المنتج", cell: (r) => r.product_name },
      { header: "النوع", cell: (r) => movementLabels[r.reason] },
      {
        header: "الكمية",
        numeric: true,
        cell: (r) => (
          <span
            dir="ltr"
            className={r.change_grams < 0 ? "text-danger print:text-black" : "text-ok print:text-black"}
          >
            {r.change_grams > 0 ? "+" : "−"}
            {formatWeight(Math.abs(r.change_grams))}
          </span>
        ),
      },
      {
        header: "التكلفة",
        numeric: true,
        cell: (r) => (r.cost_total === null ? "—" : formatAmount(r.cost_total)),
      },
      {
        header: "ملاحظة",
        cell: (r) =>
          r.note ??
          (r.sale_id
            ? `فاتورة #${r.sale_id}`
            : r.purchase_id
              ? `شراء #${r.purchase_id} · ${r.supplier_name}`
              : ""),
      },
      { header: "بواسطة", cell: (r) => r.user_name },
    ],
  }),
];
