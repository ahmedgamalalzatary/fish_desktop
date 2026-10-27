// What every shop provides. Each src/shops/<shop>/index.ts exports a `shop` that satisfies `Shop`;
// shared code reads it through the `@shop` alias, so the build decides which shop it gets.
//
// The shop's modules import shared pages that import `@shop` back, so shared code reads `shop` inside
// components and functions, never at the top level of a module.
import type { PurchaseItem, PurchaseLines, SaleItem } from "@shop/types";
import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { Column } from "../components/DataTable";
import type { Range } from "./api";
import type { Purchase, ReportSummary, Sale, Settings } from "./types";

/** The big totals display on the till, the checkout and the reports. */
export interface ReadoutProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  size?: "md" | "lg" | "xl";
  /** Shows the value as a warning, e.g. when the customer has not paid enough. */
  warn?: boolean;
  className?: string;
}

/** A sidebar page. `cashier` marks the pages a cashier can open too. */
export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  cashier?: true;
}

/** How the shop counts what it sells, for the shared reports and invoices. */
export interface Units {
  /** The plural, with the article, that "sold", "bought" and "received" follow: "الأجهزة". */
  noun: string;
  /** What one product is called in a table header: "الموديل". */
  product: string;
  /** Header for the average buy price of `per` units: "متوسط سعر الجهاز". */
  perUnit: string;
  /** The average price of one unit, for `perUnit`, from what `units` of them cost. */
  unitPrice: (cost: number, units: number) => string;
  /** Header for how many lines an invoice has ("الأصناف"), for shops where that is not the units. */
  invoiceLines?: string;
  /** A quantity in a table cell. */
  format: (units: number) => ReactNode;
  /** A quantity in a sentence: "3 أجهزة". */
  count: (units: number) => string;
}

/** The lines of the purchase invoice form, owned by the shop. */
export interface PurchaseForm {
  /** The rows to fill in. */
  editor: ReactNode;
  total: number;
  /** What the filled-in lines add up to, in words: "3 أجهزة". */
  count: string;
  /** No line is filled in; `read` then gives no lines, for an invoice of extras only. */
  empty: boolean;
  /** The lines to send, or why they cannot be sent yet. */
  read: () => { items: PurchaseLines } | { error: string };
}

/** A reports tab that only this shop has (sales per product, stock…). */
export interface ReportTab<T> {
  value: string;
  label: string;
  /** "sales" tabs follow the invoices tab; "stock" tabs come last. */
  place: "sales" | "stock";
  /** Shows the state now, whatever period is picked (the stock on hand). */
  snapshot?: boolean;
  /** A line above the table. */
  intro?: string;
  empty: string;
  load: (range: Range) => Promise<T[]>;
  columns: (rows: T[], summary: ReportSummary, currency: string) => Column<T>[];
  rowKey: (row: T) => string | number;
  /** Section title in the full report; tabs without one are left out of it. */
  inFullReport?: string;
  /** A drop-down over the rows: narrow them (by kind of movement) or regroup them (merge categories). */
  filter?: {
    label: string;
    /** The first option, which shows the rows as loaded. */
    all: string;
    options: { value: string; label: string }[];
    apply: (rows: T[], value: string) => T[];
  };
}

/** Lets a shop list tabs of different row types together. */
export const reportTab = <T>(tab: ReportTab<T>) => tab as unknown as ReportTab<unknown>;

/** What the shop calls the things it sells by the piece next to its own goods (see src/lib/extras.ts). */
export interface ExtrasNames {
  /** The page, tab and sidebar title: "الإضافات". */
  title: string;
  /** One of them, in a sentence or a table header: "إضافة". */
  one: string;
  /** The add button: "إضافة جديدة". */
  newOne: string;
  icon: LucideIcon;
  /** Example categories, for the empty page: "«مشروبات» و«سلطات»". */
  categoriesExample: string;
  /** Example name in the item form: "عصير برتقال". */
  nameExample: string;
}

export interface Shop {
  /** Window and document title. */
  title: string;
  /** The shop's own sidebar pages, listed after the reports. */
  navItems: NavItem[];
  /** Pages only an admin opens, matching the paths of `navItems`. */
  adminRoutes: { path: string; Page: ComponentType }[];
  /** The till. */
  PosPage: ComponentType;
  Readout: ComponentType<ReadoutProps>;
  /** The left half of the sign-in screen: the shop's picture and what the app is for. */
  LoginArt: ComponentType;
  /** The item lines of a receipt. */
  ReceiptItems: ComponentType<{ items: SaleItem[] }>;
  /** The made-up sale the receipt preview in the settings shows. */
  sampleSale: Pick<Sale, "items" | "extras" | "total" | "payments" | "paid" | "change_due">;
  extras: ExtrasNames;
  units: Units;
  /** The line rows of the purchase invoice form; a hook, called once per form. `productId` pre-fills
   *  the first line where the shop supports it. */
  usePurchaseLines: (productId?: number) => PurchaseForm;
  /** Columns of one invoice's lines, on screen and printed. */
  purchaseItemColumns: (purchase: Purchase) => Column<PurchaseItem>[];
  reportTabs: ReportTab<unknown>[];
  /** Settings only this shop has, shown as their own section on the settings page. */
  SettingsSection?: ComponentType<{ draft: Settings; set: (key: string) => (value: string) => void }>;
}
