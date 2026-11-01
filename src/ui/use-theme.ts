import { useEffect, useState } from "react";
import type { Settings } from "../shared/preferences";
export function useTheme(theme: Settings["theme"] = "system") {
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const value =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = value;
      setResolved(value);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return resolved;
}
