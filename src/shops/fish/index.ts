import { FolderTree, Package, Warehouse } from "lucide-react";
import type { Shop } from "../../lib/shop";
import { CategoriesPage } from "./CategoriesPage";
import { formatWeight } from "./format";
import { LoginArt } from "./LoginArt";
import { PosPage } from "./PosPage";
import { ProductsPage } from "./ProductsPage";
import { purchaseItemColumns, usePurchaseLines } from "./purchases";
import { Readout } from "./Readout";
import { ReceiptItems } from "./ReceiptItems";
import { reportTabs } from "./reports";
import { SettingsSection } from "./SettingsSection";
import { StockPage } from "./StockPage";

export const shop: Shop = {
  title: "نقطة بيع الأسماك",
  navItems: [
    { to: "/products", label: "المنتجات", icon: Package },
    { to: "/categories", label: "التصنيفات", icon: FolderTree },
    { to: "/stock", label: "المخزون", icon: Warehouse },
  ],
  adminRoutes: [
    { path: "/products", Page: ProductsPage },
    { path: "/categories", Page: CategoriesPage },
    { path: "/stock", Page: StockPage },
  ],
  PosPage,
  Readout,
  LoginArt,
  ReceiptItems,
  sampleSale: {
    items: [
      {
        product_name: "بلطي",
        variant_label: null,
        quantity: 1,
        weight_grams: 1500,
        unit_price: 9000,
        line_total: 13500,
      },
      {
        product_name: "جمبري",
        variant_label: "نصف كيلو",
        quantity: 1,
        weight_grams: 500,
        unit_price: 13000,
        line_total: 13000,
      },
    ],
    total: 26500,
    payments: [{ method: "cash", amount: 26500 }],
    paid: 30000,
    change_due: 3500,
  },
  units: {
    noun: "الكمية",
    product: "الصنف",
    perUnit: "متوسط سعر الكيلو",
    per: 1000,
    invoiceLines: "الأصناف",
    format: formatWeight,
    count: formatWeight,
  },
  usePurchaseLines,
  purchaseItemColumns,
  reportTabs,
  SettingsSection,
};
