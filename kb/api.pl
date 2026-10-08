% api.pl — knowledge-graph bridge and JSON API consumed by the browser.
%
% The UI calls api(Request) and parses the JSON written to stdout.
%   api(snapshot)    — domains, predicates, types, roles, users, rules, entities, triples
%   api(explain(E))  — facts about E and proof-based explanations of its derived values

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

api_term(snapshot, obj([
        domains-arr(Ds), predicates-arr(Ps), types-arr(Ts), roles-arr(Rs),
        users-arr(Us), rules-arr(RDs), entities-arr(Es), triples-arr(Trs)])) :-
    findall(obj([id-D, label-L]), ( domain(D), label_of(D, L) ), Ds),
    findall(obj([id-P, arity-N, domain-D, label-L, derived-bool(false)]),
            ( kb_predicate(P, N, D), edge_label(P, L) ), Ps0),
    findall(obj([id-P, arity-N, domain-D, label-L, derived-bool(true)]),
            ( derived_predicate(P, N, D), edge_label(P, L) ), Ps1),
    append(Ps0, Ps1, Ps),
    findall(obj([id-T, label-L, color-C, shape-S]), ( type_style(T, C, S), label_of(T, L) ), Ts),
    findall(obj([id-R, label-L, domains-arr(RD), features-arr(RF), start-St]),
            ( role(R), label_of(R, L),
              findall(D, role_domain(R, D), RD),
              findall(F, role_feature(R, F), RF),
              ( role_start(R, St) -> true ; St = null ) ),
            Rs),
    findall(obj([id-U, name-N, role-R]), ( user_account(U, R), label_of(U, N) ), Us),
    findall(obj([predicate-P, text-T]), rule_description(P, T), RDs),
    findall(t(S, L, O, P, K), kb_triple(S, L, O, P, K), Raw),
    findall(obj([s-S, p-L, o-O, pred-P, domain-D, derived-bool(B), severity-Sv]),
            ( member(t(S, L, O, P, K), Raw),
              pred_domain(P, D),
              G =.. [P, S, O], severity(G, Sv),
              ( K == derived -> B = true ; B = false ) ),
            Trs),
    findall(X, ( member(t(S, _, O, _, _), Raw), ( X = S ; X = O ), atom(X) ), Xs0),
    sort(Xs0, Xs),
    findall(obj([id-X, type-T, label-L]), ( member(X, Xs), entity_type(X, T), phrase_of(X, L) ), Es).

api_term(explain(E), obj([id-E, type-T, phrase-Ph, facts-arr(Fs), conclusions-arr(Cs)])) :-
    entity_type(E, T),
    phrase_of(E, Ph),
    findall(Txt, ( kb_predicate(P, N, _), functor(H, P, N),
                   catch(H, _, fail), mentions(H, E), sentence(H, Txt) ), Fs0),
    sort(Fs0, Fs),
    findall(obj([predicate-P, severity-Sv, goal-GA, text-Txt, lines-arr(Ls), proof-PA]),
            ( derived_predicate(P, 2, _),
              G =.. [P, E, _],
              catch(solve(G, Proof), _, fail),
              sentence(G, Txt),
              severity(G, Sv),
              once(proof_lines(Proof, 0, Lines)),
              findall(obj([depth-D, kind-K, text-X]), member(line(D, K, X), Lines), Ls),
              format(atom(GA), "~q", [G]),
              proof_term(Proof, PT),
              format(atom(PA), "~q", [PT]) ),
            Cs).

mentions(H, E) :- H =.. [_|Args], member(A, Args), A == E, !.

% Proof without the named clause copies, for the raw view.
proof_term(true, true) :- !.
proof_term((A, B), (PA, PB)) :- !, proof_term(A, PA), proof_term(B, PB).
proof_term(builtin(G), G) :- !.
proof_term(rule(G, true, _, _), G) :- !.
proof_term(rule(G, _, _, Sub), (G :- PS)) :- proof_term(Sub, PS).
