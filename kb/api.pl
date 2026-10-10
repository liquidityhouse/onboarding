% api.pl — the knowledge-graph bridge and the JSON requests the web server asks.
%
% The web server's REST endpoints and MCP tools call api(Request) and parse the JSON written
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

session_json(U, R, obj([user-U, name-N, role-R, role_label-RL, domains-arr(Ds), features-arr(Fs), start-St, title-T, tagline-G])) :-
    label_of(U, N), label_of(R, RL), app_title(T), app_tagline(G),
    findall(D, role_domain(R, D), Ds),
    findall(F, role_feature(R, F), Fs),
    ( role_start(R, St) -> true ; St = null ).

% allowed(Role, Endpoint): the web server's authorisation, from can_call/2 (explorer pack).
api_term(allowed(Role, Endpoint), obj([allowed-bool(B)])) :-
    ( can_call(Role, Endpoint) -> B = true ; B = false ).

% may_use(Role, Tool): the MCP tools' authorisation, from can_use/2 (explorer pack).
api_term(may_use(Role, Tool), obj([allowed-bool(B)])) :-
    ( can_use(Role, Tool) -> B = true ; B = false ).

% tool_docs: MCP tool descriptions, from purpose/2 (explorer pack).
api_term(tool_docs, obj(Docs)) :-
    findall(T-D, ( mcp_tool(T, _), purpose(T, D) ), Docs).

api_term(users, obj([users-arr(Us)])) :-
    findall(obj([id-U, name-N, role-R]), ( user_account(U, R), label_of(U, N) ), Us).

% graph(Role): everything the explorer draws, limited to the role's domains.
api_term(graph(Role), obj([problem-'unknown role'])) :- \+ role(Role), !.
api_term(graph(Role), obj([
        domains-arr(Ds), predicates-arr(Ps), types-arr(Ts), kinds-arr(Ks), words-obj(Ws),
        rules-arr(RDs), entities-arr(Es), triples-arr(Trs)])) :-
    kinds_json(Ks),
    label_of(relation, RL), Ws = [relation-RL],
    findall(obj([id-D, label-L]), ( domain(D), role_domain(Role, D), label_of(D, L) ), Ds),
    findall(obj([id-P, arity-N, domain-D, label-L, derived-bool(false)]),
            ( kb_predicate(P, N, D), role_domain(Role, D), edge_label(P, L) ), Ps0),
    findall(obj([id-P, arity-N, domain-D, label-L, derived-bool(true)]),
            ( derived_predicate(P, N, D), role_domain(Role, D), edge_label(P, L) ), Ps1),
    append(Ps0, Ps1, Ps),
    findall(obj([id-T, label-L, color-C, shape-S]), ( type_style(T, C, S), label_of(T, L) ), Ts),
    findall(obj(RJ),
            ( derived_predicate(P, _, D), role_domain(Role, D), rule_json(Role, P, RJ) ), RDs),
    findall(T, scoped_triple(Role, T), Raw0),
    counted(Raw0, Raw),   % a conclusion reached two ways is still one edge; W counts the ways
    findall(obj([s-S, p-L, o-O, pred-P, domain-D, derived-bool(B), kind-RK, severity-Sv, ways-W, via-Via, change-Ch]),
            ( member(t(S, L, O, P, K)-W, Raw),
              pred_domain(P, D),
              G =.. [P, S, O], severity(G, Sv),
              fact_kind(G, RK), change_of(G, Ch),
              ( K == derived -> B = true, via_of(Role, G, Via) ; B = false, Via = null ) ),
            Trs),
    findall(X, ( member(t(S, _, O, _, _)-_, Raw), ( X = S ; X = O ), atom(X) ), Xs0),
    sort(Xs0, Xs),
    findall(obj([id-X, type-T, label-L]), ( member(X, Xs), entity_type(X, T), phrase_of(X, L) ), Es).

% The kinds of knowledge, named by the lexicon and explained by their purpose.
kinds_json(Ks) :-
    findall(obj([id-K, label-L, hint-H]), ( knowledge_kind(K), label_of(K, L), purpose(K, P), plain(P, H) ), Ks).

% One rule clause: its words, its slots and, for technical roles, the clause as written.
rule_json(Role, P, [predicate-P, clause-I, text-T, slots-arr(Ns)|Tech]) :-
    rule_clause(P, I, Named), rule_text(Named, T), clause_slots(Named, Ns),
    (   role_feature(Role, technical) -> rule_source(P, I, Named, Tech) ; Tech = [] ).

