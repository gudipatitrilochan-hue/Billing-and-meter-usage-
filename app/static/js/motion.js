// GSAP motion layer: page curtain transitions, reveals, button press + ripple,
// magnetic buttons, 3D tilt cards, cursor spotlights, count-ups, confetti.
// Everything degrades to no motion under prefers-reduced-motion.

const gsap = window.gsap;
export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;

let started = false;

export function initMotion() {
  if (started || !gsap) return;
  started = true;
  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);
  gsap.defaults({ ease: "power3.out", duration: 0.6 });
  bindPress();
  bindTransitions();
  arrive();
  enhance(document);
}

/** Wire hover effects on newly rendered content. Safe to call repeatedly. */
export function enhance(root = document) {
  if (!gsap || reduced) return;
  if (finePointer) {
    root.querySelectorAll("[data-magnetic]:not([data-mx])").forEach(magnetic);
    root.querySelectorAll("[data-tilt]:not([data-tx])").forEach(tilt);
  }
  root.querySelectorAll(".ml-panel:not([data-spot]), .ml-spot:not([data-spot])").forEach(spotlight);
}

// ---------------- page transitions ----------------

function curtain() { return document.querySelector(".ml-curtain"); }

function arrive() {
  const c = curtain();
  const root = document.documentElement;
  const arriving = root.classList.contains("is-arriving");
  try { sessionStorage.removeItem("ml_arrive"); } catch (e) {}
  if (!c) return;
  gsap.set(c, { y: 0, yPercent: arriving ? 0 : 100 });
  root.classList.remove("is-arriving");
  if (arriving) {
    gsap.to(c, { yPercent: -100, duration: reduced ? 0 : 0.7, ease: "expo.inOut", delay: 0.05 });
    gsap.fromTo(c.querySelector(".ml-curtain__mark"), { opacity: 1 }, { opacity: 0, duration: 0.3 });
  }
}

export function navigate(href) {
  const c = curtain();
  if (!c || reduced) { location.href = href; return; }
  try { sessionStorage.setItem("ml_arrive", "1"); } catch (e) {}
  gsap.timeline({ onComplete: () => (location.href = href) })
    .set(c, { yPercent: 100 })
    .to(c, { yPercent: 0, duration: 0.55, ease: "expo.inOut" })
    .fromTo(c.querySelector(".ml-curtain__mark"), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.3 }, "-=0.25");
}

function bindTransitions() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download") || a.dataset.noTransition !== undefined) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    if (!/\.html$|\/$/.test(url.pathname)) return;
    e.preventDefault();
    navigate(url.href);
  });
  // bfcache restore: make sure the curtain isn't stuck over the page
  window.addEventListener("pageshow", (e) => {
    if (e.persisted && curtain()) gsap.set(curtain(), { yPercent: 100 });
  });
}

// ---------------- reveals ----------------

export function reveal(targets, opts = {}) {
  if (!gsap) return;
  const els = typeof targets === "string" ? document.querySelectorAll(targets) : targets;
  if (!els || (els.length === 0 && !(els instanceof Element))) return;
  if (reduced) { gsap.set(els, { opacity: 1, y: 0 }); return; }
  return gsap.fromTo(els, { opacity: 0, y: opts.y ?? 18 }, { opacity: 1, y: 0, duration: opts.duration ?? 0.6, stagger: opts.stagger ?? 0.05, delay: opts.delay ?? 0, ease: "power3.out", clearProps: "transform" });
}

/** Split an element's words into spans and rise them in. */
export function splitWords(el, delay = 0.15) {
  if (!el || !gsap) return;
  const words = el.textContent.trim().split(/\s+/);
  el.setAttribute("aria-label", el.textContent.trim());
  el.textContent = "";
  for (const w of words) {
    const outer = document.createElement("span");
    outer.className = "ml-word";
    outer.setAttribute("aria-hidden", "true");
    const inner = document.createElement("span");
    inner.textContent = w;
    outer.append(inner);
    el.append(outer, " ");
  }
  if (reduced) return;
  gsap.from(el.querySelectorAll(".ml-word > span"), { yPercent: 110, rotate: 4, duration: 0.9, stagger: 0.06, ease: "expo.out", delay });
}

// ---------------- buttons ----------------

function bindPress() {
  if (!gsap) return;
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".btn, .ml-press");
    if (!b || b.disabled) return;
    if (!reduced) gsap.to(b, { scale: 0.96, duration: 0.12, ease: "power2.out", overwrite: "auto" });
    if (b.classList.contains("btn")) ripple(b, e);
    const up = () => {
      if (!reduced) gsap.to(b, { scale: 1, duration: 0.5, ease: "elastic.out(1.2, 0.45)", overwrite: "auto" });
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
}

