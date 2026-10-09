% lexicon.pl — the primitive vocabulary every label and explanation is built from.
%
% Nothing here is a finished sentence. explain.pl composes sentences, edge
% labels, rule descriptions and calculations from these words, so adding a
% relation usually needs at most one noun/2 or verb/2 line (atoms like
% wallet_exposure are humanised to "wallet exposure" by default).

% noun(Concept, Phrase) — what a concept, attribute, type, role or user is called.
% For a predicate P(S, O), it names O: noun(repo, organisation).
noun(ggr_90d, '90-day gross gaming revenue').
noun(net_deposits, 'net player deposits').
noun(dau, 'daily active user count').
noun(exposure_warning, 'exposure level').
noun(risk_weight, value).
noun(weight, 'risk weight').
noun(step, 'onboarding step').
noun(url, link).
noun(platform, 'RiskX platform').
noun(workspace, 'Slack workspace').
noun(channel, 'Slack channel').
noun(identifier, 'ID').
noun(jira_project, 'Jira project').
noun(repo, organisation).
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
noun(admin, administrator).
noun(dominic, 'Dominic, Head of Risk').
noun(adam, 'Adam, Software Engineer').

% plural(Concept) — takes "are" instead of "is".
plural(net_deposits).

% verb(Relation, Phrase) — relations read as "Subject Verb Object".
% Predicates without a verb are attributes: "the <noun> of Subject is Value".
verb(onboarding, includes).
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
verb(monitored_by, 'is monitored by').
verb(operator, 'has status').
verb(slack_channel, contains).

% arg_verb(Relation, ArgN, Phrase) — how extra arguments of n-ary facts attach.
:- dynamic(arg_verb/3).

% unit(Attribute, Unit) and how a unit is written after a number.
unit(ggr_90d, usd).
unit(net_deposits, usd).
unit(wallet_exposure, usd).
unit(soft_credit_limit, usd).
unit(daily_allowance, usd).
unit(dau, count).
unit_word(usd, 'USD').

% bare(Type) — entities of this type are written without "<type> '...'".
bare(url).
bare(value).
bare(status).
bare(identifier).
bare(account).
bare(domain).
bare(email).
bare(concept).

% flag(Attribute, Value, Severity) — values that deserve attention.
flag(exposure_warning, high, warning).

% Operators, as words and symbols.
op_word(>, 'is greater than').
op_word(<, 'is less than').
op_word(>=, 'is at least').
op_word(=<, 'is at most').
op_word(=:=, equals).
op_word(=\=, 'differs from').
op_word(\==, 'differs from').
op_symbol(+, '+').
op_symbol(-, '−').
op_symbol(*, '×').
op_symbol(/, '÷').
op_precedence(+, 1).
op_precedence(-, 1).
op_precedence(*, 2).
op_precedence(/, 2).

% Connectives used when joining phrases.
connective(and, and).
connective(when, when).
connective(calculated, 'Calculated:').
connective(checked, 'Checked:').
connective(built, 'Built:').
connective(from, from).
