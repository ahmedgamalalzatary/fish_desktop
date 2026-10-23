// Mirrors the Rust command payloads. Money is integer cents, quantities are whole pieces.

export type Role = "admin" | "cashier";
export type PaymentMethod = "cash" | "card" | "wallet";

export interface SessionUser {
  id: number;
  name: string;
  username: string;
  role: Role;
}

export interface User extends SessionUser {
  active: boolean;
  created_at: string;
  sales_count: number;
}

export interface UserInput {
  name: string;
  username: string;
  role: Role;
  active: boolean;
  password: string | null;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  product_count: number;
}

/** A sellable option of a product, e.g. "128GB أسود". Stock is counted per variant. */
export interface Variant {
  id: number;
  /** Empty for a product sold without options. */
  label: string;
  price: number;
  cost: number;
  stock: number;
  low_stock: number;
}

export interface Product {
  id: number;
  name: string;
  category_id: number;
  category_name: string;
  parent_category_id: number | null;
  parent_category_name: string | null;
  active: boolean;
  /** Always at least one. */
  variants: Variant[];
}

export interface VariantInput {
  /** null for a variant created in this request. */
  id: number | null;
  label: string;
  price: number;
  cost: number;
  low_stock: number;
  /** Pieces on hand when the variant is created; ignored for existing ones. */
  opening_stock: number;
}

export interface ProductInput {
  name: string;
  category_id: number;
  variants: VariantInput[];
}

export interface CartItemInput {
  variant_id: number;
  quantity: number;
}

export interface SaleItem {
  product_name: string;
  variant_label: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface Sale {
  id: number;
  created_at: string;
  cashier_name: string;
  total: number;
  payment_method: PaymentMethod;
  paid: number;
  change_due: number;
  items: SaleItem[];
}

export interface SaleSummary {
  id: number;
  created_at: string;
  cashier_name: string;
  total: number;
  payment_method: PaymentMethod;
  items_count: number;
}

export type Settings = Record<
  "shop_name" | "shop_phone" | "shop_address" | "receipt_footer" | "currency" | "allow_negative_stock",
  string
>;

export interface ReportSummary {
  sales_count: number;
  revenue: number;
  cost: number;
  profit: number;
  units_sold: number;
  purchases_cost: number;
  purchases_units: number;
  supplier_paid: number;
  by_payment: { method: PaymentMethod; count: number; total: number }[];
}

export interface DailyRow {
  day: string;
  sales_count: number;
  revenue: number;
  profit: number;
}

export interface ProductReportRow {
  variant_id: number;
  name: string;
  variant_label: string;
  category_name: string;
  units: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface CategoryReportRow {
  category_id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  units: number;
  revenue: number;
  profit: number;
}

export interface CashierReportRow {
  user_id: number;
  name: string;
  sales_count: number;
  revenue: number;
  profit: number;
  first_sale: string;
  last_sale: string;
}

export type MovementReason = "sale" | "purchase" | "adjustment";

export interface MovementRow {
  id: number;
  created_at: string;
  product_name: string;
  variant_label: string;
  change_qty: number;
  reason: MovementReason;
  cost_total: number | null;
  note: string | null;
  sale_id: number | null;
  purchase_id: number | null;
  supplier_name: string | null;
  user_name: string;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string;
  note: string;
  opening_balance: number;
  active: boolean;
  purchases_count: number;
  purchases_total: number;
  paid_total: number;
  /** What the shop owes the supplier now. */
  balance: number;
  last_purchase: string | null;
}

export interface SupplierInput {
  name: string;
  phone: string;
  note: string;
  opening_balance: number;
  active: boolean;
}

export interface PurchaseItemInput {
  variant_id: number;
  quantity: number;
  /** Buy price of one piece. */
  unit_cost: number;
}

export interface PurchaseInput {
  supplier_id: number;
  invoice_no: string;
  note: string;
  paid: number;
  update_cost: boolean;
  items: PurchaseItemInput[];
}

export interface PurchaseSummary {
  id: number;
  created_at: string;
  supplier_id: number;
  supplier_name: string;
  invoice_no: string;
  items_count: number;
  pieces: number;
  total: number;
  /** Paid while receiving the invoice; later payments go to the supplier's account. */
  paid: number;
  user_name: string;
}

export interface Purchase extends PurchaseSummary {
  note: string;
  items: { product_name: string; variant_label: string; quantity: number; cost_total: number }[];
}

export interface StatementRow {
  kind: "purchase" | "payment";
  id: number;
  created_at: string;
  reference: string;
  purchase_id: number | null;
  amount: number;
}

export interface SupplierReportRow {
  supplier_id: number;
  name: string;
  purchases_count: number;
  purchases_total: number;
  pieces: number;
  paid: number;
  balance: number;
}
