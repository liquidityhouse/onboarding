% readme.pl — how README.md is composed from the knowledge base.
%
% npm run readme asks api(readme) and renders these sections as Markdown. Every
% heading, sentence and table cell comes from facts, rules and the lexicon, so the
% README follows the explorer's description and is never edited by hand.
%
% Blocks: para(Text) | bullets(Items) | table(Columns, Rows) | code(Lang, Text)
%         | graph(Nodes, Edges) with Nodes = [Id-Label] and Edges = [From-To]

:- discontiguous(readme_blocks/2).

readme_section(readme_overview).
readme_section(readme_components).
readme_section(readme_running).
readme_section(readme_access).
readme_section(readme_knowledge).
readme_section(readme_rest).
readme_section(readme_mcp).
readme_section(readme_explorer).
readme_section(readme_practices).

% --- Wording helpers ---
% A thing's description: its stated purpose, else its source files' header comments.
described(X, D) :- purpose(X, P), !, plain(P, D).
described(X, D) :- findall(S, described_as(X, S), [S|_]), !, capitalise(S, D).
described(_, N) :- connective(none, N).

% "The <noun> exists to <purpose>."
exists_to(X, Noun, T) :-
    purpose(X, P), connective(definite, The), connective(exists, Exists),
    format(atom(T0), "~w ~w ~w ~w", [The, Noun, Exists, P]), as_sentence(T0, T).

code_cell(X, C) :- format(atom(C), "`~w`", [X]).
codes_cell(Xs, C) :- findall(X1, ( member(X, Xs), code_cell(X, X1) ), Cs), join_or_none(Cs, C).
labels_cell(Xs, C) :- findall(L, ( member(X, Xs), label_of(X, L) ), Ls), join_or_none(Ls, C).
join_or_none([], N) :- !, connective(none, N).
join_or_none(Xs, T) :- join_and(Xs, T).
headings(Concepts, Hs) :- findall(H, ( member(C, Concepts), label_of(C, H) ), Hs).

% --- Sections ---
readme_blocks(readme_overview, [para(Intro), para(Domains), graph(Nodes, Edges)]) :-
    noun_of(knowledge_explorer, Name),
    exists_to(knowledge_explorer, Name, Intro),
    findall(L, ( domain(D), label_of(D, L) ), Ls), join_and(Ls, DT),
    connective(organised_in, Org),
    format(atom(D0), "~w ~w", [Org, DT]), as_sentence(D0, Domains),
    findall(A-B, uses(A, B), Edges0), sort(Edges0, Edges),
    findall(X, ( member(A-B, Edges), ( X = A ; X = B ) ), Xs0), sort(Xs0, Xs),
    findall(X-NL, ( member(X, Xs), entity_type(X, T), noun_of(T, TN),
                    format(atom(NL), "~w (~w)", [X, TN]) ), Nodes).

readme_blocks(readme_components, [table(Cols, Rows)]) :-
    headings([component, kind, runs_on, source_file, described_as], Cols),
    findall(arr([CC, KN, RN, FC, D]),
            ( component(X, K), code_cell(X, CC), noun_of(K, KN),
              ( runs_on(X, R) -> noun_of(R, RN) ; connective(none, RN) ),
              findall(F, source_file(X, F), Fs), codes_cell(Fs, FC),
              described(X, D) ),
            Rows).

readme_blocks(readme_running, [para(Req), code(bash, Cmds), table(Cols, Rows)]) :-
    engine_requirement(node, V), sentence(engine_requirement(node, V), Req),
    format(atom(Cmds), "npm install~nnpm start", []),
    headings([npm_script, command, described_as], Cols),
    findall(arr([SC, CC, D]),
            ( npm_script(S, Cmd), format(atom(SC), "`npm run ~w`", [S]), code_cell(Cmd, CC),
              script_described(S, D) ),
            Rows).

script_described(S, D) :- purpose(S, _), !, described(S, D).
script_described(S, D) :- runs_component(S, C), !, described(C, D).
script_described(_, N) :- connective(none, N).

