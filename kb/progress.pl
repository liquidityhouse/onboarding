% progress.pl — what each person or agent has already set up.
%
% completed(Who, Item): Who has done the item's action (cloned the repository,
% set up the environment, got the access). Agents can also pass what they have
% done when they ask the MCP tools to verify a task, without editing this file.
% Example: completed(adam, onboarding).

:- dynamic(completed/2).
