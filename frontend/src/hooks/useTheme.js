import { useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "maverik-theme";

export const THEMES = [
  { id: "spacemacs", label: "Spacemacs" },
  { id: "terminal-clay", label: "Terminal Clay" },
  { id: "ops-console", label: "Ops Console" },
  { id: "ledger", label: "Ledger" },
];

const DEFAULT_THEME = THEMES[0].id;

function isKnownTheme(id) {
  return THEMES.some((t) => t.id === id);
}

// Persists the chosen theme to localStorage and reflects it as [data-theme] on <html>, which is
// what every CSS custom property in styles.css is scoped under. index.html sets the attribute
// synchronously (before React mounts) from the same storage key, so there's no flash of the
// default theme on reload — this hook just keeps state and storage in sync from then on.
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isKnownTheme(stored) ? stored : DEFAULT_THEME;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return [theme, setTheme];
}
