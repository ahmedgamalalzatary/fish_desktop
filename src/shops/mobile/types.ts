// The mobile shop's payloads: one row per phone, tracked by its serial.

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

/** A phone as sold, copied at the time of sale. */
export interface SaleItem {
  product_name: string;
  serial: string;
  storage: string;
  color: string;
  battery: number | null;
  price: number;
}

/** The phones being sold, by id. */
export type Cart = number[];

/** One phone on a supplier invoice; its `cost` is what the supplier charged. */
export interface PurchaseLine extends PhoneInput {
  product_id: number;
}

/** An invoice's lines: one per phone. */
export type PurchaseLines = PurchaseLine[];

/** A phone as it came in on an invoice, and where it is now. */
export interface PurchaseItem {
  product_name: string;
  serial: string;
  storage: string;
  color: string;
  battery: number | null;
  cost: number;
  status: "in_stock" | "sold" | "removed";
}

export interface ProductReportRow {
  product_id: number;
  name: string;
  units: number;
  revenue: number;
  cost: number;
  profit: number;
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
