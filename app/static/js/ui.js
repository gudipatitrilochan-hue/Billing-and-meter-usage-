// Shared UI: app shell (sidebar / top nav), toasts, modals, loading/empty/error states,
// command palette (⌘K), theme dock, and small DOM helpers. All user data goes in via
// textContent (PRD Section 11 output safety).

import { CONFIG } from "./config.js";
import { getSession } from "./auth-store.js";
import { signOut } from "./auth.js";
import { api, ApiError, resetDemoData } from "./api.js";
import { initMotion, enhance, reveal, navigate, reduced } from "./motion.js";
import { THEMES, getTheme, setTheme } from "./theme.js";

const gsap = window.gsap;

// ---------------- DOM helpers ----------------

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Trusted static SVG icons only (never user data). */
const ICONS = {
  overview: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  tenants: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  plans: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>',
  invoices: '<path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 3 2 3-2 3 2 3-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  simulator: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  portal: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a6 6 0 0 0 6-6c0-4.9-4.5-9-10-9z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/>',
};

export function icon(name, size = 18) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", size);
  s.setAttribute("height", size);
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.8");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.classList.add("ml-icon");
  s.innerHTML = ICONS[name] || "";
  return s;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
export const param = (k) => new URLSearchParams(location.search).get(k);

// ---------------- periods ----------------

export const currentPeriod = () => new Date().toISOString().slice(0, 7);
export function shiftPeriod(period, delta) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
export function periodLabel(period, style = "long") {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: style, year: "numeric", timeZone: "UTC" });
}

/** Segmented month picker (prev / label / next) capped at the current month. */
export function monthPicker(initial, onChange, { min } = {}) {
  let value = initial;
  const label = el("span", { class: "ml-month__label", "aria-live": "polite" });
  const prev = el("button", { class: "ml-month__btn", type: "button", "aria-label": "Previous month" }, icon("back", 16));
  const next = el("button", { class: "ml-month__btn", type: "button", "aria-label": "Next month" }, icon("arrow", 16));
  const wrap = el("div", { class: "ml-month", role: "group", "aria-label": "Billing month" }, prev, label, next);
  const sync = () => {
    label.textContent = periodLabel(value);
    next.disabled = value >= currentPeriod();
    prev.disabled = !!min && value <= min;
  };
  const go = (d) => {
    value = shiftPeriod(value, d);
    sync();
    if (gsap && !reduced) gsap.fromTo(label, { y: d * -10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 });
    onChange(value);
  };
  prev.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));
  sync();
  return { el: wrap, get value() { return value; }, set(v) { value = v; sync(); } };
}

// ---------------- status + money bits ----------------

const STATUS_TEXT = { draft: "Draft", finalized: "Finalized", paid: "Paid", void: "Void", active: "Active", suspended: "Suspended" };
export function statusPill(status) {
  return el("span", { class: `ml-status ml-status--${status}` }, el("i", { "aria-hidden": "true" }), STATUS_TEXT[status] || status);
}

export function planBadge(planId, plans) {
  const p = plans && plans.find((x) => x.id === planId);
  return el("span", { class: `ml-plan ml-plan--${planId}` }, p ? p.name : planId);
}

export function avatar(name) {
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return el("span", { class: "ml-avatar", style: { "--h": h }, "aria-hidden": "true" }, initials);
}

// ---------------- toasts ----------------

function toastHost() {
  let host = qs(".ml-toasts");
  if (!host) {
    host = el("div", { class: "ml-toasts", role: "region", "aria-label": "Notifications" });
    document.body.append(host);
  }
  return host;
}

export function toast(message, { type = "info", action, timeout = 4200, title } = {}) {
  const ic = type === "success" ? "check" : type === "error" ? "alert" : "bolt";
  const t = el("div", { class: `ml-toast ml-toast--${type}`, role: type === "error" ? "alert" : "status" },
    el("span", { class: "ml-toast__icon" }, icon(ic, 16)),
    el("div", { class: "ml-toast__body" }, title ? el("strong", { text: title }) : null, el("span", { text: message })),
  );
  const close = () => {
    if (!t.isConnected) return;
    if (gsap && !reduced) gsap.to(t, { x: 40, opacity: 0, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0, duration: 0.35, onComplete: () => t.remove() });
    else t.remove();
  };
  if (action) {
    t.append(el("button", { class: "ml-toast__action", type: "button", onclick: () => { close(); action.onClick(); } }, action.label));
  }
  t.append(el("button", { class: "ml-toast__close", type: "button", "aria-label": "Dismiss", onclick: close }, icon("close", 14)));
  toastHost().append(t);
  if (gsap && !reduced) gsap.from(t, { x: 60, opacity: 0, duration: 0.5, ease: "back.out(1.6)" });
  if (timeout) setTimeout(close, timeout);
  return close;
}

