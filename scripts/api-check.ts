// End-to-end check of the REST endpoints and their role scoping. Starts the real
// server twice (dev and proxy identity) on spare ports and checks what each
// person can and cannot see.
//
// Run: npm run api:check

import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const SERVER = join(import.meta.dirname, "..", "server.ts");
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
}

async function start(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port), ...env }, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server on ${port} did not start`);
}

function client(port: number, headers: Record<string, string> = {}) {
  return async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: { ...headers, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };
}

const dev = await start(8798, {});
const proxy = await start(8797, { KB_AUTH: "proxy" });
try {
  const anyone = client(8798);
  const dominic = client(8798, { "X-Kb-User": "dominic" });
  const adam = client(8798, { "X-Kb-User": "adam" });

  check("health is public", (await anyone("/api/health")).status === 200);
  const s = await anyone("/api/session");
  check("dev: default session", s.status === 200 && typeof s.body.session?.user === "string", JSON.stringify(s.body));

  const g = await dominic("/api/graph");
  const domains = g.body.domains?.map((d: { id: string }) => d.id).sort().join(",");
  check("risk officer graph has only risk and platform", domains === "platform,risk", domains);
  check("risk officer graph has no onboarding triples", !g.body.triples?.some((t: { domain: string }) => t.domain === "onboarding"));
  check("risk officer graph does not mention adam", !g.body.entities?.some((e: { id: string }) => e.id === "adam"));

  check("risk officer cannot explain a person", (await dominic("/api/explain/adam")).status === 404);
  const exD = await dominic("/api/explain/dope");
  check("risk officer explains dope without proof terms", exD.status === 200 && exD.body.conclusions?.length > 0 && !("proof" in exD.body.conclusions[0]));
  const exA = await adam("/api/explain/dope");
  check("developer gets proof terms", exA.status === 200 && typeof exA.body.conclusions?.[0]?.proof === "string");
  const link = await adam(`/api/explain/${encodeURIComponent("https://github.com/liquidityhouse/riskx")}`);
  check("an entity id containing slashes", link.status === 200 && link.body.type === "url", JSON.stringify(link.body).slice(0, 120));

  check("raw KB is closed to the risk officer", (await dominic("/api/kb.pl")).status === 403);
  check("raw KB is open to the developer", (await adam("/api/kb.pl")).status === 200);

  check("risk officer has no query console", (await dominic("/api/query", { method: "POST", body: JSON.stringify({ goal: "true" }) })).status === 403);
  const q = await adam("/api/query", { method: "POST", body: JSON.stringify({ goal: "soft_credit_limit(dope, L)" }) });
  check("developer query", q.status === 200 && /L = 74750/.test(q.body.lines?.join(" ")), JSON.stringify(q.body));
  const halt = await adam("/api/query", { method: "POST", body: JSON.stringify({ goal: "halt" }) });
  check("halt/0 stays inside the sandbox", halt.status !== 500, JSON.stringify(halt));
  const loop = await adam("/api/query", { method: "POST", body: JSON.stringify({ goal: "repeat, fail" }) });
  check("a runaway query is stopped", loop.status === 422 && /stopped after/.test(loop.body.error), JSON.stringify(loop.body));
  check("the shared engine still answers afterwards", (await adam("/api/explain/riskx")).status === 200);

  check("risk officer cannot explain onboarding goals", (await dominic(`/api/explain-goal?expression=${encodeURIComponent("url(riskx, U)")}`)).status === 400);
  const eg = await dominic(`/api/explain-goal?expression=${encodeURIComponent("soft_credit_limit(dope, L)")}`);
  check("risk officer explains a credit limit, no proof term", eg.status === 200 && eg.body.holds === true && !("proof" in eg.body.answers[0]));

  check("risk officer cannot verify onboarding requirements", (await dominic("/api/verify/riskx")).status === 400);
  const v = await adam("/api/verify/injectx?completed=onboarding");
  check("developer verifies own progress", v.status === 200 && v.body.who === "adam" && !v.body.missing.includes("onboarding"));
  check("only technical roles check someone else", (await dominic("/api/verify/riskx?who=adam")).status === 403);

  check("context outside the role scope", (await dominic("/api/context/adam")).status === 404);
  const ctx = await adam("/api/context/injectx?depth=1&max=5");
  check("context is capped", ctx.status === 200 && ctx.body.triples.length === 5 && ctx.body.truncated === true);
  check("bad depth is rejected", (await adam("/api/context/injectx?depth=9")).status === 400);

  const p = client(8797);
  check("proxy: no identity, no access", (await p("/api/graph")).status === 401);
  check("proxy: X-Kb-User is ignored", (await client(8797, { "X-Kb-User": "admin" })("/api/graph")).status === 401);
  const ps = await client(8797, { "X-Forwarded-Email": "adam@goat.gs" })("/api/session");
  check("proxy: email maps to a person", ps.status === 200 && ps.body.session.user === "adam" && !ps.body.users, JSON.stringify(ps.body));
  check("proxy: unknown email is refused", (await client(8797, { "X-Forwarded-Email": "nobody@example.com" })("/api/session")).status === 403);
} finally {
  dev.kill();
  proxy.kill();
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
