% schema.pl — what is shown, where it belongs, how it looks and who sees it.
%
% To surface a new relation in the explorer, add one kb_predicate/3 line
% (and, if needed, a noun/2 or verb/2 in lexicon.pl).

% --- Domains (scopes of knowledge) ---
domain(onboarding).
domain(platform).
domain(risk).

% --- Relations shown in the graph: kb_predicate(Name, Arity, Domain) ---
kb_predicate(onboarding, 1, onboarding).
kb_predicate(repo, 2, onboarding).
kb_predicate(organisation, 3, onboarding).
kb_predicate(dashboard, 2, platform).
kb_predicate(riskx, 2, platform).
kb_predicate(data_source, 2, platform).
kb_predicate(monitored_by, 2, platform).
kb_predicate(operator, 2, risk).
kb_predicate(ggr_90d, 2, risk).
kb_predicate(dau, 2, risk).
kb_predicate(net_deposits, 2, risk).
kb_predicate(wallet_exposure, 2, risk).
kb_predicate(risk_weight, 2, risk).

% Rules whose conclusions appear as dashed edges and can be explained.
derived_predicate(soft_credit_limit, 2, risk).
derived_predicate(daily_allowance, 2, risk).
derived_predicate(exposure_warning, 2, risk).

% --- Entity types (first matching rule wins) ---
entity_type(E, value) :- number(E), !.
entity_type(E, url) :- atom(E), sub_atom(E, 0, _, _, http), !.
entity_type(E, operator) :- catch(operator(E, _), _, fail), !.
entity_type(E, repository) :- catch(repo(E, _), _, fail), !.
entity_type(E, organisation) :- catch(organisation(E, _, _), _, fail), !.
entity_type(E, weight) :- catch(risk_weight(E, _), _, fail), !.
entity_type(E, service) :- catch(data_source(_, E), _, fail), !.
entity_type(E, service) :- catch(organisation(_, E, _), _, fail), !.
entity_type(E, dataset) :- catch((riskx(E, _) ; riskx(_, E)), _, fail), !.
entity_type(E, status) :- catch((operator(_, E) ; exposure_warning(_, E)), _, fail), !.
entity_type(E, step) :- catch(onboarding(E), _, fail), !.
entity_type(_, concept).

% type_style(Type, DefaultColour, Shape) — shapes are vis-network shapes.
type_style(operator, '#e4572e', dot).
type_style(repository, '#4c6ef5', box).
type_style(organisation, '#7048e8', hexagon).
type_style(service, '#1098ad', diamond).
type_style(dataset, '#2f9e44', database).
type_style(weight, '#f59f00', triangle).
type_style(status, '#868e96', ellipse).
type_style(step, '#d6336c', star).
type_style(url, '#495057', text).
type_style(value, '#adb5bd', box).
type_style(concept, '#5c7cfa', dot).

% --- User scopes ---
role(risk_officer).
role(developer).
role(admin).

role_domain(risk_officer, risk).
role_domain(risk_officer, platform).
role_domain(developer, onboarding).
role_domain(developer, platform).
role_domain(developer, risk).
role_domain(admin, D) :- domain(D).

% Features: table (triple table), console (advanced query), technical (raw proofs,
% predicate names, KB files and load errors — hidden from non-technical users).
role_feature(risk_officer, table).
role_feature(developer, table).
role_feature(developer, console).
role_feature(developer, technical).
role_feature(admin, table).
role_feature(admin, console).
role_feature(admin, technical).

% Where each role starts exploring.
role_start(risk_officer, dope).
role_start(developer, riskx).
role_start(admin, riskx).

% user_account(Id, Role)
user_account(dominic, risk_officer).
user_account(adam, developer).
user_account(admin, admin).
