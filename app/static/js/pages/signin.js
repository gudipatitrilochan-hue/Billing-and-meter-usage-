// S1 Sign in — paste a tenant API key or the admin key; role comes from GET /me.
import { signIn, getSession, homeFor } from "../auth.js";
import { getDemoKeys } from "../api.js";
import { mountBare, el, qs, toast, icon, param } from "../ui.js";
import { splitWords, reveal, shake, navigate, reduced } from "../motion.js";

const gsap = window.gsap;
const next = param("next");
const existing = getSession();
if (existing && !next) location.replace(homeFor(existing));

mountBare();
splitWords(qs("#hero-title"), 0.35);
reveal([qs(".ml-auth__pitch"), ...document.querySelectorAll(".ml-auth__chips > *"), ...document.querySelectorAll(".ml-auth__card > *")], { delay: 0.25, stagger: 0.06 });

// ---- floating meter coins + the retry ticket loop ----
if (gsap && !reduced) {
  document.querySelectorAll(".ml-orbit").forEach((o, i) => {
    gsap.from(o, { scale: 0, opacity: 0, duration: 1.1, ease: "elastic.out(1, 0.55)", delay: 0.4 + i * 0.12 });
    gsap.to(o, { y: i % 2 ? 14 : -14, rotation: i % 2 ? -8 : 8, duration: 2.6 + i * 0.4, ease: "sine.inOut", yoyo: true, repeat: -1, delay: i * 0.3 });
  });
  const stage = qs(".ml-auth__stage");
  const steps = [
    { cls: "ok", code: "201 accepted", text: "shk-2026-09-14-0042 · 500 calls" },
    { cls: "dup", code: "200 duplicate", text: "shk-2026-09-14-0042 · retry" },
    { cls: "dup", code: "200 duplicate", text: "shk-2026-09-14-0042 · retry" },
    { cls: "ok", code: "201 accepted", text: "shk-2026-09-14-0043 · 120 calls" },
  ];
  let k = 0;
  const spawn = () => {
    const s = steps[k++ % steps.length];
    const t = el("div", { class: `ml-ticket ml-ticket--${s.cls}` }, el("b", { text: s.code }), s.text);
    stage.append(t);
    gsap.timeline({ onComplete: () => t.remove() })
      .fromTo(t, { y: 150, opacity: 0, scale: 0.92 }, { y: 96, opacity: 1, scale: 1, duration: 0.7, ease: "expo.out" })
      .to(t, { y: 40, duration: 1.6, ease: "none" })
      .to(t, { y: 0, opacity: 0, duration: 0.6, ease: "power2.in" });
  };
  spawn();
  setInterval(() => { if (!document.hidden) spawn(); }, 1300);
}

// ---- form ----
const form = qs("#signin-form");
const input = qs("#key");
const errorEl = qs("#key-error");
const submit = qs("#signin-submit");

qs("#toggle-key").addEventListener("click", (e) => {
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  e.currentTarget.setAttribute("aria-label", show ? "Hide key" : "Show key");
  e.currentTarget.replaceChildren(icon(show ? "eyeOff" : "eye", 17));
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  input.classList.remove("is-invalid");
  submit.disabled = true;
  const label = submit.innerHTML;
  submit.replaceChildren(el("span", { class: "spinner-border spinner-border-sm", "aria-hidden": "true" }), "Checking key…");
  try {
    const s = await signIn(input.value);
    toast(s.role === "admin" ? "Signed in as billing admin" : `Signed in as ${s.tenant.name}`, { type: "success", timeout: 1500 });
    const dest = next && /^[a-z]+\.html(\?[\w=&%.-]*)?$/.test(next) ? next : homeFor(s);
    setTimeout(() => navigate(dest), 350);
  } catch (err) {
    submit.disabled = false;
    submit.innerHTML = label;
    input.classList.add("is-invalid");
    errorEl.textContent = err.status === 0 ? "Can't reach the billing server" : err.status === 403 ? err.detail : "Key not recognised";
    shake(qs(".ml-auth__card form"));
    input.focus();
  }
});

// ---- demo keys (mock mode only, like the output of scripts/seed.py) ----
const keys = await getDemoKeys();
if (keys) {
  const box = qs("#demo");
  const list = qs("#demo-list");
  const fill = (k) => {
    input.value = k;
    input.type = "password";
    if (gsap && !reduced) gsap.fromTo(input, { boxShadow: "0 0 0 8px rgba(134,239,172,.55)" }, { boxShadow: "0 0 0 0px rgba(134,239,172,0)", duration: 0.9, clearProps: "boxShadow" });
    submit.focus();
  };
  list.append(el("button", { class: "ml-demo__key ml-demo__key--admin", type: "button", onclick: () => fill(keys.admin) }, icon("shield", 16), "Billing admin (Kavya)", el("small", { text: "admin key" })));
  for (const t of keys.tenants) {
    list.append(el("button", { class: "ml-demo__key", type: "button", onclick: () => fill(t.key) }, icon("key", 15), t.name, el("small", { text: "tenant" })));
  }
  box.hidden = false;
  reveal(list.children, { stagger: 0.03, delay: 0.6, y: 10 });
}
