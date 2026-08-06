import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const KEY = "rtanalytics_theme";

/**
 * Theme is dark by default (the design target) and persisted per browser.
 * Applied as a data-theme attribute on <html> so all tokens flip at once.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(KEY) as Theme) || "dark"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}
