import type { Column } from "../components/DataTable";
import { formatAmount, formatPieces } from "./format";
import type { Product, Variant } from "./types";

/** One stock line: a variant together with the product it belongs to. */
export interface StockRow {
  product: Product;
  variant: Variant;
}

export const stockRows = (products: Product[]): StockRow[] =>
  products.flatMap((product) => product.variants.map((variant) => ({ product, variant })));

/** Value of what is on hand at cost price. Negative stock counts as zero. */
export const stockValue = (v: Variant) => v.cost * Math.max(v.stock, 0);

export const isLowStock = (v: Variant) => v.stock > 0 && v.stock <= v.low_stock;

/** Total pieces across a product's variants. */
export const productStock = (p: Product) => p.variants.reduce((s, v) => s + v.stock, 0);

/** Stock columns shared by the stock page and the printed stock reports. */
export function stockColumns(currency: string): Column<StockRow>[] {
  return [
    { header: "المنتج", cell: (r) => r.product.name },
    { header: "النوع", cell: (r) => r.variant.label || "—" },
    { header: "التصنيف", cell: (r) => r.product.category_name },
    { header: "المتوفر", numeric: true, cell: (r) => formatPieces(r.variant.stock) },
    {
      header: "حد التنبيه",
      numeric: true,
      cell: (r) => (r.variant.low_stock ? r.variant.low_stock : "—"),
    },
    { header: "سعر الشراء", numeric: true, cell: (r) => formatAmount(r.variant.cost) },
    {
      header: `قيمة المخزون (${currency})`,
      numeric: true,
      cell: (r) => formatAmount(stockValue(r.variant)),
    },
  ];
}
