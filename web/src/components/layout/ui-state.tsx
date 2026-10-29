import { createContext, useContext } from "react";

export interface UiState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  isMobile: boolean;
  openSettings: (tab?: SettingsTab) => void;
}
export type SettingsTab = "general" | "generation";

export const UiContext = createContext<UiState | null>(null);

export function useUi() {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi must be used inside AppShell");
  return ui;
}
