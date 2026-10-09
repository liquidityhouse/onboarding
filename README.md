# Liquidity House Knowledge Explorer

An explainable knowledge graph for onboarding and RiskX. The knowledge base is Prolog; it is served from one
API endpoint and reasoned over in the browser by Trealla Prolog (WebAssembly).

```
kb/*.pl + onboarding.pl ──▶ GET /api/kb (server.ts) ──▶ Trealla WASM in the browser ──▶ graph · table · console · explanations
```

## Run

Requires Node ≥ 23.6 (runs TypeScript directly, no build step).

```bash
npm start
```

Open http://localhost:8765. `npm run dev` restarts the server on change. `npm install && npm run typecheck` type-checks.

## The single source

`kb/manifest.json` lists the Prolog files that `/api/kb` concatenates into one program, versioned by content hash
(the ETag). The browser polls it (off / 10 s / 30 s / 5 min) and re-reasons whenever it changes, and the MCP server
re-reads it on every call, so whatever writes the facts (for example a Metabase sync every 5 minutes) only has to
update the `.pl` files. `lib/kb-source.ts` is the one loader both servers use.

| File | Holds |
|---|---|
| `onboarding.pl` | Organisation, team, people, accounts, email, Slack, Jira, services, their dependencies and setups; rules for links, email addresses, siblings and requirements |
| `kb/progress.pl` | `completed(Who, Item)`: what each person or agent has already set up |
| `kb/riskx_kb.pl` | Operator KPIs, risk weights and the credit-limit / allowance / exposure rules |
| `kb/lexicon.pl` | **Primitive vocabulary**: nouns, verbs, units, plurals, flags, operator words |
| `kb/schema.pl` | Domains, which relations are shown, entity types, colours/shapes, roles and users |
| `kb/explain.pl` | Meta-interpreter (`solve/2`) and the sentence composer |
| `kb/api.pl` | `triple/3` bridge, `mindmap_focus/4`, and the JSON `api/1` requests the UI and the MCP server call |

## MCP server for AI agents

`mcp-server.ts` exposes the knowledge base to coding agents over MCP (stdio), so they can discover what they need
instead of reading repositories. It runs the same Prolog requests (`kb/api.pl`) and engine wrapper
(`public/prolog.ts`) as the explorer, with Trealla running in Node.

| Tool | Use it to | Returns |
|---|---|---|
| `get_knowledge_overview` | Discover: domains, their relations and entities, services, rules in English | ~1–4 KB JSON |
| `query_entity_context` | Focus: triples within 1–3 hops of an entity, in a role scope, nearest first | triples + entity types; suggestions for unknown ids |
| `verify_task_onboarding` | Verify: everything needed to work on a service, what is missing, links, who invites you, why | checklist + one-sentence summary |
| `explain_rule_or_decision` | Explain: a goal such as `soft_credit_limit(dope, L)` or a rule name | bindings + English proof trace |

Requirements are inferred, not listed: a service needs its own repository, the repositories it `depends_on`
(transitively), its `needs_setup` items and its `data_source`s. Progress comes from `kb/progress.pl` and from the
`completed` list an agent passes in. Goals are parsed by Prolog and only knowledge-base relations can be explained.

The server is registered for Claude Code in `.mcp.json` (approve it when prompted). To run or check it by hand:

```bash
npm run mcp:check
```

## Explanations come from primitives

There are no per-predicate sentence templates. `explain.pl` composes every sentence from `lexicon.pl`:

- A **fact** reads as a relation (`verb/2`: "Operator 'dope' is monitored by repository 'riskx'.") or as an
  attribute ("The wallet exposure of operator 'dope' is 15,000 USD."), with units from `unit/2`.
- A **rule** is described by reading its clause: each body variable is named after the concept that binds it,
  so `Limit is GGR * GF + …` becomes "Soft credit limit = 90-day gross gaming revenue × ggr factor + …".
- A **calculation** pairs those names with the values in the proof: "… 90-day gross gaming revenue (120,000 USD) × ggr factor (0.50) … = 74,750.00 USD".
- **Severity** comes from `flag/3`, so `exposure_warning(_, high)` shows as a warning.

To add a relation, add the facts, one `kb_predicate/3` line in `schema.pl`, and a `noun/2` or `verb/2` only
when the humanised predicate name doesn't read well.

## Exploring

- **Users and scopes**: each user has a role, which sets the domains they can see, the views they get
  (Table, Prolog console) and whether raw proof terms are shown. Settings are remembered per user.
- **Views**: mind map, hierarchy (four directions), triple table, Prolog console.
- **Focus**: click a node to re-centre (or turn that off), search, go back through history, and set depth 1–5.
- **Scope**: toggle domains and individual relations, derived conclusions, and value/link leaves.
- **Entity types**: show/hide each type and change its colour and shape. Defaults come from `type_style/3`.
- **Shareable state**: the URL keeps `#u=user&v=view&f=focus&d=depth`.

Operators other than `dope` are illustrative sample data.
