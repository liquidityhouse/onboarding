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
kb_predicate(part_of, 2, onboarding).
kb_predicate(builds, 2, onboarding).
kb_predicate(product_domain, 2, onboarding).
kb_predicate(member_of, 2, onboarding).
kb_predicate(mailbox, 2, onboarding).
kb_predicate(email_role, 2, onboarding).
kb_predicate(inbox, 2, onboarding).
kb_predicate(email_provider, 2, onboarding).
kb_predicate(managed_by, 2, onboarding).
kb_predicate(invites, 2, onboarding).
kb_predicate(works_as, 2, onboarding).
kb_predicate(reachable_in, 2, onboarding).
kb_predicate(github_account, 2, onboarding).
kb_predicate(repo, 2, onboarding).
kb_predicate(slack_client_id, 2, onboarding).
kb_predicate(invitation_sent_to, 2, onboarding).
kb_predicate(slack_channel, 2, onboarding).
kb_predicate(slack_channel_id, 2, onboarding).
kb_predicate(email_domain, 2, onboarding).
kb_predicate(signs_in_with, 2, onboarding).
kb_predicate(jira_site, 2, onboarding).
kb_predicate(jira_board, 2, onboarding).
kb_predicate(depends_on, 2, platform).
kb_predicate(needs_setup, 2, platform).
kb_predicate(dashboard, 2, platform).
kb_predicate(deployed_on, 2, platform).
kb_predicate(cluster_domain, 2, platform).
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
derived_predicate(url, 2, onboarding).
derived_predicate(sibling_repo, 2, onboarding).
derived_predicate(belongs_to, 2, onboarding).
derived_predicate(email_address, 2, onboarding).
derived_predicate(requires, 2, onboarding).

% --- Entity types (first matching rule wins) ---
entity_type(E, value) :- number(E), !.
entity_type(E, url) :- atom(E), sub_atom(E, 0, _, _, http), !.
entity_type(E, identifier) :- catch((slack_client_id(_, E) ; slack_channel_id(_, E)), _, fail), !.
entity_type(E, account) :- catch((github_account(_, E) ; jira_site(_, E)), _, fail), !.
entity_type(E, domain) :- catch((email_domain(_, E) ; cluster_domain(_, E) ; product_domain(_, E) ; managed_by(_, E)), _, fail), !.
entity_type(E, email) :- catch((email_domain(E, _) ; invitation_sent_to(_, E) ; signs_in_with(_, E)), _, fail), !.
entity_type(E, address) :- catch(email_address(_, E), _, fail), !.
entity_type(E, team) :- catch(part_of(E, _), _, fail), !.
entity_type(E, organisation) :- catch((part_of(_, E) ; mailbox(E, _)), _, fail), !.
entity_type(E, product) :- catch(builds(_, E), _, fail), !.
entity_type(E, workspace) :- catch(slack_client_id(E, _), _, fail), !.
entity_type(E, channel) :- catch(slack_channel(_, E), _, fail), !.
entity_type(E, person) :- catch((invites(E, _) ; works_as(E, _) ; member_of(E, _)), _, fail), !.
entity_type(E, jira_project) :- catch(jira_site(E, _), _, fail), !.
entity_type(E, dashboard) :- catch(dashboard(_, E), _, fail), !.
entity_type(E, cluster) :- catch(cluster_domain(E, _), _, fail), !.
entity_type(E, operator) :- catch(operator(E, _), _, fail), !.
entity_type(E, service) :- catch(service(E), _, fail), !.
entity_type(E, repository) :- catch(repo(E, _), _, fail), !.
entity_type(E, env_setup) :- catch(needs_setup(_, E), _, fail), !.
entity_type(E, organisation) :- catch(github_account(E, _), _, fail), !.
entity_type(E, weight) :- catch(risk_weight(E, _), _, fail), !.
entity_type(E, data_source) :- catch(data_source(_, E), _, fail), !.
entity_type(E, dataset) :- catch((riskx(E, _) ; riskx(_, E)), _, fail), !.
entity_type(E, status) :- catch((operator(_, E) ; exposure_warning(_, E)), _, fail), !.
entity_type(E, step) :- catch(onboarding(E), _, fail), !.
entity_type(_, concept).

% type_style(Type, DefaultColour, Shape) — shapes are vis-network shapes.
type_style(operator, '#e4572e', dot).
type_style(repository, '#4c6ef5', box).
type_style(organisation, '#7048e8', hexagon).
type_style(team, '#845ef7', hexagon).
type_style(product, '#f03e3e', star).
type_style(service, '#3bc9db', box).
type_style(data_source, '#1098ad', diamond).
type_style(env_setup, '#e67700', triangle).
type_style(dataset, '#2f9e44', database).
type_style(weight, '#f59f00', triangle).
type_style(status, '#868e96', ellipse).
type_style(step, '#d6336c', star).
type_style(workspace, '#9c36b5', square).
type_style(channel, '#cc5de8', ellipse).
type_style(person, '#94d82d', dot).
type_style(identifier, '#74c0fc', box).
type_style(account, '#20c997', box).
type_style(domain, '#15aabf', text).
type_style(email, '#fd7e14', box).
type_style(address, '#ffa94d', text).
type_style(jira_project, '#1c7ed6', diamond).
type_style(dashboard, '#f76707', hexagon).
type_style(cluster, '#5c940d', box).
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
