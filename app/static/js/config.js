// Frontend phase: API_MODE "mock" runs the whole PRD Section 9 contract in the browser
// (js/mock/server.js). Backend phase: set API_MODE to "live" and FastAPI serves /api.
// You can also force a mode per tab with ?api=live or ?api=mock.

const params = new URLSearchParams(location.search);
const forced = params.get("api");
if (forced === "live" || forced === "mock") {
  try { sessionStorage.setItem("ml_api_mode", forced); } catch (e) {}
}
let saved = null;
try { saved = sessionStorage.getItem("ml_api_mode"); } catch (e) {}

export const CONFIG = {
  API_MODE: saved || "mock",
  API_BASE: "/api",
  // Mock-only: simulated network latency per request (ms) so loading states are visible.
  MOCK_LATENCY: [80, 240],
  // Mock-only stand-in for ADMIN_KEY from .env. Never used in live mode.
  MOCK_ADMIN_KEY: "ml_admin_demo_key",
  CURRENCY: "INR",
};

export const METERS = [
  { id: "api_calls", name: "API calls", unit: "call", short: "Calls" },
  { id: "emails_sent", name: "Emails sent", unit: "email", short: "Emails" },
];