% Its file, line and text (clause_source/6 is generated from the KB files); a reprint
% from the loaded clause when the file has no such clause.
rule_source(P, I, _, [source-obj([file-F, line-L, text-T])]) :-
    catch(clause_source(P, _, I, F, L, T), _, fail), !.
rule_source(_, _, Named, [pattern-Pat]) :- clause_pattern(Named, Pat).

% Where a stated fact is written: the clause_source/6 entry that reads as exactly this
% fact, or, for a generated one, the module that generates it, or, for a local one, the
% state file and the change that added it.
fact_source(G, obj([file-F, local-bool(true), text-T])) :-
    local_fact(G), !,
    keeps_state_in(override_store, F),
    format(atom(T0), "~q.", [G]), T = T0.
fact_source(G, obj([file-F, line-L, text-T])) :-
    functor(G, P, A),
    catch(clause_source(P, A, _, F, L, T), _, fail),
    catch(read_term_from_atom(T, G1, []), _, fail),
    G1 == G, !.
fact_source(G, obj([file-F, generated-bool(true), text-T|More])) :-
    functor(G, P, A), catch(generated_predicate(P, A), _, fail),
    source_file(kb_source, F), !,
    format(atom(T0), "~q.", [G]), T = T0,
    findall(K-J, generation(G, P, K, J), More).

% Where a generated fact was read from (generated_origin/4) and the code that generated
% it (generator_code/4), both written by the generator itself.
generation(G, _, origin, obj([label-L, file-F, line-N, text-T])) :-
    once(catch(generated_origin(G, F, N, T), _, fail)), label_of(generated_origin, L).
generation(_, P, generator, obj([label-L, file-F, line-N, text-T])) :-
    once(catch(generator_code(P, F, N, T), _, fail)), label_of(generator_code, L).

% The change behind a local fact, for everyone: who made it, how and when.
change_of(G, J) :- once(local_change(Id, add, G, B, V, At, S)), !, change_json(Id, add, G, B, V, At, S, J).
change_of(_, null).

change_json(Id, Op, G, B, V, At, S, obj([id-Id, op-Op, fact-C, text-T, summary-Sum, by-B, by_name-BN, by_role-RL, via-V, via_label-VL, at-At, stale-bool(St)|Src])) :-
    format(atom(C), "~q", [G]),
    ( catch(sentence(G, T0), _, fail) -> T = T0 ; T = C ),
    label_of(B, BN), ( user_account(B, R) -> label_of(R, RL) ; RL = null ),
    noun_of(V, VL),
    ( local_stale(Id) -> St = true ; St = false ),
    source_json(S, Src),
    change_summary(Op, BN, RL, VL, S, Sum).

% "Added by Adam, Software Engineer (Developer) through the explorer, pasted"
change_summary(Op, BN, RL, VL, S, Sum) :-
    ( Op == add -> connective(added_by, A) ; connective(removed_by, A) ),
    ( RL == null -> Who = BN ; format(atom(Who), "~w (~w)", [BN, RL]) ),
    connective(through, Th),
    source_phrase(S, SP),
    format(atom(Sum0), "~w ~w ~w ~w~w", [A, Who, Th, VL, SP]), capitalise(Sum0, Sum1),
    Sum = Sum1.

source_phrase(url(U), P) :- !, connective(read_from, R), format(atom(P0), ", ~w ~w", [R, U]), P = P0.
source_phrase(replaces(Old), P) :- !, connective(replacing, R),
    ( catch(sentence(Old, T), _, fail) -> true ; format(atom(T), "~q", [Old]) ),
    format(atom(P0), ", ~w: ~w", [R, T]), P = P0.
source_phrase(pasted, P) :- !, connective(pasted, R), format(atom(P0), ", ~w", [R]), P = P0.
source_phrase(_, '').

source_json(url(U), [source-U]) :- !.
source_json(replaces(Old), [replaces-T]) :- !, ( catch(sentence(Old, T0), _, fail) -> T = T0 ; format(atom(T), "~q", [Old]) ).
source_json(pasted, [source-pasted]) :- !.
source_json(_, []).

% overrides: every local change, oldest first.
api_term(overrides, obj([changes-arr(Cs)])) :-
    findall(J, ( local_change(Id, Op, G, B, V, At, S), change_json(Id, Op, G, B, V, At, S, J) ), Cs).

% fact_check(Text): whether Text is a fact that may be changed here, in canonical form and
% in words, whether it holds now and, when it is stated, where it is written.
api_term(fact_check(Text), J) :-
    (   catch(read_term_from_atom(Text, G, []), _, fail) -> checked_fact(G, J)
    ;   J = obj([problem-'not a Prolog term']) ).

