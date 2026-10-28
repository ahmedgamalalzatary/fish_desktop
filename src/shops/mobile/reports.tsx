import { creditReportTab } from "../../lib/credit";
import { formatAmount, formatDateTime } from "../../lib/format";
import { reportTab } from "../../lib/shop";
import { api } from "./api";
import { movementLabels } from "./format";
import { stockColumns, stockRows } from "./stock";
import type { MovementReason, MovementRow, ProductReportRow } from "./types";

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const margin = (profit: number, revenue: number) =>
  revenue ? `${Math.round((profit / revenue) * 100)}%` : "—";

export const reportTabs = [
  reportTab<ProductReportRow>({
    value: "products",
    label: "المنتجات",
    place: "sales",
    empty: "لم يُبع أي منتج في هذه الفترة",
    inFullReport: "المنتجات",
    load: (range) => api.reportByProduct(range),
    rowKey: (r) => r.product_id,
    columns: (rows) => [
      { header: "الموديل", cell: (r) => r.name },
      {
        header: "الأجهزة المباعة",
        numeric: true,
        cell: (r) => r.units,
        total: sum(rows, (r) => r.units),
      },
      {
        header: "المبيعات",
        numeric: true,
        cell: (r) => formatAmount(r.revenue),
        total: formatAmount(sum(rows, (r) => r.revenue)),
      },
      {
        header: "التكلفة",
        numeric: true,
        cell: (r) => formatAmount(r.cost),
        total: formatAmount(sum(rows, (r) => r.cost)),
      },
      {
        header: "الربح",
        numeric: true,
        cell: (r) => formatAmount(r.profit),
        total: formatAmount(sum(rows, (r) => r.profit)),
      },
      {
        header: "الهامش",
        numeric: true,
        cell: (r) => margin(r.profit, r.revenue),
      },
    ],
  }),
  creditReportTab,
  reportTab({
    value: "stock",
    label: "المخزون",
    place: "stock",
    snapshot: true,
    intro: "المخزون الحالي لكل المنتجات، بغض النظر عن الفترة المختارة.",
    empty: "لا توجد منتجات",
    inFullReport: "المخزون الحالي",
    load: () => api.listProducts().then(stockRows),
    rowKey: (r) => r.phone.id,
    columns: (rows) => stockColumns(rows),
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
      {
        header: "التاريخ",
        cell: (r) => <span dir="ltr">{formatDateTime(r.created_at)}</span>,
      },
      { header: "الموديل", cell: (r) => r.product_name },
      { header: "الرقم التسلسلي", cell: (r) => <span dir="ltr">{r.serial}</span> },
      { header: "الحركة", cell: (r) => movementLabels[r.reason] },
      {
        header: "الكمية",
        numeric: true,
        cell: (r) => (
          <span
            dir="ltr"
            className={r.change_qty < 0 ? "text-danger print:text-black" : "text-ok print:text-black"}
          >
            {r.change_qty > 0 ? "+" : "−"}
            {Math.abs(r.change_qty)}
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
