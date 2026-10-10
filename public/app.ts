// The explorer UI: draws and filters the role-scoped knowledge the server sends, and shows how
// every derived fact was reached. The server reasons over the knowledge base; this page never sees it.

import { DataSet, Network, type Edge, type Node as VisNode, type Options } from "vis-network/standalone";
import type {
  Audit, AuditRelation, Candidate, Explanation, GoalExplanation, Graph, Kind, KnowledgeKind, Line, Plan, Rule, Session, SessionInfo,
  Source, Triple, TypeStyle, Via,
} from "../lib/kb-types.ts";

type View = "mindmap" | "hierarchy" | "table" | "console" | "audit";
type Direction = "LR" | "UD" | "RL" | "DU";

interface Settings {
  view: View;
  focus: string | null;
  depth: number;
  domains: string[];
  /** Domains this viewer has been shown before; a newly visible domain starts ticked. */
  seenDomains: string[];
  hiddenPredicates: string[];
  hiddenTypes: string[];
  showValues: boolean;
  showDerived: boolean;
  edgeLabels: boolean;
  sizeByDegree: boolean;
  clickRecentres: boolean;
  physics: boolean;
  direction: Direction;
  colors: Record<string, string>;
  shapes: Record<string, string>;
}

interface GraphNode { id: string; entity: string | number; type: string; label: string; subject?: string }
interface GraphEdge { id: string; from: string; to: string; triple: Triple }

const VIEWS: { id: View; label: string; feature?: string }[] = [
  { id: "mindmap", label: "Mind map" },
  { id: "hierarchy", label: "Hierarchy" },
  { id: "table", label: "Table", feature: "table" },
  { id: "console", label: "Query", feature: "console" },
  { id: "audit", label: "Audit", feature: "technical" },
];
const SHAPES = ["dot", "box", "ellipse", "diamond", "hexagon", "triangle", "star", "square", "database", "text"];
const LABEL_INSIDE = new Set(["box", "ellipse", "database", "circle"]);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

