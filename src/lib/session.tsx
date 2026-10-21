import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { SessionUser, Settings } from "./types";

interface SessionValue {
  user: SessionUser;
  settings: Settings;
  reloadSettings: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  user,
  onLogout,
  children,
}: {
  user: SessionUser;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);

  const reloadSettings = useCallback(async () => setSettings(await api.getSettings()), []);
  useEffect(() => {
    api.getSettings().then(setSettings);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    onLogout();
  }, [onLogout]);

  if (!settings) return null;
  return (
    <SessionContext.Provider value={{ user, settings, reloadSettings, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
