// The MCP tools for AI agents, served by the web server at POST /mcp (Streamable HTTP,
// stateless), so agents reach them by URL: localhost now, an AdminX endpoint later.
//
// Agents discover → focus → verify → explain instead of reading repositories:
//   get_knowledge_overview    domains, their relations and entities, services, rules
//   query_entity_context      triples within N hops of one entity, in a role scope
//   verify_task_onboarding    what working on a service needs, and what is still missing
//   explain_rule_or_decision  English proof traces for a goal, or a rule in words
//   query_knowledge_base      any goal, run in a sandbox; for developers exploring directly
//   record_progress           mark a service's setup steps done or not done, for a person
//   change_facts              add, edit, remove or undo facts locally (lib/overrides.ts)
//
// The answers come from the same Prolog requests (kb/api.pl) and shared engine
// (lib/kb-service.ts) as the web server's REST endpoints, so edits to kb/*.pl apply at once.
// Which role may use which tool is knowledge too: can_use/2 in the explorer pack, asked before
// every call. With dev identity (KB_AUTH=dev) each call names its role in `scope`; behind an
// auth proxy (KB_AUTH=proxy) the role is the signed-in person's, and only their tools are listed.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { current } from "./kb-service.ts";
import type { Outcome, Problem, Session } from "./kb-types.ts";
import { literal, type KbEngine } from "./prolog.ts";
import { changeFacts, recordProgress } from "./overrides.ts";
import { runQuery } from "./sandbox.ts";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const failure = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });

const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const changes = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const role = z.string().default("developer").describe("Role scope: developer, risk_officer or admin. It limits which domains are visible.");

/** Authorisation from the knowledge base: can_use(Role, Tool). Unknown roles have no features. */
async function mayUse(engine: KbEngine, role: string, tool: string): Promise<boolean> {
  return (await engine.api<{ allowed: boolean }>(`may_use(${literal(role)}, ${literal(tool)})`)).allowed;
}