checked_fact(G, obj([problem-P])) :- fact_problem(G, P), !.
checked_fact(G, obj([fact-C, text-T, predicate-PA, holds-bool(H), kind-K, shown-bool(Sh), change-Ch|Site])) :-
    format(atom(C), "~q", [G]), functor(G, P, A), format(atom(PA), "~w/~w", [P, A]),
    ( catch(sentence(G, T0), _, fail) -> T = T0 ; T = C ),
    ( catch(G, _, fail) -> H = true ; H = false ),
    ( H == true -> fact_kind(G, K) ; K = null ),
    ( kb_predicate(P, A, _) -> Sh = true ; Sh = false ),
    change_of(G, Ch),
    ( H == true, \+ local_fact(G), fact_source(G, S), S = obj(L), \+ memberchk(generated-_, L) -> Site = [site-S] ; Site = [] ).

fact_problem(G, 'only facts can be changed here, not rules or directives') :- ( G = (_ :- _) ; G = (:- _) ), !.
fact_problem(G, 'a fact looks like relation(argument, …)') :- \+ compound(G), !.
fact_problem(G, 'a fact cannot contain variables') :- \+ ground(G), !.
fact_problem(G, P) :- functor(G, N, A), protected_relation(N, A), !,
    format(atom(P), "~w/~w decides who may see and do what, so it is changed only in the pack files", [N, A]).
fact_problem(G, P) :- functor(G, N, A), derived_predicate(N, A, _), !,
    format(atom(P), "~w/~w is worked out by a rule: change the facts it uses instead", [N, A]).
fact_problem(G, P) :- functor(G, N, A), \+ changeable(N, A), !,
    format(atom(P), "~w/~w is not a relation any knowledge pack states", [N, A]).

% A relation can be changed locally when a pack states it: a graph relation, or facts in a pack file.
changeable(N, A) :- kb_predicate(N, A, _), !.
changeable(N, A) :- catch(clause_source(N, A, _, F, _, T), _, fail), sub_atom(F, 0, _, _, 'knowledge/'), \+ sub_atom(T, _, _, _, ':-'), !.

% progress_plan(Who, Service, Items, Done): the changes that mark Items (all of the service's
% requirements when empty) done or not done for Who: add completed/2, or undo or remove it.
api_term(progress_plan(Who, Service, Items0, Done), J) :-
    findall(I, prerequisite(Service, I), Is0), dedupe(Is0, All),
    (   All == [] -> format(atom(P), "no requirements are recorded for ~w", [Service]), J = obj([problem-P])
    ;   ( Items0 == [] -> Items = All ; Items = Items0 ),
        (   member(I, Items), \+ memberchk(I, All)
        ->  format(atom(P), "~w is not needed for ~w", [I, Service]), J = obj([problem-P])
        ;   findall(Op, ( member(I, Items), progress_op(completed(Who, I), Done, Op) ), Ops),
            J = obj([ops-arr(Ops)]) ) ).

progress_op(G, true, obj([op-add, fact-C, text-T])) :- \+ catch(G, _, fail), format(atom(C), "~q", [G]), sentence(G, T).
progress_op(G, false, obj([op-undo, id-Id])) :- once(local_change(Id, add, G, _, _, _, _)).
progress_op(G, false, obj([op-remove, fact-C, text-T, site-S])) :-
    \+ local_fact(G), catch(G, _, fail), fact_source(G, S), format(atom(C), "~q", [G]), sentence(G, T).

% A stated fact's source, for technical roles.
stated_source(Role, G, [source-J]) :- role_feature(Role, technical), fact_source(G, J), !.
stated_source(_, _, []).

% via: the clause that made a conclusion and what each of its slots stood for; technical
% roles also get the clause with these values and the query that asks for it again.
via_of(Role, G, Via) :- ( catch(once(solve(G, Proof)), _, fail), via_json(Role, Proof, Via) -> true ; Via = null ).
via_json(Role, Proof, obj([rule-I, bindings-arr(Bs)|Tech])) :-
    derivation(Proof, I, Ps), !,
    findall(obj([name-N, value-T]), member(N-T, Ps), Bs),
    (   role_feature(Role, technical), Proof = rule(G, Body, _, _)
    ->  instance_text((G :- Body), IT), query_text(G, I, QT), Tech = [instance-IT, query-QT]
    ;   Tech = [] ).
via_json(_, _, null).

