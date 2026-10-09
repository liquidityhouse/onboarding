% plan.lp — chooses which compression candidates to apply so the knowledge base needs the fewest symbols.
%
% An answer set program, solved by clingo (lib/optimiser.ts). Its facts come from
% api(audit(Role)) and the asker's constraints:
%   cand(C, Cost)   candidate C adds Cost symbols (its rule, exception facts, new words)
%   covers(C, F)    C makes F redundant (a stated fact, clause or word)
%   stated(F, W)    F costs W symbols while it stays
%   head(C, R)      the relation C would derive;  body(C, R)  a relation its rule reads
%   kind(C, K)      its template;  exceptions(C, N)  how many members it must leave out
%   reads(R, Q)     an existing rule for R reads Q
%   keep(R)         constraint: R stays stated
%   kind_off(K)     constraint: template K is not used
%   max_rules(M)    constraint: at most M candidates are applied
%   no_exceptions   constraint: only candidates without exceptions
%   avoid(P, C), plan_size(P, N)   plans found before, so a different one is found
%
% What is minimised is the symbols the chosen candidates add plus those of the facts
% that remain, so candidates covering the same facts are not counted twice (as in
% KGist and MaxSynth). Recursive and invented-predicate effects are judged by the
% audit, not here.

{ sel(C) : cand(C, _) }.
dropped(F) :- sel(C), covers(C, F).

:- sel(C), head(C, R), keep(R).
:- sel(C), kind(C, K), kind_off(K).
:- no_exceptions, sel(C), exceptions(C, N), N > 0.
:- max_rules(M), #count { C : sel(C) } > M.

% A new rule may not close a cycle: its relation would end up derived from itself.
% (Existing recursion, such as relies_on/2 reading itself, is fine.)
reads(R, Q) :- sel(C), head(C, R), body(C, Q).
path(R, Q) :- reads(R, Q).
path(R, S) :- path(R, Q), reads(Q, S).
:- sel(C), head(C, R), body(C, Q), path(Q, R).
:- sel(C), head(C, R), body(C, R).

% Each alternative leaves out something every earlier plan chose, so plans differ in
% substance rather than by an extra candidate that saves nothing.
:- plan_size(P, N), N = #count { C : sel(C), avoid(P, C) }.

% Fewest symbols first; on a tie, fewest candidates.
#minimize { Cost@2,c,C : sel(C), cand(C, Cost) ; W@2,f,F : stated(F, W), not dropped(F) }.
#minimize { 1@1,C : sel(C) }.
#show sel/1.
