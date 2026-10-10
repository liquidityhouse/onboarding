% vocabulary.pl — the Liquidity House pack's words: what its concepts, relations, people and units are called.
%
% The primitives are described in kb/lexicon.pl; only words that read badly when
% humanised are written here.

% What concepts, attributes, types and people are called.
noun(requires, requirement).
noun(depends_on, dependency).
noun(needs_setup, 'environment setup').
noun(env_setup, 'environment setup').
noun(member_of, team).
noun(belongs_to, organisation).
noun(address, 'email address').
noun(product_domain, domain).
noun(email_role, role).
noun(email_provider, provider).
noun(google_workspace, 'Google Workspace').
noun(ai_invoices, 'AI invoices').
noun(helps_with, topic).
noun(can_help_with, topic).
noun(api_docs_path, 'API docs path').
noun(nextjs, 'Next.js').
noun(react, 'React').
noun(tailwindcss, 'Tailwind CSS').
noun(shadcn, 'shadcn/ui').
noun(trpc, 'tRPC').
noun(adminx, 'AdminX').
noun(api_reference, 'API reference').
noun(ggr_90d, '90-day gross gaming revenue').
noun(net_deposits, 'net player deposits').
noun(dau, 'daily active user count').
noun(exposure_warning, 'exposure level').
noun(risk_weight, value).
noun(weight, 'risk weight').
noun(step, 'onboarding step').
noun(platform, 'RiskX platform').
noun(workspace, 'Slack workspace').
noun(channel, 'Slack channel').
noun(identifier, 'ID').
noun(jira_project, 'Jira project').
noun(repo, team).
noun(sibling_repo, 'other repository').
noun(github_account, 'GitHub account').
noun(slack_channel, 'Slack channel').
noun(slack_client_id, 'Slack client ID').
noun(slack_channel_id, 'Slack channel ID').
noun(jira_site, 'Jira site').
noun(jira_board, 'Jira board').
noun(deployed_on, cluster).
noun(personal_email, 'your personal email').
noun(work_email, 'your work email').
noun(team_email, 'your team email').
noun(admin, administrator).
noun(software_engineer, 'Software Engineer').
noun(team_lead, 'Team Lead').
noun(head_of_risk, 'Head of Risk').
noun(ceo, 'CEO').
noun(cto, 'CTO').
noun(compliance, 'Compliance').
noun(management, managerial).
noun(business, 'business stakeholder').
noun(job_area, 'kind of work').
noun(works_as, job).
noun(full_name, 'full name').
noun(slack_member_id, 'Slack member ID').
noun(injectx_api, 'InjectX public API').
noun(api, 'API').
noun(github_user, 'GitHub user').
noun(github_login, 'GitHub user').
noun(candidate_owner, 'candidate owner').
noun(most_commits_in_slack, 'most commits by anyone in Slack').
noun(public_api, 'public API').
noun(needs_access, access).
noun(access_granted_by, person).
noun(grants, access).
% A person is called by their full name and jobs: "Richard Larsson, Team Lead and CTO".
noun(Person, Name) :-
    full_name(Person, Full),
    findall(J, ( works_as(Person, Job), noun_of(Job, J) ), Jobs),
    ( Jobs == [] -> Name0 = Full ; join_and(Jobs, JT), format(atom(Name0), "~w, ~w", [Full, JT]) ),
    Name = Name0.
noun(liquidity_house, 'Liquidity House').

% Relations read as "Subject Verb Object".
verb(onboarding, includes).
verb(helps_with, 'helps with').
verb(commits_by, 'was committed to by').
verb(candidate_owner, 'may be owned by').
verb(grants, 'gives access to').
verb(public_api, offers).
verb(api_gateway_needs, 'has an API gateway that needs').
verb(needs_access, needs).
verb(access_granted_by, 'needs access given by').
verb(can_help_with, 'can help with').
verb(completed, 'has completed').
verb(part_of, 'is part of').
verb(builds, builds).
verb(member_of, 'is a member of').
verb(belongs_to, 'belongs to').
verb(mailbox, provides).
verb(managed_by, 'is managed by').
verb(invites, 'invites you to').
verb(works_as, 'works as').
verb(reachable_in, 'is reachable in').
verb(repo, 'belongs to').
verb(sibling_repo, 'is a sibling of').
verb(invitation_sent_to, 'is joined via an invitation to').
verb(signs_in_with, 'is reached with').
verb(dashboard, 'is shown on').
verb(deployed_on, 'is deployed on').
verb(riskx, 'flows into').
verb(data_source, 'pulls data from').
verb(monitors, monitors).
verb(in_portfolio, 'is part of').
verb(operator, 'has status').
verb(slack_channel, contains).
verb(requires, requires).
verb(depends_on, 'depends on').
verb(needs_setup, needs).
verb(built_with, 'is built with').
verb(calls, calls).

% Rule wording, when a relation's noun already names something else.
object(operator, status).

% Takes "are" instead of "is".
plural(net_deposits).

% Units, and how they are written after a number.
unit(ggr_90d, usd).
unit(net_deposits, usd).
unit(wallet_exposure, usd).
unit(soft_credit_limit, usd).
unit(daily_allowance, usd).
unit(dau, count).
unit_word(usd, 'USD').

% Entities written without "<type> '...'".
bare(status).
bare(identifier).
bare(account).
bare(domain).
bare(email).
bare(address).

% Values that deserve attention.
flag(exposure_warning, high, warning).

% What you do to satisfy a requirement of each type.
action(service, clone).
action(repository, clone).
action(env_setup, 'set up').
action(data_source, 'get access to').
action(dashboard, 'get access to').

% How extra arguments of n-ary facts attach.
arg_verb(commits_by, 3, 'commits:').