// --- Storage (per-viewer convenience only; the KB itself lives on the server) ---
const store = {
  get<T>(key: string): T | null {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

// --- State ---
let info: SessionInfo;
let snap: Graph;
let userId = "";
let settings: Settings;
let selected: string | number | null = null;
let history: string[] = [];
let network: Network | null = null;
let refreshTimer: number | undefined;
let tableSort: { key: keyof Triple; dir: 1 | -1 } = { key: "s", dir: 1 };

const session = (): Session => info.session;
const can = (feature: string) => session().features.includes(feature);
const typeOf = (entity: string | number) =>
  typeof entity === "number" ? "value" : snap.entities.find((e) => e.id === entity)?.type ?? "concept";
const styleOf = (type: string): TypeStyle =>
  snap.types.find((t) => t.id === type) ?? { id: type, label: type, color: "#868e96", shape: "dot" };
const colorOf = (type: string) => settings.colors[type] ?? styleOf(type).color;
const shapeOf = (type: string) => settings.shapes[type] ?? styleOf(type).shape;
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// --- Kinds of knowledge (stated, generated, derived): named and explained by the knowledge base ---
const kindOf = (k: KnowledgeKind): Kind => snap.kinds.find((x) => x.id === k) ?? { id: k, label: k, hint: "" };
const kindHint = (k: KnowledgeKind) => { const i = kindOf(k); return `${i.label}: ${i.hint}`; };
const LITERAL_TYPES = new Set(["value", "url", "text"]);

/** The rule clauses behind a derived relation: the "how". */
const rulesFor = (pred: string) => snap.rules.filter((r) => r.predicate === pred);
const ruleOf = (pred: string, via: Via | null | undefined) =>
  via ? snap.rules.find((r) => r.predicate === pred && r.clause === via.rule) : undefined;

/** A rule's words with its slots (the variables it is written with) marked; with a via, each slot shows its value. */
function slotted(rule: Rule, via?: Via | null): HTMLElement {
  const out = el("span", { className: "slotted" });
  const value = new Map(via?.bindings.map((b) => [b.name, b.value]));
  const names = [...rule.slots].sort((a, b) => b.length - a.length);
  if (!names.length) { out.append(rule.text); return out; }
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<![\\p{L}\\p{N}_-])(${escaped.join("|")})(?![\\p{L}\\p{N}_-])`, "giu");
  let at = 0;
  for (const m of rule.text.matchAll(re)) {
    out.append(rule.text.slice(at, m.index));
    const name = names.find((n) => n.toLowerCase() === m[0].toLowerCase()) ?? m[0];
    const v = value.get(name);
    out.append(el("span", { className: v === undefined ? "slot" : "slot bound", title: v === undefined ? "A slot: any value that fits" : `${name} = ${v}` },
      m[0], ...(v === undefined ? [] : [el("b", {}, v)])));
    at = m.index + m[0].length;
  }
  out.append(rule.text.slice(at));
  return out;
}

/** Prolog with its comments, quoted atoms, strings, numbers, variables, functors and operators marked. */
const PL_TOKEN = /(%[^\n]*)|('(?:[^'\\]|\\.|'')*')|("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|(\b[A-Z_][A-Za-z0-9_]*\b)|(\b[a-z][A-Za-z0-9_]*(?=\())|(:-|\\\+|=\.\.|\\==|==|=<|>=|\bis\b|\?-|[=<>+*\/-])/g;
const PL_CLASS = ["", "pl-comment", "pl-atom", "pl-string", "pl-number", "pl-var", "pl-functor", "pl-op"];
function prolog(code: string, className = ""): HTMLElement {
  const pre = el("pre", { className: `code ${className}` });
  let at = 0;
  for (const m of code.matchAll(PL_TOKEN)) {
    pre.append(code.slice(at, m.index));
    const group = m.slice(1).findIndex((g) => g !== undefined) + 1;
    pre.append(el("span", { className: PL_CLASS[group] }, m[0]));
    at = m.index + m[0].length;
  }
  pre.append(code.slice(at));
  return pre;
}

/** A value as Prolog writes it: bare when it can be, quoted otherwise. */
const plValue = (v: unknown) =>
  typeof v === "number" ? String(v) : /^[a-z][A-Za-z0-9_]*$/.test(String(v)) ? String(v) : lit(String(v));

/**
 * Technical detail of a derivation: the rule as written in its file (variables unbound),
 * the same clause with this fact's values, and the query that asks for it, which can be
 * run again. `expect` is the fact's sentence, to mark its answer among the others.
 */
function prologDetail(rule: Rule, via: Via, expect?: string): HTMLElement | null {
  const code = rule.source?.text ?? rule.pattern;
  if (!code) return null;
  const where = rule.source ? ` · ${whereWritten(rule.source)}` : "";
  const box = el("details", { className: "prolog" }, el("summary", {}, `Technical detail${where}`),
    el("div", { className: "via-label" }, "Rule as written"), prolog(code));
  if (via.instance) box.append(el("div", { className: "via-label" }, "With this fact's values"), prolog(via.instance));
  if (via.query) {
    const query = via.query;
    const out = el("pre", { className: "code query-out" });
    const again = el("button", { type: "button", className: "run", textContent: "Run again" });
    const ask = async () => {
      out.textContent = "…";
      try {
        const ex = await api<GoalExplanation>(`/api/explain-goal?expression=${encodeURIComponent(query)}&max=20`);
        const answers = ex.answers ?? [];
        out.replaceChildren(...(ex.holds && answers.length ? answers.flatMap((a, i) => {
          const b = Object.entries(a.bindings);
          const line = b.length ? b.map(([k, v]) => `${k} = ${plValue(v)}`).join(", ") : "true";
          const last = i === answers.length - 1 && (ex.answers_total ?? 0) <= answers.length;
          return [el("span", { className: a.text === expect ? "this-answer" : "" }, `${line}${last ? "." : " ;"}`),
            ...(a.text === expect ? [el("span", { className: "muted" }, "   ← this fact")] : []), "\n"];
        }) : ["false."]));
        if ((ex.answers_total ?? 0) > answers.length) out.append(`… ${ex.answers_total! - answers.length} more`);
      } catch (e) {
        out.textContent = (e as Error).message;
      }
    };
    again.onclick = ask;
    let asked = false;
    box.addEventListener("toggle", () => { if (box.open && !asked) { asked = true; ask(); } });
    box.append(el("div", { className: "via-label" }, "Query"), prolog(`?- ${query}.`), out, again);
  }
  return box;
}

/** How a derived fact was made: the general rule (slots open), then what each slot stood for here. */
function viaBlock(pred: string, via: Via | null | undefined, compact = false, expect?: string): HTMLElement {
  const rule = ruleOf(pred, via);
  if (!rule || !via) {
    return el("div", { className: "via" }, ...rulesFor(pred).map((r) => el("div", { className: "rule-text" }, `How: ${r.text}`)));
  }
  const count = rulesFor(pred).length;
  const box = el("div", { className: "via" },
    el("div", { className: "via-label" }, count > 1 ? `General rule ${rule.clause} of ${count}` : "General rule"),
    el("div", { className: "rule-text" }, slotted(rule)));
  box.append(el("div", { className: "via-label" }, "Applied here with"),
    el("div", { className: "bindings" }, ...via.bindings.map((b) =>
      el("span", { className: "binding" }, el("span", { className: "slot" }, b.name), " = ", el("b", {}, b.value)))));
  const detail = compact ? null : prologDetail(rule, via, expect);
  if (detail) box.append(detail);
  return box;
}

/** Where a clause is written, as the technical-detail summary says it. */
const whereWritten = (src: Source) => src.generated ? `generated by ${src.file}` : `${src.file}:${src.line}`;

/** A stated fact as written in its file (or as generated), folded, for technical roles. */
function sourceDetail(src: Source, summary?: string): HTMLElement {
  return el("details", { className: "prolog" },
    el("summary", { title: "Show where this fact is written" }, summary ?? `Technical detail · ${whereWritten(src)}`),
    ...(summary ? [el("div", { className: "via-label" }, `Technical detail · ${whereWritten(src)}`)] : []),
    el("div", { className: "via-label" }, src.generated ? "Generated fact" : "Fact as written"), prolog(src.text));
}

/** A rule clause's Prolog, folded, for technical roles. */
function ruleCode(r: Rule): HTMLElement | string {
  const code = r.source?.text ?? r.pattern;
  if (!code) return "";
  const where = r.source ? whereWritten(r.source) : `${r.predicate} · clause ${r.clause}`;
  return el("details", { className: "prolog" }, el("summary", { className: "muted" }, `Technical detail · ${where}`), prolog(code));
}

/** The same in one line of text, for plain tooltips. */
function viaText(pred: string, via: Via | null | undefined): string {
  const rule = ruleOf(pred, via);
  if (!rule || !via) return rulesFor(pred).map((r) => `How: ${r.text}`).join("\n");
  return `How: ${rule.text}\nHere: ${via.bindings.map((b) => `${b.name} = ${b.value}`).join(", ")}`;
}

function kindBadge(kind: KnowledgeKind) {
  return el("span", { className: `kind-badge ${kind}`, textContent: kindOf(kind).label.toLowerCase(), title: kindHint(kind) });
}

/** A Prolog literal for a goal sent to /api/explain-goal (parsed there, never run as code). */
const lit = (x: string | number) =>
  typeof x === "number" ? String(x) : `'${x.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** The goal a triple stands for, when its relation is unary or binary. */
function goalOf(t: Triple): string | null {
  const arity = snap.predicates.find((p) => p.id === t.pred)?.arity;
  if (arity === 2) return `${t.pred}(${lit(t.s)}, ${lit(t.o)})`;
  if (arity === 1) return `${t.pred}(${lit(t.o)})`;
  return null;
}

/** Proof lines as a list: ƒ how (rule) · • why (fact) · = calculation · ∴ conclusion. */
function linesList(lines: Line[], from = 0) {
  return el("ul", { className: "lines" }, ...lines.slice(from).map((l) => {
    const li = el("li", { className: l.kind, textContent: l.text, title: LINE_HINT[l.kind] ?? "" });
    li.style.setProperty("--depth", String(l.depth - (from ? 1 : 0)));
    return li;
  }));
}
const LINE_HINT: Record<string, string> = {
  rule: "How: the rule that infers this",
  fact: "Why: a stated fact the rule used",
  calc: "Why: the calculation or check, with the values used",
  conclusion: "A derived fact this one builds on",
  warning: "A derived fact that needs attention",
};
const howWhyKey = () => el("p", { className: "how-why muted" }, "ƒ how (rule) · • why (facts used) · = calculation");
/** Where a proof's lines start once its top rule is shown as a general rule above them. */
const ruleShown = (lines: Line[], via: Via | null | undefined) => (via && lines[1]?.kind === "rule" ? 2 : 1);

/** Tooltip for an edge: stated, or derived with the rule clause that made it and its slot values. */
function edgeTitle(t: Triple): HTMLElement {
  const box = el("div", { className: "edge-tip" }, el("strong", {}, kindOf(t.kind).label), ` · ${t.p}`);
  if (t.derived) {
    box.append(viaBlock(t.pred, t.via, true));
    if (t.ways > 1) box.append(el("div", { className: "muted" }, `Also follows ${t.ways - 1} other way${t.ways > 2 ? "s" : ""}.`));
    box.append(el("div", { className: "muted" }, "Click the connection to see why."));
  }
  return box;
}

function defaults(s: Session): Settings {
  return {
    view: "mindmap",
    focus: s.start,
    depth: 2,
    domains: [...s.domains],
    seenDomains: [...s.domains],
    hiddenPredicates: [],
    hiddenTypes: [],
    showValues: s.role === "risk_officer",
    showDerived: true,
    edgeLabels: true,
    sizeByDegree: false,
    clickRecentres: true,
    physics: true,
    direction: "LR",
    colors: {},
    shapes: {},
  };
}

function loadSettings() {
  const s = session();
  const saved = store.get<Partial<Settings>>(`kbx:settings:${userId}`) ?? {};
  settings = { ...defaults(s), ...saved };
  const seen = saved.seenDomains ?? saved.domains ?? s.domains;
  const fresh = s.domains.filter((d) => !seen.includes(d));
  settings.domains = [...settings.domains, ...fresh].filter((d) => s.domains.includes(d));
  settings.seenDomains = [...new Set([...seen, ...s.domains])];
  if (!VIEWS.some((v) => v.id === settings.view && (!v.feature || can(v.feature)))) settings.view = "mindmap";
}

function save() {
  store.set(`kbx:settings:${userId}`, settings);
  store.set("kbx:user", userId);
  const hash = new URLSearchParams({ u: userId, v: settings.view, d: String(settings.depth) });
  if (settings.focus) hash.set("f", settings.focus);
  history_replace(`#${hash}`);
}
function history_replace(hash: string) {
  if (location.hash !== hash) window.history.replaceState(null, "", hash);
}

// --- Scope & graph construction ---
function scopedTriples(): Triple[] {
  const domains = new Set(settings.domains.filter((d) => session().domains.includes(d)));
  const hiddenPreds = new Set(settings.hiddenPredicates);
  return snap.triples.filter((t) =>
    domains.has(t.domain) && !hiddenPreds.has(t.pred) && (settings.showDerived || !t.derived));
}

function buildGraph(): { nodes: Map<string, GraphNode>; edges: GraphEdge[] } {
  const hiddenTypes = new Set(settings.hiddenTypes);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  scopedTriples().forEach((t, i) => {
    const sType = typeOf(t.s);
    const oType = typeOf(t.o);
    const literal = LITERAL_TYPES.has(oType);
    if (literal && !settings.showValues) return;
    if (hiddenTypes.has(sType) || hiddenTypes.has(oType)) return;
    const sId = String(t.s);
    // Numbers are per-fact leaves; atoms (including URLs) are shared nodes.
    const oId = typeof t.o === "number" ? `#${t.s}|${t.pred}|${t.o}` : String(t.o);
    if (!nodes.has(sId)) nodes.set(sId, { id: sId, entity: t.s, type: sType, label: sId });
    if (!nodes.has(oId)) {
      nodes.set(oId, {
        id: oId, entity: t.o, type: oType, subject: typeof t.o === "number" ? sId : undefined,
        label: typeof t.o === "number" ? t.o.toLocaleString() : shortLabel(String(t.o)),
      });
    }
    edges.push({ id: `e${i}`, from: sId, to: oId, triple: t });
  });

  const focus = settings.focus;
  if (!focus || !nodes.has(focus)) return { nodes, edges };

  // Breadth-first neighbourhood of the focus, ignoring edge direction.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
    (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from);
  }
  const level = new Map<string, number>([[focus, 0]]);
  let frontier = [focus];
  for (let d = 1; d <= settings.depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const n of adj.get(id) ?? []) {
      if (!level.has(n)) { level.set(n, d); next.push(n); }
    }
    frontier = next;
  }
  const kept = new Map([...nodes].filter(([id]) => level.has(id)));
  return { nodes: kept, edges: edges.filter((e) => kept.has(e.from) && kept.has(e.to)) };
}

