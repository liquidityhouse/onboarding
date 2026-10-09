% api.pl — knowledge-graph bridge and JSON API consumed by the browser.
%
% The web server and the MCP server call api(Request) and parse the JSON written
% to stdout. Every request that returns knowledge takes the asker's role and
% only answers from that role's domains.
%   api(session(user(U))) / api(session(email(E)))  — who is asking, their role and scope
%   api(users)                                       — accounts, for the dev-mode picker
%   api(graph(Role))                                 — what the explorer draws
%   api(explain(E, Role))                            — facts and explained conclusions about E
% Agent requests (overview, context, verify, explain_goal) are at the end of the file.

:- discontiguous(api_term/2).

% --- Universal meta-bridge ---
% kb_triple(Subject, EdgeLabel, Object, Predicate, Kind)   Kind = fact | derived
kb_triple(S, L, O, P, fact) :-
    kb_predicate(P, N, _),
    functor(H, P, N),
    catch(H, _, fail),
    fact_triple(H, S, L, O).
kb_triple(S, L, O, P, derived) :-
    derived_predicate(P, 2, _),
    functor(H, P, 2),
    catch(H, _, fail),
    H =.. [P, S, O],
    edge_label(P, L).

% Unary P(X): P -> X.  Binary P(S, O): S -> O.  N-ary: S -> each further arg.
fact_triple(H, P, L, X) :- H =.. [P, X], !, edge_label(P, L).
fact_triple(H, S, L, O) :- H =.. [P, S, O|_], edge_label(P, L).
fact_triple(H, S, L, O) :-
    H =.. [P, S, _|Rest],
    nth_arg(Rest, 3, I, O),
    arg_label(P, I, L).

nth_arg([X|_], I, I, X).
nth_arg([_|Xs], I0, I, X) :- I1 is I0 + 1, nth_arg(Xs, I1, I, X).

% triple/3 and mind-map focus, as in the original design.
triple(S, P, O) :- kb_triple(S, _, O, P, _).
mindmap_focus(Center, Pred, Neighbor, outbound) :- triple(Center, Pred, Neighbor).
mindmap_focus(Center, Pred, Neighbor, inbound)  :- triple(Neighbor, Pred, Center).

pred_domain(P, D) :- kb_predicate(P, _, D), !.
pred_domain(P, D) :- derived_predicate(P, _, D).

label_of(X, L) :- noun_of(X, N), capitalise(N, L).

% --- JSON writer: obj([K-V]) | arr(L) | bool(B) | null | number | atom ---
json(obj(Ps)) :- !, write('{'), json_pairs(Ps), write('}').
json(arr(Xs)) :- !, write('['), json_items(Xs), write(']').
json(bool(B)) :- !, write(B).
json(null) :- !, write(null).
json(X) :- number(X), !, write(X).
json(X) :- json_string(X).

json_pairs([]).
json_pairs([K-V]) :- !, json_string(K), write(':'), json(V).
json_pairs([K-V|Ps]) :- json_string(K), write(':'), json(V), write(','), json_pairs(Ps).

json_items([]).
json_items([X]) :- !, json(X).
json_items([X|Xs]) :- json(X), write(','), json_items(Xs).

json_string(X) :-
    ( atom(X) -> A = X ; format(atom(A), "~w", [X]) ),
    atom_codes(A, Cs),
    put_char('"'), json_codes(Cs), put_char('"').

