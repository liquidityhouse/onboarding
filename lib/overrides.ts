// Local overrides as operations, for the explorer (REST) and agents (MCP) alike: check facts
// against the knowledge base, then add, remove, edit or undo them in the override store, or
// mark a service's setup steps done. Each change records who made it and how, and the
// knowledge base reloads with it at once.

import { sourceClauses } from "./kb-source.ts";
import { current, invalidate } from "./kb-service.ts";
import type { Change as ChangeView, Outcome, Problem } from "./kb-types.ts";
import { clauseOf, updateChanges, type Change, type Site } from "./override-store.ts";
import { literal, type KbEngine } from "./prolog.ts";

/** Who changes the knowledge, and through what. */
export interface Actor { user: string; via: "explorer" | "mcp" }

/** fact_check/1: a fact in canonical form and in words, whether it holds, and where it is written. */
interface Checked extends Problem {
  fact: string; text: string; predicate: string; holds: boolean; kind: string | null; shown: boolean;
  change: { id: string } | null; site?: Site;
}

const MAX_TEXT = 65_536;
const MAX_FETCHED = 262_144;

const check = (engine: KbEngine, text: string) => engine.api<Checked>(`fact_check(${literal(text)})`);
const newId = () => crypto.randomUUID().slice(0, 8);
const now = () => new Date().toISOString().slice(0, 19) + "Z";

/** Every local change, with its fact in words and who made it. */
export async function listChanges(): Promise<ChangeView[]> {
  const { engine } = await current();
  return (await engine.api<{ changes: ChangeView[] }>("overrides")).changes;
}

async function done(outcome: Outcome): Promise<Outcome> {
  invalidate();
  return { ...outcome, changes: await listChanges() };
}

/**
 * Add the facts in a text (pasted, or fetched from `source`). Rules and directives are
 * skipped, as are facts that already hold. kb_predicate/3 facts go first, so a relation
 * declared in the same text can be used by the facts after it.
 */
export async function addFacts(text: string, actor: Actor, source?: string): Promise<Outcome> {
  if (text.length > MAX_TEXT) return { problem: `the text is longer than ${MAX_TEXT} characters` };
  const clauses = sourceClauses(text);
  if (!clauses.length) return { problem: "no facts found: write them as relation(argument, …)." };
  const declarations = clauses.filter((c) => c.name === "kb_predicate" && c.arity === 3);
  const added: { fact: string; text: string }[] = [];
  const skipped: { text: string; reason: string }[] = [];
  for (const batch of [declarations, clauses.filter((c) => !declarations.includes(c))]) {
    const { engine } = await current();
    const fresh: Change[] = [];
    for (const c of batch) {
      const written = clauseOf(c.text);
      if (c.rule) { skipped.push({ text: written, reason: "only facts are added here, not rules" }); continue; }
      const r = await check(engine, written);
      if (r.problem) { skipped.push({ text: written, reason: r.problem }); continue; }
      if (r.holds || added.some((a) => a.fact === r.fact)) { skipped.push({ text: written, reason: "already known" }); continue; }
      added.push({ fact: r.fact, text: r.text });
      fresh.push({ id: newId(), op: "add", fact: r.fact, by: actor.user, via: actor.via, at: now(), ...(source ? { source } : {}) });
    }
    if (fresh.length) {
      await updateChanges((cs) => [...cs, ...fresh]);
      invalidate();
    }
  }
  return done({ added, skipped });
}

/** Fetch a Prolog file over HTTP(S) and add its facts. */
export async function consultUrl(url: string, actor: Actor): Promise<Outcome> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { problem: "not a URL" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { problem: "only http and https URLs can be read" };
  const res = await fetch(u, { signal: AbortSignal.timeout(5000) }).catch((e: Error) => e);
  if (res instanceof Error) return { problem: `could not read ${u.href}: ${res.message}` };
  if (!res.ok) return { problem: `${u.href} answered ${res.status}` };
  const text = await res.text();
  if (text.length > MAX_FETCHED) return { problem: `${u.href} is longer than ${MAX_FETCHED} characters` };
  return addFacts(text, actor, u.href);
}