function shortLabel(s: string) {
  return s.startsWith("http") ? s.replace(/^https?:\/\//, "").replace(/\/$/, "") : s;
}

function levels(nodes: Map<string, GraphNode>, edges: GraphEdge[], root: string | null): Map<string, number> {
  const out = new Map<string, number>();
  const roots = root && nodes.has(root) ? [root] : [...nodes.keys()].filter((id) => !edges.some((e) => e.to === id));
  roots.forEach((r) => out.set(r, 0));
  let frontier = [...roots];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) for (const e of edges) {
      const other = e.from === id ? e.to : e.to === id && root ? e.from : null;
      if (other && !out.has(other)) { out.set(other, out.get(id)! + 1); next.push(other); }
    }
    frontier = next;
  }
  for (const id of nodes.keys()) if (!out.has(id)) out.set(id, 0);
  return out;
}

// --- Rendering: graph ---
function renderGraph() {
  const { nodes, edges } = buildGraph();
  const container = $("graph");
  const empty = $("stage-empty");
  if (!nodes.size) {
    network?.destroy(); network = null;
    empty.hidden = false;
    empty.textContent = "Nothing in scope. Widen the domains, relations or entity types on the left.";
    return;
  }
  empty.hidden = true;
  const text = cssVar("--text");
  const surface = cssVar("--surface");
  const muted = cssVar("--muted");
  const warn = cssVar("--warn");
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const hierarchical = settings.view === "hierarchy";
  const lv = hierarchical ? levels(nodes, edges, settings.focus) : null;

  const visNodes: VisNode[] = [...nodes.values()].map((n) => {
    const color = colorOf(n.type);
    const shape = shapeOf(n.type);
    const isFocus = n.id === settings.focus;
    const size = settings.sizeByDegree ? 12 + Math.min(degree.get(n.id) ?? 0, 12) * 2.5 : 16;
    return {
      id: n.id,
      label: n.label,
      title: `${styleOf(n.type).label}: ${n.entity}`,
      shape,
      size: isFocus ? size + 8 : size,
      level: lv?.get(n.id),
      color: { background: color, border: isFocus ? text : color, highlight: { background: color, border: text } },
      borderWidth: isFocus ? 3 : 1,
      font: {
        color: shape === "text" ? color : LABEL_INSIDE.has(shape) ? "#fff" : text,
        size: isFocus ? 16 : 13,
        bold: isFocus ? { color: text } : undefined,
        strokeWidth: LABEL_INSIDE.has(shape) ? 0 : 3,
        strokeColor: surface,
      },
      margin: LABEL_INSIDE.has(shape) ? { top: 6, right: 8, bottom: 6, left: 8 } : undefined,
    } as VisNode;
  });
  const visEdges: Edge[] = edges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    label: settings.edgeLabels ? e.triple.p : undefined,
    title: edgeTitle(e.triple) as unknown as string,
    arrows: "to",
    dashes: e.triple.derived,
    width: e.triple.severity === "warning" ? 2.5 : 1,
    color: { color: e.triple.severity === "warning" ? warn : muted, highlight: cssVar("--accent") },
    font: { color: muted, size: 11, strokeWidth: 3, strokeColor: surface, align: "middle" },
    smooth: hierarchical ? { enabled: true, type: "cubicBezier", roundness: 0.4 } : { enabled: true, type: "dynamic", roundness: 0.5 },
  }));

  const options: Options = {
    autoResize: true,
    interaction: { hover: true, tooltipDelay: 150 },
    physics: hierarchical
      ? { enabled: settings.physics, hierarchicalRepulsion: { nodeDistance: 140 }, solver: "hierarchicalRepulsion" }
      : { enabled: settings.physics, solver: "forceAtlas2Based", forceAtlas2Based: { gravitationalConstant: -60, springLength: 110 }, stabilization: { iterations: 200 } },
    layout: hierarchical
      ? { hierarchical: { enabled: true, direction: settings.direction, sortMethod: "directed", levelSeparation: 200, nodeSpacing: 90 } }
      : { improvedLayout: true },
  };

  network?.destroy();
  network = new Network(container, { nodes: new DataSet(visNodes), edges: new DataSet(visEdges) }, options);
  network.once("stabilizationIterationsDone", () => network?.fit({ animation: true }));
  network.on("click", (params: { nodes: string[]; edges: string[] }) => {
    const id = params.nodes[0];
    if (!id) {
      const edge = params.edges.length === 1 ? edges.find((e) => e.id === params.edges[0]) : undefined;
      if (edge) showTriple(edge.triple);
      return;
    }
    const node = nodes.get(id)!;
    const target = node.subject ?? id;
    if (settings.clickRecentres && typeof node.entity !== "number" && node.type !== "url") setFocus(target);
    else select(node.subject ? node.subject : node.entity);
  });
  network.on("doubleClick", (params: { nodes: string[] }) => {
    const node = params.nodes[0] && nodes.get(params.nodes[0]);
    if (node && node.type === "url") window.open(String(node.entity), "_blank", "noopener");
    else if (node) setFocus(node.subject ?? node.id);
  });
}

// --- Rendering: table ---
function renderTable() {
  const filter = ($("table-filter") as HTMLInputElement).value.toLowerCase();
  const rows = scopedTriples()
    .filter((t) => !filter || [t.s, t.p, t.o, t.domain].some((v) => String(v).toLowerCase().includes(filter)))
    .sort((a, b) => {
      const x = a[tableSort.key], y = b[tableSort.key];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * tableSort.dir;
    });
  const cols: [keyof Triple, string][] = [["s", "Subject"], ["p", "Relation"], ["o", "Object"], ["domain", "Domain"], ["derived", ""]];
  const head = el("tr", {}, ...cols.map(([key, label]) => {
    const th = el("th", {}, label + (tableSort.key === key ? (tableSort.dir === 1 ? " ▲" : " ▼") : ""));
    th.onclick = () => {
      tableSort = { key, dir: tableSort.key === key ? (-tableSort.dir as 1 | -1) : 1 };
      renderTable();
    };
    return th;
  }));
  const chip = (v: string | number) => el("span", { className: "chip" }) as HTMLSpanElement;
  const cell = (v: string | number) => {
    const c = chip(v);
    c.style.background = colorOf(typeOf(v));
    return el("td", {}, c, typeof v === "number" ? v.toLocaleString() : v);
  };
  const body = el("tbody", {}, ...rows.map((t) => {
    const badge = kindBadge(t.kind);
    if (t.derived) badge.title = `${kindHint("derived")}\n${viaText(t.pred, t.via)}`;
    const why = el("button", { type: "button", className: "why", textContent: t.derived ? "why?" : "fact", title: "Show this connection in the side panel" });
    why.onclick = (e) => { e.stopPropagation(); showTriple(t); };
    const tr = el("tr", { className: t.severity === "warning" ? "warning" : "" },
      cell(t.s), el("td", { className: t.derived ? "derived" : "" }, t.p, " ", badge), cell(t.o), el("td", {}, domainLabel(t.domain)), el("td", {}, why));
    tr.onclick = () => setFocus(String(t.s), false);
    return tr;
  }));
  $("triples").replaceChildren(el("thead", {}, head), body);
}

const domainLabel = (id: string) => snap.domains.find((d) => d.id === id)?.label ?? id;

