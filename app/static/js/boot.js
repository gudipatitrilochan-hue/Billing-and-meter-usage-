/* Runs synchronously in <head> before first paint:
   - applies the saved theme + light/dark mode (no flash of wrong theme)
   - marks the page as "arriving" when we came from a GSAP page transition */
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
  try {
    if (sessionStorage.getItem("ml_arrive") === "1") {
      root.classList.add("is-arriving");
      // Safety net: if page scripts fail to load, never leave the curtain covering the page.
      setTimeout(function () {
        if (root.classList.contains("is-arriving")) {
          root.classList.remove("is-arriving");
          try { sessionStorage.removeItem("ml_arrive"); } catch (e) {}
        }
      }, 2500);
    }
  } catch (e) {}
})();
