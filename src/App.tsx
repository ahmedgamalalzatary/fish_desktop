import { shop } from "@shop";
import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { StartupUpdate } from "./components/Updates";
import { api } from "./lib/api";
import { SessionProvider } from "./lib/session";
import type { SessionUser } from "./lib/types";
import { ActivationPage } from "./pages/ActivationPage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { LoginPage } from "./pages/LoginPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  const [activation, setActivation] = useState<{ active: boolean; device_code: string } | null>(null);
  const [state, setState] = useState<{
    user: SessionUser | null;
    needsSetup: boolean;
  } | null>(null);

  useEffect(() => {
    api.activationStatus().then(setActivation);
    Promise.all([api.currentUser(), api.needsSetup()]).then(([user, needsSetup]) =>
      setState({ user, needsSetup }),
    );
  }, []);

  if (!state || !activation) return null;
  if (!activation.active) {
    return (
      <>
        <ActivationPage
          deviceCode={activation.device_code}
          onActive={() => setActivation({ ...activation, active: true })}
        />
        <StartupUpdate />
      </>
    );
  }
  if (!state.user) {
    return (
      <>
        <LoginPage firstRun={state.needsSetup} onLogin={(user) => setState({ user, needsSetup: false })} />
        <StartupUpdate />
      </>
    );
  }

  const isAdmin = state.user.role === "admin";
  return (
    <SessionProvider user={state.user} onLogout={() => setState({ user: null, needsSetup: false })}>
      <HashRouter>
        <Shell>
          <Routes>
            <Route path="/pos" element={<shop.PosPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            {isAdmin && (
              <>
                <Route path="/reports" element={<ReportsPage />} />
                {shop.adminRoutes.map(({ path, Page }) => (
                  <Route key={path} path={path} element={<Page />} />
                ))}
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
