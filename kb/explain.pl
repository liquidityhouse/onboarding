% explain.pl — Syllog-style meta-interpreter and a sentence composer.
%
% Every string here is derived from lexicon.pl primitives and the structure of
% facts and rule clauses. There are no per-predicate sentence templates.

% --- Meta-interpreter: solve(Goal, Proof) ---
% Proof = true | (PA, PB) | builtin(Goal) | rule(Goal, Body, NamedClause, SubProof)
% NamedClause is a generic copy of the clause used (before unifying with Goal),
% with variables named after the concepts they stand for; it lets us describe
% the rule in words exactly as it is written.
solve(true, true) :- !.
solve((A, B), (PA, PB)) :- !,
    solve(A, PA),
    solve(B, PB).
solve(G, builtin(G)) :- builtin_goal(G), !,
    call(G).
% Only dynamic predicates can be read with clause/2: answers of the others count as given facts.
solve(G, rule(G, true, (G :- true), true)) :- opaque(G), !,
    call(G).
solve(G, rule(G, Body, Named, Sub)) :-
    functor(G, F, A), functor(H, F, A),
    clause(H, Body),
    (   Body == true -> Named = (H :- true)
    ;   copy_term((H :- Body), Named), name_clause(Named) ),
    H = G,
    solve(Body, Sub).

% Asked under negation, never by catching clause/2's error (practice isolate_reflection).
opaque(G) :- \+ predicate_property(G, dynamic).

builtin_goal(_ is _).
builtin_goal(_ = _).
builtin_goal(format(atom(_), _, _)).
builtin_goal(G) :- compound(G), functor(G, Op, 2), op_word(Op, _).

% --- Naming variables after concepts: V becomes n(Phrase, Concept) ---
% The head's value is named after the predicate. In the body, a goal P(S, O)
% names O after P and S after the type of P's subjects in the data. A name that
% is already taken is qualified by its subject: "organisation link".
name_clause((H :- B)) :-
    name_value(H),
    name_body(B, H-B),
    term_variables(H-B, Vs),
    name_rest(Vs).

name_value(G) :- compound(G), G =.. [P, _, V], var(V), !,
    noun_of(P, N), V = n(N, P).
name_value(_).

name_body((A, B), C) :- !, name_body(A, C), name_body(B, C).
% Out = Out0 passes a name on: the fresh variable takes its partner's name.
name_body(L = R, _) :- !,
    ( var(R), nonvar(L) -> R = L ; var(L), nonvar(R) -> L = R ; true ).
name_body(G, _) :- builtin_goal(G), !.
name_body(risk_weight(W, V), _) :- atom(W), var(V), !,
    noun_of(W, N), V = n(N, weight).
name_body(G, C) :- compound(G), G =.. [P, S, O], !,
    (   var(S) -> subject_noun(P, SN0, Ty), fresh_name(C, none, SN0, SN), S = n(SN, Ty) ; true ),
    (   var(O) -> object_noun(P, N0), fresh_name(C, S, N0, N), O = n(N, P) ; true ).
name_body(_, _).

object_noun(P, N) :- object(P, N), !.
object_noun(P, N) :- noun_of(P, N).

% What P's subjects are called: the lexicon's subject/2 if it says, otherwise
% read from P's own facts (repo/2 -> "repository").
subject_noun(P, N, none) :- subject(P, N), !.
subject_noun(P, N, Ty) :-
    functor(G, P, 2), catch(G, _, fail), arg(1, G, S), atomic(S),
    entity_type(S, Ty), !,
    noun_of(Ty, N).
subject_noun(_, it, none).

fresh_name(C, _, N, N) :- \+ name_used(C, N), !.
fresh_name(_, Q, N0, N) :- compound(Q), Q = n(QN, _), !, format(atom(N), "~w ~w", [QN, N0]).
fresh_name(_, _, N0, N) :- format(atom(N), "other ~w", [N0]).

