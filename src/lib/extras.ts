// Extras: what a shop sells by the piece next to its own goods (the fish shop's add-ons, the mobile shop's
// accessories). The same in every shop; `shop.extras` only names them. Mirrors src-tauri/src/commands/extras.rs.
import { call, type Range } from "./api";

/** A main category (`parent_id` null) or a sub category directly under one. */
export interface ExtraCategory {
  id: number;
  name: string;
  parent_id: number | null;
  /** Active items directly in this category. */
  extra_count: number;
}

export interface Extra {
  id: number;
  name: string;
  category_id: number;
  category_name: string;
  parent_category_id: number | null;
  parent_category_name: string | null;
  price: number;
  /** 0 for a cashier, who does not see costs. */
  cost: number;
  /** Counted items have a piece stock; the rest (made in the shop) can always be sold. */
  track_stock: boolean;
  stock_qty: number;
  low_stock_qty: number;
  active: boolean;
}

export interface ExtraInput {
  name: string;
  category_id: number;
  price: number;
  cost: number;
  track_stock: boolean;
  low_stock_qty: number;
}

/** Pieces of an item sent with a sale; the backend prices them again. */
export interface ExtraLine {
  extra_id: number;
  quantity: number;
}

/** An extra as sold, copied at the time of sale. */
export interface SaleExtra {
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

/** Pieces of a counted item on a supplier invoice, and what they cost in all. */
export interface ExtraPurchaseLine {
  extra_id: number;
  quantity: number;
  cost_total: number;
}

export interface PurchaseExtra {
  name: string;
  quantity: number;
  cost_total: number;
}

export interface ExtrasReportRow {
  extra_id: number;
  name: string;
  category_name: string;
  parent_name: string | null;
  sold: number;
  revenue: number;
  cost: number;
  profit: number;
  bought: number;
  bought_cost: number;
}

export const extrasApi = {
  listCategories: () => call<ExtraCategory[]>("list_extra_categories"),
  createCategory: (name: string, parentId: number | null) =>
    call<number>("create_extra_category", { name, parentId }),
  updateCategory: (id: number, name: string, parentId: number | null) =>
    call<void>("update_extra_category", { id, name, parentId }),
  deleteCategory: (id: number) => call<void>("delete_extra_category", { id }),
  list: (includeArchived = false) => call<Extra[]>("list_extras", { includeArchived }),
  create: (input: ExtraInput, openingQty: number) => call<number>("create_extra", { input, openingQty }),
  update: (id: number, input: ExtraInput) => call<void>("update_extra", { id, input }),
  remove: (id: number) => call<"deleted" | "archived">("delete_extra", { id }),
  restore: (id: number) => call<void>("restore_extra", { id }),
  adjustStock: (id: number, qty: number, note: string) => call<void>("adjust_extra_stock", { id, qty, note }),
  report: (r: Range) => call<ExtrasReportRow[]>("report_extras", r),
};

/** An item on the ticket and how many pieces of it. */
export interface ExtraCartLine {
  extra: Extra;
  quantity: number;
}

/** Pieces of `extra` that can still go on the ticket: all of them for an item that is not counted. */
export function piecesLeft(extra: Extra, lines: ExtraCartLine[]): number {
  if (!extra.track_stock) return Infinity;
  const taken = lines.find((l) => l.extra.id === extra.id)?.quantity ?? 0;
  return extra.stock_qty - taken;
}

/** One more piece of `extra`; the same lines back when no counted piece is left (and the shop does not
 *  sell below zero). */
export function addPiece(lines: ExtraCartLine[], extra: Extra, allowNegative: boolean): ExtraCartLine[] {
  if (!allowNegative && piecesLeft(extra, lines) <= 0) return lines;
  return lines.some((l) => l.extra.id === extra.id)
    ? lines.map((l) => (l.extra.id === extra.id ? { ...l, quantity: l.quantity + 1 } : l))
    : [...lines, { extra, quantity: 1 }];
}

/** Adds `delta` pieces to a line, removing it at zero. */
export const changePieces = (lines: ExtraCartLine[], extraId: number, delta: number) =>
  lines.flatMap((l) =>
    l.extra.id !== extraId ? [l] : l.quantity + delta <= 0 ? [] : [{ ...l, quantity: l.quantity + delta }],
  );

export const extrasTotal = (lines: ExtraCartLine[]) =>
  lines.reduce((s, l) => s + l.extra.price * l.quantity, 0);

export const toExtraLines = (lines: ExtraCartLine[]): ExtraLine[] =>
  lines.map((l) => ({ extra_id: l.extra.id, quantity: l.quantity }));

/** Whether `extra` shows under the picked main category (with its sub categories) and sub category. */
export function inCategory(extra: Extra, main: number | null, sub: number | null): boolean {
  if (sub !== null) return extra.category_id === sub;
  if (main !== null) return extra.category_id === main || extra.parent_category_id === main;
  return true;
}
