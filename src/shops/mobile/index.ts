import { Package, Warehouse } from "lucide-react";
import type { Shop } from "../../lib/shop";
import { formatPhones } from "./format";
import { LoginArt } from "./LoginArt";
import { PosPage } from "./PosPage";
import { ProductsPage } from "./ProductsPage";
import { purchaseItemColumns, usePurchaseLines } from "./purchases";
import { Readout } from "./Readout";
import { ReceiptItems } from "./ReceiptItems";
import { reportTabs } from "./reports";
import { StockPage } from "./StockPage";

export const shop = {
  title: "نقطة بيع الموبايلات",
  tagline: "كل جهاز برقمه التسلسلي وسعته ولونه وبطاريته، ويخرج من المخزون مع فاتورته.",
  navItems: [
    { to: "/products", label: "المنتجات", icon: Package },
    { to: "/stock", label: "المخزون", icon: Warehouse },
  ],
  adminRoutes: [
    { path: "/products", Page: ProductsPage },
    { path: "/stock", Page: StockPage },
  ],
  PosPage,
  Readout,
  LoginArt,
  ReceiptItems,
  sampleSale: {
    items: [
      {
        product_name: "Samsung Galaxy S24 Ultra",
        serial: "352914110482316",
        storage: "256GB",
        color: "رمادي",
        battery: 94,
        price: 3245000,
      },
    ],
    total: 3245000,
    payments: [
      { method: "cash", amount: 1245000 },
      { method: "card", amount: 2000000 },
    ],
    paid: 3250000,
    change_due: 5000,
  },
  units: {
    noun: "الأجهزة",
    product: "الموديل",
    perUnit: "متوسط سعر الجهاز",
    per: 1,
    invoiceLines: "الأجهزة",
    format: (n) => n,
    count: formatPhones,
  },
  usePurchaseLines,
  purchaseItemColumns,
  reportTabs,
} satisfies Shop;