export function errorToast(err, retry) {
  if (err instanceof ApiError && err.status === 401) {
    setFlash("Key not recognised — please sign in again.", "error");
    signOut();
    return;
  }
  const detail = err instanceof ApiError ? err.detail : String(err && err.message || err);
  toast(detail, { type: "error", title: err && err.status === 0 ? "Offline" : undefined, action: retry ? { label: "Retry", onClick: retry } : undefined, timeout: 6500 });
}

export function setFlash(message, type = "info") {
  try { sessionStorage.setItem("ml_flash", JSON.stringify({ message, type })); } catch (e) {}
}
function showFlash() {
  let f = null;
  try { f = JSON.parse(sessionStorage.getItem("ml_flash") || "null"); sessionStorage.removeItem("ml_flash"); } catch (e) {}
  if (f) setTimeout(() => toast(f.message, { type: f.type }), 500);
}

// ---------------- states ----------------

export function skeleton(rows = 4, cls = "") {
  const wrap = el("div", { class: `ml-skeleton ${cls}`, "aria-busy": "true", "aria-label": "Loading" });
  for (let i = 0; i < rows; i++) wrap.append(el("div", { class: "ml-skeleton__row", style: { width: `${70 + ((i * 37) % 30)}%` } }));
  return wrap;
}

export function emptyState({ title = "Nothing here yet", body, action } = {}) {
  return el("div", { class: "ml-empty" },
    el("div", { class: "ml-empty__orb", "aria-hidden": "true" }),
    el("h3", { text: title }),
    body ? el("p", { text: body }) : null,
    action ? (action.href
      ? el("a", { class: "btn ml-btn ml-btn--ink", href: action.href }, action.label)
      : el("button", { class: "btn ml-btn ml-btn--ink", type: "button", onclick: action.onClick }, action.label)) : null,
  );
}

export function errorState(err, retry) {
  const detail = err instanceof ApiError ? err.detail : "Something went wrong.";
  return el("div", { class: "ml-empty ml-empty--error", role: "alert" },
    el("span", { class: "ml-empty__icon" }, icon("alert", 22)),
    el("h3", { text: err && err.status === 0 ? "Can't reach the billing server" : "Couldn't load this" }),
    el("p", { text: detail }),
    retry ? el("button", { class: "btn ml-btn ml-btn--ghost", type: "button", onclick: retry }, icon("refresh", 16), "Retry") : null,
  );
}

/** Run a loader into a container with loading / error states handled. */
export async function load(container, loader, { rows = 4, cls } = {}) {
  container.replaceChildren(skeleton(rows, cls));
  try {
    return await loader();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { errorToast(e); throw e; }
    container.replaceChildren(errorState(e, () => load(container, loader, { rows, cls })));
    throw e;
  }
}

// ---------------- modal (Bootstrap) ----------------

export function openModal({ title, body, footer, size = "", onClose, labelledBy } = {}) {
  const id = "m" + Math.random().toString(36).slice(2, 8);
  const titleEl = el("h2", { class: "modal-title", id: id + "-t", text: title });
  const content = el("div", { class: "modal-content ml-modal" },
    el("div", { class: "modal-header" }, titleEl, el("button", { type: "button", class: "ml-iconbtn", "data-bs-dismiss": "modal", "aria-label": "Close" }, icon("close", 16))),
    el("div", { class: "modal-body" }, body),
    footer ? el("div", { class: "modal-footer" }, footer) : null,
  );
  const dialog = el("div", { class: `modal-dialog modal-dialog-centered ${size}` }, content);
  const modal = el("div", { class: "modal fade", tabindex: "-1", "aria-labelledby": labelledBy || id + "-t", "aria-modal": "true", role: "dialog" }, dialog);
  document.body.append(modal);
  const bs = new window.bootstrap.Modal(modal);
  modal.addEventListener("shown.bs.modal", () => {
    const f = modal.querySelector("[autofocus], input, select, textarea");
    if (f) f.focus();
  });
  modal.addEventListener("show.bs.modal", () => {
    if (gsap && !reduced) gsap.fromTo(content, { y: 30, scale: 0.96, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.5, ease: "back.out(1.4)", delay: 0.05 });
  });
  modal.addEventListener("hidden.bs.modal", () => { modal.remove(); onClose && onClose(); });
  bs.show();
  enhance(modal);
  return { el: modal, body: content, close: () => bs.hide() };
}