// --- Rendering: sidebar controls ---
function renderControls() {
  $("role-badge").textContent = session().role_label;

  $("views").replaceChildren(...VIEWS.filter((v) => !v.feature || can(v.feature)).map((v) => {
    const b = el("button", { type: "button", textContent: v.label });
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(settings.view === v.id));
    b.onclick = () => { settings.view = v.id; update(); };
    return b;
  }));

  // The server only sends the domains this role may see.
  $("domains").replaceChildren(...snap.domains.map((d) => {
    const input = el("input", { type: "checkbox", checked: settings.domains.includes(d.id) });
    input.onchange = () => {
      settings.domains = input.checked ? [...settings.domains, d.id] : settings.domains.filter((x) => x !== d.id);
      update();
    };
    const count = snap.triples.filter((t) => t.domain === d.id).length;
    return el("label", {}, input, `${d.label} `, el("span", { className: "muted" }, `(${count})`));
  }));

  $("predicates").replaceChildren(...snap.predicates
    .filter((p) => settings.domains.includes(p.domain))
    .map((p) => {
      const input = el("input", { type: "checkbox", checked: !settings.hiddenPredicates.includes(p.id) });
      input.onchange = () => {
        settings.hiddenPredicates = input.checked
          ? settings.hiddenPredicates.filter((x) => x !== p.id)
          : [...settings.hiddenPredicates, p.id];
        update();
      };
      return el("label", {}, input, `${p.label}${p.derived ? " (calculated)" : ""} `,
        can("technical") ? el("span", { className: "muted" }, `${p.id}/${p.arity}`) : "");
    }));

  const bind = (id: string, key: "showValues" | "showDerived" | "edgeLabels" | "sizeByDegree" | "clickRecentres" | "physics") => {
    const input = $<HTMLInputElement>(id);
    input.checked = settings[key];
    input.onchange = () => { settings[key] = input.checked; update(); };
  };
  bind("opt-values", "showValues");
  bind("opt-derived", "showDerived");
  bind("opt-labels", "edgeLabels");
  bind("opt-degree", "sizeByDegree");
  bind("opt-recentre", "clickRecentres");
  bind("opt-physics", "physics");

  const direction = $<HTMLSelectElement>("direction");
  direction.value = settings.direction;
  direction.onchange = () => { settings.direction = direction.value as Direction; update(); };
  $("direction-wrap").hidden = settings.view !== "hierarchy";

  const depth = $<HTMLInputElement>("depth");
  depth.value = String(settings.depth);
  $("depth-out").textContent = String(settings.depth);
  depth.oninput = () => { settings.depth = Number(depth.value); update(); };

  $("entity-list").replaceChildren(...snap.entities
    .filter((e) => e.type !== "url")
    .map((e) => el("option", { value: e.id, label: e.label })));

  renderTypes();
  renderCrumbs();
}

function renderTypes() {
  const counts = new Map<string, number>();
  for (const e of snap.entities) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  $("types").replaceChildren(...snap.types.map((t) => {
    const visible = el("input", { type: "checkbox", checked: !settings.hiddenTypes.includes(t.id), title: "Show this type" });
    visible.onchange = () => {
      settings.hiddenTypes = visible.checked
        ? settings.hiddenTypes.filter((x) => x !== t.id)
        : [...settings.hiddenTypes, t.id];
      update();
    };
    const color = el("input", { type: "color", value: colorOf(t.id), title: "Colour" });
    color.oninput = () => { settings.colors[t.id] = color.value; update(false); };
    const shape = el("select", { title: "Shape" }, ...SHAPES.map((s) => el("option", { value: s, textContent: s })));
    shape.value = shapeOf(t.id);
    shape.onchange = () => { settings.shapes[t.id] = shape.value; update(false); };
    const n = t.id === "value" ? "" : String(counts.get(t.id) ?? 0);
    return el("div", { className: "type-row" }, visible,
      el("span", {}, `${t.label} `, el("span", { className: "count" }, n)), color, shape);
  }));
}

function renderCrumbs() {
  $("crumbs").replaceChildren(...history.slice(-6).map((id) => {
    const b = el("button", { type: "button", textContent: id });
    b.onclick = () => setFocus(id);
    return b;
  }));
  $<HTMLButtonElement>("focus-back").disabled = history.length < 2;
  $<HTMLInputElement>("focus-input").value = settings.focus ?? "";
}

// --- Explanation panel: foldable; opening a detail unfolds it, refocusing does not ---
let panelFolded = store.get<boolean>("kbx:panelFolded") ?? false;

function setPanelFolded(folded: boolean) {
  panelFolded = folded;
  store.set("kbx:panelFolded", folded);
  document.querySelector(".layout")!.classList.toggle("panel-folded", folded);
  const b = $("panel-toggle");
  b.setAttribute("aria-expanded", String(!folded));
  b.title = folded ? "Show explanations" : "Fold explanations";
  requestAnimationFrame(() => network?.redraw());
}
const unfoldPanel = () => { if (panelFolded) setPanelFolded(false); };

async function renderExplain() {
  const target = selected ?? settings.focus;
  const panel = $("explain");
  if (target === null) return panel.replaceChildren(overview());
  let ex: Explanation;
  try {
    ex = await api<Explanation>(`/api/explain/${encodeURIComponent(String(target))}`);
  } catch (e) {
    const detail = can("technical") ? `: ${(e as Error).message}` : ".";
    return panel.replaceChildren(el("p", { className: "muted" }, `No explanation available for ${target}${detail}`));
  }
  if ((selected ?? settings.focus) !== target) return; // a newer selection won

  const typeChip = el("span", { className: "type-chip", textContent: styleOf(ex.type).label });
  typeChip.style.background = colorOf(ex.type);
  const parts: HTMLElement[] = [el("div", { className: "ex-head" }, el("h2", { textContent: String(ex.id) }), typeChip)];

  const actions = el("div", { className: "ex-actions" });
  if (settings.focus !== String(ex.id)) {
    const b = el("button", { type: "button", textContent: "Centre graph here" });
    b.onclick = () => setFocus(String(ex.id));
    actions.append(b);
  }
  if (ex.type === "url") {
    actions.append(el("a", { href: String(ex.id), target: "_blank", rel: "noopener", textContent: "Open link ↗" }));
  }
  parts.push(actions);

  if (ex.conclusions.length) {
    parts.push(el("h3", { className: "ex-section", title: kindHint("derived") }, `${kindOf("derived").label} `, kindBadge("derived")));
    const bySeverity = [...ex.conclusions].sort((a, b) => Number(b.severity === "warning") - Number(a.severity === "warning"));
    for (const c of bySeverity) {
      const details = el("details", { open: c.severity === "warning" || session().role === "risk_officer" },
        el("summary", {}, "How and why"), viaBlock(c.predicate, c.via, false, c.text), howWhyKey(), linesList(c.lines, ruleShown(c.lines, c.via)));
      parts.push(el("div", { className: `card derived ${c.severity}` }, el("div", { className: "headline", textContent: c.text }), details));
    }
  }

  if (ex.facts.length) {
    parts.push(el("h3", { className: "ex-section", title: kindHint("stated") }, `${kindOf("stated").label} `, kindBadge("stated")),
      el("ul", { className: "facts" }, ...ex.facts.map((f) => el("li", {}, f.source ? sourceDetail(f.source, f.text) : f.text))));
  }

  // Derived connections that point at this entity (the ones above start from it).
  const incoming = scopedTriples().filter((t) => t.derived && t.o === ex.id);
  if (incoming.length) {
    parts.push(el("h3", { className: "ex-section", title: kindHint("derived") }, `${kindOf("derived").label} connections to it `, kindBadge("derived")),
      ...incoming.map((t) => whyDetails(t)));
  }

  // Neighbours, with whether every connection to them is derived.
  const neighbours = new Map<string, boolean>();
  for (const t of scopedTriples()) {
    const n = t.s === ex.id && typeof t.o !== "number" ? String(t.o) : t.o === ex.id ? String(t.s) : null;
    if (n !== null && !LITERAL_TYPES.has(typeOf(n))) neighbours.set(n, (neighbours.get(n) ?? true) && t.derived);
  }
  if (neighbours.size) {
    parts.push(el("h3", { className: "ex-section" }, "Connected"),
      el("div", { className: "neighbours" }, ...[...neighbours].map(([n, derivedOnly]) => {
        const b = el("button", { type: "button", textContent: shortLabel(n), className: derivedOnly ? "derived" : "",
          title: derivedOnly ? `Connected only through derived facts. ${kindHint("derived")}` : "Connected through stated facts" });
        b.style.borderColor = colorOf(typeOf(n));
        b.onclick = () => setFocus(n);
        return b;
      })));
  }
  panel.replaceChildren(...parts);
}

/** A derived connection whose why loads when opened. */
function whyDetails(t: Triple): HTMLElement {
  const details = el("details", { className: "card derived" },
    el("summary", {}, `${t.s} ${t.p} ${shortLabel(String(t.o))}`));
  let loaded = false;
  details.addEventListener("toggle", async () => {
    if (!details.open || loaded) return;
    loaded = true;
    details.append(await whyBody(t));
  });
  return details;
}

