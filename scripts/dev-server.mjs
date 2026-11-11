// Frontend-phase dev server: serves app/static on http://localhost:5173 (no dependencies).
// Backend phase replaces this with `uvicorn app.main:app`, which serves the same folder.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "static");
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".csv": "text/csv",
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end("Forbidden"); return; }
    if (path.startsWith("/api/")) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no_backend", detail: "The FastAPI backend isn't running yet. Use the mock API (default)." }));
      return;
    }
    await stat(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(await readFile(file));
    console.log(req.method, path, 200);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    console.log(req.method, req.url, 404);
  }
}).listen(PORT, "127.0.0.1", () => console.log(`MeterLedger frontend → http://localhost:${PORT}`));