% [b, a, b] -> [a-1, b-2]
counted(Xs, Counts) :- msort(Xs, Sorted), runs(Sorted, Counts).
runs([], []).
runs([X|Xs], [X-N|Rs]) :- run(X, Xs, 1, N, Rest), runs(Rest, Rs).
run(X, [Y|Ys], N0, N, Rest) :- Y == X, !, N1 is N0 + 1, run(X, Ys, N1, N, Rest).
run(_, Rest, N, N, Rest).

% explain(E, Role): facts and explained conclusions about E within the role's domains.
api_term(explain(E, Role), obj([id-E, problem-'not visible in this role scope'])) :-
    \+ visible(E, Role), !.
api_term(explain(E, Role), obj([id-E, type-T, phrase-Ph, similar-arr(Sim), similar_label-SL, facts-arr(Fs), conclusions-arr(Cs)])) :-
    entity_type(E, T),
    phrase_of(E, Ph),
    findall(obj([id-X, type-XT, phrase-XP]), ( similar_entity(Role, E, X), entity_type(X, XT), phrase_of(X, XP) ), Sim),
    label_of(similar_name, SL),
    findall(Txt-H, ( kb_predicate(P, N, D), role_domain(Role, D), functor(H, P, N),
                     catch(H, _, fail), mentions(H, E), sentence(H, Txt) ), Fs0),
    keysort(Fs0, Fs1), first_per_key(Fs1, Hs),
    findall(obj([text-Txt, kind-K, change-Ch|Src]), ( member(H, Hs), sentence(H, Txt), fact_kind(H, K), change_of(H, Ch), stated_source(Role, H, Src) ), Fs),
    findall(GA-obj([predicate-P, severity-Sv, goal-GA, text-Txt, via-Via, lines-arr(Ls)]),
            ( derived_predicate(P, 2, D), role_domain(Role, D),
              G =.. [P, E, _],
              catch(solve(G, Proof), _, fail),
              sentence(G, Txt),
              severity(G, Sv),
              via_json(Role, Proof, Via),
              once(proof_lines(Proof, 0, Lines)),
              findall(obj([depth-D1, kind-K, text-X]), member(line(D1, K, X), Lines), Ls),
              format(atom(GA), "~q", [G]) ),
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

% Entities whose names differ only in case or punctuation (api:check, api_check) are
% easy to mix up; the explorer names them side by side.
similar_entity(Role, E, X) :-
    name_key(E, K), K \== '',
    findall(Y, ( scoped_triple(Role, t(S, _, O, _, _)), ( Y = S ; Y = O ), atom(Y), Y \== E ), Ys0),
    sort(Ys0, Ys),
    member(X, Ys), name_key(X, K).

name_key(E, K) :-
    atom(E), atom_codes(E, Cs),
    findall(L, ( member(C, Cs), alnum(C), lower_code(C, L) ), Ls),
    atom_codes(K, Ls).
lower_code(C, L) :- C >= 0'A, C =< 0'Z, !, L is C + 32.
lower_code(C, C).

mentions(H, E) :- H =.. [_|Args], member(A, Args), A == E, !.

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
    findall(obj([item-I, type-T, action-A, satisfied-bool(B), link-Link, ask-arr(Ps), because-arr(Why), change-Ch]),
            ( member(I, Is), entity_type(I, T), action_of(T, A), change_of(completed(Who, I), Ch),
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
    label_of(Who, WN), ( user_account(Who, WR) -> label_of(WR, WRL) ; WRL = null ),
    J = obj([who-Who, who_name-WN, who_role-WRL, service-Service, known-bool(Known), ready-bool(Ready), summary-Summary,
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
    findall(GA-(Vs-G-Proof), ( catch(solve(G, Proof), _, fail), format(atom(GA), "~q", [G]) ), Keyed),
    first_per_key(Keyed, Sols0),   % one answer per distinct conclusion
    length(Sols0, N),
    take(Max, Sols0, Sols),
    findall(obj([bindings-obj(Bs), text-T, severity-Sv, derived-bool(Dv), kind-AK, via-Via, explanation-X, lines-arr(Ls)|Src]),
            ( member(Vs1-G1-P1, Sols),
              findall(Name-Val, member(Name=Val, Vs1), Bs),
              sentence(G1, T), severity(G1, Sv), via_json(Role, P1, Via),
              ( P1 = rule(_, true, _, _) -> Dv = false, stated_source(Role, G1, Src) ; Dv = true, Src = [] ),
              ( Dv == true -> AK = derived ; fact_kind(G1, AK) ),
              once(proof_lines(P1, 0, Lines)), lines_text(Lines, X),
              findall(obj([depth-D, kind-K, text-LT]), member(line(D, K, LT), Lines), Ls) ),
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
