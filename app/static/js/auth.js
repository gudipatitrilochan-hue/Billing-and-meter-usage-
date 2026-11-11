import { api, ApiError } from "./api.js";
import { getSession, setSession, clearSession } from "./auth-store.js";

export { getSession, clearSession };

/** Detect the role from GET /me (PRD S1) and store the session. */
export async function signIn(key) {
  key = key.trim();
  if (!key) throw new ApiError(401, "missing_key", "Paste an API key or the admin key");
  const me = await api("/me", { session: { kind: "both", key } });
  const session = me.role === "admin"
    ? { kind: "admin", key, role: "admin" }
    : { kind: "tenant", key, role: "tenant", tenant: me.tenant };
  setSession(session);
  return session;
}

export function signOut() {
  clearSession();
  location.href = "index.html";
}

/**
 * Page guard. Redirects to sign in when there is no session, or to the
 * right home page when the role doesn't match.
 * @param {("admin"|"tenant"|"public")[]} roles
 */
export function requireRole(roles) {
  const s = getSession();
  if (!s) {
    if (roles.includes("public")) return null;
    const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
    location.replace(`index.html?next=${next}`);
    throw redirecting();
  }
  if (!roles.includes(s.role)) {
    location.replace(s.role === "admin" ? "overview.html" : "portal.html");
    throw redirecting();
  }
  return s;
}

// Throwing stops the rest of the page module from running while the redirect happens;
// this keeps that intentional stop out of the console.
function redirecting() {
  return Object.assign(new Error("redirecting"), { mlRedirect: true });
}
window.addEventListener("error", (e) => { if (e.error && e.error.mlRedirect) e.preventDefault(); });

export const homeFor = (s) => (s && s.role === "admin" ? "overview.html" : "portal.html");
