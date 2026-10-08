// Trealla Prolog (WASM) engine wrapper: consults the KB program and runs api/1 requests.

import { load, Prolog } from "trealla";

export interface Domain { id: string; label: string }
export interface Predicate { id: string; arity: number; domain: string; label: string; derived: boolean }
export interface TypeStyle { id: string; label: string; color: string; shape: string }
export interface Role { id: string; label: string; domains: string[]; features: string[]; start: string | null }
export interface User { id: string; name: string; role: string }
export interface Rule { predicate: string; text: string }
export interface Entity { id: string; type: string; label: string }
export interface Triple {
  s: string | number; p: string; o: string | number;
  pred: string; domain: string; derived: boolean; severity: string;
}
export interface Snapshot {
  domains: Domain[]; predicates: Predicate[]; types: TypeStyle[]; roles: Role[];
  users: User[]; rules: Rule[]; entities: Entity[]; triples: Triple[];
}
export interface Line { depth: number; kind: string; text: string }
export interface Conclusion { predicate: string; severity: string; goal: string; text: string; lines: Line[]; proof: string }
export interface Explanation { id: string; type: string; phrase: string; facts: string[]; conclusions: Conclusion[] }

export interface KbFile { name: string; lines: number; sha: string; modified: number }
export interface KbPayload { version: string; loadedAt: number; files: KbFile[]; program: string }

let runtime: Promise<void> | null = null;

/** Quote a JS value as a Prolog atom or number literal. */
export function literal(x: string | number): string {
  if (typeof x === "number") return String(x);
  return `'${x.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export class KbEngine {
  private pl: Prolog;
  private queue: Promise<unknown> = Promise.resolve();
  readonly warnings: string;

  private constructor(pl: Prolog, warnings: string) {
    this.pl = pl;
    this.warnings = warnings;
  }

  static async create(program: string): Promise<KbEngine> {
    runtime ??= load();
    await runtime;
    const pl = new Prolog();
    await pl.consultText(program);
    // Consult errors (syntax errors etc.) surface on the first query's output.
    const probe = await pl.queryOnce("true.");
    const warnings = `${probe.stdout ?? ""}${probe.stderr ?? ""}`.trim();
    return new KbEngine(pl, warnings);
  }

  /** Queries run one at a time so outputs never interleave. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  api<T>(request: string): Promise<T> {
    return this.serial(async () => {
      const answer = await this.pl.queryOnce(`api(${request}).`);
      if (answer.status !== "success") {
        throw new Error(`api(${request}) ${answer.status}: ${JSON.stringify("error" in answer ? answer.error : answer.stderr ?? "")}`);
      }
      const json = JSON.parse(answer.stdout ?? "");
      if (json && typeof json === "object" && "error" in json) throw new Error(`api(${request}) not understood`);
      return json as T;
    });
  }

  snapshot(): Promise<Snapshot> {
    return this.api<Snapshot>("snapshot");
  }

  explain(entity: string | number): Promise<Explanation> {
    return this.api<Explanation>(`explain(${literal(entity)})`);
  }

  /** Free-form goal for the developer console; returns toplevel-style lines. */
  console(goal: string, limit = 50): Promise<string[]> {
    return this.serial(async () => {
      const out: string[] = [];
      const text = goal.trim().replace(/\.?$/, ".");
      for await (const answer of this.pl.query(text, { format: "prolog" })) {
        out.push(String(answer));
        if (out.length >= limit) {
          out.push(`… stopped after ${limit} answers`);
          break;
        }
      }
      return out.length ? out : ["false."];
    });
  }
}
