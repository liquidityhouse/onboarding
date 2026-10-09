% system.pl — the explorer and its servers, described as knowledge.
%
% Only what nothing else records is stated here. The rest is inferred
% (runs_on, relies_on, can_call, served_by, same_answer, runs_component,
% described_as) or generated from the repository by lib/kb-source.ts: kb_file
% from kb/manifest.json; package_version, engine_requirement, npm_script and
% npm_script_file from package.json; file_summary from each file's header
% comment; clause_source from the explained rules as written. The knowledge is executable: the web server authorises endpoints with
% can_call/2, the MCP server describes its tools with purpose/2, and README.md is
% composed from all of it (readme.pl).

purpose(knowledge_explorer, 'to make onboarding, platform, risk and system knowledge explorable and explainable, for people in the explorer and for AI agents over MCP, from one Prolog knowledge base').

% --- Components and where they run ---
% A component's description is its source file's header comment (described_as/2).
component(explorer_ui, ui).
component(web_server, server).
component(mcp_server, server).
component(kb_service, module).
component(kb_source, module).
component(prolog_engine, module).
component(query_sandbox, module).
component(kb_types, module).
component(optimiser, module).
component(knowledge_base, knowledge).
component(api_check, script).
component(mcp_check, script).
component(code_export, script).
component(readme_builder, script).

executes_in(ui, browser).
executes_in(server, node).
executes_in(module, node).
executes_in(script, node).

source_file(explorer_ui, 'public/app.ts').
source_file(web_server, 'server.ts').
source_file(mcp_server, 'mcp-server.ts').
source_file(kb_service, 'lib/kb-service.ts').
source_file(kb_source, 'lib/kb-source.ts').
source_file(prolog_engine, 'lib/prolog.ts').
source_file(query_sandbox, 'lib/sandbox.ts').
source_file(query_sandbox, 'lib/query-worker.ts').
source_file(kb_types, 'lib/kb-types.ts').
source_file(optimiser, 'lib/optimiser.ts').
source_file(optimiser, 'kb/plan.lp').
source_file(api_check, 'scripts/api-check.ts').
source_file(mcp_check, 'scripts/mcp-check.ts').
source_file(code_export, 'scripts/export-code.ts').
source_file(readme_builder, 'scripts/readme.ts').

purpose(knowledge_base, 'to hold every fact and rule, the vocabulary explanations are built from, and the requests the servers ask').

% --- What uses what (direct use only; relies_on/2 follows the chain) ---
uses(explorer_ui, web_server).
uses(explorer_ui, 'vis-network').
uses(web_server, kb_service).
uses(web_server, query_sandbox).
uses(web_server, optimiser).
uses(mcp_server, kb_service).
uses(mcp_server, '@modelcontextprotocol/sdk').
uses(kb_service, kb_source).
uses(kb_service, prolog_engine).
uses(kb_source, knowledge_base).
uses(prolog_engine, trealla).
uses(query_sandbox, trealla).
uses(optimiser, 'clingo-wasm').
uses(readme_builder, kb_service).
uses(api_check, web_server).
uses(mcp_check, mcp_server).

% --- npm scripts that need more than the component they start ---
purpose(dev, 'to run the web server and restart it whenever a source file changes').
purpose(typecheck, 'to type-check the servers, the explorer and the scripts').
purpose('readme:check', 'to fail when README.md differs from what the knowledge base would generate, for use in CI').

% --- Identity: who is asking ---
identity_setting(dev_identity, 'KB_AUTH=dev').
identity_setting(proxy_identity, 'KB_AUTH=proxy').
purpose(dev_identity, 'to let the explorer''s user picker choose who is asking; for local use only, since anyone can pick anyone').
purpose(proxy_identity, 'to trust an email header set by an auth proxy (X-Forwarded-Email, or KB_EMAIL_HEADER) and match it to a person through email_address/2; the proxy must strip that header from client requests').

% --- REST endpoints: the feature each needs, and the knowledge request behind it ---
% Every role has public and signed_in (schema.pl); the rest are role features.
access('GET /api/health', public).
access('GET /api/session', signed_in).
access('GET /api/graph', signed_in).
access('GET /api/explain/:entity', signed_in).
access('GET /api/overview', signed_in).
access('GET /api/context/:entity', signed_in).
access('GET /api/verify/:service', signed_in).
access('GET /api/explain-goal', signed_in).
access('POST /api/query', console).
access('GET /api/kb', technical).
access('GET /api/kb.pl', technical).
access('GET /api/audit', technical).
access('POST /api/plan', technical).

answers_with('GET /api/session', session).
answers_with('GET /api/graph', graph).
answers_with('GET /api/explain/:entity', explain).
answers_with('GET /api/overview', overview).
answers_with('GET /api/context/:entity', context).
answers_with('GET /api/verify/:service', verify).
answers_with('GET /api/explain-goal', explain_goal).
answers_with('GET /api/audit', audit).

% --- MCP tools and the knowledge request each answers with ---
mcp_tool(get_knowledge_overview, overview).
mcp_tool(query_entity_context, context).
mcp_tool(verify_task_onboarding, verify).
mcp_tool(explain_rule_or_decision, explain_goal).

