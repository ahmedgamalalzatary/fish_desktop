import { Package, Warehouse } from "lucide-react";
import type { Shop } from "../../lib/shop";
import { LoginArt } from "./LoginArt";
import { Readout } from "./Readout";

export const shop = {
  title: "نقطة بيع الموبايلات",
  tagline: "كل جهاز برقمه التسلسلي وسعته ولونه وبطاريته، ويخرج من المخزون مع فاتورته.",
  navItems: [
    { to: "/products", label: "المنتجات", icon: Package },
    { to: "/stock", label: "المخزون", icon: Warehouse },
  ],
  Readout,
  LoginArt,
} satisfies Shop;
