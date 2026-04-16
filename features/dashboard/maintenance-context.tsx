"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type MaintenanceValue = {
  enabled: boolean;
  message: string;
  refresh: () => Promise<void>;
};

const MaintenanceContext = createContext<MaintenanceValue | null>(null);

export function MaintenanceProvider({
  children,
  isAdmin,
}: {
  children: ReactNode;
  isAdmin: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (isAdmin) {
      setEnabled(false);
      setMessage("");
      return;
    }
    try {
      const response = await fetch("/api/maintenance", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { enabled?: boolean; message?: string };
      setEnabled(Boolean(data.enabled));
      setMessage(typeof data.message === "string" ? data.message : "");
    } catch {
      // сеть / сервер — не блокируем кабинет полностью
    }
  }, [isAdmin]);

  useEffect(() => {
    void refresh();
    if (isAdmin) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 45_000);
    return () => window.clearInterval(id);
  }, [refresh, isAdmin]);

  const value = useMemo(
    () => ({
      enabled: isAdmin ? false : enabled,
      message: isAdmin ? "" : message,
      refresh,
    }),
    [enabled, message, refresh, isAdmin],
  );

  return <MaintenanceContext.Provider value={value}>{children}</MaintenanceContext.Provider>;
}

export function useMaintenance() {
  const ctx = useContext(MaintenanceContext);
  if (!ctx) {
    return {
      enabled: false,
      message: "",
      refresh: async () => {},
    };
  }
  return ctx;
}
