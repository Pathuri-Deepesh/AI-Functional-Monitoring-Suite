import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_KEY = "fm:theme";

export function getThemePref(): ThemePref {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

export function setThemePref(pref: ThemePref): void {
  try {
    window.localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* ignore */
  }
  applyTheme(pref);
}

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === "system" ? systemTheme() : pref;
}

export function applyTheme(pref: ThemePref): void {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
}

/**
 * Hook returning [pref, setPref, resolved]. `resolved` reflects the system
 * preference live when pref === "system" — so the toggle UI shows the right
 * active state even if the OS flips while the page is open.
 */
export function useTheme(): [ThemePref, (p: ThemePref) => void, ResolvedTheme] {
  const [pref, setPrefState] = useState<ThemePref>(() => getThemePref());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(pref));

  useEffect(() => {
    setResolved(resolveTheme(pref));
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setResolved(systemTheme());
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [pref]);

  function setPref(p: ThemePref) {
    setPrefState(p);
    setThemePref(p);
  }

  return [pref, setPref, resolved];
}
