% core.pl — what every knowledge pack shares: kinds of knowledge, entity typing and roles.
%
% The engine (kb/) holds no domain knowledge. Each pack under knowledge/ brings its
% own domains, relations (kb_predicate/3), entity types (type_rule/2, first match
% wins, packs in load order), styles and vocabulary, so packs can be added or removed
% as a whole (kb/manifest.json, or KB_PACKS).

% --- Kinds of knowledge: how a fact came to be known ---
% Their names come from the lexicon and their meanings from purpose/2, so the explorer
% never words them itself.
knowledge_kind(stated).
knowledge_kind(generated).
knowledge_kind(derived).

purpose(stated, 'to record what cannot be worked out from other knowledge, such as decisions, names and observations, written in the knowledge base by a person').
purpose(generated, 'to take what the repository already records, such as package versions, imports, file headers and the code that implements each endpoint and tool, instead of writing it by hand').
purpose(derived, 'to work out what follows from other facts by a rule; open it to see how (the rule) and why (the facts it used)').

knowledge_kind(local).
purpose(local, 'to try a change without editing the shared knowledge files: facts added, edited or removed here, in the explorer or by an agent over MCP, kept on this machine (state/, which git ignores) until someone writes them into a pack').

% relation_kind(P, Kind): derived when a rule defines P, generated when the repository
% records it (generated_predicate/2 comes with the generated facts), stated otherwise.
relation_kind(P, derived) :- derived_predicate(P, _, _), !.
relation_kind(P, generated) :- kb_predicate(P, A, _), catch(generated_predicate(P, A), _, fail), !.
relation_kind(_, stated).

% --- Local overrides: changes made on this machine (lib/override-store.ts) ---
% local_change(Id, Op, Fact, By, Via, At, Source): Op is add or remove; Via is explorer or
% mcp; Source is none, pasted, url(U) or replaces(OldFact). Added facts are in the program
% as written; removed ones are left out of their files. local_stale(Id): a removal whose
% fact is no longer in its file.
:- dynamic(local_change/7).
:- dynamic(local_stale/1).

local_fact(G) :- once(local_change(_, add, G, _, _, _, _)).

% Who may see and do what is never changed locally: only in the pack files.
protected_relation(role, 1).
protected_relation(role_domain, 2).
protected_relation(role_feature, 2).
protected_relation(everyone_has, 1).
protected_relation(user_account, 2).
protected_relation(access, 2).
protected_relation(tool_access, 2).

% fact_kind(Fact, Kind): local when added here, otherwise its relation's kind.
fact_kind(G, local) :- local_fact(G), !.
fact_kind(G, K) :- functor(G, P, _), relation_kind(P, K).

% --- Entity types: numbers and links first, then each pack's type_rule/2 ---
:- dynamic(type_rule/2).
entity_type(E, value) :- number(E), !.
entity_type(E, url) :- atom(E), sub_atom(E, 0, _, _, http), !.
entity_type(E, knowledge_kind) :- catch(knowledge_kind(E), _, fail), !.
entity_type(E, T) :- type_rule(E, T), !.
entity_type(_, concept).

type_style(knowledge_kind, '#adb5bd', ellipse).
type_style(text, '#868e96', text).
type_style(url, '#495057', text).
type_style(value, '#adb5bd', box).
type_style(concept, '#5c7cfa', dot).

% --- Roles: which domains and features each role has ---
% Packs state role/1, role_domain/2, role_feature/2, role_start/2 and user_account/2.
% Every role also has public and signed_in, which open endpoints need.
:- dynamic(role/1).
:- dynamic(role_domain/2).
:- dynamic(role_start/2).
:- dynamic(user_account/2).
everyone_has(public).
everyone_has(signed_in).
role_feature(Role, Feature) :- everyone_has(Feature), role(Role).

% --- The explorer's name: the explorer's noun, after the organisation it explores ---
:- dynamic(explores/2).
app_title(Title) :-
    noun_of(knowledge_explorer, Explorer),
    ( explores(knowledge_explorer, Org) -> noun_of(Org, O), format(atom(T0), "~w ~w", [O, Explorer]) ; T0 = Explorer ),
    Title = T0.

% Its tagline: the explorer's purpose, as a phrase ("to explore …" → "Explore …").
app_tagline(Tagline) :-
    ( purpose(knowledge_explorer, P) -> plain(P, T0) ; T0 = '' ),
    Tagline = T0.
