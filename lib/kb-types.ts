// Shapes of the JSON the knowledge base answers with (kb/api.pl). Shared by the
// servers and, type-only, by the browser UI.

/** Answers that cannot be given carry a `problem` plus hints (suggestions, allowed domains, …). */
export interface Problem { problem?: string; [hint: string]: unknown }

export interface Session extends Problem {
  user: string; name: string; role: string; role_label: string;
  domains: string[]; features: string[]; start: string | null;
  /** The explorer's name and tagline, from the knowledge (app_title/1, app_tagline/1). */
  title: string; tagline: string;
}
export interface User { id: string; name: string; role: string }

export interface Domain { id: string; label: string }
export interface Predicate { id: string; arity: number; domain: string; label: string; derived: boolean }
export interface TypeStyle { id: string; label: string; color: string; shape: string }
/** One clause of a rule: its words, its slots (variables, named after concepts) and, for technical roles, the clause. */
/** Where a clause is written; a generated fact names the module that generates it instead of a line. */
export interface Snippet { label: string; file: string; line: number; text: string }
export interface Source {
  file: string; line?: number; text: string; generated?: boolean;
  /** Local overrides: the fact is in the state file, not in a pack. */
  local?: boolean;
  /** Generated facts: where the fact was read from, and the code that generated it. */
  origin?: Snippet; generator?: Snippet;
  /** Facts from a pack data file: the page each was read from, how the file was made (which agent
   *  or npm command, when), the script that makes it again, and the agent task that does it by hand. */
  read_from?: { label: string; url: string }; made_by?: Snippet; script?: Snippet; agent_task?: { label: string; id: string };
}
export interface Rule {
  predicate: string; clause: number; text: string; slots: string[];
  /** Technical roles: the clause as written in its file… */
  source?: Source;
  /** …or reprinted from the loaded clause when the file has none. */
  pattern?: string;
}
export interface Binding { name: string; value: string }
/** How a derived fact was made: which clause of its rule, and what each slot stood for. */
export interface Via {
  rule: number; bindings: Binding[];
  /** Technical roles: the clause with this fact's values, and the query that asks for it again. */
  instance?: string; query?: string;
}
export interface Entity { id: string; type: string; label: string }
/** How a fact came to be known; names and meanings come from the knowledge base (Graph.kinds). */
export type KnowledgeKind = "stated" | "generated" | "derived" | "local";

/** What a change to local overrides did (lib/overrides.ts), with the changes after it. */
export interface Outcome extends Problem {
  added?: { fact: string; text: string }[];
  removed?: { fact: string; text: string }[];
  undone?: string[];
  skipped?: { text: string; reason: string }[];
  changes?: Change[];
}

/** A local override (lib/overrides.ts): what changed, who changed it, through what and when. */
export interface Change {
  id: string; op: "add" | "remove"; fact: string; text: string;
  /** Who changed it, through what, and from where, in words (without the date). */
  summary: string;
  by: string; by_name: string; by_role: string | null; via: string; via_label: string; at: string;
  /** A removal whose fact is no longer in its file. */
  stale: boolean;
  /** pasted, or the URL the facts were read from */
  source?: string;
  /** The fact an edit replaced, in words. */
  replaces?: string;
}
export interface Kind { id: KnowledgeKind; label: string; hint: string }
export interface Triple {
  s: string | number; p: string; o: string | number;
  pred: string; domain: string; derived: boolean; kind: KnowledgeKind; severity: string;
  /** How many proofs reach it; the first one is shown. */
  ways: number;
  via: Via | null;
  /** The local change that added it, when it is a local override. */
  change: Change | null;
}
/** Everything the explorer draws, already limited to the asker's role. */
export interface Graph extends Problem {
  domains: Domain[]; predicates: Predicate[]; types: TypeStyle[];
  /** The kinds of knowledge, named and explained by the knowledge base. */
  kinds: Kind[]; words: { relation: string };
  rules: Rule[]; entities: Entity[]; triples: Triple[];
}