/** How (rule) and why (proof) for one connection, from /api/explain-goal. */
async function whyBody(t: Triple): Promise<HTMLElement> {
  const goal = goalOf(t);
  if (!goal) return el("p", { className: "muted" }, t.derived ? "This connection cannot be explained here." : kindHint(t.kind));
  try {
    const ex = await api<GoalExplanation>(`/api/explain-goal?expression=${encodeURIComponent(goal)}&max=1`);
    const a = ex.answers?.[0];
    if (!a) return el("p", { className: "muted" }, "This connection no longer holds.");
    const box = el("div", {}, el("div", { className: "headline", textContent: a.text }));
    if (!a.derived) {
      box.append(el("p", { className: "muted" }, kindHint(a.kind ?? t.kind)));
      if (a.source) box.append(sourceDetail(a.source));
      return box;
    }
    const via = a.via ?? t.via;
    box.append(viaBlock(t.pred, via, false, a.text), howWhyKey(), linesList(a.lines ?? [], ruleShown(a.lines ?? [], via)));
    return box;
  } catch (e) {
    return el("p", { className: "muted" }, (e as Error).message);
  }
}

/** The side panel for one clicked connection. */
async function showTriple(t: Triple) {
  unfoldPanel();
  const panel = $("explain");
  const back = el("button", { type: "button", textContent: `← ${settings.focus ?? "overview"}` });
  back.onclick = () => { selected = null; renderExplain(); };
  const focusS = el("button", { type: "button", textContent: `Centre on ${t.s}` });
  focusS.onclick = () => setFocus(String(t.s));
  const actions = el("div", { className: "ex-actions" }, back, focusS);
  if (typeof t.o !== "number" && !LITERAL_TYPES.has(typeOf(t.o))) {
    const focusO = el("button", { type: "button", textContent: `Centre on ${t.o}` });
    focusO.onclick = () => setFocus(String(t.o));
    actions.append(focusO);
  }
  // The heading is the fact itself (subject, relation, object); the relation alone is not a fact.
  const object = typeof t.o === "number" ? t.o.toLocaleString() : shortLabel(String(t.o));
  const head = el("div", { className: "ex-head" }, el("h2", { textContent: `${t.s} ${t.p} ${object}` }), kindBadge(t.kind));
  const relation = el("p", { className: "muted relation-line", title: kindHint(t.kind) }, `${snap.words.relation}: `, t.p,
    can("technical") ? el("span", {}, ` (${t.pred})`) : "", ` · ${kindOf(t.kind).label.toLowerCase()}`);
  const others = t.derived ? rulesFor(t.pred).filter((r) => r.clause !== t.via?.rule) : [];
  const parts: HTMLElement[] = [head, relation, actions];
  if (t.derived && t.ways > 1) {
    parts.push(el("p", { className: "muted" }, `This connection follows ${t.ways} ways; the first is explained.`));
  }
  parts.push(el("h3", { className: "ex-section" }, t.derived ? "How and why" : "Fact"),
    el("div", { className: `card ${t.derived ? "derived" : ""}` }, await whyBody(t)));
  if (others.length) {
    parts.push(el("details", { className: "other-rules" }, el("summary", {}, `Other rules for “${t.p}”`),
      ...others.map((r) => el("div", { className: "card rule" }, slotted(r), ruleCode(r)))));
  }
  panel.replaceChildren(...parts);
}

function overview(): HTMLElement {
  const wrap = el("div");
  wrap.append(el("h2", { textContent: "How Liquidity House reasons" }),
    el("p", { className: "muted" }, "Select or search anything to see what is known about it and, step by step, how each figure was worked out. Explanations come from the same rules and data as the calculations, so they always match the result."));
  wrap.append(el("h3", { className: "ex-section", title: "Every derived fact comes from one of these rules" }, "Rules: how derived facts are made"),
    ...snap.rules.map((r) => el("div", { className: "card" }, el("div", {}, slotted(r)), ruleCode(r))));
  const warnings = snap.triples.filter((t) => t.severity === "warning");
  if (warnings.length) {
    wrap.append(el("h3", { className: "ex-section" }, "Needs attention"),
      el("div", { className: "neighbours" }, ...warnings.map((t) => {
        const b = el("button", { type: "button", textContent: `${t.s}: ${t.p} ${t.o}` });
        b.style.borderColor = cssVar("--warn");
        b.onclick = () => setFocus(String(t.s));
        return b;
      })));
  }
  if (info.files) {
    wrap.append(el("h3", { className: "ex-section" }, `Knowledge base ${info.version}`),
      el("ul", { className: "files" }, ...info.files.map((f) => el("li", {}, `${f.name} — ${f.lines} lines`))));
  }
  return wrap;
}

// --- Audit: stated vs derived, in symbols, and what could be said more briefly ---
type AuditTab = "facts" | "relations" | "compression";
let audit: Audit | null = null;
let auditFor = "";
let auditTab: AuditTab = store.get<AuditTab>("kbx:auditTab") ?? "compression";
let nearMisses = false;
let lastPlans: Plan[] | null = null;

async function renderAudit() {
  const view = $("audit-view");
  const key = `${info.version}|${userId}`;
  if (auditFor !== key) {
    view.replaceChildren(el("p", { className: "muted" }, "Measuring the knowledge base…"));
    try {
      audit = await api<Audit>("/api/audit");
      auditFor = key;
      lastPlans = null;
    } catch (e) {
      view.replaceChildren(el("p", { className: "muted" }, (e as Error).message));
      return;
    }
  }
  const a = audit!;
  const t = a.totals;
  const saved = t.without_rules - t.now;
  const tile = (label: string, value: string, note: string, title = "") =>
    el("div", { className: "tile", title }, el("div", { className: "tile-label" }, label), el("div", { className: "tile-value" }, value), el("div", { className: "muted" }, note));
  const tabs = el("div", { className: "segmented" }, ...([["facts", "Stated vs derived"], ["relations", "Relations"], ["compression", "Compression"]] as [AuditTab, string][])
    .map(([id, label]) => {
      const b = el("button", { type: "button", textContent: label });
      b.setAttribute("aria-selected", String(auditTab === id));
      b.onclick = () => { auditTab = id; store.set("kbx:auditTab", id); renderAudit(); };
      return b;
    }));
  const body = auditTab === "facts" ? auditFacts() : auditTab === "relations" ? auditRelations(a) : auditCompression(a);
  view.replaceChildren(
    el("div", { className: "audit-head" }, el("h2", {}, "Knowledge audit"),
      el("p", { className: "muted" }, "Description length in symbols: a name, number or variable is one symbol; a link or sentence one per word-like segment. Generated facts are free; derived facts are what the rules save.")),
    el("div", { className: "tiles" },
      tile(kindOf("stated").label, `${t.stated.symbols}`, `${t.stated.facts} facts`, kindHint("stated")),
      tile("Rules", `${t.rules.symbols}`, `${t.rules.clauses} clauses`),
      tile("Lexicon", `${t.lexicon.symbols}`, `${t.lexicon.entries} words and primitives`),
      tile(kindOf("derived").label, `${t.derived.symbols}`, `${t.derived.facts} facts, if they were stated`, kindHint("derived")),
      tile(kindOf("generated").label, `${t.generated.symbols}`, `${t.generated.facts} facts, free`, kindHint("generated")),
      tile("Description length", `${t.now}`, `${t.without_rules} without rules: rules save ${saved} (${Math.round((saved / t.without_rules) * 100)}%)`, "Stated + rules + lexicon, against stated + derived + lexicon")),
    tabs, body);
}

/** Every fact in scope, stated beside derived, grouped by relation. */
function auditFacts(): HTMLElement {
  const filter = el("input", { type: "search", placeholder: "Filter facts…", className: "audit-filter" });
  const columns = el("div", { className: "fact-columns" });
  const draw = () => {
    const q = filter.value.toLowerCase();
    const rows = scopedTriples().filter((t) => !q || [t.s, t.p, t.o].some((v) => String(v).toLowerCase().includes(q)));
    const column = (derived: boolean) => {
      const mine = rows.filter((t) => t.derived === derived);
      const groups = new Map<string, Triple[]>();
      for (const t of mine) (groups.get(t.p) ?? groups.set(t.p, []).get(t.p)!).push(t);
      return el("div", { className: "fact-column" },
        el("h3", { className: "ex-section", title: kindHint(derived ? "derived" : "stated") }, `${kindOf(derived ? "derived" : "stated").label} `, kindBadge(derived ? "derived" : "stated"), ` ${mine.length}`),
        ...[...groups].sort((x, y) => y[1].length - x[1].length).map(([p, ts]) =>
          el("details", { className: "fact-group", open: groups.size <= 6 }, el("summary", {}, `${p} `, el("span", { className: "muted" }, String(ts.length))),
            el("ul", { className: "fact-list" }, ...ts.map((t) => {
              const li = el("li", { title: t.derived ? viaText(t.pred, t.via) : kindHint(t.kind) },
                `${t.s} → ${typeof t.o === "number" ? t.o.toLocaleString() : shortLabel(String(t.o))}`);
              if (t.via) li.append(el("span", { className: "rule-chip" }, `rule ${t.via.rule}`));
              if (t.ways > 1) li.append(el("span", { className: "muted" }, ` ×${t.ways}`));
              li.onclick = () => showTriple(t);
              return li;
            })))));
    };
    columns.replaceChildren(column(false), column(true));
  };
  filter.addEventListener("input", draw);
  draw();
  return el("div", {}, filter, columns);
}

