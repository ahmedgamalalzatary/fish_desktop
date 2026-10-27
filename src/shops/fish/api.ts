import { api as shared, call, type Range } from "../../lib/api";
import type {
  Category,
  CategoryReportRow,
  MovementReason,
  MovementRow,
  Product,
  ProductInput,
  ProductReportRow,
} from "./types";

/** The shared commands plus the fish shop's own. */
export const api = {
  ...shared,

  listCategories: () => call<Category[]>("list_categories"),
  createCategory: (name: string, parentId: number | null) =>
    call<number>("create_category", { name, parentId }),
  updateCategory: (id: number, name: string, parentId: number | null) =>
    call<void>("update_category", { id, name, parentId }),
  deleteCategory: (id: number) => call<void>("delete_category", { id }),

  listProducts: (includeInactive = false) => call<Product[]>("list_products", { includeInactive }),
  createProduct: (input: ProductInput, openingStockGrams: number) =>
    call<number>("create_product", { input, openingStockGrams }),
  updateProduct: (id: number, input: ProductInput) => call<void>("update_product", { id, input }),
  deleteProduct: (id: number) => call<"deleted" | "archived">("delete_product", { id }),
  restoreProduct: (id: number) => call<void>("restore_product", { id }),

  adjustStock: (productId: number, newGrams: number, note: string) =>
    call<void>("adjust_stock", { productId, newGrams, note }),

  reportByProduct: (r: Range) => call<ProductReportRow[]>("report_by_product", r),
  reportByCategory: (r: Range) => call<CategoryReportRow[]>("report_by_category", r),
  reportMovements: (r: Range, reason: MovementReason | null = null) =>
    call<MovementRow[]>("report_movements", { ...r, reason }),
};
