% onboarding.pl — what a new joiner sets up, who gets them in, and where things live.
%
% Each piece of knowledge is written once. Links are not stored: url/2 builds
% them from account names and IDs, and sibling repos follow from repo/2.

% --- What a new joiner sets up ---
onboarding(env).
onboarding(liquidity).          % GitHub organisation
onboarding('liquidity-house').  % Slack workspace
onboarding(work_email).
onboarding('GOAT').             % Jira project
onboarding(riskx_dashboard).

% --- Who invites you where (change the person to hand it over) ---
invites(richard, 'liquidity-house').
invites(georgi, riskx_dashboard).

works_as(georgi, developer).
reachable_in(georgi, direct_messages).

% --- GitHub ---
github_account(liquidity, liquidityhouse).
repo(onboarding, liquidity).
repo(injectx, liquidity).
repo(riskx, liquidity).

% --- Slack ---
% First login is at the workspace link, through an invitation to your personal email.
slack_client_id('liquidity-house', 'T0A2MCQ1G3A').
invitation_sent_to('liquidity-house', personal_email).
slack_channel('liquidity-house', development).
slack_channel_id(development, 'C0A2A2JHYPP').
slack_channel('liquidity-house', direct_messages).
slack_channel_id(direct_messages, dms).

% --- Work email and Jira ---
% You get an @goat.gs email; it is what you sign in to Jira with.
email_domain(work_email, 'goat.gs').
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
% Dynamic so the explorer can read these rules and explain them.
:- dynamic(url/2).
:- dynamic(sibling_repo/2).

url(Org, Url) :-
    github_account(Org, Account),
    format(atom(Url), 'https://github.com/~w', [Account]).
url(Repo, Url) :-
    repo(Repo, Org),
    url(Org, OrgUrl),
    format(atom(Url), '~w/~w', [OrgUrl, Repo]).
url(Workspace, Url) :-
    slack_client_id(Workspace, _),
    format(atom(Url), 'https://~w.slack.com', [Workspace]).
url(Channel, Url) :-
    slack_channel(Workspace, Channel),
    slack_client_id(Workspace, ClientId),
    slack_channel_id(Channel, ChannelId),
    format(atom(Url), 'https://app.slack.com/client/~w/~w', [ClientId, ChannelId]).
url(Project, Url) :-
    jira_site(Project, Site),
    jira_board(Project, Board),
    format(atom(Url), 'https://~w.atlassian.net/jira/software/projects/~w/boards/~w?filter=&groupBy=assignee', [Site, Project, Board]).
url(Dashboard, Url) :-
    dashboard(App, Dashboard),
    deployed_on(App, Cluster),
    cluster_domain(Cluster, Domain),
    format(atom(Url), 'https://dashboard.~w.~w/', [App, Domain]).

% Repos in the same organisation are siblings (riskx and injectx, for example).
sibling_repo(Repo, Sibling) :-
    repo(Repo, Org),
    repo(Sibling, Org),
    Repo \== Sibling.
