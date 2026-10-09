// Knowledge explorer server: the only place the knowledge base is reasoned over.
// The browser gets role-scoped answers from these endpoints and never sees the KB itself.
//
//   GET  /api/health                    { ok, version }                      public; the UI polls it
//   GET  /api/session                   who is asking, their role and scope
//   GET  /api/graph                     everything the explorer draws, for the asker's role
//   GET  /api/explain/:entity           facts and explained conclusions about an entity
//   GET  /api/overview?domain=          domains, relations, entities, services, rules
//   GET  /api/context/:entity?depth=&max=   triples within N hops of an entity
//   GET  /api/verify/:service?who=&completed=a,b   what working on a service needs
//   GET  /api/explain-goal?expression=&max=        English proof traces for a goal
//   POST /api/query  { goal }           free-form goal, sandboxed     roles with the console feature
//   GET  /api/kb, /api/kb.pl            the KB itself                 roles with the technical feature
//   GET  /api/audit                     stated vs derived in symbols, compression candidates   technical
//   POST /api/plan   { keep, kindsOff, maxRules, exceptions, alternatives }   best candidate sets   technical
//   GET  /*                             ./public; *.ts served as JS with types stripped
//
// Which role may call which endpoint is knowledge, not code: kb/system.pl states what
// each endpoint requires and can_call/2 decides. An endpoint missing there is refused.
//
// Identity (KB_AUTH):
//   dev   (default) the UI's user picker sends X-Kb-User. For local use only: anyone can pick anyone.
//   proxy an auth proxy in front sets KB_EMAIL_HEADER (default X-Forwarded-Email); the email is
//         matched to a person through the KB's email_address/2. The proxy must strip that header
//         from client requests.
//
// Run: node server.ts   (Node >= 23.6; PORT, HOST, KB_AUTH, KB_EMAIL_HEADER)

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, join, normalize, resolve } from "node:path";
import { current, type Current } from "./lib/kb-service.ts";
import type { Audit, Conclusion, PlanRequest, Problem, Session, SessionInfo } from "./lib/kb-types.ts";
import { plans } from "./lib/optimiser.ts";
import { literal } from "./lib/prolog.ts";
import { runQuery } from "./lib/sandbox.ts";

const ROOT = import.meta.dirname;
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT ?? 8765);
const HOST = process.env.HOST ?? "127.0.0.1";
const AUTH: "dev" | "proxy" = process.env.KB_AUTH === "proxy" ? "proxy" : "dev";
const EMAIL_HEADER = (process.env.KB_EMAIL_HEADER ?? "x-forwarded-email").toLowerCase();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown = { error: message }) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function send(res: ServerResponse, status: number, body: string, type: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-cache", ...headers });
  res.end(body);
}

const json = (res: ServerResponse, body: unknown, status = 200) =>
  send(res, status, JSON.stringify(body), "application/json");

/** A `problem` from Prolog becomes an HTTP error carrying its hints. */
function answer<T extends Problem>(res: ServerResponse, body: T, problemStatus = 400) {
  json(res, body, body.problem ? problemStatus : 200);
}

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || "";
};

/** Who is asking. In proxy mode only the trusted email header counts. */
async function identify(req: IncomingMessage, cur: Current): Promise<Session> {
  let session: Session;
  if (AUTH === "proxy") {
    const email = header(req, EMAIL_HEADER).toLowerCase();
    if (!email) throw new HttpError(401, "not signed in");
    session = await cur.cached(`session|email|${email}`, () => cur.engine.session({ email }));
  } else {
    const user = header(req, "x-kb-user") || (await cur.cached("users", () => cur.engine.users()))[0]?.id;
    if (!user) throw new HttpError(500, "no user accounts in the knowledge base");
    session = await cur.cached(`session|user|${user}`, () => cur.engine.session({ user }));
  }
  if (session.problem) throw new HttpError(403, session.problem, session);
  return session;
}

const can = (s: Session, feature: string) => s.features.includes(feature);

/** Each route's endpoint id, as kb/system.pl names it. */
const ENDPOINT: Record<string, string> = {
  session: "GET /api/session",
  graph: "GET /api/graph",
  explain: "GET /api/explain/:entity",
  overview: "GET /api/overview",
  context: "GET /api/context/:entity",
  verify: "GET /api/verify/:service",
  "explain-goal": "GET /api/explain-goal",
  "POST query": "POST /api/query",
  kb: "GET /api/kb",
  "kb.pl": "GET /api/kb.pl",
  audit: "GET /api/audit",
  "POST plan": "POST /api/plan",
};

/** Authorisation from the knowledge base: can_call(Role, Endpoint). */
async function authorise(cur: Current, role: string, endpoint: string | undefined) {
  if (!endpoint) throw new HttpError(404, "not found");
  const { allowed } = await cur.cached(`allowed|${role}|${endpoint}`,
    () => cur.engine.api<{ allowed: boolean }>(`allowed(${literal(role)}, ${literal(endpoint)})`));
  if (!allowed) throw new HttpError(403, `${endpoint} is not part of your role`);
}

/** Proof terms are technical detail; other roles get the English explanation only. */
function withoutProofs<T extends { proof?: string }>(items: T[] | undefined, s: Session): void {
  if (!can(s, "technical")) for (const item of items ?? []) delete item.proof;
}

function intParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  const n = raw === null ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be an integer from ${min} to ${max}`);
  return n;
}

/** Plan constraints, checked against what the audit knows: unknown names are refused, not passed on. */
function planRequest(raw: Record<string, unknown>, audit: Audit): PlanRequest {
  const names = (key: string, known: Set<string>): string[] => {
    const v = raw[key] ?? [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !known.has(x))) throw new HttpError(400, `${key} must list known names`);
    return v as string[];
  };
  const int = (key: string, min: number, max: number): number | undefined => {
    const v = raw[key];
    if (v === undefined || v === null) return undefined;
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new HttpError(400, `${key} must be an integer from ${min} to ${max}`);
    return v as number;
  };
  if (raw.exceptions !== undefined && typeof raw.exceptions !== "boolean") throw new HttpError(400, "exceptions must be true or false");
  return {
    keep: names("keep", new Set(audit.candidates.map((c) => c.relation))),
    kindsOff: names("kindsOff", new Set(audit.kinds.map((k) => k.id))),
    maxRules: int("maxRules", 0, 100),
    exceptions: raw.exceptions as boolean | undefined,
    alternatives: int("alternatives", 1, 5) ?? 3,
  };
}

async function body(req: IncomingMessage, limit = 16_384): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw new HttpError(413, "request too large");
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const cur = await current();
  const { kb, engine, cached } = cur;
  // Split before decoding: an entity id may itself contain "/" (links are URLs).
  const [, , route, rawArg] = url.pathname.split("/"); // "", "api", route, arg
  const arg = rawArg ? decodeURIComponent(rawArg) : "";

  if (route === "health") return json(res, { ok: true, version: kb.version });

  const session = await identify(req, cur);
  const role = session.role;
  const key = req.method === "POST" ? `POST ${route}` : req.method === "GET" ? route : "";
  await authorise(cur, role, ENDPOINT[key]);

  switch (key) {
    case "session": {
      const info: SessionInfo = { session, auth: AUTH, version: kb.version };
      if (AUTH === "dev") info.users = await cached("users", () => engine.users());
      if (can(session, "technical")) {
        info.files = kb.files.map(({ name, lines }) => ({ name, lines }));
        if (engine.warnings) info.warnings = engine.warnings;
      } else if (engine.warnings) info.incomplete = true;
      return json(res, info);
    }
    case "graph":
      return answer(res, await cached(`graph|${role}`, () => engine.graph(role)));
    case "explain": {
      if (!arg) throw new HttpError(400, "missing entity");
      const ex = structuredClone(await cached(`explain|${role}|${arg}`, () => engine.explain(arg, role)));
      withoutProofs<Conclusion>(ex.conclusions, session);
      return answer(res, ex, 404);
    }
    case "overview": {
      const domain = url.searchParams.get("domain") || "all";
      return answer(res, await cached(`overview|${role}|${domain}`, () => engine.overview(domain, role)));
    }
    case "context": {
      if (!arg) throw new HttpError(400, "missing entity");
      const depth = intParam(url, "depth", 1, 1, 3);
      const max = intParam(url, "max", 40, 1, 200);
      return answer(res, await engine.context(arg, depth, role, max), 404);
    }
    case "verify": {
      if (!arg) throw new HttpError(400, "missing service");
      // Checking someone else's progress is for roles with technical access.
      const who = url.searchParams.get("who") || session.user;
      if (who !== session.user && !can(session, "technical")) throw new HttpError(403, "you can only verify your own progress");
      const completed = (url.searchParams.get("completed") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return answer(res, await engine.verify(who, arg, completed, role));
    }
    case "explain-goal": {
      const expression = url.searchParams.get("expression");
      if (!expression) throw new HttpError(400, "missing expression");
      const max = intParam(url, "max", 3, 1, 20);
      const ex = await engine.explainGoal(expression, max, role);
      withoutProofs(ex.answers, session);
      return answer(res, ex);
    }
    case "POST query": {
      const { goal } = await body(req);
      if (typeof goal !== "string" || !goal.trim()) throw new HttpError(400, "missing goal");
      try {
        return json(res, { lines: await runQuery(kb.program, goal) });
      } catch (e) {
        return json(res, { error: (e as Error).message }, 422);
      }
    }
    case "audit":
      return answer(res, await cached(`audit|${role}`, () => engine.audit(role)));
    case "POST plan": {
      const audit = await cached<Audit>(`audit|${role}`, () => engine.audit(role));
      return json(res, { plans: await plans(audit, planRequest(await body(req), audit)) });
    }
    case "kb":
    case "kb.pl": {
      const etag = `"${kb.version}"`;
      if (route === "kb.pl") return send(res, 200, kb.program, "text/plain; charset=utf-8", { ETag: etag });
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { ETag: etag });
        return res.end();
      }
      return send(res, 200, JSON.stringify(kb), "application/json", { ETag: etag });
    }
    default:
      throw new HttpError(404, "not found");
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
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else await staticFile(res, decodeURIComponent(url.pathname));
  } catch (e) {
    if (e instanceof HttpError) json(res, e.body, e.status);
    else {
      console.error(e);
      json(res, { error: "internal error" }, 500);
    }
  }
}).listen(PORT, HOST, () => console.log(`Knowledge explorer on http://localhost:${PORT} (auth: ${AUTH})`));
