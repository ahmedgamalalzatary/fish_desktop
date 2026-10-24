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

/** One physical phone in stock. Stock is the number of these. */
export interface Phone {
  id: number;
  product_id: number;
  serial: string;
  storage: string;
  color: string;
  /** Battery health in percent; null when not recorded (e.g. a new phone). */
  battery: number | null;
  price: number;
  /** Buy price; 0 for cashiers, who never see it. */
  cost: number;
  /** Set when the phone came in on a supplier invoice, which then fixes its buy price. */
  purchase_id: number | null;
  created_at: string;
}

/** A phone model, e.g. "Samsung Galaxy S24 Ultra", with its phones in stock. */
export interface Product {
  id: number;
  name: string;
  active: boolean;
  phones: Phone[];
}

export interface PhoneInput {
  serial: string;
  storage: string;
  color: string;
  battery: number | null;
  price: number;
  cost: number;
}

/** What the customer handed over with one method. Only cash may be more than due; the rest is change. */
export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
}

/** What one method covered of a sale, change already taken off. A sale's payments add up to its total. */
export interface Payment {
  method: PaymentMethod;
  amount: number;
}

/** A phone as sold, copied at the time of sale. */
export interface SaleItem {
  product_name: string;
  serial: string;
  storage: string;
  color: string;
  battery: number | null;
  price: number;
}

export interface Sale {
  id: number;
  created_at: string;
  cashier_name: string;
  total: number;
  payments: Payment[];
  /** Everything handed over, cash change included. */
  paid: number;
  change_due: number;
  items: SaleItem[];
}

export interface SaleSummary {
  id: number;
  created_at: string;
  cashier_name: string;
  total: number;
  methods: PaymentMethod[];
  items_count: number;
}

export type Settings = Record<
  "shop_name" | "shop_phone" | "shop_address" | "receipt_footer" | "currency",
  string
>;

export interface ReportSummary {
  sales_count: number;
  revenue: number;
  cost: number;
  /** Revenue minus the cost of the pieces sold. */
  profit: number;
  units_sold: number;
  expenses: number;
  /** Profit after expenses. */
  net_profit: number;
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

export type PeriodGroup = "day" | "month" | "year";

export interface PeriodRow {
  /** YYYY-MM-DD, YYYY-MM or YYYY, depending on the grouping. */
  period: string;
  sales_count: number;
  units_sold: number;
  revenue: number;
  cost: number;
  profit: number;
  expenses: number;
  net_profit: number;
  purchases_cost: number;
  purchases_units: number;
}

export interface PurchasedItemRow {
  product_id: number;
  name: string;
  units: number;
  cost: number;
}

export interface Expense {
  id: number;
  created_at: string;
  amount: number;
  reason: string;
  user_id: number;
  user_name: string;
}

export interface ProductReportRow {
  product_id: number;
  name: string;
  units: number;
  revenue: number;
  cost: number;
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

export type MovementReason = "added" | "purchase" | "sale" | "removed";

export interface MovementRow {
  id: number;
  created_at: string;
  product_name: string;
  serial: string;
  storage: string;
  color: string;
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

/** One phone on a supplier invoice; its `cost` is what the supplier charged. */
export interface PurchaseItemInput extends PhoneInput {
  product_id: number;
}

export interface PurchaseInput {
  supplier_id: number;
  invoice_no: string;
  note: string;
  paid: number;
  items: PurchaseItemInput[];
}

export interface PurchaseSummary {
  id: number;
  created_at: string;
  supplier_id: number;
  supplier_name: string;
  invoice_no: string;
  /** Phones on the invoice. */
  items_count: number;
  total: number;
  /** Paid while receiving the invoice; later payments go to the supplier's account. */
  paid: number;
  user_name: string;
}

export interface Purchase extends PurchaseSummary {
  note: string;
  items: {
    product_name: string;
    serial: string;
    storage: string;
    color: string;
    battery: number | null;
    cost: number;
    status: "in_stock" | "sold" | "removed";
  }[];
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
