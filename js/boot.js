/* Runs synchronously in <head> before first paint:
   applies the saved theme + light/dark mode (no flash of the wrong theme). */
(function () {
  var root = document.documentElement;
  var pref = null;
  try { pref = JSON.parse(localStorage.getItem("ml_theme") || "null"); } catch (e) {}
  var mode = pref && pref.mode;
  if (mode !== "light" && mode !== "dark") {
    mode = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  root.setAttribute("data-mode", mode);
  root.setAttribute("data-theme", (pref && pref.theme) || "mint");
})();
