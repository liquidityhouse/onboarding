% agent_tasks.pl — what an agent does, step by step, to read this pack's outside data again.
%
% The steps are composed by rules from the facts: one item per repository to read, per GitHub
% user to count or skip (active or not, by the activity rule), per file to write. The
% agent_instructions MCP tool, the explorer and npm run github-commits all follow the same
% items, so changing a rule here changes both what an agent is told and what the script does.

agent_task(commit_activity, 'knowledge/liquidity_house/github-activity.json').
agent_task(commit_counts, 'knowledge/liquidity_house/github-commits.json').
purpose(commit_activity, 'to note when each member of the GitHub organisation last committed, which decides who is active, in a browser signed in to GitHub when npm run github-commits has no token').
purpose(commit_counts, 'to count each active developer''s commits in each repository again, in a browser signed in to GitHub when npm run github-commits has no token').

% --- When each member of the organisation last committed: this decides who is active ---
task_step(commit_activity, 1, sign_in(Org)) :- github_account(liquidity_house, Org).
task_step(commit_activity, 2, list_members(Org)) :- github_account(liquidity_house, Org).
task_step(commit_activity, 3, last_commit(Org, Login)) :- github_account(liquidity_house, Org), last_commit_week(Login, _).
task_step(commit_activity, 4, write_file(File)) :- agent_task(commit_activity, File).
task_step(commit_activity, 5, run_checks).

% --- Commits in each repository, counted for active developers and skipped for the rest ---
task_step(commit_counts, 1, sign_in(Org)) :- github_account(liquidity_house, Org).
task_step(commit_counts, 2, first(commit_activity)).
task_step(commit_counts, 3, read_repository(Org, Repo)) :-
    github_account(liquidity_house, Org), repo(Repo, liquidity_house).
task_step(commit_counts, 4, count(Person, Login, Days)) :-
    developer_login(Person, Login), login_activity(Login, active),
    last_commit_week(Login, Week), days_before_reading(Week, Days).
task_step(commit_counts, 4, skip(Login, Days, Window)) :-
    login_activity(Login, inactive), last_commit_week(Login, Week), days_before_reading(Week, Days),
    activity_window(commit_activity, Window).
task_step(commit_counts, 4, unknown(Login)) :-
    login_activity(Login, active), \+ github_login(_, Login).
task_step(commit_counts, 5, write_file(File)) :- agent_task(commit_counts, File).
task_step(commit_counts, 6, run_checks).

% The shape of each line a task writes in its file.
row_format('knowledge/liquidity_house/github-activity.json', '["<GitHub user>","<date of the last commit, YYYY-MM-DD>"]').  % newest first
row_format('knowledge/liquidity_house/github-commits.json', '["<repository>","<person>",<commits>]').

% --- How each kind of item is worded for an agent ---
step_text(sign_in(Org), T) :-
    format(atom(T), "Use a browser signed in to GitHub with access to the ~w organisation, such as BrowserOS neo.", [Org]).
step_text(first(Task), T) :-
    agent_task(Task, File),
    format(atom(T), "First bring ~w up to date (the agent_instructions steps for ~w): it decides who is active.", [File, Task]).
step_text(list_members(Org), T) :-
    format(atom(T), "List the organisation's members on https://github.com/orgs/~w/people; a new member gets a line too.", [Org]).
step_text(last_commit(Org, Login), T) :-
    format(atom(T), "Find the date of GitHub user ~w's last commit: https://github.com/search?q=org%3A~w+author%3A~w&type=commits&s=committer-date&o=desc lists the newest first.", [Login, Org, Login]).
step_text(read_repository(Org, Repo), T) :-
    format(atom(T), "Open https://github.com/~w/~w/graphs/contributors; in that page, GET /~w/~w/graphs/contributors-data with the header Accept: application/json gives each contributor's commits (ask again while it answers 202). Commits on other branches count once: /~w/~w/commits/<branch>?author=<GitHub user> lists them.", [Org, Repo, Org, Repo, Org, Repo]).
step_text(count(Person, Login, Days), T) :-
    format(atom(T), "Count ~w's commits (GitHub user ~w) in each repository: active, last committed ~w days before the activity data was read.", [Person, Login, Days]).
step_text(skip(Login, Days, Window), T) :-
    format(atom(T), "Skip GitHub user ~w: inactive, last committed ~w days before the activity data was read, beyond the ~w-day activity window.", [Login, Days, Window]).
step_text(unknown(Login), T) :-
    format(atom(T), "Skip GitHub user ~w for now: active, but the knowledge base does not say who it is; ask for a github_login/2 fact if they are on the team.", [Login]).
step_text(write_file(File), T) :-
    row_format(File, Row),
    format(atom(T), "Update ~w: keep its other fields, set as_of (if it has one) to today, set made_by to who refreshed it, how and when (for example: refreshed on <date> by <agent> in <browser>, following the agent_instructions steps), and list one ~w line per item, most first.", [File, Row]).
step_text(run_checks, 'Check the result: npm run readme, npm run readme:check and npm run mcp:check. The explorer and the MCP tools use the new data at once.').
