% audit.pl — what is stated, what is derived, and where the same knowledge could be said in fewer symbols.
%
% Description length (minimum description length, MDL) is counted in symbols: a
% predicate name, an atom, a number or a variable is one symbol; a link, path or
% sentence counts one per word-like segment, so repeated text shows. A fact costs its
% symbols, a rule clause the symbols of its head and body. Generated facts are free
% (the repository records them) and derived facts are what the rules save.
%
%   api(audit(Role)) — totals, relations and their clauses, and compression candidates
%
% Candidates instantiate rule-mining templates: KGist-style class rules with
% exceptions, Metagol's identity, inverse and chain metarules, Stitch-style shared
% templates and invented predicates. Each is checked against the data, so it derives
% exactly the facts it would replace apart from its listed exceptions, and is scored
% saving = symbols of those facts − symbols it adds. kb/plan.lp chooses among them.

% --- Symbols ---
% Rules the audit's tiles show as written (clause/2 reads only dynamic predicates).
:- dynamic(implementation_costs/1).
:- dynamic(generator_cost/2).
:- dynamic(written_cost/4).
:- dynamic(size_threshold/3).
:- dynamic(totals/3).
:- dynamic(kind_totals/4).
:- dynamic(lexicon_entries/1).
:- dynamic(facts_symbols/2).
:- dynamic(clause_symbols/2).
:- dynamic(mdl_total_text/2).
:- dynamic(mdl_role/2).

symbols(T, 1) :- var(T), !.
symbols(T, 1) :- number(T), !.
symbols(T, 1) :- compound(T), T = '$VAR'(N), integer(N), !.   % a numbered variable
symbols(T, N) :- atom(T), !, segments(T, N).
symbols(T, N) :- string(T), !, atom_chars(A, T), segments(A, N).
symbols(T, N) :- is_list(T), !, sum_symbols(T, 0, N).
symbols(T, N) :- T =.. [_|As], sum_symbols(As, 1, N).

sum_symbols([], N, N).
sum_symbols([X|Xs], N0, N) :- symbols(X, S), N1 is N0 + S, sum_symbols(Xs, N1, N).

% A name is one symbol; text (with spaces, dots, slashes, ...) is one per segment.
segments(A, N) :-
    atom_codes(A, Cs),
    (   member(C, Cs), text_mark(C)
    ->  segment_count(Cs, false, 0, N0), N is max(1, N0)
    ;   N = 1 ).

