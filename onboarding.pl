% onboarding.pl — what a new joiner sets up, who gets them in, and where things live.
%
% Each piece of knowledge is written once. Links and email addresses are not
% stored: url/2 and email_address/2 build them, and sibling repos follow from repo/2.

% --- Who we are ---
% GOAT (goat.gs) is the umbrella organisation. Liquidity House is our team
% inside it, building the bankroll product at liquidity.house.
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

works_as(georgi, developer).
reachable_in(georgi, direct_messages).

% --- GitHub ---
github_account(liquidity_house, liquidityhouse).
repo(onboarding, liquidity_house).
repo(injectx, liquidity_house).
repo(riskx, liquidity_house).

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

% Members of a team also belong to the organisation the team is part of.
belongs_to(Person, Org) :-
    member_of(Person, Org).
belongs_to(Person, Org) :-
    member_of(Person, Team),
    part_of(Team, Org).

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

% Repos in the same organisation are siblings (riskx and injectx, for example).
sibling_repo(Repo, Sibling) :-
    repo(Repo, Org),
    repo(Sibling, Org),
    Repo \== Sibling.
