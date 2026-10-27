import { api as shared, call, type Range } from "../../lib/api";
import type { MovementReason, MovementRow, PhoneInput, Product, ProductReportRow } from "./types";

/** The shared commands plus the phone shop's own. */
export const api = {
  ...shared,

  listProducts: (includeInactive = false) => call<Product[]>("list_products", { includeInactive }),
  createProduct: (name: string) => call<number>("create_product", { name }),
  updateProduct: (id: number, name: string) => call<void>("update_product", { id, name }),
  deleteProduct: (id: number) => call<"deleted" | "archived">("delete_product", { id }),
  restoreProduct: (id: number) => call<void>("restore_product", { id }),

  addPhones: (productId: number, phones: PhoneInput[]) => call<void>("add_phones", { productId, phones }),
  updatePhone: (id: number, input: PhoneInput) => call<void>("update_phone", { id, input }),
  removePhone: (id: number, note: string) => call<void>("remove_phone", { id, note }),

  reportByProduct: (r: Range) => call<ProductReportRow[]>("report_by_product", r),
  reportMovements: (r: Range, reason: MovementReason | null = null) =>
    call<MovementRow[]>("report_movements", { ...r, reason }),
};
