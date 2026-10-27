import { shop } from "@shop";
import {
  ChartColumnBig,
  LogOut,
  Settings,
  ShoppingBasket,
  Truck,
  UsersRound,
  WalletMinimal,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useSession } from "../lib/session";
import type { NavItem } from "../lib/shop";

export function Shell({ children }: { children: ReactNode }) {
  const { user, settings, logout } = useSession();
  // Built here, not at load time: the shop's modules import shared code that imports `@shop` back.
  const nav: NavItem[] = [
    { to: "/pos", label: "البيع", icon: ShoppingBasket, cashier: true },
    { to: "/expenses", label: "المصروفات", icon: WalletMinimal, cashier: true },
    { to: "/reports", label: "التقارير", icon: ChartColumnBig },
    ...shop.navItems,
    { to: "/purchases", label: "المشتريات", icon: Truck },
    { to: "/employees", label: "الموظفون", icon: UsersRound },
    { to: "/settings", label: "الإعدادات", icon: Settings },
  ];
  const items = user.role === "admin" ? nav : nav.filter((n) => n.cashier);

  return (
    <div className="flex h-full">
      <aside className="flex w-[92px] shrink-0 flex-col items-center bg-ink py-4 text-white">
        <div
          className="mb-5 px-2 text-center font-display text-lg leading-6 font-light text-white"
          title={settings.shop_name}
        >
          {settings.shop_name.split(" ").slice(0, 2).join(" ")}
        </div>
        <nav className="flex w-full flex-1 flex-col gap-1 px-2">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 rounded-xl py-2.5 text-xs transition-colors ${
                  isActive
                    ? "bg-white font-medium text-ink"
                    : "text-white/60 hover:bg-white/8 hover:text-white"
                }`
              }
            >
              <Icon className="size-6" strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="flex w-full flex-col items-center gap-2 border-t border-white/10 px-2 pt-3">
          <div className="w-full truncate text-center text-xs text-white/80" title={user.name}>
            {user.name}
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex w-full flex-col items-center gap-1 rounded-xl py-2 text-xs text-white/60 transition-colors hover:bg-white/6 hover:text-white"
          >
            <LogOut className="size-5 -scale-x-100" strokeWidth={1.75} />
            خروج
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
