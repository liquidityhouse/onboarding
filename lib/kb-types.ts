// Shapes of the JSON the knowledge base answers with (kb/api.pl). Shared by the
// servers and, type-only, by the browser UI.

/** Answers that cannot be given carry a `problem` plus hints (suggestions, allowed domains, …). */
export interface Problem { problem?: string; [hint: string]: unknown }

export interface Session extends Problem {
  user: string; name: string; role: string; role_label: string;
  domains: string[]; features: string[]; start: string | null;
}
export interface User { id: string; name: string; role: string }

export interface Domain { id: string; label: string }
export interface Predicate { id: string; arity: number; domain: string; label: string; derived: boolean }
export interface TypeStyle { id: string; label: string; color: string; shape: string }
/** One clause of a rule: its words, its slots (variables, named after concepts) and, for technical roles, the clause. */
export interface Rule {
  predicate: string; clause: number; text: string; slots: string[];
  /** Technical roles: the clause as written in its file… */
  source?: { file: string; line: number; text: string };
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
export interface Triple {
  s: string | number; p: string; o: string | number;
  pred: string; domain: string; derived: boolean; severity: string;
  /** How many proofs reach it; the first one is shown. */
  ways: number;
  via: Via | null;
}
/** Everything the explorer draws, already limited to the asker's role. */
export interface Graph extends Problem {
  domains: Domain[]; predicates: Predicate[]; types: TypeStyle[];
  rules: Rule[]; entities: Entity[]; triples: Triple[];
}

export interface Line { depth: number; kind: string; text: string }
export interface Conclusion { predicate: string; severity: string; goal: string; text: string; via: Via | null; lines: Line[]; proof?: string }
export interface Explanation extends Problem { id: string; type: string; phrase: string; facts: string[]; conclusions: Conclusion[] }

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
export interface Requirement { item: string; type: string; action: string; satisfied: boolean; link: string | null; ask: string[]; because: string[] }
export interface Verification extends Problem {
  who: string; service: string; known: boolean; ready: boolean; summary: string; missing: string[]; requirements: Requirement[];
}
export interface GoalExplanation extends Problem {
  expression: string;
  holds?: boolean;
  answers_total?: number;
  answers?: {
    bindings: Record<string, unknown>; text: string; severity: string;
    /** false when the goal is a stated fact rather than inferred by a rule */
    derived: boolean;
    via?: Via | null;
    explanation: string; lines?: Line[]; proof?: string;
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
}
/** POST /api/plan: constraints for choosing candidates. */
export interface PlanRequest { keep?: string[]; kindsOff?: string[]; maxRules?: number; exceptions?: boolean; alternatives?: number }
export interface Plan { candidates: string[]; saving: number; cost: number }
