// The local overrides: facts added or removed on this machine, kept in state/overrides.json
// (which git ignores) and applied whenever the knowledge base is loaded, never written into
// the pack files.
//
// A removal comments its clause out where it is written, so every other line keeps its
// number; additions follow the packs as a section of their own, with local_change/7 facts
// saying who made each change, how and when (kb/core.pl).

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const ROOT = join(import.meta.dirname, "..");
/** KB_STATE points elsewhere, so checks never touch the real overrides. */
export const STATE_FILE = process.env.KB_STATE ?? "state/overrides.json";
const PATH = resolve(ROOT, STATE_FILE);

export interface Site { file: string; line: number; text: string }

export interface Change {
  id: string;
  op: "add" | "remove";
  /** The fact in canonical form, as fact_check/1 returned it. */
  fact: string;
  /** Who made the change, and through what: the explorer or an agent over MCP. */
  by: string;
  via: "explorer" | "mcp";
  at: string;
  /** Where added facts came from: pasted text or a URL. */
  source?: string;
  /** The fact an edit replaced. */
  replaces?: string;
  /** Where a removed fact is written. */
  site?: Site;
}

/** A clause as written, without the comment lines above it. */
export const clauseOf = (text: string) => text.split("\n").filter((l) => !/^\s*%/.test(l)).join("\n");

export async function readChanges(): Promise<Change[]> {
  try {
    return (JSON.parse(await readFile(PATH, "utf8")) as { changes?: Change[] }).changes ?? [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

let writing: Promise<unknown> = Promise.resolve();

/** Change the list one write at a time; the file is replaced whole, never half-written. */
export function updateChanges(update: (changes: Change[]) => Change[]): Promise<Change[]> {
  const run = writing.then(async () => {
    const next = update(await readChanges());
    await mkdir(dirname(PATH), { recursive: true });
    const lines = next.map((c) => `    ${JSON.stringify(c)}`).join(",\n");
    await writeFile(`${PATH}.tmp`, `{\n  "changes": [\n${lines}\n  ]\n}\n`);
    await rename(`${PATH}.tmp`, PATH);
    return next;
  });
  writing = run.catch(() => undefined);
  return run;
}

const atom = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;

/**
 * The program's files with removed facts commented out, and the section of added facts and
 * local_change/7 records. A removal whose clause is no longer where it was written, nor
 * anywhere else in its file, is stale (local_stale/1) and changes nothing.
 * @implements local_overrides
 */
export function applyChanges(changes: Change[], texts: Map<string, string>): { texts: Map<string, string>; section: string } {
  const out = new Map(texts);
  const lines = [`% ===== local overrides (${STATE_FILE}) =====`];
  for (const c of changes) {
    const source = c.replaces ? `replaces(${c.replaces})` : c.source === "pasted" ? "pasted" : c.source ? `url(${atom(c.source)})` : "none";
    lines.push(`local_change(${atom(c.id)}, ${c.op}, ${c.fact}, ${atom(c.by)}, ${c.via}, ${atom(c.at)}, ${source}).`);
    if (c.op === "add") lines.push(`${c.fact}.`);
    else if (!c.site || !commentOut(out, c.site, c.id)) lines.push(`local_stale(${atom(c.id)}).`);
  }
  return { texts: out, section: `${lines.join("\n")}\n` };
}

/**
 * Comment out the clause as written (without the comment lines above it, which need not be
 * contiguous), preferring the occurrence nearest its recorded line.
 */
function commentOut(texts: Map<string, string>, site: Site, id: string): boolean {
  const text = texts.get(site.file);
  const clause = clauseOf(site.text);
  if (text === undefined || !clause) return false;
  let best = -1;
  for (let i = text.indexOf(clause); i >= 0; i = text.indexOf(clause, i + 1)) {
    const line = text.slice(0, i).split("\n").length;
    const bestLine = best < 0 ? Infinity : text.slice(0, best).split("\n").length;
    if (Math.abs(line - site.line) < Math.abs(bestLine - site.line)) best = i;
  }
  if (best < 0) return false;
  // A block comment keeps the line count and, unlike % lines, never reads as the next clause's comment.
  const removed = clause.includes("*/")
    ? clause.split("\n").map((l) => `% [removed locally: ${id}] ${l}`).join("\n")
    : `/* removed locally (${id}): ${clause} */`;
  texts.set(site.file, text.slice(0, best) + removed + text.slice(best + clause.length));
  return true;
}
