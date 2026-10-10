% schema.pl — the Liquidity House pack's domains, relations, entity types, roles and accounts.
%
% To surface a new relation in the explorer, add one kb_predicate/3 line (and, if
% needed, a noun/2 or verb/2 in vocabulary.pl).

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
kb_predicate(helps_with, 2, onboarding).
kb_predicate(grants, 2, onboarding).
kb_predicate(full_name, 2, onboarding).
kb_predicate(slack_member_id, 2, onboarding).
kb_predicate(job_area, 2, onboarding).
kb_predicate(github_login, 2, onboarding).
kb_predicate(commits_by, 3, onboarding).
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
% completed(Who, Item): Who has done the item's action (cloned it, set it up, got access).
% Personal progress, so it is kept as local overrides (the setup checklist, record_progress),
% never in a pack; dynamic, so verify works while nobody has completed anything.
:- dynamic(completed/2).
kb_predicate(completed, 2, onboarding).
kb_predicate(depends_on, 2, platform).
kb_predicate(needs_setup, 2, platform).
kb_predicate(dashboard, 2, platform).
kb_predicate(deployed_on, 2, platform).
kb_predicate(cluster_domain, 2, platform).
kb_predicate(riskx, 2, platform).
kb_predicate(data_source, 2, platform).
kb_predicate(monitors, 2, platform).
kb_predicate(api_docs_path, 2, platform).
kb_predicate(public_api, 2, platform).
kb_predicate(api_gateway_needs, 2, platform).
kb_predicate(built_with, 2, platform).
kb_predicate(calls, 2, platform).
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
derived_predicate(in_portfolio, 2, platform).
derived_predicate(api_reference, 2, platform).
derived_predicate(needs_access, 2, platform).
derived_predicate(access_granted_by, 2, onboarding).
derived_predicate(candidate_owner, 2, onboarding).
derived_predicate(url, 2, onboarding).
derived_predicate(sibling_repo, 2, onboarding).
derived_predicate(belongs_to, 2, onboarding).
derived_predicate(email_address, 2, onboarding).
derived_predicate(requires, 2, onboarding).
derived_predicate(can_help_with, 2, onboarding).

% --- Entity types (first matching rule wins) ---
type_rule(E, text) :- catch((api_docs_path(_, E) ; full_name(_, E)), _, fail), !.
type_rule(E, identifier) :- catch((slack_client_id(_, E) ; slack_channel_id(_, E) ; slack_member_id(_, E)), _, fail), !.
type_rule(E, account) :- catch((github_account(_, E) ; jira_site(_, E)), _, fail), !.
type_rule(E, domain) :- catch((email_domain(_, E) ; cluster_domain(_, E) ; product_domain(_, E) ; managed_by(_, E)), _, fail), !.
type_rule(E, email) :- catch((email_domain(E, _) ; invitation_sent_to(_, E) ; signs_in_with(_, E)), _, fail), !.
type_rule(E, address) :- catch(email_address(_, E), _, fail), !.
type_rule(E, team) :- catch(part_of(E, _), _, fail), !.
type_rule(E, organisation) :- catch((part_of(_, E) ; mailbox(E, _)), _, fail), !.
type_rule(E, product) :- catch(builds(_, E), _, fail), !.
type_rule(E, workspace) :- catch(slack_client_id(E, _), _, fail), !.
type_rule(E, channel) :- catch(slack_channel(_, E), _, fail), !.
type_rule(E, person) :- catch((invites(E, _) ; works_as(E, _) ; member_of(E, _) ; helps_with(E, _) ; grants(E, _) ; full_name(E, _)), _, fail), !.
type_rule(E, job) :- catch(works_as(_, E), _, fail), !.
type_rule(E, github_user) :- catch(github_login(_, E), _, fail), !.
type_rule(E, work_area) :- catch(job_area(_, E), _, fail), !.
type_rule(E, api) :- catch(public_api(_, E), _, fail), !.
type_rule(E, jira_project) :- catch(jira_site(E, _), _, fail), !.
type_rule(E, dashboard) :- catch(dashboard(_, E), _, fail), !.
type_rule(E, cluster) :- catch(cluster_domain(E, _), _, fail), !.
type_rule(E, operator) :- catch(operator(E, _), _, fail), !.
type_rule(E, service) :- catch(service(E), _, fail), !.
type_rule(E, repository) :- catch(repo(E, _), _, fail), !.
type_rule(E, env_setup) :- catch(needs_setup(_, E), _, fail), !.
type_rule(E, technology) :- catch(built_with(_, E), _, fail), !.
type_rule(E, organisation) :- catch(github_account(E, _), _, fail), !.
type_rule(E, weight) :- catch(risk_weight(E, _), _, fail), !.
type_rule(E, data_source) :- catch(data_source(_, E), _, fail), !.
type_rule(E, portfolio) :- catch(monitors(_, E), _, fail), !.
type_rule(E, dataset) :- catch((riskx(E, _) ; riskx(_, E)), _, fail), !.
type_rule(E, status) :- catch((operator(_, E) ; exposure_warning(_, E)), _, fail), !.
type_rule(E, step) :- catch(onboarding(E), _, fail), !.

% type_style(Type, DefaultColour, Shape) — shapes are vis-network shapes.
type_style(operator, '#e4572e', dot).
type_style(portfolio, '#ff8787', hexagon).
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
type_style(technology, '#63e6be', diamond).
type_style(job, '#a9e34b', ellipse).
type_style(work_area, '#d8f5a2', ellipse).
type_style(api, '#22b8cf', diamond).
type_style(github_user, '#495057', box).

% --- Who sees what (developer and admin come with the explorer pack) ---
role(risk_officer).

role_domain(risk_officer, risk).
role_domain(risk_officer, platform).
role_domain(developer, onboarding).
role_domain(developer, platform).
role_domain(developer, risk).

role_feature(risk_officer, table).

% Where each role starts exploring.
role_start(risk_officer, dope).
role_start(developer, riskx).
role_start(admin, riskx).

% user_account(Id, Role)
user_account(dominic, risk_officer).
user_account(adam, developer).
