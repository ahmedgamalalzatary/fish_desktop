// The fish shop's payloads. Weights are integer grams, money integer cents, and a price per gram is in
// thousandths of a cent (0.09 a gram is 9000).

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  product_count: number;
}

/** A fixed-weight pack of a product ("500 g box"), with its own price. */
export interface Variant {
  id: number | null;
  label: string;
  weight_grams: number;
  price: number;
  cost: number;
}

export interface Product {
  id: number;
  name: string;
  category_id: number;
  category_name: string;
  parent_category_id: number | null;
  parent_category_name: string | null;
  sell_by_weight: boolean;
  /** Thousandths of a cent per gram, like `cost_per_gram`. */
  price_per_gram: number;
  cost_per_gram: number;
  stock_grams: number;
  low_stock_grams: number;
  active: boolean;
  variants: Variant[];
}

export interface ProductInput {
  name: string;
  category_id: number;
  sell_by_weight: boolean;
  price_per_gram: number;
  cost_per_gram: number;
  low_stock_grams: number;
  variants: Variant[];
}

/** One line of the cart: a pack and how many, or a weight typed in. */
export interface CartItem {
  product_id: number;
  variant_id: number | null;
  quantity: number;
  weight_grams: number | null;
}

export type Cart = CartItem[];

/** A line as sold, copied at the time of sale. */
export interface SaleItem {
  product_name: string;
  variant_label: string | null;
  quantity: number;
  weight_grams: number;
  /** A pack's price in cents, or for a weighed line the price per gram in thousandths of a cent. */
  unit_price: number;
  line_total: number;
}

/** Grams of one product on a supplier invoice, and what they cost. */
export interface PurchaseLine {
  product_id: number;
  grams: number;
  cost_total: number;
}

export interface PurchaseLines {
  /** Set each product's cost per gram from this invoice. */
  update_cost: boolean;
  lines: PurchaseLine[];
}

export interface PurchaseItem {
  product_name: string;
  grams: number;
  cost_total: number;
}

export interface ProductReportRow {
  product_id: number;
  name: string;
  category_name: string;
  /** Packs sold; weighed sales count in `grams` only. */
  units: number;
  grams: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface CategoryReportRow {
  category_id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  grams: number;
  revenue: number;
  profit: number;
}

export type MovementReason = "sale" | "purchase" | "adjustment";

export interface MovementRow {
  id: number;
  created_at: string;
  product_name: string;
  change_grams: number;
  reason: MovementReason;
  cost_total: number | null;
  note: string | null;
  sale_id: number | null;
  purchase_id: number | null;
  supplier_name: string | null;
  user_name: string;
}
