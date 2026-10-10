% explorer.pl — the knowledge explorer and its server, described as knowledge.
%
% Only what nothing else records is stated here. The rest is inferred
% (runs_on, relies_on, can_call, served_by, same_answer, runs_component,
% described_as) or generated from the repository by lib/kb-source.ts: kb_file
% and knowledge_pack from kb/manifest.json and pack.json; package_version, engine_requirement, npm_script and
% npm_script_file from package.json; file_summary from each file's header
% comment; clause_source from the explained rules as written. The knowledge is executable: the web server authorises endpoints with
% can_call/2, the MCP tools are described by purpose/2, and README.md is
% composed from all of it (readme.pl).

purpose(knowledge_explorer, 'to explore and explain how knowledge connects, for people in the explorer and for AI agents over MCP').

% --- Components and where they run ---
% A component's description is its source file's header comment (described_as/2).
component(explorer_ui, ui).
component(web_server, server).
component(mcp_tools, module).
component(overrides, module).
component(override_store, module).
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
component(github_commits, script).

executes_in(ui, browser).
executes_in(server, node).
executes_in(module, node).
executes_in(script, node).

source_file(explorer_ui, 'public/app.ts').
source_file(web_server, 'server.ts').
source_file(mcp_tools, 'lib/mcp-tools.ts').
source_file(overrides, 'lib/overrides.ts').
source_file(override_store, 'lib/override-store.ts').
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
source_file(github_commits, 'scripts/github-commits.ts').

purpose(knowledge_base, 'to hold the engine that reasons and explains (kb/) and the knowledge packs it loads (knowledge/): every fact and rule, the vocabulary explanations are built from, and the requests it answers').

% --- What uses what (direct use only; relies_on/2 follows the chain) ---
% Imports are read from the code (imports/2, generated), so uses/2 below follows them.
% reaches/2 states only what no import shows: a page calling the server over HTTP, scripts
% starting it, and the source module reading the knowledge files.
reaches(explorer_ui, web_server).
reaches(kb_source, knowledge_base).
reaches(api_check, web_server).
reaches(mcp_check, web_server).

% Where the explorer is going: into AdminX (GOAT-22), so new UI work follows AdminX's
% stack (React with shadcn components) rather than adding another framework.
planned_host(explorer_ui, adminx).

% --- npm scripts that need more than the component they start ---
purpose(dev, 'to run the web server and restart it whenever a source file changes').
purpose(typecheck, 'to type-check the server, the explorer and the scripts').
purpose('readme:check', 'to fail when README.md differs from what the knowledge base would generate, for use in CI').

% --- Identity: who is asking ---
identity_setting(dev_identity, 'KB_AUTH=dev').
identity_setting(proxy_identity, 'KB_AUTH=proxy').
purpose(dev_identity, 'to let the explorer''s user picker choose who is asking, and MCP calls name their role in scope; for local use only, since anyone can pick anyone, so POST /mcp then answers local clients only').
purpose(proxy_identity, 'to trust an email header set by an auth proxy (X-Forwarded-Email, or KB_EMAIL_HEADER) and match it to a person through email_address/2, whose role the MCP tools then answer in; the proxy must strip that header from client requests').

% --- REST endpoints: the feature each needs, and the knowledge request behind it ---
% Every role has public and signed_in (kb/core.pl); the rest are role features.
access('GET /api/health', public).
access('GET /api/session', signed_in).
access('GET /api/graph', signed_in).
access('GET /api/explain/:entity', signed_in).
access('GET /api/overview', signed_in).
access('GET /api/context/:entity', signed_in).
access('GET /api/verify/:service', signed_in).
access('GET /api/explain-goal', signed_in).
access('GET /api/kb', technical).
access('GET /api/kb.pl', technical).
access('GET /api/audit', technical).
access('POST /api/plan', technical).
access('GET /api/overrides', technical).
access('POST /api/overrides', technical).
access('POST /api/progress', signed_in).
access('GET /api/agent-instructions/:task', technical).
access('POST /mcp', signed_in).

