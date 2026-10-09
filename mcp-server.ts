// MCP server: progressive access to the liquidity.house knowledge base for AI agents.
//
// Agents discover → focus → verify → explain instead of reading repositories:
//   get_knowledge_overview    domains, their relations and entities, services, rules
//   query_entity_context      triples within N hops of one entity, in a role scope
//   verify_task_onboarding    what working on a service needs, and what is still missing
//   explain_rule_or_decision  English proof traces for a goal, or a rule in words
//
// The answers come from the same Prolog requests (kb/api.pl) and shared engine
// (lib/kb-service.ts) as the web server's REST endpoints. The engine is rebuilt
// when the KB files change, so edits to kb/*.pl apply at once.
//
// Run: node mcp-server.ts   (stdio; logs go to stderr)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { current } from "./lib/kb-service.ts";
import type { Problem } from "./lib/kb-types.ts";
import type { KbEngine } from "./lib/prolog.ts";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Compact JSON keeps answers small; a `problem` from Prolog becomes a tool error with its hints. */
async function answer<T extends Problem>(ask: (engine: KbEngine) => Promise<T>, extra: Record<string, unknown> = {}): Promise<Result> {
  try {
    const { kb, engine } = await current();
    const body = await ask(engine);
    return {
      content: [{ type: "text", text: JSON.stringify({ ...body, ...extra, kb_version: kb.version }) }],
      isError: body.problem ? true : undefined,
    };
  } catch (e) {
    return { content: [{ type: "text", text: `Knowledge base error: ${(e as Error).message}` }], isError: true };
  }
}

const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const role = z.string().default("developer").describe("Role scope: developer, risk_officer or admin. It limits which domains are visible.");

// Tool descriptions are knowledge: purpose/2 in kb/system.pl ("to start here: …" → "Start here: …").
const docs = await (await current()).engine.api<Record<string, string>>("tool_docs");
const describe = (tool: string, usage: string) => {
  const purpose = (docs[tool] ?? "").replace(/^to /, "");
  return `${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}. ${usage}`.trim();
};

const server = new McpServer({ name: "liquidity-house-knowledge", version: "1.0.0" });

server.registerTool(
  "get_knowledge_overview",
  {
    title: "Knowledge overview",
    description: describe("get_knowledge_overview", "Use the entity ids it returns with query_entity_context."),
    inputSchema: {
      domain: z.string().default("all").describe("A domain id to narrow the overview, or 'all'."),
      scope: role,
    },
    annotations: readOnly,
  },
  ({ domain, scope }) =>
    answer((e) => e.overview(domain, scope), {
      next: "query_entity_context(entity) to focus; verify_task_onboarding(service) before working on a service; explain_rule_or_decision(expression) for why.",
    }),
);

server.registerTool(
  "query_entity_context",
  {
    title: "Entity context",
    description: describe("query_entity_context", "Walks through entities only, never links or numbers; unknown ids return suggestions."),
    inputSchema: {
      entity: z.string().min(1).describe("Entity id exactly as in the overview, e.g. 'injectx' or 'GOAT'."),
      depth: z.number().int().min(1).max(3).default(1).describe("Hops from the entity (1–3)."),
      scope: role,
      max_triples: z.number().int().min(1).max(200).default(40).describe("Cap on returned triples, nearest first."),
    },
    annotations: readOnly,
  },
  ({ entity, depth, scope, max_triples }) => answer((e) => e.context(entity, depth, scope, max_triples)),
);

server.registerTool(
  "verify_task_onboarding",
  {
    title: "Verify onboarding for a task",
    description: describe("verify_task_onboarding", "Progress comes from kb/progress.pl and from `completed`."),
    inputSchema: {
      service: z.string().min(1).describe("Service id, e.g. 'injectx' or 'riskx'."),
      userId: z.string().min(1).default("current_agent").describe("Person or agent id whose progress to check."),
      completed: z
        .array(z.string().min(1))
        .default([])
        .describe("Items already done in this session (e.g. repositories already cloned), in addition to kb/progress.pl."),
      scope: role,
    },
    annotations: readOnly,
  },
  ({ service, userId, completed, scope }) => answer((e) => e.verify(userId, service, completed, scope)),
);

server.registerTool(
  "explain_rule_or_decision",
  {
    title: "Explain a rule or decision",
    description: describe("explain_rule_or_decision", "Only knowledge-base relations in the role's scope can be explained."),
    inputSchema: {
      expression: z.string().min(1).describe("A Prolog goal over knowledge-base relations, or a rule name."),
      max_answers: z.number().int().min(1).max(20).default(3).describe("Cap on explained answers."),
      scope: role,
    },
    annotations: readOnly,
  },
  ({ expression, max_answers, scope }) => answer((e) => e.explainGoal(expression, max_answers, scope)),
);

await current();
await server.connect(new StdioServerTransport());
console.error("[mcp] liquidity-house-knowledge ready on stdio");