/** A fresh server with the tools: cheap, since the engine and the tool texts are shared. */
export async function knowledgeServer(session?: Session): Promise<McpServer> {
  const { engine, cached } = await current();

  // Tool descriptions are knowledge: purpose/2 in the explorer pack ("to start here: …" → "Start here: …").
  const docs = await cached("tool_docs", () => engine.api<Record<string, string>>("tool_docs"));
  const describe = (tool: string, usage: string) => {
    const purpose = (docs[tool] ?? "").replace(/^to /, "");
    return `${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}. ${usage}`.trim();
  };

  // Signed in, the role is the person's own and tools outside it are not offered.
  const scoped: { scope?: typeof role } = session ? {} : { scope: role };
  const roleOf = (scope?: string) => session?.role ?? scope ?? "developer";
  const offered = async (tool: string) => !session || (await mayUse(engine, session.role, tool));

  /** Compact JSON keeps answers small; a `problem` from Prolog becomes a tool error with its hints. */
  async function answer<T extends Problem>(tool: string, scope: string, ask: (engine: KbEngine) => Promise<T>, extra: Record<string, unknown> = {}): Promise<Result> {
    try {
      const { kb, engine } = await current();
      if (!(await mayUse(engine, scope, tool))) return failure(`${tool} is not available to role '${scope}'.`);
      const body = await ask(engine);
      return {
        content: [{ type: "text", text: JSON.stringify({ ...body, ...extra, kb_version: kb.version }) }],
        isError: body.problem ? true : undefined,
      };
    } catch (e) {
      return failure(`Knowledge base error: ${(e as Error).message}`);
    }
  }

  const server = new McpServer({ name: "liquidity-house-knowledge", version: "1.0.0" });

  if (await offered("get_knowledge_overview"))
    server.registerTool(
      "get_knowledge_overview",
      {
        title: "Knowledge overview",
        description: describe("get_knowledge_overview", "Use the entity ids it returns with query_entity_context."),
        inputSchema: {
          domain: z.string().default("all").describe("A domain id to narrow the overview, or 'all'."),
          ...scoped,
        },
        annotations: readOnly,
      },
      ({ domain, scope }) =>
        answer("get_knowledge_overview", roleOf(scope), (e) => e.overview(domain, roleOf(scope)), {
          next: "query_entity_context(entity) to focus; verify_task_onboarding(service) before working on a service; explain_rule_or_decision(expression) for why.",
        }),
    );

  if (await offered("query_entity_context"))
    server.registerTool(
      "query_entity_context",
      {
        title: "Entity context",
        description: describe("query_entity_context", "Walks through entities only, never links or numbers; unknown ids return suggestions."),
        inputSchema: {
          entity: z.string().min(1).describe("Entity id exactly as in the overview, e.g. 'injectx' or 'GOAT'."),
          depth: z.number().int().min(1).max(3).default(1).describe("Hops from the entity (1–3)."),
          ...scoped,
          max_triples: z.number().int().min(1).max(200).default(40).describe("Cap on returned triples, nearest first."),
        },
        annotations: readOnly,
      },
      ({ entity, depth, scope, max_triples }) =>
        answer("query_entity_context", roleOf(scope), (e) => e.context(entity, depth, roleOf(scope), max_triples)),
    );

  if (await offered("verify_task_onboarding"))
    server.registerTool(
      "verify_task_onboarding",
      {
        title: "Verify onboarding for a task",
        description: describe("verify_task_onboarding", "Progress comes from completed/2 facts (the pack's progress.pl and local overrides, which record_progress changes) and from `completed`."),
        inputSchema: {
          service: z.string().min(1).describe("Service id, e.g. 'injectx' or 'riskx'."),
          userId: z
            .string()
            .min(1)
            .default(session?.user ?? "current_agent")
            .describe(session ? "Person whose progress to check; yourself unless your role has technical access." : "Person or agent id whose progress to check."),
          completed: z
            .array(z.string().min(1))
            .default([])
            .describe("Items already done, for this answer only; record_progress keeps them."),
          ...scoped,
        },
        annotations: readOnly,
      },
      ({ service, userId, completed, scope }) => {
        // As GET /api/verify: checking someone else's progress is for roles with technical access.
        if (session && userId !== session.user && !session.features.includes("technical"))
          return failure("You can only verify your own progress.");
        return answer("verify_task_onboarding", roleOf(scope), (e) => e.verify(userId, service, completed, roleOf(scope)));
      },
    );

  if (await offered("explain_rule_or_decision"))
    server.registerTool(
      "explain_rule_or_decision",
      {
        title: "Explain a rule or decision",
        description: describe("explain_rule_or_decision", "Only knowledge-base relations in the role's scope can be explained."),
        inputSchema: {
          expression: z.string().min(1).describe("A Prolog goal over knowledge-base relations, or a rule name."),
          max_answers: z.number().int().min(1).max(20).default(3).describe("Cap on explained answers."),
          ...scoped,
        },
        annotations: readOnly,
      },
      ({ expression, max_answers, scope }) =>
        answer("explain_rule_or_decision", roleOf(scope), async (e) => {
          const ex = await e.explainGoal(expression, max_answers, roleOf(scope));
          for (const a of ex.answers ?? []) delete a.lines; // agents read `explanation`; lines are for the explorer
          return ex;
        }),
    );

  if (await offered("query_knowledge_base"))
    server.registerTool(
      "query_knowledge_base",
      {
        title: "Query the knowledge base",
        description: describe("query_knowledge_base",
          "Give a Prolog goal, e.g. soft_credit_limit(Op, Limit) or relies_on(api_check, D); each answer comes back as its variable bindings. Runs in a separate worker for at most 3 seconds, so halt/0 or a runaway goal cannot affect the server."),
        inputSchema: {
          goal: z.string().min(1).max(2000).describe("A Prolog goal; the final full stop is optional."),
          max_answers: z.number().int().min(1).max(200).default(50).describe("Cap on listed answers."),
          ...scoped,
        },
        annotations: readOnly,
      },
      async ({ goal, max_answers, scope }) => {
        try {
          const { kb, engine } = await current();
          if (!(await mayUse(engine, roleOf(scope), "query_knowledge_base")))
            return failure(`query_knowledge_base is not available to role '${roleOf(scope)}'.`);
          const lines = await runQuery(kb.program, goal, { timeoutMs: 3000, limit: max_answers });
          const truncated = lines.length > max_answers;
          const answers = truncated ? lines.slice(0, max_answers) : lines;
          return { content: [{ type: "text", text: JSON.stringify({ goal, answers, truncated, kb_version: kb.version }) }] };
        } catch (e) {
          return failure(`Query stopped: ${(e as Error).message}`);
        }
      },
    );

  /** A change's outcome as a tool answer: a problem becomes a tool error. */
  const outcome = (o: Outcome, extra: Record<string, unknown> = {}): Result => ({
    content: [{ type: "text", text: JSON.stringify({ ...o, ...extra }) }],
    isError: o.problem ? true : undefined,
  });

  if (await offered("record_progress"))
    server.registerTool(
      "record_progress",
      {
        title: "Record setup progress",
        description: describe("record_progress",
          "Marks steps done (done: true) or not done (false) as local completed/2 facts; leave items empty for every step of the service, e.g. done: false to reset it before setting it up from scratch. The explorer shows the change at once, with who made it."),
        inputSchema: {
          service: z.string().min(1).describe("Service id, e.g. 'injectx'."),
          items: z.array(z.string().min(1)).default([]).describe("Steps to mark, as verify_task_onboarding lists them; empty for all of them."),
          done: z.boolean().describe("true when the steps are done, false to mark them not done."),
          userId: z
            .string()
            .default(session?.user ?? "")
            .describe(session ? "Whose progress: yourself unless your role has technical access." : "Whose progress, e.g. 'adam': the person you are working for."),
          ...scoped,
        },
        annotations: changes,
      },
      async ({ service, items, done, userId, scope }) => {
        try {
          const { engine } = await current();
          if (!(await mayUse(engine, roleOf(scope), "record_progress"))) return failure(`record_progress is not available to role '${roleOf(scope)}'.`);
          if (!userId) return failure("Say whose progress this is in userId, e.g. 'adam'.");
          if (session && userId !== session.user && !session.features.includes("technical")) return failure("You can only record your own progress.");
          const o = await recordProgress(userId, service, items, done, roleOf(scope), { user: session?.user ?? userId, via: "mcp" });
          if (o.problem) return outcome(o);
          const { engine: after } = await current();
          const v = await after.verify(userId, service, [], roleOf(scope));
          return outcome({ ...o, changes: undefined }, { ready: v.ready, summary: v.summary, missing: v.missing });
        } catch (e) {
          return failure(`Knowledge base error: ${(e as Error).message}`);
        }
      },
    );

  // Signed in, the change is the person's own; otherwise the call says whose it is.
  const actorField: { userId?: z.ZodDefault<z.ZodString> } = session ? {} : {
    userId: z.string().min(1).default("current_agent").describe("Who is making the change, e.g. 'adam' for the person you are working for."),
  };

  if (await offered("change_facts"))
    server.registerTool(
      "change_facts",
      {
        title: "Change facts locally",
        description: describe("change_facts",
          "One change per call: add facts (Prolog text, one or more), read facts from a URL, remove a fact, edit a fact into another, or undo changes by id. Rules, derived facts and who-sees-what are refused, with the reason."),
        inputSchema: {
          add: z.string().max(65_536).optional().describe("Facts to add, e.g. completed(adam, onboarding)."),
          url: z.string().url().optional().describe("A Prolog file over http(s) whose facts to add."),
          remove: z.string().optional().describe("A fact to remove, e.g. invites(richard, 'liquidity-house')."),
          edit: z.object({ fact: z.string(), with: z.string() }).optional().describe("A fact and the fact to put in its place."),
          undo: z.array(z.string()).optional().describe("Ids of local changes to take back."),
          ...actorField,
          ...scoped,
        },
        annotations: { ...changes, openWorldHint: true },
      },
      async ({ add, url, remove, edit, undo, userId, scope }) => {
        try {
          const { engine } = await current();
          if (!(await mayUse(engine, roleOf(scope), "change_facts"))) return failure(`change_facts is not available to role '${roleOf(scope)}'.`);
          return outcome(await changeFacts({ add, url, remove, edit, undo }, { user: session?.user ?? userId ?? "current_agent", via: "mcp" }));
        } catch (e) {
          return failure(`Knowledge base error: ${(e as Error).message}`);
        }
      },
    );

  return server;
}