answers_with('GET /api/session', session).
answers_with('GET /api/graph', graph).
answers_with('GET /api/explain/:entity', explain).
answers_with('GET /api/overview', overview).
answers_with('GET /api/context/:entity', context).
answers_with('GET /api/verify/:service', verify).
answers_with('GET /api/explain-goal', explain_goal).
answers_with('GET /api/audit', audit).
answers_with('GET /api/overrides', overrides).
answers_with('POST /api/overrides', fact_check).
answers_with('POST /api/progress', progress_plan).
answers_with('GET /api/agent-instructions/:task', agent_instructions).

% --- MCP tools and the knowledge request each answers with ---
mcp_tool(get_knowledge_overview, overview).
mcp_tool(query_entity_context, context).
mcp_tool(verify_task_onboarding, verify).
mcp_tool(explain_rule_or_decision, explain_goal).
mcp_tool(query_knowledge_base, query).
mcp_tool(record_progress, progress_plan).
mcp_tool(change_facts, fact_check).
mcp_tool(agent_instructions, agent_instructions).

% What each tool requires; can_use/2 decides who may call it, as can_call/2 does for
% endpoints. Free-form queries see the whole knowledge base, past role scoping.
tool_access(get_knowledge_overview, signed_in).
tool_access(query_entity_context, signed_in).
tool_access(verify_task_onboarding, signed_in).
tool_access(explain_rule_or_decision, signed_in).
tool_access(query_knowledge_base, console).
tool_access(record_progress, signed_in).
tool_access(change_facts, technical).
tool_access(agent_instructions, technical).

% One transport, so there is one way in: Streamable HTTP on the web server, which is how
% Claude Code reaches the tools (.mcp.json) and how a hosted explorer (AdminX) would offer them.
mcp_transport(web_server, streamable_http).
registered_in(web_server, '.mcp.json').

purpose(get_knowledge_overview, 'to start here: list the domains a role can see, their relations, their entities by type, the services, and every rule in plain English').
purpose(query_entity_context, 'to return the facts and derived conclusions within a few hops of one entity as triples, nearest first, with the type of every entity mentioned').
purpose(verify_task_onboarding, 'to infer everything needed to work on a service and report, for each item, what to do, its link, who can invite you, why it is needed, and whether it is done').
purpose(query_knowledge_base, 'to run any Prolog goal against the whole knowledge base, in a throwaway sandbox with a time limit, and list every answer; for direct exploration by developers, past the role scoping the other tools apply').
purpose(record_progress, 'to mark the steps of setting up a service done or not done for a person, as local completed/2 facts, so their progress shows at once in the explorer and in verify_task_onboarding; marking every step not done resets the service for a run from scratch').
purpose(change_facts, 'to add, edit or remove facts on this machine only, from Prolog text or a URL, or undo such changes; they show in the explorer as local overrides, marked with who made them, until someone writes them into a pack').
purpose(agent_instructions, 'to hand an agent the steps a knowledge pack gives for a task, such as refreshing a data file in a signed-in browser when its script cannot run, with the repositories, people and file filled in from the facts').
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
offers(explorer_ui, local_overrides).
offers(explorer_ui, setup_checklist).
offers(explorer_ui, data_provenance).

purpose(stated_and_derived, 'to mark every connection as stated (solid line) or derived by a rule (dashed): hover a connection for how it is inferred, click it for why it holds').
purpose(views, 'to switch between the mind map, the hierarchy in four directions, the triple table and the audit').
purpose(focus, 'to re-centre on an entity by clicking or searching, go back through history, and set the depth from one to five hops').
purpose(scope, 'to toggle domains, single relations, derived facts, and value, link and description leaves').
purpose(entity_types, 'to show or hide each type of entity and change its colour and shape').
purpose(per_user_settings, 'to remember settings for each user and start newly visible domains ticked').
purpose(knowledge_audit, 'to count what is stated, generated and derived in symbols, open any relation beside it (its rule, what it reads and is read by, its facts), list compression candidates by the symbols they would save, and let an optimiser choose the best set under constraints, and count the code behind generated facts and capabilities in the description length, ranked by size and coloured red, yellow or green as candidates for streamlining: code that produces facts against the size of those facts (minimum description length, generator_band/2), hand-written code against this code base''s own quantiles (size_band/2), each tile explaining its measure and the rules behind it').
purpose(local_overrides, 'to change facts here without editing the packs: paste facts or load them from a URL, edit or remove a fact from its card, and undo any change; changed facts are outlined in gold with an i saying who changed them, when and how, and the kinds filter can hide them').
purpose(data_provenance, 'to show, for a fact read from outside the repository and for every conclusion resting on one, where it was read from, how and when its file was made, the script that makes it again, and the agent steps to copy to the clipboard for an agent when the script cannot run; over MCP, such explanations name the agent task to ask agent_instructions for').
purpose(setup_checklist, 'to tick off the steps of setting up a service, as the person picked at the top and in their role; ticks are local overrides shared with agents over MCP').
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
practice(try_locally).
practice(record_outside_data).
practice(one_definition).
practice(tag_implementations).

