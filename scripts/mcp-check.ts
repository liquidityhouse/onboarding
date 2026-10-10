// Smoke test for the MCP server over real stdio: lists the tools, then walks the
// discover → focus → verify → explain sequence an agent would follow, and checks that
// free-form queries are answered, refused outside their role and contained in the sandbox.
//
// Run: npm run mcp:check

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(import.meta.dirname, "..", "mcp-server.ts")],
  stderr: "inherit",
});
const client = new Client({ name: "mcp-check", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);

// [tool, arguments, whether a tool error is expected, optional check on the answer text]
const calls: [string, Record<string, unknown>, boolean, ((text: string) => boolean)?][] = [
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
  ["query_knowledge_base", { goal: "halt" }, true, (t) => /Query stopped/.test(t)],
  ["query_knowledge_base", { goal: "repeat, fail" }, true, (t) => /stopped after 3 s/.test(t)],
  // …which still answers afterwards.
  ["query_knowledge_base", { goal: "daily_allowance(dope, A)" }, false, (t) => t.includes("A = 7475")],
];

let failed = 0;
for (const [name, args, expectError, check] of calls) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
  const ok = Boolean(result.isError) === expectError && (!check || check(text));
  if (!ok) failed++;
  console.log(`\n${ok ? "ok  " : "FAIL"} ${name} ${JSON.stringify(args)} (${text.length} chars)\n${text.slice(0, 700)}`);
}

await client.close();
process.exit(failed ? 1 : 0);