json_codes([]).
json_codes([C|Cs]) :- json_code(C), json_codes(Cs).
json_code(0'") :- !, write('\\"').
json_code(0'\\) :- !, write('\\\\').
json_code(0'\n) :- !, write('\\n').
json_code(0'\t) :- !, write('\\t').
json_code(C) :- C < 32, !, put_char(' ').
json_code(C) :- put_code(C).

% --- Requests ---
api(R) :- api_term(R, J), !, json(J), nl.
api(R) :- json(obj([error-R])), nl.

% --- Identity: who is asking, and what their role may see ---
api_term(session(user(U)), J) :- !,
    (   user_account(U, R) -> session_json(U, R, J)
    ;   J = obj([user-U, problem-'unknown user']) ).
api_term(session(email(E)), J) :- !,
    (   email_address(U, A), A == E, user_account(U, R) -> session_json(U, R, J)
    ;   J = obj([email-E, problem-'no account for this email']) ).

session_json(U, R, obj([user-U, name-N, role-R, role_label-RL, domains-arr(Ds), features-arr(Fs), start-St])) :-
    label_of(U, N), label_of(R, RL),
    findall(D, role_domain(R, D), Ds),
    findall(F, role_feature(R, F), Fs),
    ( role_start(R, St) -> true ; St = null ).

% allowed(Role, Endpoint): the web server's authorisation, from can_call/2 (system.pl).
api_term(allowed(Role, Endpoint), obj([allowed-bool(B)])) :-
    ( can_call(Role, Endpoint) -> B = true ; B = false ).

% tool_docs: MCP tool descriptions, from purpose/2 (system.pl).
api_term(tool_docs, obj(Docs)) :-
    findall(T-D, ( mcp_tool(T, _), purpose(T, D) ), Docs).

api_term(users, obj([users-arr(Us)])) :-
    findall(obj([id-U, name-N, role-R]), ( user_account(U, R), label_of(U, N) ), Us).

% graph(Role): everything the explorer draws, limited to the role's domains.
api_term(graph(Role), obj([problem-'unknown role'])) :- \+ role(Role), !.
api_term(graph(Role), obj([
        domains-arr(Ds), predicates-arr(Ps), types-arr(Ts),
        rules-arr(RDs), entities-arr(Es), triples-arr(Trs)])) :-
    findall(obj([id-D, label-L]), ( domain(D), role_domain(Role, D), label_of(D, L) ), Ds),
    findall(obj([id-P, arity-N, domain-D, label-L, derived-bool(false)]),
            ( kb_predicate(P, N, D), role_domain(Role, D), edge_label(P, L) ), Ps0),
    findall(obj([id-P, arity-N, domain-D, label-L, derived-bool(true)]),
            ( derived_predicate(P, N, D), role_domain(Role, D), edge_label(P, L) ), Ps1),
    append(Ps0, Ps1, Ps),
    findall(obj([id-T, label-L, color-C, shape-S]), ( type_style(T, C, S), label_of(T, L) ), Ts),
    findall(obj([predicate-P, text-T]),
            ( derived_predicate(P, _, D), role_domain(Role, D), rule_description(P, T) ), RDs),
    findall(T, scoped_triple(Role, T), Raw0),
    dedupe(Raw0, Raw),   % a conclusion reached two ways is still one edge
    findall(obj([s-S, p-L, o-O, pred-P, domain-D, derived-bool(B), severity-Sv]),
            ( member(t(S, L, O, P, K), Raw),
              pred_domain(P, D),
              G =.. [P, S, O], severity(G, Sv),
              ( K == derived -> B = true ; B = false ) ),
            Trs),
    findall(X, ( member(t(S, _, O, _, _), Raw), ( X = S ; X = O ), atom(X) ), Xs0),
    sort(Xs0, Xs),
    findall(obj([id-X, type-T, label-L]), ( member(X, Xs), entity_type(X, T), phrase_of(X, L) ), Es).

% explain(E, Role): facts and explained conclusions about E within the role's domains.
api_term(explain(E, Role), obj([id-E, problem-'not visible in this role scope'])) :-
    \+ visible(E, Role), !.
api_term(explain(E, Role), obj([id-E, type-T, phrase-Ph, facts-arr(Fs), conclusions-arr(Cs)])) :-
    entity_type(E, T),
    phrase_of(E, Ph),
    findall(Txt, ( kb_predicate(P, N, D), role_domain(Role, D), functor(H, P, N),
                   catch(H, _, fail), mentions(H, E), sentence(H, Txt) ), Fs0),
    sort(Fs0, Fs),
    findall(GA-obj([predicate-P, severity-Sv, goal-GA, text-Txt, lines-arr(Ls), proof-PA]),
            ( derived_predicate(P, 2, D), role_domain(Role, D),
              G =.. [P, E, _],
              catch(solve(G, Proof), _, fail),
              sentence(G, Txt),
              severity(G, Sv),
              once(proof_lines(Proof, 0, Lines)),
              findall(obj([depth-D1, kind-K, text-X]), member(line(D1, K, X), Lines), Ls),
              format(atom(GA), "~q", [G]),
              proof_term(Proof, PT),
              format(atom(PA), "~q", [PT]) ),
            Keyed),
    first_per_key(Keyed, Cs).   % one explanation per conclusion, however many proofs

first_per_key([], []).
first_per_key([K-V|KVs], [V|Vs]) :- drop_key(K, KVs, Rest), first_per_key(Rest, Vs).
drop_key(_, [], []).
drop_key(K, [K1-_|KVs], Rest) :- K1 == K, !, drop_key(K, KVs, Rest).
drop_key(K, [KV|KVs], [KV|Rest]) :- drop_key(K, KVs, Rest).

% E is visible to Role when it takes part in a relation of one of the role's domains.
visible(E, Role) :-
    ( kb_predicate(P, N, D) ; derived_predicate(P, N, D) ),
    role_domain(Role, D),
    functor(H, P, N), between(1, N, I), arg(I, H, E),
    catch(H, _, fail), !.

mentions(H, E) :- H =.. [_|Args], member(A, Args), A == E, !.

% Proof without the named clause copies, for the raw view.
proof_term(true, true) :- !.
proof_term((A, B), (PA, PB)) :- !, proof_term(A, PA), proof_term(B, PB).
proof_term(builtin(G), G) :- !.
proof_term(rule(G, true, _, _), G) :- !.
proof_term(rule(G, _, _, Sub), (G :- PS)) :- proof_term(Sub, PS).

% --- Agent requests (MCP): progressive disclosure over the same knowledge ---
%   api(overview(Domain, Role))           — domains, their relations and entities, services, rules
%   api(context(Entity, Depth, Role, Max)) — triples within Depth hops of Entity
%   api(verify(Who, Service, Done, Role))  — what working on Service needs, and what is missing
%   api(explain_goal(Text, Max, Role))     — English proof traces for a goal such as 'soft_credit_limit(dope, L)'
% Answers that cannot be given carry a `problem` and hints instead of failing.

% Walks pass through entities only, never through links or numbers.
walkable(X) :- atom(X), entity_type(X, T), T \== url, T \== value, T \== text.

scoped_triple(Role, t(S, L, O, P, K)) :-
    kb_triple(S, L, O, P, K), pred_domain(P, D), role_domain(Role, D).

api_term(overview(_, Role), obj([problem-'unknown role', roles-arr(Rs)])) :-
    \+ role(Role), !, findall(R, role(R), Rs).
api_term(overview(Domain, Role), J) :-
    findall(D, ( domain(D), role_domain(Role, D), ( Domain == all ; Domain == D ) ), DIds),
    (   DIds == []
    ->  findall(D, role_domain(Role, D), Allowed),
        J = obj([problem-'domain not in this role scope', domains-arr(Allowed)])
    ;   findall(obj([id-D, label-L, relations-arr(Rels), entities-obj(Groups)]),
                ( member(D, DIds), label_of(D, L),
                  findall(PL, ( ( kb_predicate(P, _, D) ; derived_predicate(P, _, D) ), edge_label(P, PL) ), Rels0),
                  dedupe(Rels0, Rels),
                  domain_entities(D, Groups) ),
                Ds),
        findall(S, service(S), Ss),
        findall(T, ( member(D, DIds), derived_predicate(P, _, D), rule_description(P, T) ), Rules),
        J = obj([role-Role, domains-arr(Ds), services-arr(Ss), rules-arr(Rules)]) ).

domain_entities(D, Groups) :-
    findall(T-X, ( kb_triple(S, _, O, P, _), pred_domain(P, D),
                   ( X = S ; X = O ), walkable(X), entity_type(X, T) ), Pairs0),
    sort(Pairs0, Pairs),
    group_pairs(Pairs, Groups).

% [a-1, a-2, b-3] -> [a-arr([1, 2]), b-arr([3])]
group_pairs([], []).
group_pairs([K-V|Ps], [K-arr([V|Vs])|Gs]) :- same_key(K, Ps, Vs, Rest), group_pairs(Rest, Gs).
same_key(K, [K1-V|Ps], [V|Vs], Rest) :- K1 == K, !, same_key(K, Ps, Vs, Rest).
same_key(_, Ps, [], Ps).

api_term(context(_, _, Role, _), obj([problem-'unknown role', roles-arr(Rs)])) :-
    \+ role(Role), !, findall(R, role(R), Rs).
api_term(context(E, Depth, Role, Max), J) :-
    findall(T, scoped_triple(Role, T), All),
    (   \+ ( member(t(S, _, O, _, _), All), ( S == E ; O == E ) )
    ->  suggestions(E, All, Sug),
        J = obj([entity-E, problem-'unknown entity in this role scope', suggestions-arr(Sug)])
    ;   walk([E], [E-0], 0, Depth, All, Dist),
        findall(K-T, ( member(T, All), T = t(S, _, O, _, _), hops(S, O, Dist, Depth, K) ), Keyed0),
        sort(Keyed0, Keyed),
        length(Keyed, Total),
        take(Max, Keyed, Kept),
        findall(obj([subject-S, predicate-L, object-O, relation-P, derived-bool(B), hops-K]),
                ( member(K-t(S, L, O, P, Kind), Kept), ( Kind == derived -> B = true ; B = false ) ),
                Ts),
        findall(X-Ty, ( member(_-t(S, _, O, _, _), Kept), ( X = S ; X = O ), walkable(X), entity_type(X, Ty) ), Es0),
        sort(Es0, Es),
        entity_type(E, ET),
        ( Total > Max -> Trunc = true ; Trunc = false ),
        J = obj([entity-E, type-ET, depth-Depth, role-Role, total-Total, truncated-bool(Trunc),
                 triples-arr(Ts), entities-obj(Es)]) ).

% Breadth-first distances from the focus, through walkable entities.
walk(_, Seen, D, Depth, _, Seen) :- D >= Depth, !.
walk([], Seen, _, _, _, Seen) :- !.
walk(Frontier, Seen, D, Depth, All, Dist) :-
    D1 is D + 1,
    findall(N, ( member(X, Frontier), member(t(S, _, O, _, _), All),
                 ( S == X, N = O ; O == X, N = S ),
                 walkable(N), \+ member(N-_, Seen) ), Ns0),
    sort(Ns0, Ns),
    findall(N-D1, member(N, Ns), New),
    append(Seen, New, Seen1),
    walk(Ns, Seen1, D1, Depth, All, Dist).

% A triple is in context when one end is closer than Depth; K is that distance.
hops(S, O, Dist, Depth, K) :-
    findall(D, ( ( member(X-D, Dist), X == S ; member(X-D, Dist), X == O ), D < Depth ), Ds),
    msort(Ds, [K|_]).

suggestions(E, All, Sug) :-
    findall(X, ( member(t(S, _, O, _, _), All), ( X = S ; X = O ), walkable(X),
                 atom(E), ( sub_atom(X, _, _, _, E) ; sub_atom(E, _, _, _, X) ) ), Xs0),
    sort(Xs0, Xs),
    (   Xs == [] -> findall(S, service(S), Sug) ; take(10, Xs, Sug) ).

take(N, Xs, Ys) :- length(Xs, L), ( L =< N -> Ys = Xs ; length(Ys, N), append(Ys, _, Xs) ).

% --- Task verification ---
% Working on a service means its own repository plus everything it requires.
prerequisite(Service, Service) :- repo(Service, _).
prerequisite(Service, Item) :- requires(Service, Item).

done(Who, Item, Done) :- ( catch(completed(Who, Item), _, fail) ; memberchk(Item, Done) ), !.

action_of(T, A) :- action(T, A), !.
action_of(_, 'set up').

api_term(verify(_, _, _, Role), obj([problem-'requirements are not in this role scope'])) :-
    \+ ( derived_predicate(requires, _, D), role_domain(Role, D) ), !.
api_term(verify(Who, Service, Done, _), J) :-
    findall(I, prerequisite(Service, I), Is0),
    dedupe(Is0, Is),
    findall(obj([item-I, type-T, action-A, satisfied-bool(B), link-Link, ask-arr(Ps), because-arr(Why)]),
            ( member(I, Is), entity_type(I, T), action_of(T, A),
              ( done(Who, I, Done) -> B = true ; B = false ),
              ( url(I, U) -> Link = U ; Link = null ),
              findall(P, catch(invites(P, I), _, fail), Ps),
              because(Service, I, Why) ),
            Items),
    findall(A-I, ( member(I, Is), \+ done(Who, I, Done), entity_type(I, T), action_of(T, A) ), Missing),
    findall(I, member(_-I, Missing), MissingIds),
    ( Is == [] -> Known = false ; Known = true ),
    ( Is \== [], Missing == [] -> Ready = true ; Ready = false ),
    verify_summary(Who, Service, Is, Missing, Summary),
    J = obj([who-Who, service-Service, known-bool(Known), ready-bool(Ready), summary-Summary,
             missing-arr(MissingIds), requirements-arr(Items)]).

because(S, S, [T]) :- !, noun_of(own_repository, N), as_sentence(N, T).
because(S, I, Why) :-
    once(solve(requires(S, I), P)),
    once(proof_lines(P, 0, Ls)),
    findall(T, member(line(_, fact, T), Ls), Why0),
    dedupe(Why0, Why).

% "adam still needs to clone injectx and k8s and set up docker_compose before working on service 'injectx'."
verify_summary(_, Service, [], _, T) :- !,
    connective(unrecorded, C), phrase_of(Service, SP),
    format(atom(T0), "~w ~w", [C, SP]), as_sentence(T0, T).
verify_summary(Who, Service, _, [], T) :- !,
    connective(ready, C), phrase_of(Who, WP), phrase_of(Service, SP),
    format(atom(T0), "~w ~w ~w", [WP, C, SP]), as_sentence(T0, T).
verify_summary(Who, Service, _, Missing, T) :-
    findall(A, member(A-_, Missing), As0), dedupe(As0, As),
    findall(G, ( member(A, As), findall(I, member(A-I, Missing), Is), join_and(Is, IT),
                 format(atom(G), "~w ~w", [A, IT]) ), Groups),
    join_and(Groups, GT),
    connective(still_needs, C1), connective(before_working_on, C2),
    phrase_of(Who, WP), phrase_of(Service, SP),
    format(atom(T0), "~w ~w ~w ~w ~w", [WP, C1, GT, C2, SP]), as_sentence(T0, T).

dedupe([], []).
dedupe([X|Xs], [X|Ys]) :- drop_all(X, Xs, Zs), dedupe(Zs, Ys).
drop_all(_, [], []).
drop_all(X, [Y|Ys], Zs) :- Y == X, !, drop_all(X, Ys, Zs).
drop_all(X, [Y|Ys], [Y|Zs]) :- drop_all(X, Ys, Zs).

% --- Explaining a goal or a rule ---
explainable(P, A, Role) :- kb_predicate(P, A, D), role_domain(Role, D).
explainable(P, A, Role) :- derived_predicate(P, A, D), role_domain(Role, D).

api_term(explain_goal(_, _, Role), obj([problem-'unknown role', roles-arr(Rs)])) :-
    \+ role(Role), !, findall(R, role(R), Rs).
api_term(explain_goal(Text, Max, Role), J) :-
    (   catch(read_term_from_atom(Text, G, [variable_names(Vs)]), _, fail)
    ->  explain_parsed(Text, G, Vs, Max, Role, J)
    ;   explain_problem(Text, 'not a readable goal', Role, J) ).

% A bare rule name: describe the rule.
explain_parsed(Text, G, _, _, Role, obj([expression-Text, rule-G, descriptions-arr(Ds)])) :-
    atom(G), derived_predicate(G, _, D0), role_domain(Role, D0), !,
    findall(D, rule_description(G, D), Ds).
explain_parsed(Text, G, Vs, Max, Role, J) :-
    callable(G), functor(G, P, A), explainable(P, A, Role), !,
    findall(Vs-G-Proof, catch(solve(G, Proof), _, fail), Sols0),
    length(Sols0, N),
    take(Max, Sols0, Sols),
    findall(obj([bindings-obj(Bs), text-T, severity-Sv, explanation-X, proof-PA]),
            ( member(Vs1-G1-P1, Sols),
              findall(Name-Val, member(Name=Val, Vs1), Bs),
              sentence(G1, T), severity(G1, Sv),
              once(proof_lines(P1, 0, Lines)), lines_text(Lines, X),
              proof_term(P1, PT), format(atom(PA), "~q", [PT]) ),
            Answers),
    ( N > 0 -> Holds = true ; Holds = false ),
    J = obj([expression-Text, holds-bool(Holds), answers_total-N, answers-arr(Answers)]).
explain_parsed(Text, _, _, _, Role, J) :-
    explain_problem(Text, 'not an explainable goal in this role scope', Role, J).

explain_problem(Text, Problem, Role, obj([expression-Text, problem-Problem, explainable-arr(Ps)])) :-
    findall(PA, ( explainable(P, A, Role), format(atom(PA), "~w/~w", [P, A]) ), Ps).

% Explanation lines as one indented text, two spaces per level.
lines_text(Lines, T) :-
    findall(L, ( member(line(D, _, X), Lines), D2 is D * 2, spaces(D2, I), atom_concat(I, X, L) ), Ls),
    join_lines(Ls, T).
spaces(0, '') :- !.
spaces(N, S) :- N1 is N - 1, spaces(N1, S1), atom_concat(' ', S1, S).
join_lines([], '').
join_lines([X], X) :- !.
join_lines([X|Xs], T) :- join_lines(Xs, R), format(atom(T), "~w~n~w", [X, R]).
