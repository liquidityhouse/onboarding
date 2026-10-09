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
%   avoid(P, C), plan_size(P, N)   plans found before, so the next best is found
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

% No relation may end up derived from itself.
reads(R, Q) :- sel(C), head(C, R), body(C, Q).
path(R, Q) :- reads(R, Q).
path(R, S) :- path(R, Q), reads(Q, S).
:- sel(C), head(C, R), path(R, R).

% A plan found before is not found again.
:- plan_size(P, N), N = #count { C : sel(C) }, N = #count { C : sel(C), avoid(P, C) }.

#minimize { Cost,c,C : sel(C), cand(C, Cost) ; W,f,F : stated(F, W), not dropped(F) }.
#show sel/1.