export interface Line { depth: number; kind: string; text: string }
export interface Conclusion { predicate: string; severity: string; goal: string; text: string; via: Via | null; lines: Line[] }
/** A stated fact in words; technical roles also get where it is written. */
export interface StatedFact { text: string; kind: KnowledgeKind; change: Change | null; source?: Source }
export interface Explanation extends Problem {
  id: string; type: string; phrase: string;
  /** Other entities whose names differ only in case or punctuation, and what to call them. */
  similar: { id: string; type: string; phrase: string }[]; similar_label: string;
  facts: StatedFact[]; conclusions: Conclusion[];
}

export interface Overview extends Problem {
  role: string;
  domains: { id: string; label: string; relations: string[]; entities: Record<string, string[]> }[];
  services: string[];
  rules: string[];
}
export interface ContextTriple { subject: string | number; predicate: string; object: string | number; relation: string; derived: boolean; hops: number }
export interface Context extends Problem {
  entity: string; type: string; depth: number; role: string; total: number; truncated: boolean;
  triples: ContextTriple[]; entities: Record<string, string>;
}
export interface Requirement {
  item: string; type: string; action: string; satisfied: boolean; link: string | null; ask: string[]; because: string[];
  /** The local change behind its tick, if any. */
  change: Change | null;
}
export interface Verification extends Problem {
  who: string; who_name: string; who_role: string | null; service: string; known: boolean; ready: boolean; summary: string; missing: string[]; requirements: Requirement[];
}
export interface GoalExplanation extends Problem {
  expression: string;
  holds?: boolean;
  answers_total?: number;
  answers?: {
    bindings: Record<string, unknown>; text: string; severity: string;
    /** false when the goal is a stated fact rather than inferred by a rule */
    derived: boolean;
    kind?: KnowledgeKind;
    via?: Via | null;
    /** Technical roles, stated answers: where the fact is written. */
    source?: Source;
    /** Technical roles, derived answers: the facts it rests on that were read from outside the repository. */
    used?: (Source & { fact: string })[];
    explanation: string; lines?: Line[];
  }[];
  rule?: string;
  descriptions?: string[];
}

/** What GET /api/session returns: the asker plus how identity was established. */
export interface SessionInfo {
  session: Session;
  auth: "dev" | "proxy";
  users?: User[];
  version: string;
  files?: { name: string; lines: number }[];
  /** Load problems in full, for roles with the technical feature… */
  warnings?: string;
  /** …and just the fact that something is missing, for everyone else. */
  incomplete?: boolean;
}

/** GET /api/audit: what is stated, generated and derived, in symbols, and what could be said more briefly. */
export interface AuditRelation {
  id: string; arity: number; domain: string; label: string; kind: "stated" | "generated" | "derived";
  facts: number; symbols: number;
  /** derived only */
  clauses?: { clause: number; symbols: number; facts: number; only: number }[];
  rule_symbols?: number; saving?: number; reads?: string[];
}
export interface Candidate {
  id: string; kind: string; relation: string; body: string[];
  saving: number; cost: number;
  covers: { item: string; symbols: number }[];
  clauses: string[]; exceptions: string[]; alternatives: string[];
}
export interface Audit extends Problem {
  totals: {
    stated: { facts: number; symbols: number }; generated: { facts: number; symbols: number };
    derived: { facts: number; symbols: number }; rules: { clauses: number; symbols: number };
    lexicon: { entries: number; symbols: number }; now: number; without_rules: number;
  };
  relations: AuditRelation[];
  kinds: { id: string; label: string; description: string }[];
  candidates: Candidate[];
  reads: { relation: string; reads: string }[];
  /** The code behind generated facts (generators, with the facts each produces) and behind the
   *  capabilities, endpoints and tools (implementations), by size in symbols, largest first. */
  implementations: { kind: "generator" | "implementation"; id: string; file: string; line: number; symbols: number; facts?: number; text: string }[];
}
/** POST /api/plan: constraints for choosing candidates. */
export interface PlanRequest { keep?: string[]; kindsOff?: string[]; maxRules?: number; exceptions?: boolean; alternatives?: number }
export interface Plan { candidates: string[]; saving: number; cost: number }
