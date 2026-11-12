// The signed-in key lives in sessionStorage only (PRD Section 11) and is removed on sign out.
const KEY = "ml_session";

export function getSession() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; }
}
export function setSession(s) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
}
export function clearSession() {
  try { sessionStorage.removeItem(KEY); } catch (e) {}
}
