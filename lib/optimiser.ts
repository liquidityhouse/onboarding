// Chooses which compression candidates to apply: kb/plan.lp, solved by clingo, finds the set
// that saves the most symbols within the asker's constraints, then the next best ones.
//
// The audit (kb/audit.pl) proposes and scores candidates one by one; this adds what one-by-one
// scoring cannot: candidates that cover the same facts, constraints, and alternatives.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import clingo from "clingo-wasm";
import type { Audit, Plan, PlanRequest } from "./kb-types.ts";

const ENCODING = join(import.meta.dirname, "..", "kb", "plan.lp");

/** Names become generated ids, so nothing from the KB or the request is spliced into the program. */
function ids(prefix: string) {
  const map = new Map<string, string>();
  return (name: string) => map.get(name) ?? (map.set(name, `${prefix}${map.size}`), map.get(name)!);
}

export async function plans(audit: Audit, req: PlanRequest): Promise<Plan[]> {
  const rel = ids("r");
  const item = ids("f");
  const kind = ids("k");
  const known = new Map(audit.candidates.map((c) => [`c${audit.candidates.indexOf(c)}`, c]));
  const facts: string[] = [];
  const weight = new Map<string, number>();
  for (const [i, c] of audit.candidates.entries()) {
    const id = `c${i}`;
    facts.push(`cand(${id}, ${Math.max(0, Math.round(c.cost))}).`, `kind(${id}, ${kind(c.kind)}).`,
      `exceptions(${id}, ${c.exceptions.length}).`, `head(${id}, ${rel(c.relation)}).`);
    if (c.kind !== "shared_conjunction") for (const b of c.body) facts.push(`body(${id}, ${rel(b)}).`);
    for (const cover of c.covers) {
      const f = item(`${c.kind === "shared_conjunction" ? c.id : ""}${cover.item}`);
      weight.set(f, Math.max(0, Math.round(cover.symbols)));
      facts.push(`covers(${id}, ${f}).`);
    }
  }
  for (const [f, w] of weight) facts.push(`stated(${f}, ${w}).`);
  for (const r of audit.reads) facts.push(`reads(${rel(r.relation)}, ${rel(r.reads)}).`);
  for (const r of req.keep ?? []) facts.push(`keep(${rel(r)}).`);
  for (const k of req.kindsOff ?? []) facts.push(`kind_off(${kind(k)}).`);
  if (req.maxRules !== undefined) facts.push(`max_rules(${req.maxRules}).`);
  if (req.exceptions === false) facts.push("no_exceptions.");

  const encoding = await readFile(ENCODING, "utf8");
  const baseline = [...weight.values()].reduce((a, b) => a + b, 0);
  const found: Plan[] = [];
  const avoid: string[] = [];
  for (let p = 0; p < (req.alternatives ?? 1); p++) {
    const result = await clingo.run([encoding, ...facts, ...avoid].join("\n"), 0, ["--opt-mode=opt"]);
    if (result.Result === "ERROR") throw new Error(`optimiser: ${result.Error}`);
    if (result.Result === "UNSATISFIABLE") break;
    const witnesses = result.Call.at(-1)?.Witnesses ?? [];
    const best = witnesses.at(-1);
    if (!best) break;
    const chosen = best.Value.map((v) => v.replace(/^sel\((\w+)\)$/, "$1"));
    const cost = best.Costs?.[0] ?? 0;   // the symbols level (@2); Costs[1] counts candidates
    const plan = { candidates: chosen.map((c) => known.get(c)!.id), saving: baseline - cost, cost };
    if (found.length && plan.saving < 0) break;
    found.push(plan);
    avoid.push(`plan_size(p${p}, ${chosen.length}).`, ...chosen.map((c) => `avoid(p${p}, ${c}).`));
  }
  return found;
}
