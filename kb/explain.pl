% explain.pl — Syllog-style meta-interpreter and a sentence composer.
%
% Every string here is derived from lexicon.pl primitives and the structure of
% facts and rule clauses. There are no per-predicate sentence templates.

% --- Meta-interpreter: solve(Goal, Proof) ---
% Proof = true | (PA, PB) | builtin(Goal) | rule(Goal, Body, NamedClause, SubProof)
% NamedClause is a copy of the clause used, with variables named after the
% concepts they stand for; it lets us describe the rule in words.
solve(true, true) :- !.
solve((A, B), (PA, PB)) :- !,
    solve(A, PA),
    solve(B, PB).
solve(G, builtin(G)) :- builtin_goal(G), !,
    call(G).
solve(G, rule(G, Body, Named, Sub)) :-
    clause(G, Body),
    copy_term((G :- Body), Named),
    name_clause(Named),
    solve(Body, Sub).

builtin_goal(_ is _).
builtin_goal(G) :- compound(G), functor(G, Op, 2), op_word(Op, _).

% --- Naming variables after concepts: V becomes n(Phrase, Concept) ---
name_clause((H :- B)) :-
    name_goal(H),
    name_body(B),
    term_variables(H-B, Vs),
    name_rest(Vs).

name_body((A, B)) :- !, name_body(A), name_body(B).
name_body(G) :- builtin_goal(G), !.
name_body(G) :- name_goal(G).

name_goal(risk_weight(W, V)) :- atom(W), var(V), !,
    noun_of(W, N), V = n(N, weight).
name_goal(G) :- compound(G), G =.. [P, _, V], var(V), !,
    noun_of(P, N), V = n(N, P).
name_goal(_).

name_rest([]).
name_rest([n(it, none)|Vs]) :- name_rest(Vs).

% --- Lexicon access with derived defaults ---
noun_of(C, N) :- noun(C, N), !.
noun_of(C, N) :- atom(C), !, humanise(C, N).
noun_of(C, N) :- format(atom(N), "~w", [C]).

humanise(A, H) :- atom_codes(A, Cs), underscores(Cs, Hs), atom_codes(H, Hs).
underscores([], []).
underscores([0'_|Cs], [0' |Hs]) :- !, underscores(Cs, Hs).
underscores([C|Cs], [C|Hs]) :- underscores(Cs, Hs).

capitalise(A, B) :-
    atom_codes(A, [C|Cs]), !,
    ( C >= 0'a, C =< 0'z -> U is C - 32 ; U = C ),
    atom_codes(B, [U|Cs]).
capitalise(A, A).

unit_of(C, U) :- unit(C, U), !.
unit_of(_, plain).

relation(P) :- verb(P, _).

copula(C, are) :- plural(C), !.
copula(_, is).

% Edge label for a predicate: its verb, else its noun.
edge_label(P, L) :- verb(P, L), !.
edge_label(P, L) :- noun_of(P, L).

arg_label(P, I, L) :- arg_verb(P, I, L), !.
arg_label(P, I, L) :- noun_of(P, N), format(atom(L), "~w (~w)", [N, I]).

% --- Noun phrases and values ---
% phrase_of(Entity, Text): "operator 'dope'", or the bare entity for bare types.
phrase_of(E, T) :- number(E), !, num_text(E, T).
phrase_of(E, T) :-
    entity_type(E, Ty),
    (   bare(Ty) -> format(atom(T), "~w", [E])
    ;   noun_of(Ty, N), format(atom(T), "~w '~w'", [N, E]) ).

value_text(C, V, T) :- number(V), !,
    unit_of(C, U), num_text(V, N),
    (   unit_word(U, W) -> format(atom(T), "~w ~w", [N, W]) ; T = N ).
value_text(_, V, T) :- phrase_of(V, T).

% Numbers: 1234567.891 -> '1,234,567.89'; integers stay integral.
num_text(X, A) :- integer(X), !, group_digits(X, A).
num_text(X, A) :-
    R is round(abs(X) * 100),
    I is R // 100, C is R mod 100,
    group_digits(I, G),
    ( X < 0 -> S = (-) ; S = '' ),
    ( C < 10 -> format(atom(A), "~w~w.0~w", [S, G, C])
    ;            format(atom(A), "~w~w.~w", [S, G, C]) ).

