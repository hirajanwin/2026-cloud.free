"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

type Theme = "system" | "light" | "dark";

const themeOrder: Theme[] = ["system", "light", "dark"];

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used within a ThemeProvider");
  return ctx;
}

function ThemeProvider({
  children,
  defaultTheme = "system",
}: {
  children: ReactNode;
  defaultTheme?: Theme;
}) {
  // Same key the inline boot script in <head> reads, so the class it applied
  // before hydration is the one this provider keeps. Theme only drives root
  // classes from an effect, so the lazy client read cannot mismatch markup.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme;
    try {
      const stored = window.localStorage.getItem("theme");
      return stored === "light" || stored === "dark" ? stored : defaultTheme;
    } catch {
      return defaultTheme;
    }
  });
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Skip the `.transitioning` guard on mount — only user-triggered theme
  // changes should suppress/retime transitions.
  const hasAppliedRef = useRef(false);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      if (next === "system") window.localStorage.removeItem("theme");
      else window.localStorage.setItem("theme", next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Single source of truth for the DOM side effects: swap the root classes,
  // bracketed by the `.transitioning` guard (added + reflow-flushed before the
  // swap so the 180ms colour cross-fade applies). Clearing the previous
  // timeout first keeps a double-press from removing the class mid-fade.
  useEffect(() => {
    const root = document.documentElement;
    const animate = hasAppliedRef.current;
    hasAppliedRef.current = true;
    if (animate) {
      root.classList.add("transitioning");
      void root.offsetHeight;
    }
    root.classList.remove("light", "dark");
    if (theme !== "system") root.classList.add(theme);
    if (animate) {
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = setTimeout(
        () => root.classList.remove("transitioning"),
        200
      );
    }
  }, [theme]);

  // Global keyboard shortcut: T to cycle theme
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "t" && e.key !== "T") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      // Just advance the state — the [theme] effect above applies the DOM.
      setThemeState((prev) => themeOrder[(themeOrder.indexOf(prev) + 1) % themeOrder.length]);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export { ThemeProvider, useThemeContext };
export type { Theme };