export function confirmModal({ title, message, confirmLabel = "Confirm", danger = false, input }) {
  return new Promise((resolve) => {
    let done = false;
    let field = null;
    const body = el("div", {}, el("p", { class: "ml-muted mb-3", text: message }));
    if (input) {
      field = el("textarea", { class: "form-control ml-input", rows: "2", id: "confirm-input", placeholder: input.placeholder || "", maxlength: "200", required: true });
      body.append(el("label", { class: "ml-label", for: "confirm-input", text: input.label }), field);
    }
    const cancel = el("button", { class: "btn ml-btn ml-btn--ghost", type: "button", "data-bs-dismiss": "modal" }, "Cancel");
    const ok = el("button", { class: `btn ml-btn ${danger ? "ml-btn--danger" : "ml-btn--ink"}`, type: "button" }, confirmLabel);
    const m = openModal({ title, body, footer: [cancel, ok], onClose: () => { if (!done) resolve(null); } });
    ok.addEventListener("click", () => {
      if (field && !field.value.trim()) { field.classList.add("is-invalid"); field.focus(); return; }
      done = true;
      resolve(field ? field.value.trim() : true);
      m.close();
    });
  });
}

// ---------------- clipboard / download ----------------

export async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, { type: "success", timeout: 1800 });
    return true;
  } catch (e) {
    toast("Copy failed — select the text and copy it manually", { type: "error" });
    return false;
  }
}

