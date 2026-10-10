// End-to-end check of the REST endpoints and their role scoping. Starts the real
// server twice (dev and proxy identity) on spare ports and checks what each
// person can and cannot see and change; local changes go to a scratch state file.
//
// Run: npm run api:check

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER = join(import.meta.dirname, "..", "server.ts");
const scratch = mkdtempSync(join(tmpdir(), "api-check-"));
const KB_STATE = join(scratch, "overrides.json");
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
}

async function start(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port), KB_STATE, ...env }, stdio: ["ignore", "ignore", "inherit"] });
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
  check("risk officer explains dope without technical detail", exD.status === 200 && exD.body.conclusions?.length > 0 && !("instance" in (exD.body.conclusions[0].via ?? {})));
  const exA = await adam("/api/explain/dope");
  check("developer gets technical detail", exA.status === 200 && typeof exA.body.conclusions?.[0]?.via?.instance === "string");
  const link = await adam(`/api/explain/${encodeURIComponent("https://github.com/liquidityhouse/riskx")}`);
  check("an entity id containing slashes", link.status === 200 && link.body.type === "url", JSON.stringify(link.body).slice(0, 120));

  check("raw KB is closed to the risk officer", (await dominic("/api/kb.pl")).status === 403);
  check("raw KB is open to the developer", (await adam("/api/kb.pl")).status === 200);

  // Free-form queries moved to the MCP query tool (npm run mcp:check tests the sandbox).
  check("no free-form query endpoint", (await adam("/api/query", { method: "POST", body: JSON.stringify({ goal: "true" }) })).status === 404);
  check("the shared engine still answers afterwards", (await adam("/api/explain/riskx")).status === 200);

  check("risk officer cannot explain onboarding goals", (await dominic(`/api/explain-goal?expression=${encodeURIComponent("url(riskx, U)")}`)).status === 400);
  const eg = await dominic(`/api/explain-goal?expression=${encodeURIComponent("soft_credit_limit(dope, L)")}`);
  check("risk officer explains a credit limit, no technical detail", eg.status === 200 && eg.body.holds === true && !("instance" in (eg.body.answers[0].via ?? {})));

  check("risk officer cannot verify onboarding requirements", (await dominic("/api/verify/riskx")).status === 400);
  const v = await adam("/api/verify/injectx?completed=onboarding");
  check("developer verifies own progress", v.status === 200 && v.body.who === "adam" && !v.body.missing.includes("onboarding"));
  check("only technical roles check someone else", (await dominic("/api/verify/riskx?who=adam")).status === 403);

  // Derivations: the clause behind each derived fact and its slot values; Prolog only for technical roles.
  const gA = await adam("/api/graph");
  const derived = gA.body.triples.filter((t: { derived: boolean }) => t.derived);
  check("every derived connection names its clause", derived.length > 0 && derived.every((t: { via: { rule: number } | null }) => t.via && t.via.rule > 0));
  const rel = derived.find((t: { pred: string; s: string; o: string }) => t.pred === "relies_on" && t.s === "explorer_ui" && t.o === "knowledge_base");
  const part = rel?.via.bindings.find((b: { name: string }) => b.name === "part")?.value;
  check("a recursive derivation reaches the right part", rel?.via.rule === 2 && part === "web_server", JSON.stringify(rel?.via));
  check("developer sees the clause as written, with its query", gA.body.rules.some((r: { source?: { file: string } }) => r.source?.file === "knowledge/knowledge_explorer/explorer.pl")
    && typeof rel?.via.query === "string" && typeof rel?.via.instance === "string");
  const stated = await adam(`/api/explain-goal?expression=${encodeURIComponent("onboarding('liquidity-house')")}`);
  const src = stated.body.answers?.[0]?.source;
  check("a stated fact names its file, line and clause", src?.file === "knowledge/liquidity_house/onboarding.pl" && src.line > 0 && src.text.startsWith("onboarding('liquidity-house')"), JSON.stringify(src));
  const ruleOnly = await dominic(`/api/explain-goal?expression=${encodeURIComponent("operator(dope, S)")}`);
  check("risk officer gets no source for stated facts", ruleOnly.status === 200 && !("source" in ruleOnly.body.answers[0]));
  check("risk officer sees no Prolog", !g.body.rules.some((r: object) => "source" in r || "pattern" in r)
    && !g.body.triples.some((t: { via: object | null }) => t.via && ("query" in t.via || "instance" in t.via)));

  // Audit and optimiser: technical roles only, constraints checked against the audit.
  check("risk officer cannot audit", (await dominic("/api/audit")).status === 403);
  const au = await adam("/api/audit");
  check("audit measures stated, derived and rules", au.status === 200 && au.body.totals.now > 0 && au.body.totals.without_rules > au.body.totals.now, JSON.stringify(au.body.totals));
  check("audit lists candidates with a saving and clauses", Array.isArray(au.body.candidates) && au.body.candidates.every((c: { saving: number; covers: unknown[] }) => typeof c.saving === "number" && c.covers.length > 0));
  const pl = await adam("/api/plan", { method: "POST", body: JSON.stringify({ alternatives: 2 }) });
  check("optimiser returns a best plan", pl.status === 200 && pl.body.plans.length >= 1 && pl.body.plans[0].saving >= 0, JSON.stringify(pl.body));
  const kept = await adam("/api/plan", { method: "POST", body: JSON.stringify({ keep: au.body.candidates.map((c: { relation: string }) => c.relation), alternatives: 1 }) });
  check("keeping every relation leaves nothing to apply", kept.status === 200 && kept.body.plans[0].candidates.length === 0, JSON.stringify(kept.body));
  check("unknown names in constraints are refused", (await adam("/api/plan", { method: "POST", body: JSON.stringify({ keep: ["x). evil"] }) })).status === 400);

  // Local overrides: technical roles change facts here; anyone records their own progress.
  const post = (who: typeof adam, path: string, body: unknown) => who(path, { method: "POST", body: JSON.stringify(body) });
  check("risk officer cannot list local changes", (await dominic("/api/overrides")).status === 403);
  check("risk officer cannot change facts", (await post(dominic, "/api/overrides", { add: "completed(dominic, riskx)." })).status === 403);
  const added = await post(adam, "/api/overrides", { add: "completed(adam, onboarding).\nrole_feature(dominic, technical)." });
  check("developer adds a fact; access rules are refused", added.status === 200 && added.body.added?.length === 1 && added.body.skipped?.length === 1, JSON.stringify(added.body));
  const gl = await adam("/api/graph");
  const local = gl.body.triples?.find((t: { kind: string }) => t.kind === "local");
  check("a local fact is drawn as local, with who added it", local?.s === "adam" && local?.change?.by === "adam" && local?.change?.via === "explorer", JSON.stringify(local));
  const edited = await post(adam, "/api/overrides", { edit: { fact: "invites(richard, 'liquidity-house')", with: "invites(georgi, 'liquidity-house')" } });
  check("editing a stated fact removes it and adds the new one", edited.status === 200 && edited.body.removed?.length === 1 && edited.body.added?.length === 1, JSON.stringify(edited.body));
  check("a derived fact cannot be removed", (await post(adam, "/api/overrides", { remove: "url(riskx, X)" })).status === 400);
  check("a malformed change is refused", (await post(adam, "/api/overrides", { undo: "all" })).status === 400);
  check("progress for someone else needs technical access", (await post(dominic, "/api/progress", { service: "injectx", done: true, who: "adam" })).status === 403);
  check("progress outside the role scope is refused", (await post(dominic, "/api/progress", { service: "injectx", done: true })).status === 400);
  const reset = await post(adam, "/api/progress", { service: "injectx", items: [], done: false });
  check("resetting a service takes back its local progress", reset.status === 200 && reset.body.undone?.length === 1, JSON.stringify(reset.body));
  const mine = await adam("/api/verify/injectx");
  const askFor = (item: string) => mine.body.requirements?.find((r: { item: string }) => r.item === item)?.ask ?? [];
  check("each step names who can help with it", ["rasmus", "adam"].every((p) => askFor("docker_compose").includes(p)) && askFor("onboarding").includes("rasmus"),
    JSON.stringify(mine.body.requirements?.map((r: { item: string; ask: string[] }) => [r.item, r.ask])));
  check("verify names the person and their role", mine.body.who_name === "Adam, Software Engineer" && mine.body.who_role === "Developer" && mine.body.ready === false);
  const all = (await adam("/api/overrides")).body.changes.map((c: { id: string }) => c.id);
  const undone = await post(adam, "/api/overrides", { undo: all });
  check("every local change can be undone", undone.status === 200 && undone.body.changes?.length === 0, JSON.stringify(undone.body));

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
  rmSync(scratch, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