/** Each relation's facts and symbols; for derived ones, what each clause derives and whether the rule pays. */
type RelationKind = AuditRelation["kind"];
type RelationKey = "label" | "domain" | "kind" | "facts" | "symbols" | "rule_symbols" | "saving" | "clauses";
interface RelationView { text: string; kinds: RelationKind[]; domain: string; costly: boolean; key: RelationKey; dir: 1 | -1 }
const KIND_ORDER: Record<RelationKind, number> = { stated: 0, generated: 1, derived: 2 };
const relationView: RelationView = {
  text: "", kinds: ["stated", "generated", "derived"], domain: "", costly: false, key: "kind", dir: 1,
  ...store.get<Partial<RelationView>>("kbx:auditRelations"),
};

/** A column's value for sorting; undefined (a stated relation has no rule) always sorts last. */
function relationValue(r: AuditRelation, key: RelationKey): string | number | undefined {
  switch (key) {
    case "label": return r.label;
    case "domain": return domainLabel(r.domain);
    case "kind": return KIND_ORDER[r.kind];
    case "clauses": return r.clauses?.length;
    default: return r[key];
  }
}

function auditRelations(a: Audit): HTMLElement {
  const v = relationView;
  const remember = () => store.set("kbx:auditRelations", v);
  const search = el("input", { type: "search", placeholder: "Filter relations…", className: "audit-filter", value: v.text });
  search.addEventListener("input", () => { v.text = search.value; remember(); draw(); });

  const kindToggles = (["stated", "generated", "derived"] as RelationKind[]).map((k) => {
    const input = el("input", { type: "checkbox", checked: v.kinds.includes(k) });
    input.onchange = () => { v.kinds = input.checked ? [...v.kinds, k] : v.kinds.filter((x) => x !== k); remember(); draw(); };
    const n = a.relations.filter((r) => r.kind === k).length;
    return el("label", {}, input, ` ${k} `, el("span", { className: "muted" }, String(n)));
  });

  const domains = [...new Set(a.relations.map((r) => r.domain))];
  const domain = el("select", {}, el("option", { value: "", textContent: "All domains" }),
    ...domains.map((d) => el("option", { value: d, textContent: domainLabel(d) })));
  domain.value = domains.includes(v.domain) ? v.domain : "";
  domain.onchange = () => { v.domain = domain.value; remember(); draw(); };

  const costly = el("input", { type: "checkbox", checked: v.costly });
  costly.onchange = () => { v.costly = costly.checked; remember(); draw(); };

  const summary = el("p", { className: "muted relation-summary" });
  const table = el("table", {});
  const columns: [RelationKey, string, string][] = [
    ["label", snap.words.relation, ""], ["domain", "Domain", ""], ["kind", "Kind", snap.kinds.map((k) => `${k.label}: ${k.hint}`).join("\n")],
    ["facts", "Facts", ""], ["symbols", "Symbols", "What its facts cost; for a derived relation, what they would cost if stated"],
    ["rule_symbols", "Rule symbols", "What its rule clauses cost"], ["saving", "Saves", "Symbols its facts would cost minus its rule's symbols"],
    ["clauses", "Clauses", "What each clause derives"],
  ];

  function draw() {
    const q = v.text.trim().toLowerCase();
    const rows = a.relations
      .filter((r) => v.kinds.includes(r.kind))
      .filter((r) => !v.domain || r.domain === v.domain)
      .filter((r) => !v.costly || (r.saving ?? 0) < 0)
      .filter((r) => !q || [r.id, r.label, domainLabel(r.domain)].some((x) => x.toLowerCase().includes(q)))
      .sort((x, y) => {
        const p = relationValue(x, v.key), r = relationValue(y, v.key);
        if (p === undefined || r === undefined) return p === r ? 0 : p === undefined ? 1 : -1;
        const c = typeof p === "number" && typeof r === "number" ? p - r : String(p).localeCompare(String(r));
        return c * v.dir || y.symbols - x.symbols;
      });
    const total = rows.reduce((n, r) => n + r.symbols, 0);
    const asIf = rows.some((r) => r.kind === "derived") ? ", derived facts counted as if stated" : "";
    summary.textContent = `${rows.length} of ${a.relations.length} relations · ${total} symbols${asIf}`;
    const head = el("tr", {}, ...columns.map(([key, label, title]) => {
      const th = el("th", { title, className: "sortable" }, label + (v.key === key ? (v.dir === 1 ? " ▲" : " ▼") : ""));
      th.onclick = () => {
        // Numbers start largest first; names and kinds start in order.
        v.dir = v.key === key ? (-v.dir as 1 | -1) : ["label", "domain", "kind"].includes(key) ? 1 : -1;
        v.key = key;
        remember();
        draw();
      };
      return th;
    }));
    table.replaceChildren(el("thead", {}, head), el("tbody", {}, ...rows.map(relationRow)));
  }
  draw();

  return el("div", { className: "relations" },
    el("div", { className: "relation-filters" }, search, ...kindToggles, domain,
      el("label", { title: "Derived relations whose facts would cost fewer symbols than their rule" }, costly, " Only rules that cost more than they save")),
    summary,
    el("div", { className: "table-wrap" }, table));
}

let selectedRelation: string | null = null;

function relationRow(r: AuditRelation): HTMLElement {
  const clauses = (r.clauses ?? []).map((c) => el("span", { className: c.facts ? "clause-stat" : "clause-stat dead", title: `${c.facts} facts, ${c.only} only by this clause` },
    `#${c.clause}: ${c.facts} facts · ${c.symbols} sym`));
  const saves = r.saving ?? null;
  const tr = el("tr", { className: `clickable ${r.id === selectedRelation ? "selected" : ""}`, title: "Show this relation in the explanations panel" },
    el("td", {}, r.label, el("span", { className: "muted" }, ` ${r.id}/${r.arity}`)),
    el("td", {}, domainLabel(r.domain)),
    el("td", {}, kindBadge(r.kind)),
    el("td", { className: "num" }, String(r.facts)),
    el("td", { className: "num" }, String(r.symbols)),
    el("td", { className: "num" }, r.rule_symbols === undefined ? "" : String(r.rule_symbols)),
    el("td", { className: `num ${saves !== null && saves < 0 ? "costs" : ""}`, title: saves !== null && saves < 0 ? "Costs more symbols than its facts would: kept for what it explains and for facts to come" : "" },
      saves === null ? "" : String(saves)),
    el("td", {}, ...clauses));
  tr.onclick = () => {
    selectedRelation = r.id;
    tr.parentElement?.querySelectorAll("tr.selected").forEach((x) => x.classList.remove("selected"));
    tr.classList.add("selected");
    showRelation(r.id);
  };
  return tr;
}