readme_blocks(readme_access, [table(ICols, IRows), para(Rule), table(RCols, RRows)]) :-
    headings([identity_mode, identity_setting, described_as], ICols),
    findall(arr([ML, SC, D]),
            ( identity_setting(M, S), label_of(M, ML), code_cell(S, SC), described(M, D) ),
            IRows),
    connective(access_rule, AR), rule_description(can_call, RT),
    format(atom(Rule0), "~w ~w", [AR, RT]), capitalise(Rule0, Rule),
    headings([role, domain, feature], RCols),
    findall(arr([RL, DC, FC]),
            ( role(R), label_of(R, RL),
              findall(D, role_domain(R, D), Ds), labels_cell(Ds, DC),
              findall(F, role_feature(R, F), Fs), codes_cell(Fs, FC) ),
            RRows).

readme_blocks(readme_knowledge, [para(Intro), table(Cols, Rows)]) :-
    noun_of(knowledge_base, Name),
    exists_to(knowledge_base, Name, Intro),
    headings([file, file_summary], Cols),
    % The engine's files, then each pack followed by its files.
    findall(F, ( kb_file(knowledge_base, F)
               ; knowledge_pack(knowledge_base, P), ( F = P ; kb_file(P, F) ) ), Fs),
    findall(arr([FC, S]),
            ( member(F, Fs), code_cell(F, FC),
              ( file_summary(F, S0) -> capitalise(S0, S) ; connective(none, S) ) ),
            Rows).

readme_blocks(readme_rest, [table(Cols, Rows)]) :-
    headings([endpoint, access, request, same_answer], Cols),
    findall(arr([EC, FC, RC, TC]),
            ( access(E, F), code_cell(E, EC), code_cell(F, FC),
              ( answers_with(E, R) -> code_cell(R, RC) ; connective(none, RC) ),
              ( same_answer(E, T) -> code_cell(T, TC) ; connective(none, TC) ) ),
            Rows).

readme_blocks(readme_mcp, [para(Intro), table(Cols, Rows)]) :-
    findall(S, ( ( mcp_transport(Sv, T), G = mcp_transport(Sv, T)
                 ; registered_in(Sv, W), G = registered_in(Sv, W) ),
                 sentence(G, S) ), Ss),
    atomic_list_concat(Ss, ' ', Intro),
    headings([tool, request, endpoint, described_as], Cols),
    findall(arr([TC, RC, EC, D]),
            ( mcp_tool(T, R), code_cell(T, TC), code_cell(R, RC),
              ( same_answer(E, T) -> code_cell(E, EC) ; connective(none, EC) ),
              described(T, D) ),
            Rows).

readme_blocks(readme_explorer, [bullets(Items)]) :-
    findall(I, ( offers(explorer_ui, C), label_of(C, L), described(C, D),
                 format(atom(I), "**~w**: ~w.", [L, D]) ), Items).

readme_blocks(readme_practices, [bullets(Items)]) :-
    findall(I, ( practice(P), described(P, D), atom_concat(D, '.', I) ), Is0),
    findall(X, sample_data(X), Xs), codes_cell(Xs, XC),
    connective(sample_data, SD), format(atom(S0), "~w ~w", [SD, XC]), as_sentence(S0, Sample),
    append(Is0, [Sample], Items).

% --- As JSON for api(readme) ---
api_term(readme, obj([title-Title, sections-arr(Ss)])) :-
    label_of(knowledge_explorer, Title),
    findall(obj([id-S, heading-H, ok-bool(Ok), blocks-arr(Bs)]),
            ( readme_section(S), label_of(S, H),
              (   catch(readme_blocks(S, B), _, fail)
              ->  Ok = true, findall(J, ( member(X, B), block_json(X, J) ), Bs)
              ;   Ok = false, Bs = [] ) ),
            Ss).

block_json(para(T), obj([kind-para, text-T])).
block_json(bullets(Is), obj([kind-bullets, items-arr(Is)])).
block_json(table(Cs, Rs), obj([kind-table, columns-arr(Cs), rows-arr(Rs)])).
block_json(code(L, T), obj([kind-code, lang-L, text-T])).
block_json(graph(Ns, Es), obj([kind-graph, nodes-arr(NJ), edges-arr(EJ)])) :-
    findall(obj([id-I, label-L]), member(I-L, Ns), NJ),
    findall(obj([from-A, to-B]), member(A-B, Es), EJ).
