// Smoke test for the MCP server over real stdio: lists the tools, then walks the
// discover → focus → verify → explain sequence an agent would follow.
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

const calls: [string, Record<string, unknown>][] = [
  ["get_knowledge_overview", { domain: "platform" }],
  ["query_entity_context", { entity: "injectx", depth: 1, max_triples: 6 }],
  ["query_entity_context", { entity: "inject" }],
  ["verify_task_onboarding", { service: "injectx", completed: ["onboarding"] }],
  ["explain_rule_or_decision", { expression: "exposure_warning(spinhaus, Level)" }],
  ["explain_rule_or_decision", { expression: "halt" }],
];

let failed = 0;
for (const [name, args] of calls) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
  const expectError = name === "explain_rule_or_decision" && args.expression === "halt" || args.entity === "inject";
  const ok = Boolean(result.isError) === expectError;
  if (!ok) failed++;
  console.log(`\n${ok ? "ok  " : "FAIL"} ${name} ${JSON.stringify(args)} (${text.length} chars)\n${text.slice(0, 700)}`);
}

await client.close();
process.exit(failed ? 1 : 0);
