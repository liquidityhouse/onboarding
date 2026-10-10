// MCP server: progressive access to the liquidity.house knowledge base for AI agents.
//
// Agents discover → focus → verify → explain instead of reading repositories:
//   get_knowledge_overview    domains, their relations and entities, services, rules
//   query_entity_context      triples within N hops of one entity, in a role scope
//   verify_task_onboarding    what working on a service needs, and what is still missing
//   explain_rule_or_decision  English proof traces for a goal, or a rule in words
//   query_knowledge_base      any goal, run in a sandbox; for developers exploring directly
//
// The answers come from the same Prolog requests (kb/api.pl) and shared engine
// (lib/kb-service.ts) as the web server's REST endpoints. The engine is rebuilt
// when the KB files change, so edits to kb/*.pl apply at once. Which role may use which
// tool is knowledge too: can_use/2 in kb/system.pl, asked before every call.
//
// Run: node mcp-server.ts   (stdio; logs go to stderr)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { current } from "./lib/kb-service.ts";
import type { Problem } from "./lib/kb-types.ts";
import { literal, type KbEngine } from "./lib/prolog.ts";
import { runQuery } from "./lib/sandbox.ts";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const failure = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });

/** Authorisation from the knowledge base: can_use(Role, Tool). Unknown roles have no features. */
async function refused(engine: KbEngine, tool: string, scope: string): Promise<Result | null> {
  const { allowed } = await engine.api<{ allowed: boolean }>(`may_use(${literal(scope)}, ${literal(tool)})`);
  return allowed ? null : failure(`${tool} is not available to role '${scope}'.`);
}

/** Compact JSON keeps answers small; a `problem` from Prolog becomes a tool error with its hints. */
async function answer<T extends Problem>(tool: string, scope: string, ask: (engine: KbEngine) => Promise<T>, extra: Record<string, unknown> = {}): Promise<Result> {
  try {
    const { kb, engine } = await current();
    const no = await refused(engine, tool, scope);
    if (no) return no;
    const body = await ask(engine);
    return {
      content: [{ type: "text", text: JSON.stringify({ ...body, ...extra, kb_version: kb.version }) }],
      isError: body.problem ? true : undefined,
    };
  } catch (e) {
    return failure(`Knowledge base error: ${(e as Error).message}`);
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
    answer("get_knowledge_overview", scope, (e) => e.overview(domain, scope), {
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
  ({ entity, depth, scope, max_triples }) => answer("query_entity_context", scope, (e) => e.context(entity, depth, scope, max_triples)),
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
  ({ service, userId, completed, scope }) => answer("verify_task_onboarding", scope, (e) => e.verify(userId, service, completed, scope)),
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
  ({ expression, max_answers, scope }) =>
    answer("explain_rule_or_decision", scope, async (e) => {
      const ex = await e.explainGoal(expression, max_answers, scope);
      for (const a of ex.answers ?? []) delete a.lines; // agents read `explanation`; lines are for the explorer
      return ex;
    }),
);

server.registerTool(
  "query_knowledge_base",
  {
    title: "Query the knowledge base",
    description: describe("query_knowledge_base",
      "Give a Prolog goal, e.g. soft_credit_limit(Op, Limit) or relies_on(api_check, D); each answer comes back as its variable bindings. Runs in a separate worker for at most 3 seconds, so halt/0 or a runaway goal cannot affect the server."),
    inputSchema: {
      goal: z.string().min(1).max(2000).describe("A Prolog goal; the final full stop is optional."),
      max_answers: z.number().int().min(1).max(200).default(50).describe("Cap on listed answers."),
      scope: role,
    },
    annotations: readOnly,
  },
  async ({ goal, max_answers, scope }) => {
    try {
      const { kb, engine } = await current();
      const no = await refused(engine, "query_knowledge_base", scope);
      if (no) return no;
      const lines = await runQuery(kb.program, goal, { timeoutMs: 3000, limit: max_answers });
      const truncated = lines.length > max_answers;
      const answers = truncated ? lines.slice(0, max_answers) : lines;
      return { content: [{ type: "text", text: JSON.stringify({ goal, answers, truncated, kb_version: kb.version }) }] };
    } catch (e) {
      return failure(`Query stopped: ${(e as Error).message}`);
    }
  },
);

await current();
await server.connect(new StdioServerTransport());
console.error("[mcp] liquidity-house-knowledge ready on stdio");
