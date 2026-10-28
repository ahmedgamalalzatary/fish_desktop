import { Headphones, Package, Warehouse } from "lucide-react";
import { formatAmount } from "../../lib/format";
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

export const shop: Shop = {
  title: "نقطة بيع الموبايلات",
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
    extras: [{ name: "جراب سيليكون", quantity: 1, unit_price: 15000, line_total: 15000 }],
    total: 3260000,
    payments: [
      { method: "cash", amount: 1260000 },
      { method: "card", amount: 2000000 },
    ],
    paid: 3265000,
    change_due: 5000,
  },
  extras: {
    title: "الإكسسوارات",
    one: "إكسسوار",
    newOne: "إكسسوار جديد",
    icon: Headphones,
    categoriesExample: "«جرابات» و«اسكرينات» و«شواحن»، وتحت «جرابات»: «جرابات آيفون»",
    nameExample: "جراب سيليكون آيفون 15",
  },
  units: {
    noun: "الأجهزة",
    product: "الموديل",
    perUnit: "متوسط سعر الجهاز",
    unitPrice: (cost, units) => formatAmount(Math.round(cost / units)),
    format: (n) => n,
    count: formatPhones,
  },
  usePurchaseLines,
  purchaseItemColumns,
  reportTabs,
  creditSales: true,
};
