import type { Column } from "../components/DataTable";
import { formatAmount, formatDateTime } from "./format";
import type { Phone, Product } from "./types";

/** One phone in stock together with its model. */
export interface StockRow {
  product: Product;
  phone: Phone;
}

export const stockRows = (products: Product[]): StockRow[] =>
  products.flatMap((product) => product.phones.map((phone) => ({ product, phone })));

const sum = (rows: StockRow[], f: (p: Phone) => number) => rows.reduce((s, r) => s + f(r.phone), 0);

/** Stock columns shared by the stock page and the printed stock reports, with totals for `rows`. */
export function stockColumns(rows: StockRow[]): Column<StockRow>[] {
  return [
    { header: "الموديل", cell: (r) => r.product.name },
    { header: "الرقم التسلسلي", cell: (r) => <span dir="ltr">{r.phone.serial}</span> },
    { header: "السعة", cell: (r) => r.phone.storage || "—" },
    { header: "اللون", cell: (r) => r.phone.color || "—" },
    {
      header: "البطارية",
      numeric: true,
      cell: (r) => (r.phone.battery === null ? "—" : `${r.phone.battery}%`),
    },
    { header: "أُضيف", cell: (r) => formatDateTime(r.phone.created_at).split(" ")[0] },
    {
      header: "سعر الشراء",
      numeric: true,
      cell: (r) => formatAmount(r.phone.cost),
      total: formatAmount(sum(rows, (p) => p.cost)),
    },
    {
      header: "سعر البيع",
      numeric: true,
      cell: (r) => formatAmount(r.phone.price),
      total: formatAmount(sum(rows, (p) => p.price)),
    },
  ];
}
