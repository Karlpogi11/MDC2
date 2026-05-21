export type Theme = "light" | "dark";

const STORAGE_KEY = "mdc-theme";

function readStoredTheme(): Theme | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : null;
}

function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return readStoredTheme() ?? "dark";
}

export function applyTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  localStorage.setItem(STORAGE_KEY, theme);
  root.classList.toggle("dark-theme", theme === "dark");
  root.setAttribute("data-theme", theme);
  window.dispatchEvent(new CustomEvent("mdc-theme-change", { detail: theme }));
}