group_digits(I, A) :- I < 0, !, J is -I, group_digits(J, B), atom_concat((-), B, A).
group_digits(I, A) :- I < 1000, !, format(atom(A), "~w", [I]).
group_digits(I, A) :-
    H is I // 1000, L is I mod 1000,
    group_digits(H, HA),
    ( L < 10 -> P = '00' ; L < 100 -> P = '0' ; P = '' ),
    format(atom(A), "~w,~w~w", [HA, P, L]).

join([], _, '').
join([X], _, X) :- !.
join([X|Xs], Sep, T) :- join(Xs, Sep, R), format(atom(T), "~w~w~w", [X, Sep, R]).

as_sentence(T0, T) :- capitalise(T0, T1), atom_concat(T1, '.', T).

% --- Facts as sentences ---
% Relations:  "Subject Verb Object[, ArgVerb Extra]."
% Attributes: "The Noun of Subject is Value."
sentence(G, T) :- G =.. [P|Args], clause_text(P, Args, T0), as_sentence(T0, T).

clause_text(P, [X], T) :- !,
    phrase_of(P, S), edge_label(P, V), phrase_of(X, O),
    format(atom(T), "~w ~w ~w", [S, V, O]).
clause_text(P, [S, O|Extra], T) :- relation(P), !,
    phrase_of(S, ST), verb(P, V), phrase_of(O, OT),
    extras(P, 3, Extra, XT),
    format(atom(T), "~w ~w ~w~w", [ST, V, OT, XT]).
clause_text(P, [S, V|Extra], T) :-
    noun_of(P, N), copula(P, Is), phrase_of(S, ST), value_text(P, V, VT),
    extras(P, 3, Extra, XT),
    format(atom(T), "the ~w of ~w ~w ~w~w", [N, ST, Is, VT, XT]).

extras(_, _, [], '').
extras(P, I, [X|Xs], T) :-
    arg_label(P, I, L), phrase_of(X, XT),
    I1 is I + 1, extras(P, I1, Xs, R),
    format(atom(T), ", ~w ~w~w", [L, XT, R]).

% --- Rules in words, derived from a named clause ---
% "soft credit limit = 90-day gross gaming revenue × ggr factor + ..."
% "the exposure level is high when wallet exposure is greater than ..."
rule_text((H :- B), T) :-
    H =.. [P, _, V],
    noun_of(P, N),
    (   calc_goal(B, V, E)
    ->  expr_words(E, EW), format(atom(T0), "~w = ~w", [N, EW])
    ;   conditions(B, Cs), Cs \== []
    ->  connective(and, And), connective(when, When),
        format(atom(Sep), " ~w ", [And]), join(Cs, Sep, CT),
        value_text(P, V, VT), copula(P, Is),
        format(atom(T0), "the ~w ~w ~w ~w ~w", [N, Is, VT, When, CT])
    ;   inputs(B, Is), join(Is, ', ', IT),
        format(atom(T0), "the ~w follows from ~w", [N, IT]) ), !,
    as_sentence(T0, T).

calc_goal((A, B), V, E) :- !, ( calc_goal(A, V, E) -> true ; calc_goal(B, V, E) ).
calc_goal(X is E, V, E) :- X == V.

conditions((A, B), Cs) :- !, conditions(A, CA), conditions(B, CB), append(CA, CB, Cs).
conditions(G, [T]) :-
    G =.. [Op, A, B], op_word(Op, W), !,
    expr_words(A, AT), expr_words(B, BT),
    format(atom(T), "~w ~w ~w", [AT, W, BT]).
conditions(_, []).

inputs((A, B), Is) :- !, inputs(A, IA), inputs(B, IB), append(IA, IB, Is).
inputs(G, []) :- builtin_goal(G), !.
inputs(G, [N]) :- functor(G, P, _), noun_of(P, N).

% expr_words(NamedExpr, Text): names only.
expr_words(n(N, _), N) :- !.
expr_words(X, T) :- number(X), !, num_text(X, T).
expr_words(E, T) :-
    E =.. [Op, A, B], op_symbol(Op, S), !,
    operand(Op, A, AT), operand(Op, B, BT),
    format(atom(T), "~w ~w ~w", [AT, S, BT]).