/** The side panel for one relation of the audit: its cost, its rule, what it reads and is read by, candidates, facts. */
function showRelation(id: string) {
  const a = audit;
  const r = a?.relations.find((x) => x.id === id);
  if (!a || !r) return;
  unfoldPanel();
  selectedRelation = id;
  const panel = $("explain");
  const back = el("button", { type: "button", textContent: `← ${settings.focus ?? "overview"}` });
  back.onclick = () => { selectedRelation = null; selected = null; renderExplain(); };
  const badge = kindBadge(r.kind);
  const parts: (HTMLElement | string)[] = [
    el("div", { className: "ex-head" }, el("h2", { textContent: r.label }), badge),
    el("div", { className: "ex-actions" }, back),
    el("p", { className: "muted" }, `${r.id}/${r.arity} · ${domainLabel(r.domain)} · ${r.facts} facts · ${r.symbols} symbols${r.kind === "derived" ? " if they were stated" : ""}`),
  ];
  if (r.kind === "derived") {
    const saves = r.saving ?? 0;
    parts.push(el("p", { className: saves < 0 ? "costs" : "" }, saves < 0
      ? `Its rule costs ${r.rule_symbols} symbols, ${-saves} more than its facts would: kept for what it explains and for facts to come.`
      : `Its rule costs ${r.rule_symbols} symbols and saves ${saves}.`));
    parts.push(el("h3", { className: "ex-section" }, "How it is derived"),
      ...rulesFor(r.id).map((rule) => {
        const stat = r.clauses?.find((c) => c.clause === rule.clause);
        return el("div", { className: "card rule" }, el("div", {}, slotted(rule)),
          stat ? el("div", { className: stat.facts ? "muted" : "costs" },
            stat.facts ? `Clause ${rule.clause}: ${stat.facts} facts (${stat.only} only by this clause) · ${stat.symbols} symbols` : `Clause ${rule.clause} derives nothing yet · ${stat.symbols} symbols`) : "",
          ruleCode(rule));
      }));
  } else if (r.kind === "generated") {
    parts.push(el("p", { className: "muted" }, "Generated from what the repository already records, so its facts cost nothing to write."));
  }

  const chipLabel = (x: string) => {
    const label = a.relations.find((y) => y.id === x)?.label ?? x;
    return label.replace(/ /g, "_") === x ? label : `${label} (${x})`;
  };
  const chips = (ids: string[]) => el("div", { className: "relation-chips" }, ...ids.map((x) => {
    const b = el("button", { type: "button", textContent: chipLabel(x), title: `Show ${x}` });
    b.onclick = () => showRelation(x);
    return b;
  }));
  const reads = (r.reads ?? []).filter((x) => a.relations.some((y) => y.id === x));
  const readBy = a.relations.filter((x) => x.reads?.includes(r.id) && x.id !== r.id).map((x) => x.id);
  if (reads.length) parts.push(el("h3", { className: "ex-section" }, "Reads"), chips(reads));
  if (readBy.length) parts.push(el("h3", { className: "ex-section" }, "Read by"), chips(readBy));

  const kinds = new Map(a.kinds.map((k) => [k.id, k.label]));
  const cands = a.candidates.filter((c) => c.relation === r.id || c.body.includes(r.id));
  if (cands.length) {
    parts.push(el("h3", { className: "ex-section" }, "Compression candidates"),
      ...cands.map((c) => {
        const b = el("button", { type: "button", className: "link", textContent: `${kinds.get(c.kind) ?? c.kind}: ${c.relation} — ${c.saving > 0 ? `saves ${c.saving}` : c.saving === 0 ? "saves nothing" : `costs ${-c.saving}`}` });
        b.onclick = () => {
          auditTab = "compression";
          if (c.saving <= 0) nearMisses = true;
          renderAudit().then(() => document.getElementById(`cand-${c.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
        };
        return el("div", {}, b);
      }));
  }

  const facts = snap.triples.filter((t) => t.pred === r.id);
  const shown = facts.slice(0, 60);
  if (facts.length) {
    parts.push(el("h3", { className: "ex-section", title: kindHint(r.kind) }, `${kindOf(r.kind).label} `, kindBadge(r.kind), ` ${facts.length}`),
      el("ul", { className: "facts" }, ...shown.map((t) => {
        const li = el("li", { className: "clickable", title: t.derived ? viaText(t.pred, t.via) : "Show where it is written" },
          `${t.s} → ${typeof t.o === "number" ? t.o.toLocaleString() : shortLabel(String(t.o))}`);
        li.onclick = () => showTriple(t);
        return li;
      })),
      facts.length > shown.length ? el("p", { className: "muted" }, `… and ${facts.length - shown.length} more`) : "");
  }
  panel.replaceChildren(...parts);
}

/** Compression candidates, and the optimiser that picks the best set under constraints. */
function auditCompression(a: Audit): HTMLElement {
  const kinds = new Map(a.kinds.map((k) => [k.id, k]));
  const shown = a.candidates.filter((c) => nearMisses || c.saving > 0);
  const near = el("input", { type: "checkbox", checked: nearMisses });
  near.onchange = () => { nearMisses = near.checked; renderAudit(); };
  const cards = shown.map((c) => candidateCard(c, kinds.get(c.kind)));
  return el("div", { className: "compression" },
    optimiserForm(a),
    el("label", { className: "inline-check" }, near, " Show near misses (candidates that save nothing yet)"),
    ...(cards.length ? cards : [el("p", { className: "muted" }, "No candidate saves symbols: nothing here is said twice in a way these templates can see.")]));
}

/** A relation name that opens the relation in the panel, when the audit knows it. */
function relationLink(id: string): HTMLElement {
  if (!audit?.relations.some((r) => r.id === id)) return el("strong", {}, id);
  const b = el("button", { type: "button", className: "link strong", textContent: id, title: "Show this relation in the explanations panel" });
  b.onclick = () => showRelation(id);
  return b;
}

function candidateCard(c: Candidate, kind?: { label: string; description: string }): HTMLElement {
  const covered = c.covers.reduce((n, x) => n + x.symbols, 0);
  const card = el("div", { className: `card candidate ${c.saving > 0 ? "" : "near"}`, id: `cand-${c.id}` },
    el("div", { className: "cand-head" },
      el("span", { className: "kind-chip", title: kind?.description ?? "" }, kind?.label ?? c.kind),
      relationLink(c.relation),
      el("span", { className: c.saving > 0 ? "saves" : "muted" }, c.saving > 0 ? `saves ${c.saving} symbols` : c.saving === 0 ? "saves nothing" : `costs ${-c.saving}`)),
    el("div", { className: "muted" }, `${kind?.description ?? ""}. Replaces ${c.covers.length} item${c.covers.length === 1 ? "" : "s"} (${covered} symbols) and adds ${c.cost}.`));
  for (const clause of c.clauses) card.append(prolog(clause));
  if (c.exceptions.length) card.append(el("div", {}, el("span", { className: "via-label" }, "Exceptions "), c.exceptions.join(", ")));
  if (c.alternatives.length) card.append(el("div", { className: "muted" }, `Would also hold reading ${c.alternatives.join(", ")}.`));
  card.append(el("details", {}, el("summary", {}, "What it replaces"),
    el("ul", { className: "fact-list" }, ...c.covers.map((x) => el("li", {}, `${x.item} `, el("span", { className: "muted" }, `${x.symbols}`))))));
  return card;
}

function optimiserForm(a: Audit): HTMLElement {
  const relations = [...new Set(a.candidates.filter((c) => c.saving > 0).map((c) => c.relation))];
  const kinds = [...new Set(a.candidates.map((c) => c.kind))];
  const keep = relations.map((r) => [r, el("input", { type: "checkbox" })] as const);
  const allow = kinds.map((k) => [k, el("input", { type: "checkbox", checked: true })] as const);
  const maxRules = el("input", { type: "number", min: "0", max: "100", placeholder: "any", className: "small-input" });
  const exceptions = el("input", { type: "checkbox", checked: true });
  const alternatives = el("select", {}, ...[1, 2, 3, 4, 5].map((n) => el("option", { value: String(n), textContent: String(n), selected: n === 3 })));
  const results = el("div", { className: "plans" });
  const label = (k: string) => a.kinds.find((x) => x.id === k)?.label ?? k;
  const drawPlans = (ps: Plan[]) => results.replaceChildren(...(ps.length ? ps.map((p, i) =>
    el("div", { className: "card plan" },
      el("div", { className: "cand-head" }, el("strong", {}, i === 0 ? "Best plan" : `Alternative ${i}`),
        el("span", { className: p.saving > 0 ? "saves" : "muted" }, p.saving > 0 ? `saves ${p.saving} symbols` : "saves nothing")),
      p.candidates.length ? el("div", { className: "plan-items" }, ...p.candidates.map((id) => {
        const c = a.candidates.find((x) => x.id === id)!;
        const b = el("button", { type: "button", className: "link", textContent: `${label(c.kind)}: ${c.relation} (${c.saving})` });
        b.onclick = () => { if (!nearMisses && c.saving <= 0) { nearMisses = true; renderAudit(); } document.getElementById(`cand-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); };
        return b;
      })) : el("div", { className: "muted" }, "Keep the knowledge base as it is.")))
    : [el("p", { className: "muted" }, "No plan meets these constraints.")]));
  if (lastPlans) drawPlans(lastPlans);
  const run = el("button", { type: "button", className: "primary", textContent: "Find best plans" });
  run.onclick = async () => {
    results.replaceChildren(el("p", { className: "muted" }, "Optimising…"));
    try {
      const { plans } = await api<{ plans: Plan[] }>("/api/plan", { method: "POST", body: JSON.stringify({
        keep: keep.filter(([, i]) => i.checked).map(([r]) => r),
        kindsOff: allow.filter(([, i]) => !i.checked).map(([k]) => k),
        maxRules: maxRules.value === "" ? undefined : Number(maxRules.value),
        exceptions: exceptions.checked,
        alternatives: Number(alternatives.value),
      }) });
      lastPlans = plans;
      drawPlans(plans);
    } catch (e) {
      results.replaceChildren(el("p", { className: "muted" }, (e as Error).message));
    }
  };
  return el("details", { className: "card optimiser", open: true },
    el("summary", {}, "Choose the best set (optimiser)"),
    el("p", { className: "muted" }, "Candidates are scored one by one; the optimiser (clingo) picks the set that saves most together, without counting shared facts twice or closing a cycle, under your constraints."),
    el("div", { className: "opt-grid" },
      el("div", {}, el("div", { className: "via-label" }, "Keep stated"), ...(keep.length ? keep.map(([r, i]) => el("label", {}, i, ` ${r}`)) : [el("span", { className: "muted" }, "—")])),
      el("div", {}, el("div", { className: "via-label" }, "Templates"), ...allow.map(([k, i]) => el("label", {}, i, ` ${label(k)}`))),
      el("div", {}, el("div", { className: "via-label" }, "Limits"),
        el("label", {}, "At most ", maxRules, " changes"),
        el("label", {}, exceptions, " Allow exceptions"),
        el("label", {}, "Plans ", alternatives))),
    run, results);
}

