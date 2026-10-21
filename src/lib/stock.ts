import type { Column } from "../components/DataTable";
import { formatAmount, formatWeight, priceForGrams } from "./format";
import type { Product } from "./types";

/** Value of what is on hand at cost price. Negative stock counts as zero. */
export const stockValue = (p: Product) => priceForGrams(p.cost_per_kg, Math.max(p.stock_grams, 0));

export const isLowStock = (p: Product) => p.stock_grams > 0 && p.stock_grams <= p.low_stock_grams;

/** Stock columns shared by the stock page and the printed stock reports. */
export function stockColumns(currency: string): Column<Product>[] {
  return [
    { header: "المنتج", cell: (p) => p.name },
    { header: "التصنيف", cell: (p) => p.category_name },
    { header: "المتوفر", numeric: true, cell: (p) => formatWeight(p.stock_grams) },
    {
      header: "حد التنبيه",
      numeric: true,
      cell: (p) => (p.low_stock_grams ? formatWeight(p.low_stock_grams) : "—"),
    },
    { header: "تكلفة الكيلو", numeric: true, cell: (p) => formatAmount(p.cost_per_kg) },
    { header: `قيمة المخزون (${currency})`, numeric: true, cell: (p) => formatAmount(stockValue(p)) },
  ];
}