expr_words(E, T) :- format(atom(T), "~w", [E]).

operand(Op, A, T) :-
    compound(A), A =.. [Op2, _, _], op_precedence(Op2, P2), op_precedence(Op, P1), P2 < P1, !,
    expr_words(A, T0), format(atom(T), "(~w)", [T0]).
operand(_, A, T) :- expr_words(A, T).

% expr_values(NamedExpr, ValueExpr, Text): names with their values.
expr_values(n(N, C), V, T) :- !,
    value_text(C, V, VT), format(atom(T), "~w (~w)", [N, VT]).
expr_values(X, _, T) :- number(X), !, num_text(X, T).
expr_values(NE, VE, T) :-
    NE =.. [Op, NA, NB], VE =.. [Op, VA, VB], op_symbol(Op, S), !,
    operand_values(Op, NA, VA, AT), operand_values(Op, NB, VB, BT),
    format(atom(T), "~w ~w ~w", [AT, S, BT]).
expr_values(_, VE, T) :- format(atom(T), "~w", [VE]).

operand_values(Op, NA, VA, T) :-
    compound(NA), NA =.. [Op2, _, _], op_precedence(Op2, P2), op_precedence(Op, P1), P2 < P1, !,
    expr_values(NA, VA, T0), format(atom(T), "(~w)", [T0]).
operand_values(_, NA, VA, T) :- expr_values(NA, VA, T).

% A side of a comparison, with its total when it is a compound expression.
side_text(NE, VE, T) :-
    expr_values(NE, VE, T0),
    (   compound(VE), NE \= n(_, _)
    ->  V is VE, num_text(V, VT), format(atom(T), "~w = ~w", [T0, VT])
    ;   T = T0 ).

% --- Calculations and checks, from the instantiated and named builtin goal ---
calc_text(X is VE, n(N, C) is NE, T) :- !,
    connective(calculated, K),
    expr_values(NE, VE, ET), value_text(C, X, XT),
    format(atom(T), "~w ~w = ~w = ~w", [K, N, ET, XT]).
calc_text(G, NG, T) :-
    G =.. [Op, VA, VB], NG =.. [Op, NA, NB], op_word(Op, W), !,
    connective(checked, K),
    side_text(NA, VA, AT), side_text(NB, VB, BT),
    format(atom(T), "~w ~w ~w ~w", [K, AT, W, BT]).
calc_text(G, _, T) :- connective(checked, K), format(atom(T), "~w ~w", [K, G]).

% --- Proof tree -> explanation lines: line(Depth, Kind, Text) ---
% Kind = conclusion | warning | rule | fact | calc
proof_lines(true, _, []) :- !.
proof_lines((A, B), D, L) :- !,
    proof_lines(A, D, LA), proof_lines(B, D, LB), append(LA, LB, L).
proof_lines(rule(G, true, _, _), D, [line(D, K, T)]) :- !,
    sentence(G, T), line_kind(G, fact, K).
proof_lines(rule(G, Body, Named, Sub), D, [line(D, K, T), line(D1, rule, R)|L]) :-
    sentence(G, T), line_kind(G, conclusion, K),
    D1 is D + 1,
    rule_text(Named, R),
    Named = (_ :- NB),
    body_lines(Body, NB, Sub, D1, L).

body_lines((A, B), (NA, NB), (PA, PB), D, L) :- !,
    body_lines(A, NA, PA, D, LA), body_lines(B, NB, PB, D, LB), append(LA, LB, L).
body_lines(G, NG, builtin(_), D, [line(D, calc, T)]) :- !, calc_text(G, NG, T).
body_lines(_, _, P, D, L) :- proof_lines(P, D, L).

line_kind(G, _, Severity) :- G =.. [P, _, V], flag(P, V, Severity), !.
line_kind(_, K, K).

severity(G, S) :- line_kind(G, none, S).

% Every rule clause of a derived predicate, in words.
rule_description(P, T) :-
    derived_predicate(P, A, _),
    functor(H, P, A),
    clause(H, B),
    copy_term((H :- B), Named),
    name_clause(Named),
    rule_text(Named, T).
