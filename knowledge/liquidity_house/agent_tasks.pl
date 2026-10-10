% agent_tasks.pl — steps an agent follows to read this pack's outside data again by hand.
%
% When a data file's script cannot run (no GitHub token yet, say), an agent with a signed-in
% browser can do the same by these steps. They are knowledge, so the agent_instructions MCP
% tool, the explorer and npm run github-commits all hand out the same words; {placeholders}
% are filled in from the facts (agent_value/3), so the lists in them never go stale.

agent_task(commit_counts, 'knowledge/liquidity_house/github-commits.json').
purpose(commit_counts, 'to count each developer''s commits in each repository again, in a browser signed in to GitHub, when npm run github-commits has no token').

agent_step(commit_counts, 1, 'Use a browser signed in to GitHub with access to the {org} organisation, such as BrowserOS neo.').
agent_step(commit_counts, 2, 'For each repository ({repos}), open https://github.com/{org}/<repository>/graphs/contributors; in that page, GET /{org}/<repository>/graphs/contributors-data with the header Accept: application/json returns every contributor''s commit total (ask again while it answers 202).').
agent_step(commit_counts, 3, 'Keep only these developers, adding up each person''s commits over their GitHub users: {developers}. Leave out everyone else and bots. A commit on another branch counts once: /{org}/<repository>/commits/<branch>?author=<GitHub user> lists them.').
agent_step(commit_counts, 4, 'Update {file}: keep summary, relation, script and read_from; set made_by to who refreshed it, how and when (for example: refreshed on <date> by <agent> in <browser>, following the agent_instructions steps for commit_counts); list one ["<repository>","<person>",<commits>] line per repository and person with commits, most first.').
agent_step(commit_counts, 5, 'Check the result: npm run readme, npm run readme:check and npm run mcp:check. The explorer and the MCP tools use the new counts at once.').

agent_value(commit_counts, org, Org) :- github_account(liquidity_house, Org).
agent_value(commit_counts, file, File) :- agent_task(commit_counts, File).
agent_value(commit_counts, repos, Repos) :-
    findall(R, repo(R, liquidity_house), Rs), join_and(Rs, Repos).
agent_value(commit_counts, developers, Devs) :-
    findall(D, ( developer_login(P, L), format(atom(D), "~w (GitHub user ~w)", [P, L]) ), Ds),
    join_and(Ds, Devs).