// --- Console ---
async function runConsole() {
  const out = $("console-output");
  const goal = $<HTMLTextAreaElement>("console-input").value;
  out.textContent = "…";
  try {
    const { lines } = await api<{ lines: string[] }>("/api/query", { method: "POST", body: JSON.stringify({ goal }) });
    out.textContent = lines.join("\n");
  } catch (e) {
    out.textContent = (e as Error).message;
  }
}

// --- Navigation ---
function setFocus(id: string, pushHistory = true) {
  settings.focus = id;
  selected = null;
  if (pushHistory && history.at(-1) !== id) history.push(id);
  update();
}

function select(entity: string | number) {
  selected = entity;
  renderExplain();
}

/** Re-render everything that depends on settings. */
function update(full = true) {
  save();
  if (full) renderControls();
  else renderTypes();
  const view = settings.view;
  const graphView = view === "mindmap" || view === "hierarchy";
  $("graph").hidden = !graphView;
  $("table-view").hidden = view !== "table";
  $("console-view").hidden = view !== "console";
  $("audit-view").hidden = view !== "audit";
  $("stage-empty").hidden = true;
  if (graphView) renderGraph();
  else { network?.destroy(); network = null; }
  if (view === "table") renderTable();
  if (view === "audit") renderAudit();
  if (full) renderExplain();
}

// --- Talking to the server ---
/** JSON from the API. In dev mode the picked user travels in X-Kb-User; behind a proxy the server knows. */
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (userId && info?.auth !== "proxy") headers.set("X-Kb-User", userId);
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.problem ?? body.error ?? `${path} → ${res.status}`);
  return body as T;
}

/** Who am I, and what may I see: session first (it decides the role), then the scoped graph. */
async function loadScope() {
  info = await api<SessionInfo>("/api/session");
  userId = info.session.user;
  snap = await api<Graph>("/api/graph");
  showLoadWarnings();
}

function showLoadWarnings() {
  const banner = $("banner");
  banner.hidden = !info.warnings && !info.incomplete;
  banner.textContent = info.warnings ? `Problems while loading the knowledge base:\n${info.warnings}`
    : info.incomplete ? "Some knowledge could not be loaded, so parts of the picture may be missing. Please let the Liquidity House team know."
    : "";
}

function setStatus(state: "live" | "error" | "", text: string) {
  const s = $("kb-status");
  s.className = `kb-status ${state}`;
  s.lastElementChild!.textContent = text;
}

function setLive() {
  setStatus("live", `Updated ${new Date().toLocaleTimeString()}`);
  $("kb-status").title = can("technical") ? `Knowledge base version ${info.version}` : "Knowledge is refreshed automatically";
}

/** Poll the public version; refetch the scoped graph only when the knowledge changed. */
async function refresh(force = false) {
  try {
    const { version } = await api<{ version: string }>("/api/health");
    if (force || version !== info.version) {
      await loadScope();
      update();
    }
    setLive();
  } catch (e) {
    setStatus("error", (e as Error).message);
  }
}

function scheduleRefresh() {
  const seconds = Number(store.get<number>("kbx:refresh") ?? 30);
  $<HTMLSelectElement>("refresh").value = String(seconds);
  window.clearInterval(refreshTimer);
  if (seconds > 0) refreshTimer = window.setInterval(() => refresh(), seconds * 1000);
}

/** Dev mode only: act as another user. The server answers in that user's role. */
async function switchUser(id: string) {
  userId = id;
  store.set("kbx:user", id);
  await loadScope();
  loadSettings();
  selected = null;
  history = settings.focus ? [settings.focus] : [];
}

function renderUserPicker() {
  const select = $<HTMLSelectElement>("user");
  const users = info.users ?? [{ id: info.session.user, name: info.session.name, role: info.session.role }];
  select.replaceChildren(...users.map((u) => el("option", { value: u.id, textContent: u.name })));
  select.value = userId;
  select.disabled = info.auth === "proxy";
  select.title = info.auth === "proxy" ? "Signed in" : "Development mode: pick who to view as";
}

/** Shareable state in the URL: #u=user&v=view&f=focus&d=depth (u only applies in dev mode). */
async function applyHash() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const u = hash.get("u");
  if (info.auth === "dev" && u && u !== userId && info.users?.some((x) => x.id === u)) {
    await switchUser(u);
    renderUserPicker();
  }
  const hv = hash.get("v") as View | null;
  if (hv && VIEWS.some((v) => v.id === hv && (!v.feature || can(v.feature)))) settings.view = hv;
  const f = hash.get("f");
  if (f && f !== settings.focus) { settings.focus = f; selected = null; history.push(f); }
  if (hash.get("d")) settings.depth = Math.min(5, Math.max(1, Number(hash.get("d")) || 2));
}

async function main() {
  setStatus("", "loading…");
  try {
    userId = store.get<string>("kbx:user") ?? "";
    await loadScope();
  } catch (e) {
    setStatus("error", "failed to load");
    $("banner").hidden = false;
    $("banner").textContent = `Could not load the knowledge base: ${(e as Error).message}`;
    return;
  }
  loadSettings();
  history = settings.focus ? [settings.focus] : [];
  renderUserPicker();
  $<HTMLSelectElement>("user").onchange = async (e) => {
    await switchUser((e.target as HTMLSelectElement).value);
    setLive();
    update();
  };

  await applyHash();
  window.addEventListener("hashchange", async () => { await applyHash(); update(); });

  $("focus-input").addEventListener("change", (e) => {
    const v = (e.target as HTMLInputElement).value.trim();
    if (v && snap.entities.some((x) => x.id === v)) setFocus(v);
  });
  $("focus-clear").onclick = () => { settings.focus = null; selected = null; update(); };
  $("focus-back").onclick = () => {
    if (history.length < 2) return;
    history.pop();
    setFocus(history.at(-1)!, false);
  };
  setPanelFolded(panelFolded);
  $("panel-toggle").onclick = () => setPanelFolded(!panelFolded);
  $("types-reset").onclick = () => { settings.colors = {}; settings.shapes = {}; settings.hiddenTypes = []; update(); };
  $("table-filter").addEventListener("input", renderTable);
  $("console-run").onclick = runConsole;
  $("console-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runConsole(); }
  });
  $("reload").onclick = () => refresh(true);
  $("refresh").onchange = (e) => { store.set("kbx:refresh", Number((e.target as HTMLSelectElement).value)); scheduleRefresh(); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => update(false));

  setLive();
  scheduleRefresh();
  update();
}

main();
