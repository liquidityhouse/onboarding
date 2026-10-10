% onboarding.pl — what a new joiner sets up, who gets them in, and where things live.
%
% Each piece of knowledge is written once. Links and email addresses are not
% stored: url/2 and email_address/2 build them, and sibling repos follow from repo/2.

% --- Who we are ---
% GOAT (goat.gs) is the umbrella organisation. Liquidity House is our team
% inside it, building the bankroll product at liquidity.house.
% This pack is what the knowledge explorer explores here, so it is named after us.
explores(knowledge_explorer, liquidity_house).
part_of(liquidity_house, goat_gaming).
builds(liquidity_house, bankroll).
product_domain(bankroll, 'liquidity.house').
member_of(adam, liquidity_house).

% --- What a new joiner sets up ---
onboarding(env).
onboarding(liquidity_house).    % GitHub organisation
onboarding('liquidity-house').  % Slack workspace
onboarding(work_email).
onboarding(team_email).
onboarding('GOAT').             % Jira project
onboarding(riskx_dashboard).

% --- Who invites you where (change the person to hand it over) ---
invites(richard, 'liquidity-house').
invites(georgi, riskx_dashboard).

% --- Who to ask: what each person knows and helps others with ---
% can_help_with/2 below extends this to what those things need.
helps_with(richard, ai_invoices).
helps_with(rasmus, injectx).
helps_with(rasmus, onboarding).
helps_with(rasmus, 'GOAT').        % Jira
helps_with(georgi, riskx).
helps_with(adam, knowledge_explorer).
helps_with(adam, injectx).
helps_with(adam, riskx).

works_as(georgi, developer).
reachable_in(georgi, direct_messages).

% --- GitHub ---
github_account(liquidity_house, liquidityhouse).
repo(onboarding, liquidity_house).
repo(injectx, liquidity_house).
repo(riskx, liquidity_house).
repo(k8s, liquidity_house).
repo(adminx, liquidity_house).
repo(payx, liquidity_house).
repo(creditx, liquidity_house).
repo(tokenx, liquidity_house).

% --- Slack ---
% First login is at the workspace link, through an invitation to your personal email.
slack_client_id('liquidity-house', 'T0A2MCQ1G3A').
invitation_sent_to('liquidity-house', personal_email).
slack_channel('liquidity-house', development).
slack_channel_id(development, 'C0A2A2JHYPP').
slack_channel('liquidity-house', direct_messages).
slack_channel_id(direct_messages, dms).

% --- Email ---
% Everyone gets {person}@goat.gs, the organisation's primary email, read at one.com.
% Liquidity House members also get {person}@liquidityhouse.io on Google Workspace.
mailbox(goat_gaming, work_email).
email_domain(work_email, 'goat.gs').
email_role(work_email, primary).
inbox(work_email, 'https://mail.one.com/mail/INBOX/1').

mailbox(liquidity_house, team_email).
email_domain(team_email, 'liquidityhouse.io').
email_provider(team_email, google_workspace).
managed_by(team_email, 'degaminggroup.com').

% --- Jira ---
% You sign in to Jira with your @goat.gs email.
signs_in_with('GOAT', work_email).
jira_site('GOAT', 'goat-gaming').
jira_board('GOAT', 2).

% --- Services and what working on them needs ---
% Working on a service means its own repository plus everything it requires
% (requires/2 below). riskx's Metabase access follows from data_source/2.
service(injectx).
service(riskx).
service(payx).
service(creditx).
service(tokenx).
service(adminx).

depends_on(injectx, onboarding).
depends_on(injectx, k8s).
depends_on(riskx, onboarding).

needs_setup(injectx, docker_compose).
needs_setup(injectx, bun_runtime).
needs_setup(injectx, aws_dev_role).
needs_setup(riskx, docker_compose).
needs_setup(adminx, bun_runtime).

% --- AdminX: the internal admin app (checked in its repository on 10 October 2026) ---
% A Next.js and React app on Bun, styled with Tailwind and shadcn (Radix UI) components,
% talking to its backend over tRPC. It has client packages for the services below, and
% already hosts an AI agent; the knowledge explorer is to move into it (GOAT-22).
built_with(adminx, nextjs).
built_with(adminx, react).
built_with(adminx, tailwindcss).
built_with(adminx, shadcn).
built_with(adminx, trpc).
built_with(adminx, bun_runtime).
calls(adminx, injectx).
calls(adminx, payx).
calls(adminx, creditx).
calls(adminx, tokenx).

