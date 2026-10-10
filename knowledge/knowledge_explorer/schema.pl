% schema.pl — the explorer pack's domain, relations and entity types: the knowledge explorer itself.

domain(knowledge_explorer).

% --- Relations shown in the graph: kb_predicate(Name, Arity, Domain) ---
kb_predicate(planned_host, 2, knowledge_explorer).
kb_predicate(tool_access, 2, knowledge_explorer).
kb_predicate(executes_in, 2, knowledge_explorer).
kb_predicate(source_file, 2, knowledge_explorer).
kb_predicate(kb_file, 2, knowledge_explorer).
kb_predicate(knowledge_pack, 2, knowledge_explorer).
kb_predicate(needs_pack, 2, knowledge_explorer).
kb_predicate(imports, 2, knowledge_explorer).
kb_predicate(reaches, 2, knowledge_explorer).
kb_predicate(implemented_in, 2, knowledge_explorer).
kb_predicate(fetches, 2, knowledge_explorer).
kb_predicate(access, 2, knowledge_explorer).
kb_predicate(answers_with, 2, knowledge_explorer).
kb_predicate(mcp_tool, 2, knowledge_explorer).
kb_predicate(purpose, 2, knowledge_explorer).
kb_predicate(package_version, 2, knowledge_explorer).
kb_predicate(file_summary, 2, knowledge_explorer).
kb_predicate(engine_requirement, 2, knowledge_explorer).
kb_predicate(npm_script, 2, knowledge_explorer).
kb_predicate(registered_in, 2, knowledge_explorer).
kb_predicate(mcp_transport, 2, knowledge_explorer).
kb_predicate(identity_setting, 2, knowledge_explorer).
kb_predicate(offers, 2, knowledge_explorer).
kb_predicate(keeps_state_in, 2, knowledge_explorer).

% Rules whose conclusions appear as dashed edges and can be explained.
derived_predicate(uses, 2, knowledge_explorer).
derived_predicate(runs_on, 2, knowledge_explorer).
derived_predicate(relies_on, 2, knowledge_explorer).
derived_predicate(can_call, 2, knowledge_explorer).
derived_predicate(can_use, 2, knowledge_explorer).
derived_predicate(served_by, 2, knowledge_explorer).
derived_predicate(same_answer, 2, knowledge_explorer).
derived_predicate(runs_component, 2, knowledge_explorer).
derived_predicate(described_as, 2, knowledge_explorer).

% --- Entity types (first matching rule wins) ---
type_rule(E, text) :- catch((purpose(_, E) ; file_summary(_, E)), _, fail), !.
type_rule(E, pack) :- catch(knowledge_pack(_, E), _, fail), !.
type_rule(E, file) :- catch((source_file(_, E) ; kb_file(_, E) ; implemented_in(_, E) ; keeps_state_in(_, E) ; imports(E, _) ; fetches(E, _)), _, fail), !.
type_rule(E, Kind) :- catch(component(E, Kind), _, fail), !.
type_rule(E, library) :- catch(package_version(E, _), _, fail), !.
type_rule(E, endpoint) :- catch(access(E, _), _, fail), !.
type_rule(E, tool) :- catch(mcp_tool(E, _), _, fail), !.
type_rule(E, transport) :- catch(mcp_transport(_, E), _, fail), !.
type_rule(E, request) :- catch((answers_with(_, E) ; mcp_tool(_, E)), _, fail), !.
type_rule(E, feature) :- catch((access(_, E) ; role_feature(_, E)), _, fail), !.
type_rule(E, kind) :- catch(executes_in(E, _), _, fail), !.
type_rule(E, runtime) :- catch(executes_in(_, E), _, fail), !.
type_rule(E, npm_script) :- catch(npm_script(E, _), _, fail), !.
type_rule(E, identity_mode) :- catch(identity_setting(E, _), _, fail), !.
type_rule(E, capability) :- catch(offers(_, E), _, fail), !.
type_rule(E, practice) :- catch(practice(E), _, fail), !.
type_rule(E, role) :- catch(role(E), _, fail), !.

% type_style(Type, DefaultColour, Shape) — shapes are vis-network shapes.
type_style(role, '#f06595', star).
type_style(ui, '#ff922b', box).
type_style(server, '#e8590c', box).
type_style(module, '#748ffc', box).
type_style(script, '#a9e34b', box).
type_style(knowledge, '#be4bdb', database).
type_style(pack, '#da77f2', database).
type_style(library, '#adb5bd', diamond).
type_style(file, '#868e96', text).
type_style(endpoint, '#0ca678', ellipse).
type_style(tool, '#12b886', ellipse).
type_style(transport, '#91a7ff', box).
type_style(request, '#3bc9db', dot).
type_style(feature, '#fab005', triangle).
type_style(kind, '#ced4da', dot).
type_style(runtime, '#495057', square).
type_style(npm_script, '#c0eb75', box).
type_style(identity_mode, '#f783ac', diamond).
type_style(capability, '#ffa8a8', ellipse).
type_style(practice, '#ced4da', ellipse).

% --- The explorer's own roles; packs add theirs, with the domains each role sees ---
% Features: table (triple table), console (free-form queries through the MCP tool), technical
% (raw proofs, predicate names, KB files, load errors and local changes to facts — hidden
% from non-technical users).
role(developer).
role(admin).

role_domain(developer, knowledge_explorer).
role_domain(admin, D) :- domain(D).

role_feature(developer, table).
role_feature(developer, console).
role_feature(developer, technical).
role_feature(admin, table).
role_feature(admin, console).
role_feature(admin, technical).

% The built-in administrator, so the explorer can be used with no other pack.
user_account(admin, admin).
