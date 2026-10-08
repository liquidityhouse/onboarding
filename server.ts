// Knowledge explorer server: serves the UI and the single KB source.
//
//   GET /api/kb      -> { version, loadedAt, files[], program }   (ETag aware)
//   GET /api/kb.pl   -> the concatenated Prolog program as text
//   GET /api/health  -> { ok, version }
//   GET /*           -> ./public; *.ts files are served as JS with types stripped
//
// Run: node server.ts   (Node >= 23.6; PORT env var, default 8765)

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = import.meta.dirname;
const PUBLIC = join(ROOT, "public");
const MANIFEST = join(ROOT, "kb", "manifest.json");
const PORT = Number(process.env.PORT ?? 8765);

interface KbFile {
  name: string;
  lines: number;
  sha: string;
  modified: number;
}

interface Kb {
  version: string;
  loadedAt: number;
  files: KbFile[];
  program: string;
}

const sha = (text: string, n: number) => createHash("sha1").update(text).digest("hex").slice(0, n);

async function loadKb(): Promise<Kb> {
  const { sources } = JSON.parse(await readFile(MANIFEST, "utf8")) as { sources: string[] };
  const files: KbFile[] = [];
  const parts: string[] = [];
  for (const rel of sources) {
    const path = join(ROOT, rel);
    let text = await readFile(path, "utf8");
    if (!text.endsWith("\n")) text += "\n";
    files.push({
      name: rel,
      lines: text.split("\n").length - 1,
      sha: sha(text, 10),
      modified: Math.floor((await stat(path)).mtimeMs / 1000),
    });
    parts.push(`% ===== ${rel} =====\n${text}`);
  }
  const program = parts.join("\n");
  return { version: sha(program, 12), loadedAt: Math.floor(Date.now() / 1000), files, program };
}

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
