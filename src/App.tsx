import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { api } from "./lib/api";
import { SessionProvider } from "./lib/session";
import type { SessionUser } from "./lib/types";
import { CategoriesPage } from "./pages/CategoriesPage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { LoginPage } from "./pages/LoginPage";
import { PosPage } from "./pages/PosPage";
import { ProductsPage } from "./pages/ProductsPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StockPage } from "./pages/StockPage";

export default function App() {
  const [state, setState] = useState<{
    user: SessionUser | null;
    needsSetup: boolean;
  } | null>(null);

  useEffect(() => {
    Promise.all([api.currentUser(), api.needsSetup()]).then(([user, needsSetup]) =>
      setState({ user, needsSetup }),
    );
  }, []);

  if (!state) return null;
  if (!state.user) {
    return (
      <LoginPage firstRun={state.needsSetup} onLogin={(user) => setState({ user, needsSetup: false })} />
    );
  }

  const isAdmin = state.user.role === "admin";
  return (
    <SessionProvider user={state.user} onLogout={() => setState({ user: null, needsSetup: false })}>
      <HashRouter>
        <Shell>
          <Routes>
            <Route path="/pos" element={<PosPage />} />
            {isAdmin && (
              <>
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/categories" element={<CategoriesPage />} />
                <Route path="/stock" element={<StockPage />} />
                <Route path="/purchases" element={<PurchasesPage />} />
                <Route path="/employees" element={<EmployeesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </>
            )}
            <Route path="*" element={<Navigate to={isAdmin ? "/reports" : "/pos"} replace />} />
          </Routes>
        </Shell>
      </HashRouter>
    </SessionProvider>
  );
}