/** Remove a fact here: undo it when it was added locally, otherwise leave it out of its file. */
export async function removeFact(fact: string, actor: Actor): Promise<Outcome> {
  const { engine } = await current();
  const r = await check(engine, fact);
  if (r.problem) return { problem: r.problem };
  if (!r.holds) return { problem: `${r.text} is not known, so there is nothing to remove` };
  if (r.kind === "local" && r.change) return undo([r.change.id]);
  if (!r.site) return { problem: `${r.text} is generated from the repository: change where it is read from instead` };
  const site = { ...r.site, text: clauseOf(r.site.text) };
  await updateChanges((cs) => [...cs, { id: newId(), op: "remove", fact: r.fact, by: actor.user, via: actor.via, at: now(), site }]);
  return done({ removed: [{ fact: r.fact, text: r.text }] });
}

/** Replace a fact with another: the old one is removed (or its local addition undone), the new one added. */
export async function editFact(fact: string, replacement: string, actor: Actor): Promise<Outcome> {
  const { engine } = await current();
  const [old, next] = [await check(engine, fact), await check(engine, replacement)];
  if (old.problem) return { problem: old.problem };
  if (next.problem) return { problem: next.problem };
  if (!old.holds) return { problem: `${old.text} is not known, so there is nothing to replace` };
  if (next.holds) return { problem: `${next.text} is already known` };
  if (old.kind !== "local" && !old.site) return { problem: `${old.text} is generated from the repository: change where it is read from instead` };
  const at = now();
  await updateChanges((cs) => [
    ...cs.filter((c) => c.id !== old.change?.id),
    ...(old.kind === "local" || !old.site ? [] : [{ id: newId(), op: "remove" as const, fact: old.fact, by: actor.user, via: actor.via, at, site: { ...old.site, text: clauseOf(old.site.text) } }]),
    { id: newId(), op: "add", fact: next.fact, by: actor.user, via: actor.via, at, replaces: old.fact },
  ]);
  return done({ removed: [{ fact: old.fact, text: old.text }], added: [{ fact: next.fact, text: next.text }] });
}

/** Take back local changes, so the packs' own facts apply again. */
export async function undo(ids: string[]): Promise<Outcome> {
  const known = new Set((await listChanges()).map((c) => c.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) return { problem: `no local change ${missing.join(", ")}` };
  await updateChanges((cs) => cs.filter((c) => !ids.includes(c.id)));
  return done({ undone: ids });
}

type ProgressOp = { op: "add"; fact: string; text: string } | { op: "undo"; id: string } | { op: "remove"; fact: string; text: string; site: Site };

/**
 * Mark a service's setup steps done or not done for a person (all of them when `items` is
 * empty), as local completed/2 facts. Marking every step not done resets the service, for
 * an end-to-end run of its setup.
 */
export async function recordProgress(who: string, service: string, items: string[], isDone: boolean, actor: Actor): Promise<Outcome> {
  const { engine } = await current();
  const plan = await engine.api<{ ops?: ProgressOp[] } & Problem>(
    `progress_plan(${literal(who)}, ${literal(service)}, [${items.map(literal).join(", ")}], ${isDone})`);
  if (plan.problem) return { problem: plan.problem };
  const ops = plan.ops ?? [];
  const at = now();
  const drop = new Set(ops.flatMap((o) => (o.op === "undo" ? [o.id] : [])));
  await updateChanges((cs) => [
    ...cs.filter((c) => !drop.has(c.id)),
    ...ops.flatMap((o): Change[] => o.op === "add" ? [{ id: newId(), op: "add", fact: o.fact, by: actor.user, via: actor.via, at }]
      : o.op === "remove" ? [{ id: newId(), op: "remove", fact: o.fact, by: actor.user, via: actor.via, at, site: { ...o.site, text: clauseOf(o.site.text) } }] : []),
  ]);
  return done({
    added: ops.flatMap((o) => (o.op === "add" ? [{ fact: o.fact, text: o.text }] : [])),
    removed: ops.flatMap((o) => (o.op === "remove" ? [{ fact: o.fact, text: o.text }] : [])),
    undone: [...drop],
  });
}

/** One change per request, as the explorer and the change_facts tool send it. */
export interface ChangeRequest { add?: string; url?: string; remove?: string; edit?: { fact: string; with: string }; undo?: string[] }

export function changeFacts(r: ChangeRequest, actor: Actor): Promise<Outcome> {
  if (r.add) return addFacts(r.add, actor, "pasted");
  if (r.url) return consultUrl(r.url, actor);
  if (r.remove) return removeFact(r.remove, actor);
  if (r.edit) return editFact(r.edit.fact, r.edit.with, actor);
  if (r.undo?.length) return undo(r.undo);
  return Promise.resolve({ problem: "say what to change: add, url, remove, edit or undo" });
}