export function downloadText(filename, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: url, download: filename, "data-no-transition": "" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------- shell ----------------

const ADMIN_NAV = [
  { id: "overview", label: "Overview", href: "overview.html", icon: "overview" },
  { id: "tenants", label: "Tenants", href: "tenants.html", icon: "tenants" },
  { id: "plans", label: "Plans & pricing", href: "plans.html", icon: "plans" },
  { id: "invoices", label: "Invoices", href: "invoices.html", icon: "invoices" },
  { id: "simulator", label: "Event simulator", href: "simulator.html", icon: "simulator" },
];
const TENANT_NAV = [
  { id: "portal", label: "My usage", href: "portal.html", icon: "portal" },
  { id: "plans", label: "Price list", href: "plans.html", icon: "plans" },
];

function logo() {
  return el("a", { class: "ml-logo", href: "index.html", "aria-label": "MeterLedger home" },
    el("span", { class: "ml-logo__mark", "aria-hidden": "true" }, el("i"), el("i"), el("i")),
    el("span", { class: "ml-logo__word" }, "Meter", el("b", {}, "Ledger")));
}

function modeBadge() {
  const mock = CONFIG.API_MODE === "mock";
  return el("span", { class: `ml-apimode ${mock ? "is-mock" : "is-live"}`, title: mock ? "Data comes from the in-browser mock API" : "Connected to the FastAPI backend" },
    el("i", { "aria-hidden": "true" }), mock ? "Mock API" : "Live API");
}

/**
 * Build the page chrome.
 * @param {{page:string, title?:string, subtitle?:string, actions?:Node[]}} opts
 */
export function mountShell({ page, title, subtitle, actions = [] } = {}) {
  const session = getSession();
  const app = qs(".ml-app");
  const main = qs("#main");
  initMotion();
  showFlash();

  if (session && session.role === "admin") {
    app.classList.add("ml-app--admin");
    const nav = el("nav", { class: "ml-nav", "aria-label": "Main" },
      ...ADMIN_NAV.map((n) => el("a", { class: `ml-nav__item ${n.id === page ? "is-active" : ""}`, href: n.href, "aria-current": n.id === page ? "page" : null }, icon(n.icon), el("span", { text: n.label }))));
    const indicator = el("span", { class: "ml-nav__indicator", "aria-hidden": "true" });
    nav.prepend(indicator);
    const side = el("aside", { class: "ml-side", id: "ml-side" },
      el("div", { class: "ml-side__top" }, logo(), el("button", { class: "ml-iconbtn ml-side__close", type: "button", "aria-label": "Close menu", onclick: () => toggleSide(false) }, icon("close"))),
      el("button", { class: "ml-cmdk-btn", type: "button", onclick: openPalette }, icon("search", 16), el("span", { text: "Jump to…" }), el("kbd", { text: navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K" })),
      nav,
      el("div", { class: "ml-side__foot" },
        el("div", { class: "ml-side__card ml-panel" },
          el("span", { class: "ml-eyebrow ml-eyebrow--dark" }, el("i"), "Billing admin"),
          el("p", { text: "Generate drafts in one click on the Invoices page." }),
          el("a", { class: "ml-side__cta", href: "invoices.html" }, "Open invoices", icon("arrow", 14))),
        el("div", { class: "ml-side__row" }, modeBadge(),
          CONFIG.API_MODE === "mock" ? el("button", { class: "ml-linkbtn", type: "button", onclick: confirmReset }, "Reset demo data") : null),
        el("button", { class: "ml-nav__item ml-nav__item--quiet", type: "button", onclick: signOut }, icon("logout"), el("span", { text: "Sign out" })),
      ),
    );
    const scrim = el("div", { class: "ml-scrim", onclick: () => toggleSide(false) });
    app.prepend(side, scrim);
    requestAnimationFrame(() => moveIndicator(nav, false));
  } else {
    app.classList.add("ml-app--top");
    const links = (session ? TENANT_NAV : [{ id: "plans", label: "Price list", href: "plans.html", icon: "plans" }])
      .map((n) => el("a", { class: `ml-topnav__link ${n.id === page ? "is-active" : ""}`, href: n.href, "aria-current": n.id === page ? "page" : null }, n.label));
    const right = session
      ? [el("span", { class: "ml-topnav__who" }, avatar(session.tenant.name), el("span", { text: session.tenant.name })),
         el("button", { class: "btn ml-btn ml-btn--ghost ml-btn--sm", type: "button", onclick: signOut }, icon("logout", 15), "Sign out")]
      : [el("a", { class: "btn ml-btn ml-btn--ink ml-btn--sm", href: "index.html", "data-magnetic": "0.2" }, "Sign in")];
    const bar = el("header", { class: "ml-topnav" },
      el("div", { class: "ml-topnav__inner" }, logo(), el("nav", { class: "ml-topnav__links", "aria-label": "Main" }, ...links), el("div", { class: "ml-topnav__right" }, modeBadge(), ...right)));
    app.prepend(bar);
  }

  if (title) {
    const head = el("header", { class: "ml-pagehead" },
      session && session.role === "admin" ? el("button", { class: "ml-iconbtn ml-menu-btn", type: "button", "aria-label": "Open menu", "aria-controls": "ml-side", onclick: () => toggleSide(true) }, icon("menu")) : null,
      el("div", { class: "ml-pagehead__text" }, el("h1", { class: "ml-h1", text: title }), subtitle ? el("p", { class: "ml-pagehead__sub", text: subtitle }) : null),
      el("div", { class: "ml-pagehead__actions" }, ...actions));
    main.prepend(head);
  }

  mountThemeDock();
  bindPalette();
  window.addEventListener("ml:mock-storage-full", () => toast("Demo storage is full. Reset demo data to keep testing.", { type: "error", timeout: 0, action: { label: "Reset", onClick: confirmReset } }));
  reveal(qsa(".ml-pagehead > *"), { stagger: 0.08 });
  enhance(document);
  return session;
}

/** For pages without the app shell (sign in): motion, flash and theme dock only. */
export function mountBare() {
  initMotion();
  showFlash();
  mountThemeDock();
  enhance(document);
}

function moveIndicator(nav, animate = true) {
  const active = nav.querySelector(".is-active");
  const ind = nav.querySelector(".ml-nav__indicator");
  if (!active || !ind) return;
  const props = { y: active.offsetTop, height: active.offsetHeight, opacity: 1 };
  if (gsap && animate && !reduced) gsap.to(ind, { ...props, duration: 0.45, ease: "expo.out" });
  else if (gsap) gsap.set(ind, props);
}

function toggleSide(open) {
  const side = qs(".ml-side");
  const scrim = qs(".ml-scrim");
  if (!side) return;
  side.classList.toggle("is-open", open);
  scrim.classList.toggle("is-open", open);
  if (open) {
    if (gsap && !reduced) {
      gsap.fromTo(side, { xPercent: -100 }, { xPercent: 0, duration: 0.5, ease: "expo.out" });
      gsap.from(side.querySelectorAll(".ml-nav__item"), { x: -20, opacity: 0, stagger: 0.04, delay: 0.1 });
    }
    side.querySelector("a, button")?.focus();
  } else if (gsap && !reduced) {
    gsap.set(side, { clearProps: "transform" });
  }
}

async function confirmReset() {
  const ok = await confirmModal({ title: "Reset demo data?", message: "This rebuilds the mock database from the seed: 3 plans, 8 tenants and 3 months of events. Anything you created will be gone.", confirmLabel: "Reset data", danger: true });
  if (!ok) return;
  await resetDemoData();
  setFlash("Demo data was reset from the seed.", "success");
  location.reload();
}

// ---------------- theme dock (bottom-right Light | Dark pill) ----------------

function mountThemeDock() {
  if (qs(".ml-dock")) return;
  const { mode } = getTheme();
  const light = el("button", { class: `ml-dock__seg ${mode === "light" ? "is-on" : ""}`, type: "button", "aria-pressed": String(mode === "light") }, icon("sun", 14), "Light");
  const dark = el("button", { class: `ml-dock__seg ${mode === "dark" ? "is-on" : ""}`, type: "button", "aria-pressed": String(mode === "dark") }, icon("moon", 14), "Dark");
  const thumb = el("span", { class: "ml-dock__thumb", "aria-hidden": "true" });
  const pal = el("button", { class: "ml-dock__pal", type: "button", "aria-label": "Choose theme colour", "aria-expanded": "false" }, icon("palette", 16));
  const pop = el("div", { class: "ml-dock__pop", role: "menu", hidden: true },
    el("span", { class: "ml-dock__poptitle", text: "Theme" }),
    ...THEMES.map((t) => el("button", { class: "ml-swatch", type: "button", role: "menuitemradio", "aria-checked": String(getTheme().theme === t.id), style: { "--sw": t.swatch }, onclick: (e) => { setTheme({ theme: t.id }, e); syncDock(); closePop(); } }, el("i"), t.name)));
  const seg = el("div", { class: "ml-dock__segwrap", role: "group", "aria-label": "Colour mode" }, thumb, light, dark);
  const dock = el("div", { class: "ml-dock" }, pop, seg, pal);
  document.body.append(dock);

  const syncDock = () => {
    const t = getTheme();
    light.classList.toggle("is-on", t.mode === "light");
    dark.classList.toggle("is-on", t.mode === "dark");
    light.setAttribute("aria-pressed", String(t.mode === "light"));
    dark.setAttribute("aria-pressed", String(t.mode === "dark"));
    pop.querySelectorAll(".ml-swatch").forEach((b, i) => b.setAttribute("aria-checked", String(THEMES[i].id === t.theme)));
    const on = t.mode === "light" ? light : dark;
    if (gsap) gsap.to(thumb, { x: on.offsetLeft - 4, width: on.offsetWidth, duration: reduced ? 0 : 0.45, ease: "expo.out" });
  };
  const closePop = () => {
    if (pop.hidden) return;
    pal.setAttribute("aria-expanded", "false");
    if (gsap && !reduced) gsap.to(pop, { y: 8, opacity: 0, duration: 0.2, onComplete: () => (pop.hidden = true) });
    else pop.hidden = true;
  };
  light.addEventListener("click", (e) => { setTheme({ mode: "light" }, e); syncDock(); });
  dark.addEventListener("click", (e) => { setTheme({ mode: "dark" }, e); syncDock(); });
  pal.addEventListener("click", () => {
    if (!pop.hidden) return closePop();
    pop.hidden = false;
    pal.setAttribute("aria-expanded", "true");
    if (gsap && !reduced) {
      gsap.fromTo(pop, { y: 10, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.6)" });
      gsap.from(pop.querySelectorAll(".ml-swatch"), { y: 8, opacity: 0, stagger: 0.04, delay: 0.05 });
    }
  });
  document.addEventListener("click", (e) => { if (!dock.contains(e.target)) closePop(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
  requestAnimationFrame(syncDock);
  // Re-measure once web fonts settle and on resize, so the thumb always sits under the active segment.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncDock);
  window.addEventListener("resize", syncDock);
  if (gsap && !reduced) gsap.from(dock, { y: 40, opacity: 0, duration: 0.8, delay: 0.4, ease: "expo.out" });
}

// ---------------- command palette ----------------

let paletteBound = false;
function bindPalette() {
  if (paletteBound) return;
  paletteBound = true;
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
  });
}

let paletteOpen = false;
export async function openPalette() {
  const session = getSession();
  if (!session || paletteOpen) return;
  paletteOpen = true;
  const base = (session.role === "admin" ? ADMIN_NAV : TENANT_NAV).map((n) => ({ label: n.label, hint: "Page", href: n.href, icon: n.icon }));
  let items = base;
  const input = el("input", { class: "ml-palette__input", type: "text", placeholder: "Search pages, tenants, invoices…", "aria-label": "Search", autocomplete: "off" });
  const list = el("ul", { class: "ml-palette__list", role: "listbox" });
  const box = el("div", { class: "ml-palette__box", role: "dialog", "aria-modal": "true", "aria-label": "Command palette" },
    el("div", { class: "ml-palette__head" }, icon("search", 18), input, el("kbd", { text: "esc" })), list);
  const overlay = el("div", { class: "ml-palette" }, box);
  document.body.append(overlay);
  let active = 0;

  const render = () => {
    const q = input.value.trim().toLowerCase();
    const found = items.filter((i) => !q || i.label.toLowerCase().includes(q) || (i.hint || "").toLowerCase().includes(q)).slice(0, 9);
    active = Math.min(active, Math.max(0, found.length - 1));
    list.replaceChildren(...(found.length ? found.map((it, i) =>
      el("li", { role: "option", "aria-selected": String(i === active), class: i === active ? "is-active" : "", onmousemove: () => { if (active !== i) { active = i; render(); } }, onclick: () => go(it) },
        icon(it.icon || "arrow", 16), el("span", { class: "ml-palette__label", text: it.label }), el("span", { class: "ml-palette__hint", text: it.hint || "" }))) : [el("li", { class: "ml-palette__none", text: "No matches" })]));
    list._found = found;
  };
  const close = () => {
    paletteOpen = false;
    if (gsap && !reduced) gsap.to(overlay, { opacity: 0, duration: 0.2, onComplete: () => overlay.remove() });
    else overlay.remove();
  };
  const go = (it) => { close(); navigate(it.href); };
  input.addEventListener("input", () => { active = 0; render(); });
  input.addEventListener("keydown", (e) => {
    const found = list._found || [];
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % Math.max(1, found.length); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + found.length) % Math.max(1, found.length); render(); }
    else if (e.key === "Enter" && found[active]) go(found[active]);
    else if (e.key === "Escape") close();
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  render();
  input.focus();
  if (gsap && !reduced) {
    gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.2 });
    gsap.fromTo(box, { y: -20, scale: 0.97, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.5)" });
  }
  if (session.role === "admin") {
    try {
      const [tenants, invoices] = await Promise.all([api("/tenants", { latency: false }), api("/invoices", { latency: false })]);
      items = [...base,
        ...tenants.map((t) => ({ label: t.name, hint: "Tenant", href: `tenant.html?id=${encodeURIComponent(t.id)}`, icon: "tenants" })),
        ...invoices.filter((i) => i.number).slice(0, 60).map((i) => ({ label: `${i.number} · ${i.tenant_name}`, hint: "Invoice", href: `invoice.html?id=${i.id}`, icon: "invoices" }))];
      if (overlay.isConnected) render();
    } catch (e) { /* palette still works for pages */ }
  }
}
