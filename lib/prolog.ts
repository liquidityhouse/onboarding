// Trealla Prolog (WASM) engine wrapper: consults the KB program and runs api/1 requests.
// Runs on the server only; the browser talks to the REST endpoints in server.ts.

import { load, Prolog } from "trealla";
import type {
  Context, Explanation, GoalExplanation, Graph, Overview, Session, User, Verification,
} from "./kb-types.ts";

let runtime: Promise<void> | null = null;

/** Quote a JS value as a Prolog atom or number literal, so input is never spliced in as code. */
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

  session(who: { user: string } | { email: string }): Promise<Session> {
    return this.api<Session>("user" in who ? `session(user(${literal(who.user)}))` : `session(email(${literal(who.email)}))`);
  }

  async users(): Promise<User[]> {
    return (await this.api<{ users: User[] }>("users")).users;
  }

  graph(role: string): Promise<Graph> {
    return this.api<Graph>(`graph(${literal(role)})`);
  }

  explain(entity: string | number, role: string): Promise<Explanation> {
    return this.api<Explanation>(`explain(${literal(entity)}, ${literal(role)})`);
  }

  overview(domain: string, role: string): Promise<Overview> {
    return this.api<Overview>(`overview(${literal(domain)}, ${literal(role)})`);
  }

  context(entity: string, depth: number, role: string, maxTriples: number): Promise<Context> {
    return this.api<Context>(`context(${literal(entity)}, ${int(depth)}, ${literal(role)}, ${int(maxTriples)})`);
  }

  verify(who: string, service: string, done: string[], role: string): Promise<Verification> {
    return this.api<Verification>(
      `verify(${literal(who)}, ${literal(service)}, [${done.map(literal).join(", ")}], ${literal(role)})`);
  }

  /** `expression` is parsed by Prolog (read_term_from_atom), never spliced into the query. */
  explainGoal(expression: string, maxAnswers: number, role: string): Promise<GoalExplanation> {
    return this.api<GoalExplanation>(`explain_goal(${literal(expression)}, ${int(maxAnswers)}, ${literal(role)})`);
  }
}

function int(n: number): string {
  if (!Number.isInteger(n)) throw new Error(`expected an integer, got ${n}`);
  return String(n);
}