text_mark(C) :- memberchk(C, [32, 0'., 0'/, 0':, 0'@, 0'?, 0'=, 0'&]).
separator(C) :- ( text_mark(C) ; C =:= 0'- ; C =:= 0'_ ), !.

segment_count([], _, N, N).
segment_count([C|Cs], In, N0, N) :-
    (   separator(C) -> segment_count(Cs, false, N0, N)
    ;   In == true -> segment_count(Cs, true, N0, N)
    ;   N1 is N0 + 1, segment_count(Cs, true, N1, N) ).

% A clause's symbols. Out = Out0 renamings (practice fresh_format) are not counted.
clause_symbols((H :- B), N) :-
    symbols(H, NH), conj_list(B, Gs),
    findall(S, ( member(G, Gs), G \== true, \+ renaming(G), symbols(G, S) ), Ss),
    sum_list(Ss, NB), N is NH + NB.

renaming(L = R) :- var(L), var(R).

facts_symbols(Fs, N) :- findall(S, ( member(F, Fs), symbols(F, S) ), Ss), sum_list(Ss, N).

% --- What there is ---
% audit_relation(Role, P, A, Domain, Kind): Kind = stated | generated | imported | derived.
audit_relation(Role, P, A, D, K) :-
    kb_predicate(P, A, D), role_domain(Role, D),
    relation_kind(P, K).
audit_relation(Role, P, A, D, derived) :-
    derived_predicate(P, A, D), role_domain(Role, D).

relation_facts(P, A, Fs) :- functor(F, P, A), findall(F, catch(F, _, fail), Fs0), sort(Fs0, Fs).

raw_clauses(P, A, Cs) :-
    functor(H, P, A), \+ \+ predicate_property(H, dynamic),   % practice isolate_reflection
    findall((H :- B), clause(H, B), Cs).

% The facts one clause derives on its own.
clause_facts((H :- B), Fs) :-
    copy_term((H :- B), (H1 :- B1)),
    findall(H1, catch(B1, _, fail), Fs0), sort(Fs0, Fs).

% rel(P, A, Domain, Kind, Facts) for every relation the role sees: computed once per audit.
audit_rels(Role, Rels) :-
    findall(rel(P, A, D, K, Fs), ( audit_relation(Role, P, A, D, K), relation_facts(P, A, Fs) ), Rels).

rel_pairs(rel(_, 2, _, _, Fs), Ps) :- findall(S-O, ( member(F, Fs), F =.. [_, S, O] ), Ps0), sort(Ps0, Ps).

% Which relations a derived relation's clauses read, and what that reaches.
rel_uses(Q, R) :-
    derived_predicate(Q, A, _), raw_clauses(Q, A, Cs),
    member((_ :- B), Cs), conj_list(B, Gs), member(G, Gs),
    callable(G), \+ builtin_goal(G), \+ G = (\+ _), functor(G, R, _).

reaches(From, To) :- reach([From], [], To).
reach([X|_], _, To) :- X == To, !.
reach([X|Xs], Seen, To) :- memberchk(X, Seen), !, reach(Xs, Seen, To).
reach([X|Xs], Seen, To) :- findall(R, rel_uses(X, R), Rs), append(Xs, Rs, Next), reach(Next, [X|Seen], To).

% --- Relations and their clauses ---
relation_json(Rels, rel(P, A, D, K, Fs), obj([id-P, arity-A, domain-D, label-L, kind-K, facts-N, symbols-S|Rest])) :-
    edge_label(P, L), length(Fs, N), facts_symbols(Fs, S),
    ( K == derived -> derived_json(Rels, P, A, S, Rest) ; Rest = [] ).

% Per clause: its symbols, the facts it derives, and how many only it derives.
derived_json(_, P, A, Derived, [clauses-arr(Js), rule_symbols-RS, saving-Saving, reads-arr(Reads)]) :-
    raw_clauses(P, A, Cs),
    findall(I-CS-CF, ( nth1(I, Cs, C), clause_symbols(C, CS), clause_facts(C, CF) ), Stats),
    findall(obj([clause-I, symbols-CS, facts-NF, only-NO]),
            ( member(I-CS-CF, Stats), length(CF, NF),
              findall(F, ( member(J-_-JF, Stats), J \== I, member(F, JF) ), Others),
              subtract(CF, Others, Only), length(Only, NO) ),
            Js),
    findall(CS, member(_-CS-_, Stats), CSs), sum_list(CSs, RS),
    Saving is Derived - RS,
    findall(R, rel_uses(P, R), Reads0), sort(Reads0, Reads).

% --- Lexicon ---
lexicon_entries(Es) :-
    findall(E, ( primitive(P, A), functor(E, P, A), catch(E, _, fail) ), Es).

% --- Compression templates ---
compression(class_value).
compression(identity).
compression(inverse).
compression(subsumes).
compression(chain).
compression(interpolation).
compression(shared_conjunction).
compression(lexicon_default).
compression(dead_clause).

purpose(class_value, 'to state a value once for a whole class when its members share it, listing any members that do not').
purpose(identity, 'to derive a relation from another that holds exactly the same pairs').
purpose(inverse, 'to derive a relation from another that holds the same pairs reversed').
purpose(subsumes, 'to derive the part of a relation that another stated relation already holds').
purpose(chain, 'to derive a relation by following two others, when that path gives exactly its pairs').
purpose(interpolation, 'to build text values from one template and values stated one step away').
purpose(shared_conjunction, 'to name two conditions that several rules repeat as a new primitive').
purpose(lexicon_default, 'to drop a lexicon word that says what the default from the name already says').
purpose(dead_clause, 'to remove a rule clause that derives nothing').

% --- Compression candidates ---
% cand(Kind, Head, Body, Covers, Clauses, Exceptions, Extra, Alternatives)
%   Head: the relation it would derive (or the new primitive); Body: relations it reads;
%   Covers: Item-Symbols for what it makes redundant (stated facts, clauses, words, or
%   the uses a new primitive shortens); Clauses: the suggested rule, with 'X', 'Y', ...
%   standing for variables; Exceptions: members it must leave out; Extra: symbols of
%   exception facts and new words; Alternatives: other bodies that would do as well.
%   saving = Σ Covers − symbols of Clauses − Extra.

weighted(Fs, Ws) :- findall(F-W, ( member(F, Fs), symbols(F, W) ), Ws).

% 1. Class-implied value (KGist): the members of a class share P's value.
%    access(E, signed_in) :- answers_with(E, _).  Class members without that value are
%    exceptions: those stated otherwise are skipped by \+ (P(X, O), O \== c); the rest
%    need an exception fact each.
class_candidates(Rels, Cands) :-
    findall(Q-QA-Col-Set, ( member(rel(Q, QA, _, _, QFs), Rels), QA =< 2,
                            between(1, QA, Col), column(QFs, Col, Set), Set = [_, _|_] ), Classes),
    findall(Best, ( member(rel(P, 2, _, stated, Fs), Rels), Fs = [_, _|_],
                    member(Col, [1, 2]), Other is 3 - Col,
                    column(Fs, Col, Values), member(C, Values),
                    findall(F, ( member(F, Fs), arg(Col, F, C1), C1 == C ), Group), Group = [_, _|_],
                    column(Group, Other, Members),
                    findall(Cand, ( member(Q-QA-QCol-Set, Classes), Q \== P, \+ reaches(Q, P),
                                    class_candidate(P, Fs, Col, C, Group, Members, Q, QA, QCol, Set, Cand) ),
                            Found),
                    best_of(Found, Best) ),
            Cands).

class_candidate(P, Fs, Col, C, Group, Members, Q, QA, QCol, Set,
                cand(class_value, P, [Q], Covers, [(Head :- Body)], Exc, Extra, [])) :-
    ord_subset_(Members, Set),
    subtract(Set, Members, Rest), length(Rest, NR), length(Members, NM), NR * 2 =< NM,
    Other is 3 - Col,
    findall(X, ( member(X, Rest), stated_otherwise(Fs, Other, X) ), Otherwise),
    subtract(Rest, Otherwise, Exc),
    head_with(P, Col, C, Head),
    functor(QG, Q, QA), fill_args(QG, QCol, 'X'),
    (   Otherwise == [] -> G1 = []
    ;   head_with(P, Col, 'O', OG), G1 = [\+ (OG, 'O' \== C)] ),
    (   Exc == [] -> G2 = []
    ;   atom_concat(P, '_exception', PE), EG =.. [PE, 'X'], G2 = [\+ EG] ),
    append([[QG], G1, G2], Goals), list_conj(Goals, Body),
    weighted(Group, Covers),
    length(Exc, NE), ( NE > 0 -> Extra is NE * 2 + 3 ; Extra = 0 ).   % exception facts and a word

stated_otherwise(Fs, Other, X) :- member(F, Fs), arg(Other, F, X1), X1 == X, !.

head_with(P, 2, C, H) :- H =.. [P, 'X', C].
head_with(P, 1, C, H) :- H =.. [P, C, 'X'].

fill_args(G, Col, V) :- G =.. [_|As], fill(As, 1, Col, V).
fill([], _, _, _).
fill([A|As], I, Col, V) :- ( I =:= Col -> A = V ; A = '_' ), I1 is I + 1, fill(As, I1, Col, V).

column(Fs, Col, Set) :- findall(X, ( member(F, Fs), arg(Col, F, X), atom(X) ), Xs), sort(Xs, Set).

ord_subset_([], _).
ord_subset_([X|Xs], Ys) :- memberchk(X, Ys), ord_subset_(Xs, Ys).

list_conj([G], G) :- !.
list_conj([G|Gs], (G, B)) :- list_conj(Gs, B).

% 2. Same pairs (Metagol identity and inverse): P holds exactly Q's pairs, or Q's pairs
%    reversed; or a stated Q holds all of P's pairs and more, so those follow from P.
pair_candidates(Rels, Cands) :-
    findall(Cand, ( member(RP, Rels), RP = rel(P, 2, _, stated, Fs), Fs = [_, _|_], rel_pairs(RP, PP),
                    member(RQ, Rels), RQ = rel(Q, 2, _, QK, QFs), Q \== P, rel_pairs(RQ, QP),
                    pair_candidate(P, Fs, PP, Q, QK, QFs, QP, Cand) ),
            Cands).

pair_candidate(P, Fs, PP, Q, _, _, QP, cand(identity, P, [Q], Covers, [(H :- B)], [], 0, [])) :-
    PP == QP, \+ reaches(Q, P),
    H =.. [P, 'X', 'Y'], B =.. [Q, 'X', 'Y'], weighted(Fs, Covers).
pair_candidate(P, Fs, PP, Q, _, _, QP, cand(inverse, P, [Q], Covers, [(H :- B)], [], 0, [])) :-
    findall(O-S, member(S-O, QP), RQ0), sort(RQ0, RQ), PP == RQ, \+ reaches(Q, P),
    H =.. [P, 'X', 'Y'], B =.. [Q, 'Y', 'X'], weighted(Fs, Covers).
pair_candidate(P, _, PP, Q, stated, QFs, QP, cand(subsumes, Q, [P], Covers, [(H :- B)], [], 0, [])) :-
    PP \== QP, ord_subset_(PP, QP),
    findall(F, ( member(F, QFs), F =.. [_, S, O], memberchk(S-O, PP) ), Covered),
    H =.. [Q, 'X', 'Y'], B =.. [P, 'X', 'Y'], weighted(Covered, Covers).

% 3. Chain (Metagol chain, AMIE paths): following two relations gives exactly P's pairs.
%    p(X, Y) :- q(X, Z), r(Z, Y), either relation possibly read backwards.
chain_candidates(Rels, Cands) :-
    edges(Rels, Edges),
    findall(Cand, ( member(RP, Rels), RP = rel(P, 2, _, stated, Fs), Fs = [_, _|_], rel_pairs(RP, PP),
                    PP = [X0-Y0|_],
                    findall(Q1/D1/Q2/D2, ( step(Edges, Q1, D1, X0, Z), Z \== X0, Q1 \== P,
                                           step(Edges, Q2, D2, Z, Y0), Q2 \== P ), Patterns0),
                    sort(Patterns0, Patterns),
                    member(Q1/D1/Q2/D2, Patterns),
                    \+ reaches(Q1, P), \+ reaches(Q2, P),
                    composition(Edges, Q1, D1, Q2, D2, PP),
                    chain_clause(P, Q1, D1, Q2, D2, Clause),
                    weighted(Fs, Covers),
                    Cand = cand(chain, P, [Q1, Q2], Covers, [Clause], [], 0, []) ),
            Cands0),
    best_per_head(Cands0, Cands).

edges(Rels, Edges) :- findall(Q-Ps, ( member(R, Rels), R = rel(Q, 2, _, _, _), rel_pairs(R, Ps) ), Edges).

% One step along a relation, forwards or backwards.
step(Edges, Q, fwd, X, Y) :- member(Q-Ps, Edges), member(X-Y, Ps).
step(Edges, Q, bwd, X, Y) :- member(Q-Ps, Edges), member(Y-X, Ps).

composition(Edges, Q1, D1, Q2, D2, PP) :-
    findall(X-Y, ( step(Edges, Q1, D1, X, Z), step(Edges, Q2, D2, Z, Y) ), C0),
    sort(C0, C), C == PP.

chain_clause(P, Q1, D1, Q2, D2, (H :- (B1, B2))) :-
    H =.. [P, 'X', 'Y'],
    ( D1 == fwd -> B1 =.. [Q1, 'X', 'Z'] ; B1 =.. [Q1, 'Z', 'X'] ),
    ( D2 == fwd -> B2 =.. [Q2, 'Z', 'Y'] ; B2 =.. [Q2, 'Y', 'Z'] ).

% 4. Interpolation (Stitch-style shared template): text values built from one template
%    and values one step away.  inbox(M, U) :- email_domain(M, D), format(atom(U), 'https://mail.~w/', [D]).
%    The rule is run over every subject its first relation has; values it would get
%    wrong or add are exceptions.
interpolation_candidates(Rels, Cands) :-
    edges(Rels, Edges),
    findall(P-Key-F, ( member(rel(P, 2, _, stated, Fs), Rels), member(F, Fs), F =.. [_, S, V],
                       atom(S), atom(V), segments(V, NV), NV >= 2,
                       template_of(Edges, P, S, V, Key) ), Keyed),
    findall(P-Key, member(P-Key-_, Keyed), Keys0), sort(Keys0, Keys),
    findall(Cand, ( member(P-Key, Keys),
                    findall(F, ( member(P1-K1-F, Keyed), P1 == P, K1 == Key ), Group),
                    Key = Tpl-Sources,
                    \+ ( member(Q/_, Sources), reaches(Q, P) ),
                    interpolation_candidate(Edges, Rels, P, Tpl, Sources, Group, Cand) ),
            Cands).

% Key = Template-Sources: where each ~w comes from, in order: self (the subject) or
% Q/fwd, Q/bwd (a value one step away). At least one must be a relation to range over.
template_of(Edges, P, S, V, Tpl-Sources) :-
    findall(Len-Piece-Src, ( piece(Edges, P, S, V, Piece, Src), atom_length(Piece, Len), Len >= 3 ), Ps0),
    sort(0, @>=, Ps0, Ps),
    place(Ps, V, [], Placed),
    memberchk(_-_-_-(_/_), Placed),
    sort(Placed, ByPos),
    build_template(ByPos, V, 0, Parts, Sources),
    atomic_list_concat(Parts, Tpl).

piece(_, _, S, V, S, self) :- sub_atom(V, _, _, _, S).
piece(Edges, P, S, V, H, Q/D) :-
    step(Edges, Q, D, S, H), Q \== P, atom(H), H \== V, sub_atom(V, _, _, _, H).

% Longest pieces first, each at its first free position.
place([], _, Placed, Placed).
place([_-Piece-Src|Ps], V, Acc, Placed) :-
    (   sub_atom(V, B, L, _, Piece), E is B + L,
        \+ ( member(B1-E1-_-_, Acc), B < E1, B1 < E )
    ->  place(Ps, V, [B-E-Piece-Src|Acc], Placed)
    ;   place(Ps, V, Acc, Placed) ).

build_template([], V, At, [Tail], []) :- sub_atom(V, At, _, 0, Tail).
build_template([B-E-_-Src|Ps], V, At, [Lit, '~w'|Parts], [Src|Srcs]) :-
    L is B - At, sub_atom(V, At, L, _, Lit),
    build_template(Ps, V, E, Parts, Srcs).

interpolation_candidate(Edges, Rels, P, Tpl, Sources, Group,
                        cand(interpolation, P, Body, Covers, [Clause], Exc, Extra, [])) :-
    findall(Q, member(Q/_, Sources), Body0), sort(Body0, Body),
    interpolation_clause(P, Tpl, Sources, Clause),
    memberchk(rel(P, 2, _, _, PFs), Rels),
    findall(S-V, ( member(F, PFs), F =.. [_, S, V] ), Stated),
    memberchk(Q1/D1, Sources),
    findall(S, step(Edges, Q1, D1, S, _), Subjects0), sort(Subjects0, Subjects),
    findall(S-V, ( member(S, Subjects), apply_template(Edges, S, Tpl, Sources, V) ), Made0),
    sort(Made0, Made),
    findall(F, ( member(F, Group), F =.. [_, S, V], memberchk(S-V, Made) ), Covered), Covered \== [],
    findall(S, ( member(S-V, Made), \+ memberchk(S-V, Stated) ), Exc0), sort(Exc0, Exc),
    weighted(Covered, Covers),
    length(Exc, NE), ( NE > 0 -> Extra is NE * 2 + 3 ; Extra = 0 ).

apply_template(Edges, S, Tpl, Sources, V) :-
    hole_values(Edges, S, Sources, Vs),
    catch(format(atom(V0), Tpl, Vs), _, fail), V = V0.

hole_values(_, _, [], []).
hole_values(Edges, S, [self|Ss], [S|Vs]) :- hole_values(Edges, S, Ss, Vs).
hole_values(Edges, S, [Q/D|Ss], [H|Vs]) :- step(Edges, Q, D, S, H), hole_values(Edges, S, Ss, Vs).

interpolation_clause(P, Tpl, Sources, (H :- Body)) :-
    H =.. [P, 'S', 'V'],
    hole_goals(Sources, 1, Goals, Args),
    append(Goals, [format(atom('V'), Tpl, Args)], All),
    list_conj(All, Body).

hole_goals([], _, [], []).
hole_goals([self|Ss], I, Gs, ['S'|As]) :- hole_goals(Ss, I, Gs, As).
hole_goals([Q/D|Ss], I, [G|Gs], [VN|As]) :-
    format(atom(VN0), "H~w", [I]), VN = VN0,
    ( D == fwd -> G =.. [Q, 'S', VN] ; G =.. [Q, VN, 'S'] ),
    I1 is I + 1, hole_goals(Ss, I1, Gs, As).

% 5. Shared conjunction (predicate invention, babble/Stitch scoring): two conditions
%    several rule clauses repeat become one new primitive. Each use of n sites saves
%    size − (1 + vars); defining it costs size + 1 + vars, plus a word.
conjunction_candidates(Role, Cands) :-
    findall(Key-(P/I), ( derived_predicate(P, A, D), role_domain(Role, D), raw_clauses(P, A, Cs),
                         nth1(I, Cs, (_ :- B)), conj_list(B, Gs),
                         append(_, [G1|Rest], Gs), member(G2, Rest),
                         user_goal(G1), user_goal(G2),
                         term_variables(G1, V1), term_variables(G2, V2), shares(V1, V2),
                         copy_term(G1-G2, Key), numbervars(Key, 0, _) ), Uses0),
    sort(Uses0, Uses),
    findall(Key, member(Key-_, Uses), Keys0), sort(Keys0, Keys),
    findall(cand(shared_conjunction, Name, Heads, Covers, [(H :- (G1, G2))], [], 3, []),
            ( member(Key, Keys),
              findall(P/I, member(Key-(P/I), Uses), Sites), Sites = [_, _|_],
              findall(P, member(P/_, Sites), Heads0), sort(Heads0, Heads),
              Key = (G1-G2), functor(G1, F1, _), functor(G2, F2, _),
              format(atom(Name0), "~w_and_~w", [F1, F2]), Name = Name0,
              findall(V, numbered_in(V, G1-G2), Vs0), sort(Vs0, Vs),
              H =.. [Name|Vs],
              symbols((G1, G2), S0), Size is S0 - 1, length(Vs, NV),
              Gain is Size - (1 + NV),
              findall(site(P, I)-Gain, member(P/I, Sites), Covers) ),
            Cands).

user_goal(G) :- callable(G), \+ builtin_goal(G), \+ G = (\+ _), \+ G = (_ = _).
shares(V1, V2) :- member(X, V1), member(Y, V2), X == Y, !.

numbered_in(V, T) :- compound(T), T = '$VAR'(_), !, V = T.
numbered_in(V, T) :- compound(T), T =.. [_|As], member(A, As), numbered_in(V, A).

% 6. Lexicon entries that say what the default from the name already says.
lexicon_candidates(Cands) :-
    findall(cand(lexicon_default, noun, [], [noun(X, N)-W], [], [], 0, []),
            ( noun(X, N), atom(X), humanise(X, H), H == N, symbols(noun(X, N), W) ), Cands).

% 7. Rule clauses that derive nothing.
dead_candidates(Role, Cands) :-
    findall(cand(dead_clause, P, [], [clause(P, I)-W], [], [], 0, []),
            ( derived_predicate(P, A, D), role_domain(Role, D), raw_clauses(P, A, Cs),
              nth1(I, Cs, C), clause_facts(C, []), clause_symbols(C, W) ),
            Cands).

% Several bodies can imply the same facts: keep the one that saves most, note the others.
best_of(Cs, Best) :-
    Cs \== [],
    findall(S-C, ( member(C, Cs), cand_saving(C, S) ), Scored),
    sort(0, @>=, Scored, [_-cand(K, H, Bd, Cv, Cl, Ex, X, _)|Others]),
    findall(B, member(_-cand(_, _, B, _, _, _, _, _), Others), Alts),
    Best = cand(K, H, Bd, Cv, Cl, Ex, X, Alts).

best_per_head(Cs, Best) :-
    findall(H, member(cand(_, H, _, _, _, _, _, _), Cs), Hs0), sort(Hs0, Hs),
    findall(B, ( member(H, Hs),
                 findall(C, ( member(C, Cs), C = cand(_, H1, _, _, _, _, _, _), H1 == H ), HC),
                 best_of(HC, B) ),
            Best).

cand_saving(cand(_, _, _, Covers, Clauses, _, Extra, _), Saving) :-
    findall(W, member(_-W, Covers), Ws), sum_list(Ws, CS),
    cand_cost(Clauses, Extra, Cost),
    Saving is CS - Cost.

cand_cost(Clauses, Extra, Cost) :-
    findall(S, ( member(C, Clauses), clause_symbols(C, S) ), Ss), sum_list(Ss, RS),
    Cost is RS + Extra.

all_candidates(Role, Rels, Cands) :-
    class_candidates(Rels, C1),
    pair_candidates(Rels, C2),
    chain_candidates(Rels, C3),
    interpolation_candidates(Rels, C4),
    conjunction_candidates(Role, C5),
    lexicon_candidates(C6),
    dead_candidates(Role, C7),
    append([C1, C2, C3, C4, C5, C6, C7], Cands).

% --- As JSON for api(audit(Role)) ---
% Candidates that pay come first; near misses (saving above -6) show what almost does.
api_term(audit(Role), obj([problem-'unknown role'])) :- \+ role(Role), !.
api_term(audit(Role), obj([totals-obj(Totals), relations-arr(RJs), kinds-arr(Kinds),
                           candidates-arr(CJs), reads-arr(Reads), implementations-arr(Is), measures-arr(Ms)])) :-
    implementation_costs(Is),
    audit_rels(Role, Rels),
    findall(J, ( member(R, Rels), relation_json(Rels, R, J) ), RJs),
    totals(Rels, Is, Totals),
    findall(M, measure_json(Totals, M), Ms),
    all_candidates(Role, Rels, Cands),
    findall(S-C, ( member(C, Cands), cand_saving(C, S), S > -6 ), Scored0),
    sort(0, @>=, Scored0, Scored),
    findall(J, ( nth1(I, Scored, S-C), candidate_json(I, S, C, J) ), CJs),
    findall(obj([id-K, label-L, description-T]),
            ( compression(K), label_of(K, L), purpose(K, P0), plain(P0, T) ), Kinds),
    findall(obj([relation-P, reads-Q]),
            ( derived_predicate(P, _, D), role_domain(Role, D), rel_uses(P, Q) ), Reads0),
    sort(Reads0, Reads).

% --- Why a snippet is red, yellow or green ---
% Code that generates or imports facts is a model of those facts, so minimum description length
% judges it against them (two-part MDL, as in library learning: an abstraction pays while it is
% shorter than what it replaces). Its band is its size as a share of theirs: green up to the first
% share, yellow up to the second, red beyond, where stating the facts by hand would be shorter.
generator_band(green, 0.5).
generator_band(yellow, 1.0).

% Code a person writes for a capability has no facts to weigh against, so it is banded against
% this code base's own spread (the quantile thresholds of Alves, Ypma and Visser 2010, taken over
% its snippets): green while no larger than the first percentage of snippets, yellow up to the
% second, red when larger than that.
size_band(green, 70).
size_band(yellow, 90).

band(red).
band(yellow).
band(green).

% The code behind generated and imported facts (one entry per generating statement, with every
% fact it produces) and behind the capabilities, endpoints and tools (code_symbols/3 counted by
% lib/kb-source.ts), largest first, each with its band and why.
implementation_costs(Is) :-
    findall(F-L-T, catch(generator_code(_, F, L, T), _, fail), GS0), sort(GS0, GSs),
    findall(C-J, ( member(F-L-T, GSs), generator_cost(F-L-T, C-J) ), Gs),
    findall(F-L-T, catch(generated_origin(implemented_in(_, F), F, L, T), _, fail), WS0), sort(WS0, WSs),
    findall(C, ( member(F-L-_, WSs), once(catch(code_symbols(F, L, C), _, fail)) ), Sizes),
    size_band(green, VG), size_band(yellow, VY),
    size_threshold(Sizes, VG, TG), size_threshold(Sizes, VY, TY),
    findall(C-J, ( member(F-L-T, WSs), written_cost(F-L-T, TG-VG, TY-VY, C-J) ), Ws),
    append(Gs, Ws, All),
    sort(0, @>=, All, Sorted),
    findall(J, member(_-J, Sorted), Is).

% A generating statement: its code against the symbols of every fact it produces.
generator_cost(F-L-T, C-obj([kind-generator, id-Id, file-F, line-L, symbols-C, facts-N, fact_symbols-FS, band-B, reason-Why, text-T])) :-
    once(catch(code_symbols(F, L, C), _, fail)),
    findall(P, catch(generator_code(P, F, L, _), _, fail), Ps0), sort(Ps0, Ps),
    atomic_list_concat(Ps, ', ', Id),
    findall(G, ( member(P, Ps), ( catch(generated_predicate(P, A), _, fail) ; catch(imported_predicate(P, A), _, fail) ),
                 functor(G, P, A), catch(G, _, fail) ), Facts),
    length(Facts, N), facts_symbols(Facts, FS),
    (   FS =:= 0
    ->  B = red, format(atom(Why0), "it produces no facts, so stating nothing would be shorter", [])
    ;   Share is C / FS,
        ( generator_band(B0, Max), Share =< Max -> B = B0 ; B = red ),
        ( FS >= C -> Times is FS / C, Way = smaller ; Times is C / FS, Way = larger ),
        format(atom(Why0), "its ~w facts would take ~w symbols to state; this code takes ~w, ~2f of their size (~1fx ~w)", [N, FS, C, Share, Times, Way])
    ),
    Why = Why0.

% A hand-written snippet against the sizes no larger than the first and second percentages of snippets.
written_cost(F-L-T, TG-VG, TY-VY, C-obj([kind-implementation, id-Id, file-F, line-L, symbols-C, band-B, reason-Why, text-T])) :-
    once(catch(code_symbols(F, L, C), _, fail)),
    findall(I, catch(generated_origin(implemented_in(I, F), F, L, _), _, fail), Ids0), sort(Ids0, Ids),
    atomic_list_concat(Ids, ', ', Id),
    (   C =< TG -> B = green, format(atom(Why0), "~w symbols: no larger than ~w% of the hand-written snippets (up to ~w symbols)", [C, VG, TG])
    ;   C =< TY -> B = yellow, format(atom(Why0), "~w symbols: larger than ~w% of the hand-written snippets (~w) but no larger than ~w% (~w)", [C, VG, TG, VY, TY])
    ;   B = red, format(atom(Why0), "~w symbols: larger than ~w% of the hand-written snippets (above ~w symbols)", [C, VY, TY])
    ),
    Why = Why0.

% size_threshold(Sizes, Percent, Size): the size no smaller than Percent of the sizes (nearest rank).
size_threshold([], _, 0) :- !.
size_threshold(Sizes, Percent, T) :-
    sort(0, @=<, Sizes, Ascending), length(Ascending, N),
    K is max(1, ceiling(Percent * N / 100)), nth1(K, Ascending, T0), T = T0.

% --- The audit in minimum description length terms ---
% Description length is L(model) + L(data | model), where the bar reads "given": the length of
% describing the data for a reader who already has the model. Each tile has its role in that sum.
mdl_role(rules, model).
mdl_role(lexicon, model).
mdl_role(implementations, model).
mdl_role(stated, data).
mdl_role(derived, explained).
mdl_role(generated, explained_by_code).
mdl_role(imported, explained_by_code).

% "In minimum description length terms, it is part of the model, so L(model) counts it."
role_sentence(M, S) :-
    mdl_role(M, R), connective(mdl_terms, In), connective(R, Phrase),
    format(atom(S0), "~w, ~w.", [In, Phrase]), capitalise(S0, S1), S = S1.

% The description length tile, with this audit's numbers.
mdl_total_text(Totals, T) :-
    total_of(Totals, rules, RS), total_of(Totals, lexicon, LS), total_of(Totals, implementations, CS),
    total_of(Totals, stated, SS),
    memberchk(now-Now, Totals), memberchk(without_rules-W, Totals),
    Model is RS + LS + CS, Saved is W - Now,
    noun_of(stated, SN), noun_of(derived, DN), label_of(derived, DL), noun_of(generated, GN), noun_of(imported, IN),
    format(atom(T0), "Description length is L(model) + L(data | model). The bar | reads “given”: L(data | model) is the length of describing the data for a reader who already has the model. Here the model is the rules (~w symbols), the lexicon (~w) and the implementations (~w), ~w in all. The data given the model is what the model leaves unexplained, the ~w facts: ~w symbols. ~w, ~w and ~w facts follow from the model, so they add nothing. Without the rules every ~w fact would be ~w too, ~w symbols, so the rules save ~w.",
           [RS, LS, CS, Model, SN, SS, DL, GN, IN, DN, SN, W, Saved]),
    T = T0.

total_of(Totals, K, S) :- memberchk(K-obj(L), Totals), memberchk(symbols-S, L).

% --- What each tile of the audit counts, and the rules that count it ---
measure_rules(stated, [kind_totals/4, symbols/2]).
measure_rules(rules, [totals/3, clause_symbols/2]).
measure_rules(lexicon, [lexicon_entries/1, facts_symbols/2]).
measure_rules(derived, [kind_totals/4]).
measure_rules(generated, [kind_totals/4, generator_cost/2]).
measure_rules(imported, [kind_totals/4, generator_cost/2]).
measure_rules(implementations, [implementation_costs/1, generator_cost/2, written_cost/4, size_threshold/3]).
measure_rules(description_length, [totals/3, mdl_total_text/2, mdl_role/2]).

% What each tile counts, worded with the kinds' names (their labels in the lexicon).
measure_text(stated, T) :-
    noun_of(stated, S),
    format(atom(T0), "Every ~w fact in scope, in symbols: a name, number or variable is one symbol; a link or sentence one per word-like segment. This is what a person wrote, and what the audit tries to shrink.", [S]), T = T0.
measure_text(rules, T) :-
    noun_of(derived, D), noun_of(stated, S),
    format(atom(T0), "The rule clauses that work facts out, in symbols. What they save is the ~w facts, which would otherwise be ~w.", [D, S]), T = T0.
measure_text(lexicon, 'The words and primitives every label and explanation is built from, in symbols.').
measure_text(derived, T) :-
    noun_of(derived, D), noun_of(stated, S),
    format(atom(T0), "What the ~w facts would cost if each were ~w by hand instead of worked out by a rule.", [D, S]), T = T0.
measure_text(generated, T) :-
    noun_of(generated, G),
    format(atom(T0), "The ~w facts, read from this repository on every load, in symbols.", [G]), T = T0.
measure_text(imported, T) :-
    noun_of(imported, I),
    format(atom(T0), "The ~w facts, read from another system at a known time, in symbols; they go stale until read again.", [I]), T = T0.
measure_text(implementations, T) :-
    generator_band(green, G), generator_band(yellow, Y), size_band(green, VG), size_band(yellow, VY),
    format(atom(T0), "The code behind generated and imported facts and behind the capabilities, in symbols, not counting comments. Code that produces facts is green while it is at most ~w of the size of its facts, yellow up to ~w of it, and red beyond, where stating the facts would be shorter (minimum description length). Hand-written code is banded against this code base: green while no larger than ~w% of its snippets, yellow up to ~w%, red when larger (quantile thresholds, Alves, Ypma and Visser 2010).", [G, Y, VG, VY]),
    T = T0.

% Each measure with its text, its role in description length, and its rules as written
% (clause_source/6), for the tile's "i".
measure_json(Totals, obj([id-M, text-T, rules-arr(Rs)])) :-
    measure_rules(M, PAs),
    (   M == description_length -> mdl_total_text(Totals, T)
    ;   once(measure_text(M, Base)),
        ( role_sentence(M, S) -> format(atom(T0), "~w ~w", [Base, S]) ; T0 = Base ), T = T0 ),
    findall(obj([predicate-PA, file-F, line-L, text-Src]),
            ( member(P/A, PAs), format(atom(PA), "~w/~w", [P, A]), catch(clause_source(P, A, _, F, L, Src), _, fail) ), Rs).

% Description length counts the code too: generated and imported facts cost the code that reads
% them, and the capabilities the code that implements them (implementation_costs/1).
totals(Rels, Is, [stated-obj([facts-SN, symbols-SS]), generated-obj([facts-GN, symbols-GS]), imported-obj([facts-IN, symbols-IS]),
              derived-obj([facts-DN, symbols-DS]), rules-obj([clauses-RN, symbols-RS]),
              lexicon-obj([entries-LN, symbols-LS]),
              implementations-obj([snippets-IsN, symbols-CS, generators-GCS, capabilities-ICS|Banded]),
              now-Now, without_rules-Without]) :-
    kind_totals(Rels, stated, SN, SS),
    kind_totals(Rels, generated, GN, GS),
    kind_totals(Rels, imported, IN, IS),
    kind_totals(Rels, derived, DN, DS),
    findall(N-S, ( member(rel(P, A, _, derived, _), Rels), raw_clauses(P, A, Cs), length(Cs, N),
                   findall(CS, ( member(C, Cs), clause_symbols(C, CS) ), CSs), sum_list(CSs, S) ), RCs),
    findall(N, member(N-_, RCs), RNs), sum_list(RNs, RN),
    findall(S, member(_-S, RCs), RSs), sum_list(RSs, RS),
    lexicon_entries(Ls), length(Ls, LN), facts_symbols(Ls, LS),
    length(Is, IsN),
    findall(S, ( member(obj(L), Is), memberchk(symbols-S, L) ), CSs0), sum_list(CSs0, CS),
    findall(S, ( member(obj(L), Is), memberchk(kind-generator, L), memberchk(symbols-S, L) ), GCSs), sum_list(GCSs, GCS),
    ICS is CS - GCS,
    findall(B-N, ( band(B), findall(x, ( member(obj(L), Is), memberchk(band-B, L) ), Xs), length(Xs, N) ), Banded),
    Now is SS + RS + LS + CS,
    Without is SS + DS + LS + CS.

kind_totals(Rels, K, N, S) :-
    findall(Fs, member(rel(_, _, _, K, Fs), Rels), Fss), append(Fss, All),
    length(All, N), facts_symbols(All, S).

candidate_json(I, Saving, cand(K, H, Body, Covers, Clauses, Exc, Extra, Alts),
               obj([id-Id, kind-K, relation-H, body-arr(Body), saving-Saving, cost-Cost,
                    covers-arr(CJs), clauses-arr(Ts), exceptions-arr(ETs), alternatives-arr(ATs)])) :-
    format(atom(Id0), "c~w", [I]), Id = Id0,
    cand_cost(Clauses, Extra, Cost),
    findall(obj([item-FT, symbols-W]), ( member(F-W, Covers), format(atom(FT), "~q", [F]) ), CJs),
    findall(T, ( member(C, Clauses), suggestion_text(C, T) ), Ts),
    findall(T, ( member(E, Exc), format(atom(T), "~w", [E]) ), ETs),
    findall(T, ( member(A, Alts), format(atom(T), "~w", [A]) ), ATs).

% A suggested clause as Prolog: placeholders 'X', 'Y', ... and numbered variables print
% as variables ('$VAR'(N) becomes the letter, since Trealla prints it as written).
suggestion_text((H0 :- B0), T) :-
    unnumber((H0 :- B0), (H :- B), Letters),
    Base = ['X', 'Y', 'Z', 'S', 'V', 'O', 'H1', 'H2', 'H3'],
    append(Base, Letters, Names),
    findall(N-N, member(N, Names), Map),
    goal_pattern(H, Map, HT),
    conj_list(B, Gs),
    findall(GT, ( member(G, Gs), goal_pattern(G, Map, GT) ), GTs),
    atomic_list_concat(GTs, ',\n    ', BT),
    format(atom(T), "~w :-~n    ~w.", [HT, BT]).

unnumber(T, T, []) :- var(T), !.
unnumber(T, L, [L]) :- compound(T), T = '$VAR'(N), integer(N), !, C is 0'A + N mod 26, atom_codes(L, [C]).
unnumber(T, T, []) :- atomic(T), !.
unnumber(T, U, Ls) :- T =.. [F|As], unnumber_args(As, Us, Ls), U =.. [F|Us].
unnumber_args([], [], []).
unnumber_args([A|As], [U|Us], Ls) :- unnumber(A, U, L1), unnumber_args(As, Us, L2), append(L1, L2, Ls).
