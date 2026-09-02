import { useEffect, useState } from "react";
import { useThemeContext } from "@/lib/theme-context";

/** "light" | "dark" after resolving the system preference. */
export function useResolvedTheme(): "light" | "dark" {
  const { theme } = useThemeContext();
  const [system, setSystem] = useState<"light" | "dark">("light");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setSystem(mq.matches ? "dark" : "light");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return theme === "system" ? system : theme;
}
