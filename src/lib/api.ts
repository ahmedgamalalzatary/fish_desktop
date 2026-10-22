import { invoke } from "@tauri-apps/api/core";
import type {
  CartItemInput,
  CashierReportRow,
  Category,
  CategoryReportRow,
  DailyRow,
  MovementReason,
  MovementRow,
  PaymentMethod,
  Product,
  ProductInput,
  ProductReportRow,
  Purchase,
  PurchaseInput,
  PurchaseSummary,
  ReportSummary,
  Sale,
  SaleSummary,
  SessionUser,
  Settings,
  StatementRow,
  Supplier,
  SupplierInput,
  SupplierReportRow,
  User,
  UserInput,
} from "./types";

/** Backend errors arrive as plain Arabic strings; wrap them so callers can rely on `Error.message`. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : String(e), { cause: e });
  }
}

type Range = { from: string; to: string };

export const api = {
  needsSetup: () => call<boolean>("needs_setup"),
  setupAdmin: (name: string, username: string, password: string) =>
    call<SessionUser>("setup_admin", { name, username, password }),
  login: (username: string, password: string) => call<SessionUser>("login", { username, password }),
  logout: () => call<void>("logout"),
  currentUser: () => call<SessionUser | null>("current_user"),
  changePassword: (current: string, newPassword: string) =>
    call<void>("change_password", { current, newPassword }),

  listUsers: () => call<User[]>("list_users"),
  createUser: (input: UserInput) => call<number>("create_user", { input }),
  updateUser: (id: number, input: UserInput) => call<void>("update_user", { id, input }),
  deleteUser: (id: number) => call<"deleted" | "deactivated">("delete_user", { id }),

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

  listSuppliers: () => call<Supplier[]>("list_suppliers"),
  createSupplier: (input: SupplierInput) => call<number>("create_supplier", { input }),
  updateSupplier: (id: number, input: SupplierInput) => call<void>("update_supplier", { id, input }),
  deleteSupplier: (id: number) => call<"deleted" | "deactivated">("delete_supplier", { id }),
  addSupplierPayment: (supplierId: number, amount: number, note: string) =>
    call<void>("add_supplier_payment", { supplierId, amount, note }),
  deleteSupplierPayment: (id: number) => call<void>("delete_supplier_payment", { id }),
  supplierStatement: (supplierId: number) => call<StatementRow[]>("supplier_statement", { supplierId }),

  createPurchase: (input: PurchaseInput) => call<number>("create_purchase", { input }),
  listPurchases: (range: Range, supplierId: number | null = null) =>
    call<PurchaseSummary[]>("list_purchases", { ...range, supplierId }),
  getPurchase: (id: number) => call<Purchase>("get_purchase", { id }),
  deletePurchase: (id: number) => call<void>("delete_purchase", { id }),

  createSale: (items: CartItemInput[], paymentMethod: PaymentMethod, paid: number) =>
    call<Sale>("create_sale", { items, paymentMethod, paid }),
  getSale: (id: number) => call<Sale>("get_sale", { id }),
  listSales: (range: Range, userId: number | null = null) =>
    call<SaleSummary[]>("list_sales", { ...range, userId }),

  getSettings: () => call<Settings>("get_settings"),
  updateSettings: (values: Partial<Settings>) => call<void>("update_settings", { values }),
  backupDatabase: (path: string) => call<void>("backup_database", { path }),

  reportSummary: (r: Range) => call<ReportSummary>("report_summary", r),
  reportDaily: (r: Range) => call<DailyRow[]>("report_daily", r),
  reportByProduct: (r: Range) => call<ProductReportRow[]>("report_by_product", r),
  reportByCategory: (r: Range) => call<CategoryReportRow[]>("report_by_category", r),
  reportByCashier: (r: Range) => call<CashierReportRow[]>("report_by_cashier", r),
  reportMovements: (r: Range, reason: MovementReason | null = null) =>
    call<MovementRow[]>("report_movements", { ...r, reason }),
  reportBySupplier: (r: Range) => call<SupplierReportRow[]>("report_by_supplier", r),
};
