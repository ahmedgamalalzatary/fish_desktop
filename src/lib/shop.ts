// What every shop provides. Each src/shops/<shop>/index.ts exports a `shop` that satisfies `Shop`;
// shared code reads it through the `@shop` alias, so the build decides which shop it gets.
import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

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

export interface Shop {
  /** Window and document title. */
  title: string;
  /** One line under the art on the sign-in screen. */
  tagline: string;
  /** The shop's own sidebar pages, listed after the reports. */
  navItems: NavItem[];
  Readout: ComponentType<ReadoutProps>;
  /** The picture on the sign-in screen. */
  LoginArt: ComponentType;
}
