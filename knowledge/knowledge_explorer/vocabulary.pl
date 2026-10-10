% vocabulary.pl — the explorer pack's words: what the explorer's parts, relations and README sections are called.
%
% The primitives are described in kb/lexicon.pl.

% What concepts, types and README sections are called.
noun(knowledge_explorer, 'Knowledge Explorer').
noun(readme_overview, 'Overview').
noun(readme_components, 'Components').
noun(readme_running, 'Running it').
noun(readme_access, 'Who sees what').
noun(readme_knowledge, 'Knowledge files').
noun(readme_rest, 'REST API').
noun(readme_mcp, 'MCP tools for AI agents').
noun(readme_explorer, 'Using the explorer').
noun(readme_practices, 'Working on the knowledge base').
noun(npm_script, 'package script').
noun(npm_script_file, file).
noun(runs_component, component).
noun(described_as, description).
noun(file_summary, summary).
noun(engine_requirement, 'required version').
noun(identity_setting, setting).
noun(streamable_http, 'Streamable HTTP (POST /mcp)').
noun(per_user_settings, 'per-user settings').
noun(ui, 'user interface').
noun(knowledge, 'knowledge base').
noun(tool, 'MCP tool').
noun(request, 'knowledge request').
noun(node, 'Node.js').
noun(browser, 'the browser').
noun(uses, part).
noun(relies_on, dependency).
noun(access, feature).
noun(can_call, endpoint).
noun(answers_with, request).
noun(mcp_tool, request).
noun(served_by, server).
noun(same_answer, 'MCP tool').
noun(package_version, version).
noun(runs_on, runtime).
noun(can_use, 'MCP tool').
noun(tool_access, feature).
noun(pack, 'knowledge pack').
noun(knowledge_pack, 'knowledge pack').
noun(implemented_in, 'code').

% Relations read as "Subject Verb Object".
verb(component, 'is of kind').
verb(executes_in, 'runs in').
verb(kb_file, 'is made of').
verb(uses, uses).
verb(relies_on, 'relies on').
verb(access, requires).
verb(tool_access, requires).
verb(can_use, 'can use').
verb(can_call, 'can call').
verb(answers_with, 'answers with').
verb(mcp_tool, 'answers with').
verb(served_by, 'is served by').
verb(same_answer, 'gives the same answer as').
verb(runs_on, 'runs on').
verb(npm_script, runs).
verb(npm_script_file, runs).
verb(runs_component, starts).
verb(registered_in, 'is registered for Claude Code in').
verb(mcp_transport, 'offers the MCP tools over').
verb(offers, offers).
verb(planned_host, 'is to move into').
verb(knowledge_pack, loads).
verb(imports, imports).
noun(imports, 'imported file').
verb(reaches, reaches).
noun(reaches, part).
subject(imports, file).
verb(needs_pack, 'builds on').
verb(implemented_in, 'is implemented in').
verb(fetches, fetches).
verb(keeps_state_in, 'keeps its state in').

% Rule wording, when a relation's facts mix kinds of subject or its noun names something else.
subject(component, component).
subject(uses, component).
subject(access, endpoint).
subject(answers_with, endpoint).
subject(mcp_tool, 'MCP tool').
subject(source_file, component).
subject(npm_script_file, 'package script').
object(npm_script, command).
object(component, kind).

% Entities written without "<type> '...'".
bare(kind).
bare(runtime).

% Joining words used by the README.
connective(organised_in, 'its knowledge is organised in these domains:').
connective(access_rule, 'who may call each endpoint follows one rule:').
connective(sample_data, 'illustrative sample data:').
