% system.pl — the explorer and its servers, described as knowledge.
%
% Only what nothing else records is stated here. The rest is inferred
% (runs_on, relies_on, can_call, served_by, same_answer) or generated from the
% repository by lib/kb-source.ts (kb_file from kb/manifest.json, package_version
% from package.json). The knowledge is also executable: the web server authorises
% every endpoint with can_call/2, and the MCP server describes its tools with purpose/2.

% --- Components and where they run ---
component(explorer_ui, ui).
component(web_server, server).
component(mcp_server, server).
component(kb_service, module).
component(kb_source, module).
component(prolog_engine, module).
component(query_sandbox, module).
component(kb_types, module).
component(knowledge_base, knowledge).
component(api_check, script).
component(mcp_check, script).
component(code_export, script).

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
source_file(api_check, 'scripts/api-check.ts').
source_file(mcp_check, 'scripts/mcp-check.ts').
source_file(code_export, 'scripts/export-code.ts').

% --- What uses what (direct use only; relies_on/2 follows the chain) ---
uses(explorer_ui, web_server).
uses(explorer_ui, 'vis-network').
uses(web_server, kb_service).
uses(web_server, query_sandbox).
uses(mcp_server, kb_service).
uses(mcp_server, '@modelcontextprotocol/sdk').
uses(kb_service, kb_source).
uses(kb_service, prolog_engine).
uses(kb_source, knowledge_base).
uses(prolog_engine, trealla).
uses(query_sandbox, trealla).
uses(api_check, web_server).
uses(mcp_check, mcp_server).

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

answers_with('GET /api/session', session).
answers_with('GET /api/graph', graph).
answers_with('GET /api/explain/:entity', explain).
answers_with('GET /api/overview', overview).
answers_with('GET /api/context/:entity', context).
answers_with('GET /api/verify/:service', verify).
answers_with('GET /api/explain-goal', explain_goal).

% --- MCP tools and the knowledge request each answers with ---
mcp_tool(get_knowledge_overview, overview).
mcp_tool(query_entity_context, context).
mcp_tool(verify_task_onboarding, verify).
mcp_tool(explain_rule_or_decision, explain_goal).

% --- Purposes (medium length, read as "the purpose of X is to …") ---
purpose(explorer_ui, 'to draw the role-scoped graph, table and query views and show how every derived fact was reached, while holding no knowledge itself').
purpose(web_server, 'to serve the explorer and the REST API, work out who is asking, and answer only within their role').
purpose(mcp_server, 'to give AI agents the same knowledge as the explorer through four small, read-only MCP tools').
purpose(kb_service, 'to keep one Prolog engine per knowledge-base version, rebuild it when files change, and cache answers per role').
purpose(kb_source, 'to join the files in kb/manifest.json into one program, add generated facts, and version it by content hash').
purpose(prolog_engine, 'to run Trealla Prolog in WebAssembly and turn api/1 requests into JSON, one query at a time').
purpose(query_sandbox, 'to run free-form goals in a throwaway worker with a time limit, so they cannot block or stop the shared engine').
purpose(kb_types, 'to describe the JSON shapes the knowledge base answers with, for the servers and the explorer').
purpose(knowledge_base, 'to hold every fact and rule, the vocabulary explanations are built from, and the requests the servers ask').
purpose(api_check, 'to start the web server in both identity modes and check what each role can and cannot see').
purpose(mcp_check, 'to call every MCP tool over real stdio the way an agent would, including the refusals').
purpose(code_export, 'to bundle all application code into export/_code.txt as one file for sharing').

purpose(get_knowledge_overview, 'to start here: list the domains a role can see, their relations, their entities by type, the services, and every rule in plain English').
purpose(query_entity_context, 'to return the facts and derived conclusions within a few hops of one entity as triples, nearest first, with the type of every entity mentioned').
purpose(verify_task_onboarding, 'to infer everything needed to work on a service and report, for each item, what to do, its link, who can invite you, why it is needed, and whether it is done').
purpose(explain_rule_or_decision, 'to prove a goal such as soft_credit_limit(dope, Limit) and return its bindings with an English trace of the facts, rules and calculations used, or describe a rule by name').

% --- Inferred knowledge ---
:- dynamic(runs_on/2).
:- dynamic(relies_on/2).
:- dynamic(can_call/2).
:- dynamic(served_by/2).
:- dynamic(same_answer/2).

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
