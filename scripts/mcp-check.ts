// Smoke test for the MCP tools at the web server's POST /mcp, on servers started on spare ports:
// lists the tools, walks the discover → focus → verify → explain sequence an agent would follow,
// and checks that free-form queries are answered, refused outside their role and contained in
// the sandbox, that a signed-in person is held to their role, and that dev mode answers local
// clients only; then that progress and local changes to facts are recorded (in a scratch state
// file, never the real one), refused where they should be, and undone.
//
// Run: npm run mcp:check

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
}

// Local changes go to a scratch state file, so the check never touches state/overrides.json.
const scratch = mkdtempSync(join(tmpdir(), "mcp-check-"));
const KB_STATE = join(scratch, "overrides.json");

async function start(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, [join(ROOT, "server.ts")], { env: { ...process.env, PORT: String(port), KB_STATE, ...env }, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server on ${port} did not start`);
}

const http = (port: number, headers: Record<string, string> = {}) =>
  new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`), { requestInit: { headers } });

async function connect(transport: StreamableHTTPClientTransport): Promise<Client> {
  const client = new Client({ name: "mcp-check", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

type Call = [string, Record<string, unknown>, boolean, ((text: string) => boolean)?];

/** Each call: [tool, arguments, whether a tool error is expected, optional check on the answer text]. */
async function calls(label: string, client: Client, list: Call[]) {
  for (const [name, args, expectError, test] of list) {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    check(`${label}: ${name} ${JSON.stringify(args)}`, Boolean(result.isError) === expectError && (!test || test(text)), text.slice(0, 300));
  }
}

const sequence: Call[] = [
  ["get_knowledge_overview", { domain: "platform" }, false],
  ["query_entity_context", { entity: "injectx", depth: 1, max_triples: 6 }, false],
  ["query_entity_context", { entity: "inject" }, true],
  ["verify_task_onboarding", { service: "injectx", completed: ["onboarding"] }, false],
  ["explain_rule_or_decision", { expression: "exposure_warning(spinhaus, Level)" }, false],
  ["explain_rule_or_decision", { expression: "halt" }, true],
  // Free-form queries: every answer listed, capped, refused without the console feature.
  ["query_knowledge_base", { goal: "soft_credit_limit(Op, Limit)" }, false,
    (t) => JSON.parse(t).answers.length === 4 && t.includes("Op = dope")],
  ["query_knowledge_base", { goal: "relies_on(api_check, D)", max_answers: 3 }, false,
    (t) => JSON.parse(t).answers.length === 3 && JSON.parse(t).truncated === true],
  ["query_knowledge_base", { goal: "operator(nobody, S)" }, false, (t) => JSON.parse(t).answers[0] === "false."],
  ["query_knowledge_base", { goal: "soft_credit_limit(Op, Limit)", scope: "risk_officer" }, true, (t) => /not available/.test(t)],
  // Contained: halt/0 and a runaway goal end the worker, not the server…
  ["query_knowledge_base", { goal: "halt" }, false, (t) => JSON.parse(t).answers[0] === "false."],
  ["query_knowledge_base", { goal: "repeat, fail" }, true, (t) => /stopped after 3 s/.test(t)],
  // …which still answers afterwards.
  ["query_knowledge_base", { goal: "daily_allowance(dope, A)" }, false, (t) => t.includes("A = 7475")],
  // Who to ask: AWS access from Richard before Rasmus can help with the injectx API page.
  ["query_knowledge_base", { goal: "access_granted_by(injectx_api, First), can_help_with(Then, injectx_api)" }, false,
    (t) => JSON.parse(t).answers.join() === "First = richard, Then = rasmus."],
  ["explain_rule_or_decision", { expression: "access_granted_by(injectx_api, Who)" }, false, (t) => /API gateway/.test(t) && /richard/.test(t)],
  // Dominic helps with riskx as Head of Risk, not with its setup.
  ["query_knowledge_base", { goal: "can_help_with(dominic, X)" }, false, (t) => JSON.parse(t).answers.join() === "X = riskx."],
  // Candidate owners: most commits among people still in Slack; unmatched GitHub users never own.
  ["query_knowledge_base", { goal: "candidate_owner(adminx, P)" }, false, (t) => JSON.parse(t).answers.join() === "P = gustav."],
  ["query_knowledge_base", { goal: "commits_by(_, P, _), \\+ full_name(P, _)" }, false, (t) => JSON.parse(t).answers[0] === "false."],
];

// --- Dev identity: each call names its role in `scope` ---
const dev = await start(8796, {});
const viaUrl = await connect(http(8796));
const devTools = (await viaUrl.listTools()).tools.map((t) => t.name);
console.log(`tools: ${devTools.join(", ")}`);
check("http: seven tools", devTools.length === 7);
await calls("http", viaUrl, sequence);

// Progress and local changes: recorded, refused where they should be, visible to queries, undone.
const ids: string[] = [];
const keep = (t: string) => { for (const c of JSON.parse(t).changes ?? []) ids.push(c.id); return true; };
await calls("http", viaUrl, [
  ["record_progress", { service: "injectx", items: ["onboarding"], done: true, userId: "adam" }, false,
    (t) => !JSON.parse(t).missing.includes("onboarding") && JSON.parse(t).added.length === 1],
  ["record_progress", { service: "injectx", items: ["onboarding"], done: true }, true, (t) => /whose progress/.test(t)],
  ["record_progress", { service: "injectx", items: ["nothing"], done: true, userId: "adam" }, true, (t) => /not needed for injectx/.test(t)],
  ["record_progress", { service: "injectx", done: true, userId: "dominic", scope: "risk_officer" }, true, (t) => /not in this role scope/.test(t)],
  ["verify_task_onboarding", { service: "injectx", userId: "adam" }, false,
    (t) => JSON.parse(t).requirements.find((r: { item: string }) => r.item === "onboarding").change.via === "mcp"],
  ["change_facts", { add: "invites(rasmus, 'liquidity-house').\nrole_feature(dominic, technical).", userId: "adam" }, false,
    (t) => JSON.parse(t).added.length === 1 && /who may see and do what/.test(JSON.parse(t).skipped[0].reason)],
  ["change_facts", { remove: "invites(richard, 'liquidity-house')", userId: "adam" }, false, (t) => JSON.parse(t).removed.length === 1 && keep(t)],
  ["change_facts", { remove: "soft_credit_limit(dope, 74750.0)" }, true, (t) => /worked out by a rule/.test(t)],
  ["change_facts", { add: "invites(rasmus, 'liquidity-house')." , scope: "risk_officer" }, true, (t) => /not available to role/.test(t)],
  ["query_knowledge_base", { goal: "local_change(Id, Op, Fact, By, Via, _, _)" }, false, (t) => JSON.parse(t).answers.length === 3],
  ["query_knowledge_base", { goal: "invites(richard, X)" }, false, (t) => JSON.parse(t).answers[0] === "false."],
]);
const { content } = await viaUrl.callTool({ name: "change_facts", arguments: { undo: ids } });
const undone = JSON.parse((content as { text: string }[])[0].text);
check("http: change_facts undoes every change", undone.undone?.length === 3 && undone.changes.length === 0, JSON.stringify(undone));
await viaUrl.close();
check("http: GET is refused (stateless)", (await fetch("http://localhost:8796/mcp")).status === 405);
const foreign = await fetch("http://localhost:8796/mcp", { method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json" }, body: "{}" });
check("http: dev mode refuses other sites", foreign.status === 403);
dev.kill();

// --- Behind an auth proxy: the role is the signed-in person's ---
const proxy = await start(8795, { KB_AUTH: "proxy" });
const adam = await connect(http(8795, { "X-Forwarded-Email": "adam@goat.gs" }));
const adamTools = (await adam.listTools()).tools;
check("proxy: tools take no scope", adamTools.every((t) => !("scope" in (t.inputSchema.properties ?? {}))));
check("proxy: changes are the signed-in person's", !("userId" in (adamTools.find((t) => t.name === "change_facts")?.inputSchema.properties ?? {})));
await calls("proxy", adam, [
  ["query_knowledge_base", { goal: "soft_credit_limit(dope, L)" }, false, (t) => t.includes("L = 74750")],
  // Progress is the signed-in person's own by default; a developer may check others' (technical).
  ["verify_task_onboarding", { service: "injectx" }, false, (t) => JSON.parse(t).who === "adam"],
  ["verify_task_onboarding", { service: "injectx", userId: "georgi" }, false, (t) => JSON.parse(t).who === "georgi"],
  ["record_progress", { service: "injectx", items: ["k8s"], done: true }, false, (t) => !JSON.parse(t).missing.includes("k8s")],
  ["verify_task_onboarding", { service: "injectx" }, false,
    (t) => JSON.parse(t).who_role === "Developer" && JSON.parse(t).requirements.find((r: { item: string }) => r.item === "k8s").change.by === "adam"],
  ["record_progress", { service: "injectx", done: false }, false, (t) => JSON.parse(t).undone.length === 1],
]);
await adam.close();
let unknown = "connected";
try {
  await connect(http(8795, { "X-Forwarded-Email": "nobody@example.com" }));
} catch (e) {
  unknown = (e as Error).message;
}
check("proxy: unknown email is refused", /no account for this email/.test(unknown), unknown);
proxy.kill();
rmSync(scratch, { recursive: true, force: true });

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