purpose(write_once, 'to state a fact only when nothing else records it, and add a rule for anything that follows from other facts').
purpose(generate_recorded, 'to generate what the repository already records (knowledge files and packs, packages, npm scripts, file descriptions, imports, and the code that implements each endpoint and tool) instead of restating it, each generated fact pointing to the line it was read from').
purpose(compose_explanations, 'to compose every sentence, rule description and calculation from lexicon primitives, never from sentence templates').
purpose(add_relation, 'to add a relation with its facts, one kb_predicate/3 line in its pack''s schema.pl, and a noun/2 or verb/2 in the pack''s vocabulary.pl only when the humanised name reads badly').
purpose(describe_in_headers, 'to describe each file in the first sentence of its header comment, of medium length; components, the README and the explorer read it from there').
purpose(fresh_format, 'to format text into a fresh variable and then unify (Url = Url0), because in Trealla format(atom(Bound), …) inside a clause succeeds without checking').
purpose(dynamic_rules, 'to declare rules the explorer explains as dynamic, because clause/2 cannot read static predicates in Trealla').
purpose(isolate_reflection, 'to ask predicate_property/2 only under negation (\\+ \\+ to keep the answer), never catch errors from clause/2, and walk terms with separate clauses and functor/3 and arg/3 rather than if-then-else or =.., because in Trealla these leave or lose bindings when backtracking').
purpose(check_audit, 'to look at the audit before adding facts: a candidate that saves symbols means knowledge is repeated, and a rule that saves none is kept for what it explains').
purpose(tag_implementations, 'to tag each function that implements a capability with @implements <capability> in its doc comment, so implemented_in/2 is generated pointing at it (as fetches/2 is from the endpoints a page calls) and the audit can rank the code by cost').
purpose(one_definition, 'to define each predicate in one file, and spread one across files only on purpose, declared discontiguous like api_term/2; the loader warns otherwise, because two definitions add up and every call answers once per definition').
purpose(record_outside_data, 'to keep facts read from another system (GitHub, Slack, an API) in a pack data file that says where each was read from, when, and by which agent or npm script; they are the imported kind of knowledge, so every such fact and every conclusion resting on it can show where it came from').
purpose(try_locally, 'to try a change as a local override first (in the explorer or with change_facts), and write it into its pack once it holds up; state/ is never committed').
purpose(regenerate_readme, 'to change the knowledge (knowledge packs, file headers, package.json) and run npm run readme, rather than editing README.md').

% --- Inferred knowledge ---
:- dynamic(uses/2).
:- dynamic(runs_on/2).
:- dynamic(relies_on/2).
:- dynamic(can_call/2).
:- dynamic(can_use/2).
:- dynamic(served_by/2).
:- dynamic(same_answer/2).
:- dynamic(runs_component/2).
:- dynamic(described_as/2).

% A component runs where its kind of component executes.
runs_on(Component, Runtime) :-
    component(Component, Kind),
    executes_in(Kind, Runtime).

% A component uses the components and packages its source files import, and what it reaches.
uses(Component, Part) :-
    source_file(Component, File),
    imports(File, Target),
    source_file(Part, Target),
    Component \== Part.
uses(Component, Package) :-
    source_file(Component, File),
    imports(File, Package),
    package_version(Package, _).
uses(Component, Part) :-
    reaches(Component, Part).

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

% A role can use an MCP tool when it has the feature the tool requires.
can_use(Role, Tool) :-
    tool_access(Tool, Feature),
    role_feature(Role, Feature).

served_by(Endpoint, web_server) :-
    access(Endpoint, _).
served_by(Tool, Server) :-
    mcp_tool(Tool, _),
    mcp_transport(Server, _).

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