name_used(T, N) :- compound(T),
    (   functor(T, n, 2), arg(1, T, N0), N0 == N -> true
    ;   T =.. [_|As], member(A, As), name_used(A, N) ).

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
% phrase_of(Entity, Text): "operator 'dope'"; bare types use the entity's own noun or itself.
phrase_of(E, T) :- number(E), !, num_text(E, T).
phrase_of(n(N, _), T) :- !, format(atom(T), "the ~w", [N]).
phrase_of(a(N, _), T) :- !, ( atom_codes(N, [C|_]), memberchk(C, "aeiou") -> A = an ; A = a ), format(atom(T), "~w ~w", [A, N]).
phrase_of(E, T) :-
    entity_type(E, Ty),
    (   bare(Ty) -> ( atom(E), noun(E, N) -> T = N ; format(atom(T), "~w", [E]) )
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

% "a", "a and b", "a, b and c"
join_and([], '').
join_and([X], X) :- !.
join_and([X, Y], T) :- !, connective(and, And), format(atom(T), "~w ~w ~w", [X, And, Y]).
join_and([X|Xs], T) :- join_and(Xs, R), format(atom(T), "~w, ~w", [X, R]).

as_sentence(T0, T) :- capitalise(T0, T1), atom_concat(T1, '.', T).

% --- Facts as sentences ---
% Relations:  "Subject Verb Object[, ArgVerb Extra]."
% Attributes: "The Noun of Subject is Value."
sentence(G, T) :- G =.. [P|Args], clause_text(P, Args, T0), as_sentence(T0, T).

clause_text(P, [X], T) :- !,
    phrase_of(P, S), edge_label(P, V), phrase_of(X, O),
    format(atom(T), "~w ~w ~w", [S, V, O]).
clause_text(P, [S, O|Extra], T) :- relation(P), !,
    phrase_of(S, ST), verb(P, V),
    extras(P, 3, Extra, XT),
    (   O = a(N, _), atom_concat(_, N, V)          % "has status", not "has status a status"
    ->  format(atom(T), "~w ~w~w", [ST, V, XT])
    ;   phrase_of(O, OT), format(atom(T), "~w ~w ~w~w", [ST, V, OT, XT]) ).
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
% "the repository is a sibling of the other repository when ..."
% A slot used only once is any value: "a feature" rather than "the feature".
rule_text(Named, T) :- indefinite(Named, N1), rule_text_(N1, T).

indefinite(Named, Out) :-
    findall(X, ( named_binding(Named, Named, b(N, C, _)), X = N-C ), All),
    findall(N-C, ( member(N-C, All), N \== it, findall(y, member(N-C, All), [_]) ), Once),
    once_slots(Named, Once, Out).

once_slots(T, _, T) :- ( var(T) ; atomic(T) ; string(T) ), !.
once_slots(T, Once, U) :- functor(T, n, 2), !,
    arg(1, T, N), arg(2, T, C),
    ( memberchk(N-C, Once) -> U = a(N, C) ; U = T ).
once_slots(T, Once, U) :-
    functor(T, F, A), functor(U, F, A), once_args(A, T, Once, U).
once_args(0, _, _, _) :- !.
once_args(K, T, Once, U) :- arg(K, T, X), arg(K, U, Y), once_slots(X, Once, Y), K1 is K - 1, once_args(K1, T, Once, U).

rule_text_((H :- B), T) :-
    H =.. [P, S, O], relation(P), !,
    verb(P, V), phrase_of(S, ST), phrase_of(O, OT),
    goal_texts(B, Cs), join_and(Cs, CT), connective(when, When),
    format(atom(T0), "~w ~w ~w ~w ~w", [ST, V, OT, When, CT]),
    as_sentence(T0, T).
rule_text_((H :- B), T) :-
    H =.. [P, _, V],
    noun_of(P, N),
    (   calc_goal(B, V, E)
    ->  expr_words(E, EW), format(atom(T0), "~w = ~w", [N, EW])
    ;   interpolation_goal(B, V, Tpl, As)
    ->  placeholders(As, Ps), format(atom(EW), Tpl, Ps), format(atom(T0), "~w = ~w", [N, EW])
    ;   conditions(B, Cs), Cs \== []
    ->  connective(when, When), join_and(Cs, CT),
        value_text(P, V, VT), copula(P, Is),
        format(atom(T0), "the ~w ~w ~w ~w ~w", [N, Is, VT, When, CT])
    ;   goal_texts(B, Cs), Cs \== []
    ->  H =.. [P|Args], clause_text(P, Args, HT), join_and(Cs, CT), connective(when, When),
        format(atom(T0), "~w ~w ~w", [HT, When, CT])
    ;   inputs(B, Is), join_and(Is, IT),
        format(atom(T0), "the ~w follows from ~w", [N, IT]) ), !,
    as_sentence(T0, T).

calc_goal((A, B), V, E) :- !, ( calc_goal(A, V, E) -> true ; calc_goal(B, V, E) ).
calc_goal(X is E, V, E) :- X == V.

interpolation_goal((A, B), V, Tpl, As) :- !,
    ( interpolation_goal(A, V, Tpl, As) -> true ; interpolation_goal(B, V, Tpl, As) ).
interpolation_goal(format(atom(X), Tpl, As), V, Tpl, As) :- X == V.

% Named arguments become {placeholders}; literal arguments stay as they are.
placeholders([], []).
placeholders([n(N, _)|As], [P|Ps]) :- !, format(atom(P), "{~w}", [N]), placeholders(As, Ps).
placeholders([A|As], [A|Ps]) :- placeholders(As, Ps).

conditions((A, B), Cs) :- !, conditions(A, CA), conditions(B, CB), append(CA, CB, Cs).
conditions(G, [T]) :-
    G =.. [Op, A, B], op_word(Op, W), !,
    expr_words(A, AT), expr_words(B, BT),
    format(atom(T), "~w ~w ~w", [AT, W, BT]).
conditions(_, []).

% Body goals of a relation rule, as clauses about the named variables.
goal_texts((A, B), Ts) :- !, goal_texts(A, TA), goal_texts(B, TB), append(TA, TB, Ts).
goal_texts(G, [T]) :- G =.. [Op, A, B], op_word(Op, W), !,
    phrase_of(A, AT), phrase_of(B, BT), format(atom(T), "~w ~w ~w", [AT, W, BT]).
goal_texts(G, []) :- builtin_goal(G), !.
goal_texts(G, [T]) :- G =.. [P|Args], clause_text(P, Args, T).

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
    (   number(V) -> value_text(C, V, VT), format(atom(T), "~w (~w)", [N, VT])
    ;   format(atom(T), "~w '~w'", [N, V]) ).
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
calc_text(format(atom(X), _, Vs), format(atom(n(N, C)), _, Ns), T) :- !,
    connective(built, K), connective(from, From),
    arg_values(Ns, Vs, Parts), join_and(Parts, PT),
    value_text(C, X, XT),
    format(atom(T), "~w ~w = ~w ~w ~w", [K, N, XT, From, PT]).
calc_text(G, NG, T) :-
    G =.. [Op, VA, VB], NG =.. [Op, NA, NB], op_word(Op, W), !,
    connective(checked, K),
    side_text(NA, VA, AT), side_text(NB, VB, BT),
    format(atom(T), "~w ~w ~w ~w", [K, AT, W, BT]).
calc_text(G, _, T) :- connective(checked, K), format(atom(T), "~w ~w", [K, G]).

arg_values([], [], []).
arg_values([NA|Ns], [VA|Vs], [T|Ts]) :- expr_values(NA, VA, T), arg_values(Ns, Vs, Ts).

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
body_lines(_ = _, _, builtin(_), _, []) :- !.
body_lines(G, NG, builtin(_), D, [line(D, calc, T)]) :- !, calc_text(G, NG, T).
body_lines(_, _, P, D, L) :- proof_lines(P, D, L).

line_kind(G, _, Severity) :- G =.. [P, _, V], flag(P, V, Severity), !.
line_kind(_, K, K).

severity(G, S) :- line_kind(G, none, S).

% Every rule clause of a derived predicate, in words.
rule_description(P, T) :- rule_clause(P, _, Named), rule_text(Named, T).

% rule_clause(P, I, Named): the I-th clause of derived predicate P, variables named.
rule_clause(P, I, Named) :-
    derived_predicate(P, A, _),
    functor(H, P, A),
    \+ \+ predicate_property(H, dynamic),   % see practice isolate_reflection
    findall((H :- B), clause(H, B), Cs),
    nth1(I, Cs, C),
    copy_term(C, Named),
    name_clause(Named).

% --- Which clause made a conclusion, and what its named variables stood for ---
% derivation(Proof, I, Bindings): a rule proof used clause I, and each named
% variable (its slot) took a value: Bindings = [Name-ValueText], head first.
derivation(rule(G, Body, Named, _), I, Bs) :-
    Body \== true,
    Named = (NH :- _), functor(NH, P, _),
    rule_clause(P, I, N2), N2 == Named, !,
    findall(N-T, ( named_binding(Named, (G :- Body), b(N, C, V)), N \== it, binding_text(C, V, T) ), Bs0),
    first_binding(Bs0, Bs).

% Walk the named clause and its instance side by side; a slot n(N, C) meets its value.
% Separate clauses with functor/3 and arg/3, not if-then-else or =.. (practice
% isolate_reflection): in Trealla both lose bindings when the walk backtracks.
named_binding(NT, IT, B) :-
    compound(NT), \+ string(NT), functor(NT, F, A),
    named_binding(F, A, NT, IT, B).
named_binding(n, 2, NT, IT, b(N, C, IT)) :- !,
    nonvar(IT), arg(1, NT, N), arg(2, NT, C).
named_binding(F, A, NT, IT, B) :-
    compound(IT), functor(IT, F, A),
    between(1, A, K), arg(K, NT, NA), arg(K, IT, IA),
    named_binding(NA, IA, B).

binding_text(C, V, T) :- number(V), !, value_text(C, V, T).
binding_text(_, V, V) :- atom(V), !.
binding_text(_, V, T) :- format(atom(T), "~w", [V]).

first_binding([], []).
first_binding([N-T|Bs], [N-T|Us]) :-
    findall(N1-T1, ( member(N1-T1, Bs), N1 \== N ), Rest),
    first_binding(Rest, Us).

% The slot names of a named clause, head first.
clause_slots(Named, Ns) :-
    findall(N, ( named_binding(Named, Named, b(N, _, _)), N \== it ), Ns0),
    dedupe(Ns0, Ns).

% --- A conclusion's clause with its values, and the query that asks for it again ---
% Out = Out0 checks (practice fresh_format) read as X = X and are left out.
instance_text((H :- B), Text) :-
    Opts = [quoted(true), double_quotes(true)],
    write_term_to_atom(HT, H, Opts),
    conj_list(B, Gs0),
    findall(G, ( member(G, Gs0), \+ ( nonvar(G), G = (L = R), L == R ) ), Gs),
    findall(GT, ( member(G, Gs), write_term_to_atom(GT, G, Opts) ), GTs),
    atomic_list_concat(GTs, ',\n    ', BT),
    format(atom(Text), "~w :-~n    ~w.", [HT, BT]).

% The head as written in clause_source/6 with its first argument set to this subject and
% the rest left as the file's variables: relies_on(explorer_ui, Dependency).
query_text(G, I, Q) :-
    functor(G, P, A),
    catch(clause_source(P, A, I, _, _, Text), _, fail),
    catch(read_term_from_atom(Text, Clause, [variable_names(Vs)]), _, fail),
    ( Clause = (H :- _) -> true ; H = Clause ),
    arg(1, H, S), arg(1, G, S0), ( var(S) -> S = S0 ; true ),
    name_variables(Vs, Names),
    write_term_to_atom(Q0, H, [quoted(true), double_quotes(true)]),
    unquote_all(Names, Q0, Q), !.
query_text(G, _, Q) :- write_term_to_atom(Q, G, [quoted(true)]).

name_variables([], []).
name_variables([N = V|Vs], Ns) :-
    ( var(V) -> V = N, Ns = [N|Ns1] ; Ns = Ns1 ),
    name_variables(Vs, Ns1).

% --- A named clause as Prolog, slots as variables: relies_on(Component, Dependency) :- ... ---
% Slots print as their variable names; the Out = Out0 pairs of practice fresh_format
% read as X = X and are left out. (Trealla's variable_names option only takes a list
% written out in the calling clause, so names are substituted in the text instead.)
clause_pattern(Named, Text) :-
    unname(Named, (H :- B), [], Map),
    goal_pattern(H, Map, HT),
    (   B == true
    ->  format(atom(Text), "~w.", [HT])
    ;   conj_list(B, Gs0),
        findall(G, ( member(G, Gs0), \+ ( G = (L = R), L == R ) ), Gs),
        findall(GT, ( member(G, Gs), goal_pattern(G, Map, GT) ), GTs),
        atomic_list_concat(GTs, ',\n    ', BT),
        format(atom(Text), "~w :-~n    ~w.", [HT, BT]) ).

goal_pattern(G, Map, T) :-
    write_term_to_atom(T0, G, [quoted(true), double_quotes(true)]),
    findall(VN, member(_-VN, Map), VNs),
    unquote_all(['_'|VNs], T0, T).

unquote_all([], T, T).
unquote_all([VN|VNs], T0, T) :-
    format(atom(Q), "'~w'", [VN]), replace_all(T0, Q, VN, T1),
    unquote_all(VNs, T1, T).

replace_all(A, From, To, R) :-
    (   sub_atom(A, B, L, After, From)
    ->  sub_atom(A, 0, B, _, Pre), S is B + L, sub_atom(A, S, After, 0, Post),
        replace_all(Post, From, To, R1), atomic_list_concat([Pre, To, R1], R)
    ;   R = A ).

unname(T, V, M0, M) :- nonvar(T), T = n(N, C), !,
    (   N == it -> V = '_', M = M0
    ;   member(N1-V0, M0), N1 == N -> V = V0, M = M0
    ;   var_name(N, C, M0, V), M = [N-V|M0] ).
unname(T, T, M, M) :- ( atomic(T) ; string(T) ), !.
unname(T, U, M0, M) :- T =.. [F|As], unname_args(As, Us, M0, M), U =.. [F|Us].
unname_args([], [], M, M).
unname_args([A|As], [U|Us], M0, M) :- unname(A, U, M0, M1), unname_args(As, Us, M1, M).

% "soft credit limit" -> SoftCreditLimit; a name that starts with a digit uses its concept.
var_name(N, C, M, VN) :-
    camel(N, VN0),
    (   atom_codes(VN0, [D|_]), D >= 0'0, D =< 0'9, C \== none -> camel(C, VN1) ; VN1 = VN0 ),
    (   member(_-VN1, M) -> atom_concat(VN1, '2', VN) ; VN = VN1 ).

camel(A, C) :- atom_codes(A, Cs), camel_codes(Cs, true, Os), atom_codes(C, Os).
camel_codes([], _, []).
camel_codes([X|Xs], Up, Os) :-
    (   alnum(X)
    ->  ( Up == true -> upper_code(X, Y) ; Y = X ), Os = [Y|Os1], camel_codes(Xs, false, Os1)
    ;   camel_codes(Xs, true, Os) ).
alnum(X) :- ( X >= 0'a, X =< 0'z ; X >= 0'A, X =< 0'Z ; X >= 0'0, X =< 0'9 ), !.
upper_code(X, Y) :- X >= 0'a, X =< 0'z, !, Y is X - 32.
upper_code(X, X).

conj_list((A, B), Gs) :- !, conj_list(A, GA), conj_list(B, GB), append(GA, GB, Gs).
conj_list(G, [G]).
