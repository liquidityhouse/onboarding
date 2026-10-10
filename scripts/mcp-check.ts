// Smoke test for the MCP tools at the web server's POST /mcp, on servers started on spare ports:
// lists the tools, walks the discover → focus → verify → explain sequence an agent would follow,
// and checks that free-form queries are answered, refused outside their role and contained in
// the sandbox, that a signed-in person is held to their role, and that dev mode answers local
// clients only.
//
// Run: npm run mcp:check

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
}

async function start(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, [join(ROOT, "server.ts")], { env: { ...process.env, PORT: String(port), ...env }, stdio: ["ignore", "ignore", "inherit"] });
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
];

// --- Dev identity: each call names its role in `scope` ---
const dev = await start(8796, {});
const viaUrl = await connect(http(8796));
const devTools = (await viaUrl.listTools()).tools.map((t) => t.name);
console.log(`tools: ${devTools.join(", ")}`);
check("http: five tools", devTools.length === 5);
await calls("http", viaUrl, sequence);
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
await calls("proxy", adam, [
  ["query_knowledge_base", { goal: "soft_credit_limit(dope, L)" }, false, (t) => t.includes("L = 74750")],
  // Progress is the signed-in person's own by default; a developer may check others' (technical).
  ["verify_task_onboarding", { service: "injectx" }, false, (t) => JSON.parse(t).who === "adam"],
  ["verify_task_onboarding", { service: "injectx", userId: "georgi" }, false, (t) => JSON.parse(t).who === "georgi"],
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

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