% --- InjectX public API ---
% The public API reference (OpenAPI) is served by injectx itself, under its API host
% on the cluster; it is where the external API documentation lives (GOAT-11).
deployed_on(injectx, eu_central_1).
api_docs_path(injectx, '/openapi').

% --- RiskX platform ---
dashboard(riskx, riskx_dashboard).
deployed_on(riskx, eu_central_1).
cluster_domain(eu_central_1, 'k8s.eu-central-1.aws.liquidity.house').
riskx(data, players).
riskx(data, export_data).
riskx(export_data, raw_all_data).
riskx(agregate, metadata).

% --- Derived knowledge ---
% Dynamic so the explorer can read these rules and explain them. Rules that
% build text format into a fresh variable and then unify (Url = Url0): in
% Trealla, format(atom(Bound), ...) inside a clause succeeds without checking.
:- dynamic(url/2).
:- dynamic(sibling_repo/2).
:- dynamic(belongs_to/2).
:- dynamic(email_address/2).
:- dynamic(requires/2).
:- dynamic(api_reference/2).
:- dynamic(can_help_with/2).

% Members of a team also belong to the organisation the team is part of.
belongs_to(Person, Org) :-
    member_of(Person, Org).
belongs_to(Person, Org) :-
    member_of(Person, Team),
    part_of(Team, Org).

% What a service requires: the repositories it depends on (and everything
% they require in turn), its environment setups, and its data sources.
requires(Service, Repo) :-
    depends_on(Service, Repo).
requires(Service, Item) :-
    depends_on(Service, Dependency),
    requires(Dependency, Item).
requires(Service, Setup) :-
    needs_setup(Service, Setup).
requires(Service, Source) :-
    data_source(Service, Source).

% Who can help with something: whoever helps with it, invites you to it, or helps with a
% service that requires it (so Rasmus, who helps with injectx, can help with its setup).
can_help_with(Person, Item) :-
    helps_with(Person, Item).
can_help_with(Person, Item) :-
    invites(Person, Item).
can_help_with(Person, Item) :-
    requires(Service, Item),
    helps_with(Person, Service).

% Every organisation you belong to gives you {person}@{its email domain}.
email_address(Person, Address) :-
    belongs_to(Person, Org),
    mailbox(Org, Mailbox),
    email_domain(Mailbox, Domain),
    format(atom(Address0), '~w@~w', [Person, Domain]),
    Address = Address0.

url(Org, Url) :-
    github_account(Org, Account),
    format(atom(Url0), 'https://github.com/~w', [Account]),
    Url = Url0.
url(Repo, Url) :-
    repo(Repo, Org),
    url(Org, OrgUrl),
    format(atom(Url0), '~w/~w', [OrgUrl, Repo]),
    Url = Url0.
url(Workspace, Url) :-
    slack_client_id(Workspace, _),
    format(atom(Url0), 'https://~w.slack.com', [Workspace]),
    Url = Url0.
url(Channel, Url) :-
    slack_channel(Workspace, Channel),
    slack_client_id(Workspace, ClientId),
    slack_channel_id(Channel, ChannelId),
    format(atom(Url0), 'https://app.slack.com/client/~w/~w', [ClientId, ChannelId]),
    Url = Url0.
url(Project, Url) :-
    jira_site(Project, Site),
    jira_board(Project, Board),
    format(atom(Url0), 'https://~w.atlassian.net/jira/software/projects/~w/boards/~w?filter=&groupBy=assignee', [Site, Project, Board]),
    Url = Url0.
url(Dashboard, Url) :-
    dashboard(App, Dashboard),
    deployed_on(App, Cluster),
    cluster_domain(Cluster, Domain),
    format(atom(Url0), 'https://dashboard.~w.~w/', [App, Domain]),
    Url = Url0.

% A service's API reference sits on its API host in the cluster it is deployed on.
api_reference(Service, Url) :-
    api_docs_path(Service, Path),
    deployed_on(Service, Cluster),
    cluster_domain(Cluster, Domain),
    format(atom(Url0), 'https://api.~w.~w~w', [Service, Domain, Path]),
    Url = Url0.

% Repos in the same organisation are siblings (riskx and injectx, for example).
sibling_repo(Repo, Sibling) :-
    repo(Repo, Org),
    repo(Sibling, Org),
    Repo \== Sibling.
