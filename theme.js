const STORAGE_KEY = "dtd-theme";
const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

function systemTheme() {
  return mediaQuery.matches ? "dark" : "light";
}

function storedTheme() {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

function applyTheme(theme, manual = false) {
  const resolved = theme === "light" || theme === "dark" ? theme : systemTheme();
  document.documentElement.dataset.theme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = resolved === "dark" ? "#0a1628" : "#f7f8fb";
  }

  const toggle = document.querySelector("#themeToggle .theme-icon");
  if (toggle) {
    toggle.textContent = resolved === "dark" ? "☀" : "☾";
  }

  if (manual) {
    localStorage.setItem(STORAGE_KEY, resolved);
  }

  document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: resolved } }));
}

applyTheme(storedTheme() || systemTheme());

function initTheme() {
  mediaQuery.addEventListener("change", () => {
    if (!storedTheme()) applyTheme(systemTheme());
  });

  const toggle = document.querySelector("#themeToggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next, true);
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTheme);
} else {
  initTheme();
}

window.dtdTheme = { applyTheme, storedTheme, systemTheme };
