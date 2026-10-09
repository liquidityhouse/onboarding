// Knowledge explorer server: serves the UI and the single KB source.
//
//   GET /api/kb      -> { version, loadedAt, files[], program }   (ETag aware)
//   GET /api/kb.pl   -> the concatenated Prolog program as text
//   GET /api/health  -> { ok, version }
//   GET /*           -> ./public; *.ts files are served as JS with types stripped
//
// Run: node server.ts   (Node >= 23.6; PORT env var, default 8765)

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, join, normalize, resolve } from "node:path";
import { loadKb } from "./lib/kb-source.ts";

const ROOT = import.meta.dirname;
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT ?? 8765);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function send(res: ServerResponse, status: number, body: string, type: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-cache", ...headers });
  res.end(body);
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  const kb = await loadKb();
  const etag = `"${kb.version}"`;
  switch (path) {
    case "/api/kb":
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { ETag: etag });
        return res.end();
      }
      return send(res, 200, JSON.stringify(kb), "application/json", { ETag: etag });
    case "/api/kb.pl":
      return send(res, 200, kb.program, "text/plain; charset=utf-8", { ETag: etag });
    case "/api/health":
      return send(res, 200, JSON.stringify({ ok: true, version: kb.version }), "application/json");
    default:
      return send(res, 404, JSON.stringify({ error: "not found" }), "application/json");
  }
}

async function staticFile(res: ServerResponse, path: string) {
  const file = resolve(PUBLIC, "." + normalize(path === "/" ? "/index.html" : path));
  if (!file.startsWith(PUBLIC)) return send(res, 403, "forbidden", "text/plain");
  let body: string;
  try {
    body = await readFile(file, "utf8");
  } catch {
    return send(res, 404, "not found", "text/plain");
  }
  const ext = extname(file);
  if (ext === ".ts") body = stripTypeScriptTypes(body, { mode: "strip" });
  send(res, 200, body, MIME[ext] ?? "application/octet-stream");
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  try {
    if (path.startsWith("/api/")) await api(req, res, path);
    else await staticFile(res, path);
  } catch (e) {
    send(res, 500, JSON.stringify({ error: String(e) }), "application/json");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Knowledge explorer on http://localhost:${PORT}`));
