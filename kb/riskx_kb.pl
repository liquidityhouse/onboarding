% riskx_kb.pl — RiskX ground facts and risk rules.
%
% Ground facts are what the Metabase / RiskX pull (every 5 minutes) would
% overwrite. Rules derive credit limits and warnings from them. Everything the
% explainer needs to inspect with clause/2 is declared dynamic.
%
% Operators marked sample_data/1 are illustrative, not real.

:- dynamic(operator/2).
:- dynamic(ggr_90d/2).
:- dynamic(dau/2).
:- dynamic(net_deposits/2).
:- dynamic(wallet_exposure/2).
:- dynamic(risk_weight/2).
:- dynamic(soft_credit_limit/2).
:- dynamic(daily_allowance/2).
:- dynamic(exposure_warning/2).
:- dynamic(in_portfolio/2).

% --- 1. Ground operator facts (pulled from Metabase / RiskX) ---
operator(dope, active).
operator(nordbet, active).
operator(spinhaus, active).
operator(vegaplay, pending).

ggr_90d(dope, 120000).
ggr_90d(nordbet, 310000).
ggr_90d(spinhaus, 64000).
ggr_90d(vegaplay, 9000).

dau(dope, 450).
dau(nordbet, 1200).
dau(spinhaus, 380).
dau(vegaplay, 40).

net_deposits(dope, 85000).
net_deposits(nordbet, 205000).
net_deposits(spinhaus, 40000).
net_deposits(vegaplay, 12000).

wallet_exposure(dope, 15000).
wallet_exposure(nordbet, 30000).
wallet_exposure(spinhaus, 18000).
wallet_exposure(vegaplay, 2500).

sample_data(nordbet).
sample_data(spinhaus).
sample_data(vegaplay).

% --- 2. System-wide risk weights & coefficients ---
risk_weight(ggr_factor, 0.50).
risk_weight(deposit_factor, 0.20).
risk_weight(exposure_penalty, 0.15).
risk_weight(exposure_threshold, 0.25).
risk_weight(daily_allowance_share, 0.10).

% --- 3. Derived logic & credit line rules ---
% Soft credit limit = GGR x ggr_factor + net deposits x deposit_factor
%                     - wallet exposure x exposure_penalty
soft_credit_limit(Operator, Limit) :-
    ggr_90d(Operator, GGR),
    net_deposits(Operator, Dep),
    wallet_exposure(Operator, Exp),
    risk_weight(ggr_factor, GF),
    risk_weight(deposit_factor, DF),
    risk_weight(exposure_penalty, Penalty),
    Limit is GGR * GF + Dep * DF - Exp * Penalty.

% Daily allowance = soft credit limit x daily_allowance_share
daily_allowance(Operator, Allowance) :-
    soft_credit_limit(Operator, Limit),
    risk_weight(daily_allowance_share, Share),
    Allowance is Limit * Share.

% Exposure warning: wallet exposure above exposure_threshold of net deposits.
exposure_warning(Operator, high) :-
    wallet_exposure(Operator, Exp),
    net_deposits(Operator, Dep),
    risk_weight(exposure_threshold, T),
    Exp > Dep * T.
exposure_warning(Operator, normal) :-
    wallet_exposure(Operator, Exp),
    net_deposits(Operator, Dep),
    risk_weight(exposure_threshold, T),
    Exp =< Dep * T.

% --- 4. Platform links ---
% RiskX monitors the operator portfolio as a whole; every operator is part of
% it, so a new operator needs no link of its own.
monitors(riskx, operators).

in_portfolio(Operator, operators) :-
    operator(Operator, _).

data_source(riskx, metabase).
