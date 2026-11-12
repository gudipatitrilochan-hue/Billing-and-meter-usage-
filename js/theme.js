// Theme registry. Add your own theme here + a matching [data-theme] block in css/themes.css.
export const THEMES = [
  { id: "mint", name: "Mint", swatch: "#22c55e" },
  { id: "iris", name: "Iris", swatch: "#8b5cf6" },
  { id: "amber", name: "Amber", swatch: "#f59e0b" },
  { id: "ocean", name: "Ocean", swatch: "#0ea5e9" },
];

const root = document.documentElement;

export function getTheme() {
  return { theme: root.getAttribute("data-theme") || "mint", mode: root.getAttribute("data-mode") || "light" };
}

function save(t) {
  try { localStorage.setItem("ml_theme", JSON.stringify(t)); } catch (e) {}
}

/**
 * Apply a theme with a circular reveal that grows from the click point
 * (View Transitions API), falling back to an instant swap.
 */
export function setTheme(next, origin) {
  const cur = getTheme();
  const t = { ...cur, ...next };
  if (t.theme === cur.theme && t.mode === cur.mode) return;
  const apply = () => {
    root.setAttribute("data-theme", t.theme);
    root.setAttribute("data-mode", t.mode);
    save(t);
    window.dispatchEvent(new CustomEvent("ml:themechange", { detail: t }));
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduced) return apply();
  const x = origin ? origin.clientX : innerWidth - 60;
  const y = origin ? origin.clientY : innerHeight - 40;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = document.startViewTransition(apply);
  vt.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 650, easing: "cubic-bezier(.22,1,.36,1)", pseudoElement: "::view-transition-new(root)" }
    );
  }).catch(() => {});
}

/** Read a CSS token (for Chart.js colours). */
export function token(name) {
  return getComputedStyle(root).getPropertyValue(name).trim();
}
