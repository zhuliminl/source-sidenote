import { createContext, useContext } from "react";

export interface UiState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  isMobile: boolean;
}

export const UiContext = createContext<UiState | null>(null);

export function useUi() {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi must be used inside AppShell");
  return ui;
}
