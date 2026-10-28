import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
const KEY = "sidenote-theme";
const media = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function resolvedTheme(pref = read()): "light" | "dark" {
  return pref === "system" ? (media.matches ? "dark" : "light") : pref;
}

function apply() {
  document.documentElement.classList.toggle("dark", resolvedTheme() === "dark");
  listeners.forEach((l) => l());
}
media.addEventListener("change", apply);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Theme preference shared by the whole app; mirrors public/theme.js for first paint. */
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, read);
  const resolved = useSyncExternalStore(subscribe, () => resolvedTheme());
  const setPreference = useCallback((p: ThemePreference) => {
    try {
      if (p === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch {}
    apply();
  }, []);
  useEffect(apply, []);
  return { preference, resolved, setPreference };
}
