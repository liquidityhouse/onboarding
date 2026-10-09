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
export interface Rule { predicate: string; text: string }
export interface Entity { id: string; type: string; label: string }
export interface Triple {
  s: string | number; p: string; o: string | number;
  pred: string; domain: string; derived: boolean; severity: string;
}
/** Everything the explorer draws, already limited to the asker's role. */
export interface Graph extends Problem {
  domains: Domain[]; predicates: Predicate[]; types: TypeStyle[];
  rules: Rule[]; entities: Entity[]; triples: Triple[];
}

export interface Line { depth: number; kind: string; text: string }
export interface Conclusion { predicate: string; severity: string; goal: string; text: string; lines: Line[]; proof?: string }
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
