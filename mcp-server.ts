// MCP server: progressive access to the liquidity.house knowledge base for AI agents.
//
// Agents discover → focus → verify → explain instead of reading repositories:
//   get_knowledge_overview    domains, their relations and entities, services, rules
//   query_entity_context      triples within N hops of one entity, in a role scope
//   verify_task_onboarding    what working on a service needs, and what is still missing
//   explain_rule_or_decision  English proof traces for a goal, or a rule in words
//
// The answers come from the same Prolog requests (kb/api.pl) and engine wrapper
// (public/prolog.ts) as the browser explorer. The KB is re-read on every call and
// the engine rebuilt when its version changes, so edits to kb/*.pl apply at once.
//
// Run: node mcp-server.ts   (stdio; logs go to stderr)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadKb } from "./lib/kb-source.ts";
import { KbEngine, type Problem } from "./public/prolog.ts";

let loaded: { version: string; engine: Promise<KbEngine> } | null = null;

/** The engine for the current KB version, rebuilt only when the files change. */
async function current(): Promise<{ version: string; engine: KbEngine }> {
  const kb = await loadKb();
  if (loaded?.version !== kb.version) {
    const engine = KbEngine.create(kb.program).then((e) => {
      if (e.warnings) console.error(`[kb ${kb.version}] ${e.warnings}`);
      return e;
    });
    loaded = { version: kb.version, engine };
    console.error(`[kb] loaded version ${kb.version}`);
  }
  return { version: loaded.version, engine: await loaded.engine };
}

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Compact JSON keeps answers small; a `problem` from Prolog becomes a tool error with its hints. */
async function answer<T extends Problem>(ask: (engine: KbEngine) => Promise<T>, extra: Record<string, unknown> = {}): Promise<Result> {
  try {
    const { version, engine } = await current();
    const body = await ask(engine);
    return {
      content: [{ type: "text", text: JSON.stringify({ ...body, ...extra, kb_version: version }) }],
      isError: body.problem ? true : undefined,
    };
  } catch (e) {
    return { content: [{ type: "text", text: `Knowledge base error: ${(e as Error).message}` }], isError: true };
  }
}

const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const role = z.string().default("developer").describe("Role scope: developer, risk_officer or admin. It limits which domains are visible.");

const server = new McpServer({ name: "liquidity-house-knowledge", version: "1.0.0" });

server.registerTool(
  "get_knowledge_overview",
  {
    title: "Knowledge overview",
    description:
      "Start here. Lists the knowledge domains (onboarding, platform, risk) visible to a role, the relations in each, " +
      "the entities grouped by type, the services, and every rule in plain English. Small enough to read in full; " +
      "use the entity ids it returns with query_entity_context.",
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
    description:
      "Returns the facts and derived conclusions around one entity (e.g. 'injectx', 'riskx', 'dope', 'liquidity_house') " +
      "as triples {subject, predicate, object, relation, derived, hops}, walking at most `depth` hops through entities " +
      "(never through links or numbers), plus the type of every entity mentioned. Unknown ids return suggestions.",
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
    description:
      "Infers everything needed to work on a service: its own repository, the repositories it depends on (transitively), " +
      "its environment setups and its data sources. Each requirement says what to do (clone, set up, get access to), " +
      "its link, who can invite you, and why it is needed. Marks what is already done from kb/progress.pl and from `completed`.",
    inputSchema: {
      service: z.string().min(1).describe("Service id, e.g. 'injectx' or 'riskx'."),
      userId: z.string().min(1).default("current_agent").describe("Person or agent id whose progress to check."),
      completed: z
        .array(z.string().min(1))
        .default([])
        .describe("Items already done in this session (e.g. repositories already cloned), in addition to kb/progress.pl."),
    },
    annotations: readOnly,
  },
  ({ service, userId, completed }) => answer((e) => e.verify(userId, service, completed)),
);

server.registerTool(
  "explain_rule_or_decision",
  {
    title: "Explain a rule or decision",
    description:
      "Proves a goal with the explainer and returns, per answer, the variable bindings and an English trace of the facts, " +
      "rules and calculations used. Examples: 'soft_credit_limit(dope, Limit)', 'exposure_warning(spinhaus, Level)', " +
      "'requires(injectx, What)', 'url(riskx, Url)'. A bare rule name such as 'soft_credit_limit' returns the rule in words. " +
      "Only knowledge-base relations can be explained.",
    inputSchema: {
      expression: z.string().min(1).describe("A Prolog goal over knowledge-base relations, or a rule name."),
      max_answers: z.number().int().min(1).max(20).default(3).describe("Cap on explained answers."),
    },
    annotations: readOnly,
  },
  ({ expression, max_answers }) => answer((e) => e.explainGoal(expression, max_answers)),
);

await current();
await server.connect(new StdioServerTransport());
console.error("[mcp] liquidity-house-knowledge ready on stdio");