registered_in(mcp_server, '.mcp.json').

purpose(get_knowledge_overview, 'to start here: list the domains a role can see, their relations, their entities by type, the services, and every rule in plain English').
purpose(query_entity_context, 'to return the facts and derived conclusions within a few hops of one entity as triples, nearest first, with the type of every entity mentioned').
purpose(verify_task_onboarding, 'to infer everything needed to work on a service and report, for each item, what to do, its link, who can invite you, why it is needed, and whether it is done').
purpose(explain_rule_or_decision, 'to prove a goal such as soft_credit_limit(dope, Limit) and return its bindings with an English trace of the facts, rules and calculations used, or describe a rule by name').

% --- What the explorer offers ---
offers(explorer_ui, stated_and_derived).
offers(explorer_ui, views).
offers(explorer_ui, focus).
offers(explorer_ui, scope).
offers(explorer_ui, entity_types).
offers(explorer_ui, per_user_settings).
offers(explorer_ui, shareable_state).
offers(explorer_ui, knowledge_audit).

purpose(stated_and_derived, 'to mark every connection as stated (solid line) or derived by a rule (dashed): hover a connection for how it is inferred, click it for why it holds').
purpose(views, 'to switch between the mind map, the hierarchy in four directions, the triple table and the query console').
purpose(focus, 'to re-centre on an entity by clicking or searching, go back through history, and set the depth from one to five hops').
purpose(scope, 'to toggle domains, single relations, derived facts, and value, link and description leaves').
purpose(entity_types, 'to show or hide each type of entity and change its colour and shape').
purpose(per_user_settings, 'to remember settings for each user and start newly visible domains ticked').
purpose(knowledge_audit, 'to count what is stated, generated and derived in symbols, list compression candidates by the symbols they would save, and let an optimiser choose the best set under constraints').
purpose(shareable_state, 'to keep the user, view, focus and depth in the URL, so a view can be shared').

% --- How we work on the knowledge base ---
practice(write_once).
practice(generate_recorded).
practice(compose_explanations).
practice(add_relation).
practice(describe_in_headers).
practice(fresh_format).
practice(dynamic_rules).
practice(isolate_reflection).
practice(regenerate_readme).
practice(check_audit).

purpose(write_once, 'to state a fact only when nothing else records it, and add a rule for anything that follows from other facts').
purpose(generate_recorded, 'to generate what the repository already records (KB files, packages, npm scripts, file descriptions) instead of restating it').
purpose(compose_explanations, 'to compose every sentence, rule description and calculation from lexicon primitives, never from sentence templates').
purpose(add_relation, 'to add a relation with its facts, one kb_predicate/3 line in schema.pl, and a noun/2 or verb/2 only when the humanised name reads badly').
purpose(describe_in_headers, 'to describe each file in the first sentence of its header comment, of medium length; components, the README and the explorer read it from there').
purpose(fresh_format, 'to format text into a fresh variable and then unify (Url = Url0), because in Trealla format(atom(Bound), …) inside a clause succeeds without checking').
purpose(dynamic_rules, 'to declare rules the explorer explains as dynamic, because clause/2 cannot read static predicates in Trealla').
purpose(isolate_reflection, 'to ask predicate_property/2 only under negation (\\+ \\+ to keep the answer), never catch errors from clause/2, and walk terms with separate clauses and functor/3 and arg/3 rather than if-then-else or =.., because in Trealla these leave or lose bindings when backtracking').
purpose(check_audit, 'to look at the audit before adding facts: a candidate that saves symbols means knowledge is repeated, and a rule that saves none is kept for what it explains').
purpose(regenerate_readme, 'to change the knowledge (kb/*.pl, file headers, package.json) and run npm run readme, rather than editing README.md').

% --- Inferred knowledge ---
:- dynamic(runs_on/2).
:- dynamic(relies_on/2).
:- dynamic(can_call/2).
:- dynamic(served_by/2).
:- dynamic(same_answer/2).
:- dynamic(runs_component/2).
:- dynamic(described_as/2).

% A component runs where its kind of component executes.
runs_on(Component, Runtime) :-
    component(Component, Kind),
    executes_in(Kind, Runtime).

% Reliance follows use, all the way down.
relies_on(Component, Dependency) :-
    uses(Component, Dependency).
relies_on(Component, Dependency) :-
    uses(Component, Part),
    relies_on(Part, Dependency).

% A role can call an endpoint when it has the feature the endpoint requires.
can_call(Role, Endpoint) :-
    access(Endpoint, Feature),
    role_feature(Role, Feature).

served_by(Endpoint, web_server) :-
    access(Endpoint, _).
served_by(Tool, mcp_server) :-
    mcp_tool(Tool, _).

% REST and MCP give the same answer when they share a knowledge request.
same_answer(Endpoint, Tool) :-
    answers_with(Endpoint, Request),
    mcp_tool(Tool, Request).

% An npm script starts the component whose source file it runs.
runs_component(Script, Component) :-
    npm_script_file(Script, File),
    source_file(Component, File).

% A component is described by its source files' header comments.
described_as(Component, Summary) :-
    source_file(Component, File),
    file_summary(File, Summary).