function ripple(btn, e) {
  if (reduced) return;
  const r = btn.getBoundingClientRect();
  const s = document.createElement("span");
  s.className = "ml-ripple";
  const size = Math.max(r.width, r.height) * 2.2;
  Object.assign(s.style, { width: size + "px", height: size + "px", left: e.clientX - r.left - size / 2 + "px", top: e.clientY - r.top - size / 2 + "px" });
  btn.append(s);
  gsap.fromTo(s, { scale: 0, opacity: 0.35 }, { scale: 1, opacity: 0, duration: 0.7, ease: "power2.out", onComplete: () => s.remove() });
}

function magnetic(el) {
  el.dataset.mx = "1";
  const xTo = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" });
  const yTo = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" });
  const strength = parseFloat(el.dataset.magnetic) || 0.3;
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    xTo((e.clientX - (r.left + r.width / 2)) * strength);
    yTo((e.clientY - (r.top + r.height / 2)) * strength);
  });
  el.addEventListener("pointerleave", () => {
    gsap.to(el, { x: 0, y: 0, duration: 0.8, ease: "elastic.out(1, 0.35)" });
  });
}

function tilt(el) {
  el.dataset.tx = "1";
  gsap.set(el, { transformPerspective: 900, transformStyle: "preserve-3d" });
  const rx = gsap.quickTo(el, "rotationX", { duration: 0.5 });
  const ry = gsap.quickTo(el, "rotationY", { duration: 0.5 });
  const max = parseFloat(el.dataset.tilt) || 6;
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ry(px * max * 2);
    rx(-py * max * 2);
    el.style.setProperty("--tx", `${(px + 0.5) * 100}%`);
    el.style.setProperty("--ty", `${(py + 0.5) * 100}%`);
  });
  el.addEventListener("pointerleave", () => { rx(0); ry(0); });
}

function spotlight(el) {
  el.dataset.spot = "1";
  if (!finePointer || reduced) return;
  const state = { x: el.offsetWidth * 0.25, y: 0 };
  const apply = () => { el.style.setProperty("--mx", state.x + "px"); el.style.setProperty("--my", state.y + "px"); };
  apply();
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    gsap.to(state, { x: e.clientX - r.left, y: e.clientY - r.top, duration: 0.9, ease: "power3.out", onUpdate: apply, overwrite: true });
  });
}

// ---------------- numbers & feedback ----------------

/** Tween an element's number from its current value (or opts.from) to `to`. */
export function countUp(el, to, format = (n) => n.toLocaleString("en-US"), opts = {}) {
  if (!el) return;
  const from = opts.from ?? (Number(el.dataset.value) || 0);
  el.dataset.value = to;
  if (!gsap || reduced) { el.textContent = format(to); return; }
  const o = { v: from };
  gsap.to(o, {
    v: to, duration: opts.duration ?? 1.2, ease: "power3.out", delay: opts.delay ?? 0,
    onUpdate: () => (el.textContent = format(Math.round(o.v))),
  });
}

export function pop(el) {
  if (!gsap || reduced || !el) return;
  gsap.fromTo(el, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: "elastic.out(1, 0.5)" });
}

export function shake(el) {
  if (!gsap || reduced || !el) return;
  gsap.fromTo(el, { x: 0 }, { x: 0, duration: 0.5, ease: "none", keyframes: { x: [0, -8, 8, -6, 6, -2, 0] } });
}

export function confetti(x, y, count = 36) {
  if (!gsap || reduced) return;
  const colors = ["var(--accent)", "var(--accent-strong)", "#fde68a", "#93c5fd", "#f9a8d4", "var(--ink)"];
  const layer = document.createElement("div");
  layer.className = "ml-confetti";
  document.body.append(layer);
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.style.background = colors[i % colors.length];
    p.style.left = x + "px";
    p.style.top = y + "px";
    if (i % 3 === 0) p.style.borderRadius = "50%";
    layer.append(p);
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 180;
    gsap.timeline()
      .to(p, { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist - 120, rotation: Math.random() * 720 - 360, duration: 0.7, ease: "power3.out" })
      .to(p, { y: "+=260", opacity: 0, rotation: "+=180", duration: 1.1, ease: "power1.in" });
  }
  setTimeout(() => layer.remove(), 2000);
}
