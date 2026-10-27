import { CupSoda, FolderTree, Package, Warehouse } from "lucide-react";
import type { Shop } from "../../lib/shop";
import { CategoriesPage } from "./CategoriesPage";
import { formatGramPrice, formatWeight, perGram } from "./format";
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
        variant_label: "علبة 500 جم",
        quantity: 1,
        weight_grams: 500,
        unit_price: 13000,
        line_total: 13000,
      },
    ],
    extras: [{ name: "سلطة خضراء", quantity: 2, unit_price: 1500, line_total: 3000 }],
    total: 29500,
    payments: [{ method: "cash", amount: 29500 }],
    paid: 30000,
    change_due: 500,
  },
  extras: {
    title: "الإضافات",
    one: "إضافة",
    newOne: "إضافة جديدة",
    icon: CupSoda,
    categoriesExample: "«مشروبات» و«سلطات»، وتحت «مشروبات»: «عصير» و«مياه»",
    nameExample: "عصير برتقال",
  },
  units: {
    noun: "الكمية",
    product: "الصنف",
    perUnit: "متوسط سعر الجرام",
    unitPrice: (cost, units) => formatGramPrice(perGram(cost, units)),
    invoiceLines: "الأصناف",
    format: formatWeight,
    count: formatWeight,
  },
  usePurchaseLines,
  purchaseItemColumns,
  reportTabs,
  SettingsSection,
};
