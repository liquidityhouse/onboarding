// Liquidity House Knowledge Explorer — UI. The server reasons over the knowledge base and
// answers only within the viewer's role; this page draws and filters what it is given.

import { DataSet, Network, type Edge, type Node as VisNode, type Options } from "vis-network/standalone";
import type { Explanation, Graph, Session, SessionInfo, Triple, TypeStyle } from "../lib/kb-types.ts";

type View = "mindmap" | "hierarchy" | "table" | "console";
type Direction = "LR" | "UD" | "RL" | "DU";

interface Settings {
  view: View;
  focus: string | null;
  depth: number;
  domains: string[];
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

function defaults(s: Session): Settings {
  return {
    view: "mindmap",
    focus: s.start,
    depth: 2,
    domains: [...s.domains],
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
  settings = { ...defaults(s), ...(store.get<Partial<Settings>>(`kbx:settings:${userId}`) ?? {}) };
  settings.domains = settings.domains.filter((d) => s.domains.includes(d));
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
    const literal = oType === "value" || oType === "url";
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
    title: `${e.triple.p}${e.triple.derived ? " (derived)" : ""}`,
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
  network.on("click", (params: { nodes: string[] }) => {
    const id = params.nodes[0];
    if (!id) return;
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
  const cols: [keyof Triple, string][] = [["s", "Subject"], ["p", "Relation"], ["o", "Object"], ["domain", "Domain"]];
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
    const tr = el("tr", { className: t.severity === "warning" ? "warning" : "" },
      cell(t.s), el("td", { className: t.derived ? "derived" : "" }, t.p), cell(t.o), el("td", {}, domainLabel(t.domain)));
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

// --- Explanation panel ---
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
    parts.push(el("h3", { className: "ex-section" }, "Conclusions"));
    const bySeverity = [...ex.conclusions].sort((a, b) => Number(b.severity === "warning") - Number(a.severity === "warning"));
    for (const c of bySeverity) {
      const details = el("details", { open: c.severity === "warning" || session().role === "risk_officer" },
        el("summary", {}, "How was this derived?"),
        el("ul", { className: "lines" }, ...c.lines.slice(1).map((l) => {
          const li = el("li", { className: l.kind, textContent: l.text });
          li.style.setProperty("--depth", String(l.depth - 1));
          return li;
        })));
      if (c.proof) {
        details.append(el("details", {}, el("summary", {}, "Technical detail"), el("pre", { className: "raw", textContent: c.proof })));
      }
      parts.push(el("div", { className: `card ${c.severity}` }, el("div", { className: "headline", textContent: c.text }), details));
    }
  }

  if (ex.facts.length) {
    parts.push(el("h3", { className: "ex-section" }, "Facts"),
      el("ul", { className: "facts" }, ...ex.facts.map((f) => el("li", { textContent: f }))));
  }

  const neighbours = new Set<string>();
  for (const t of scopedTriples()) {
    if (t.s === ex.id && typeof t.o !== "number") neighbours.add(String(t.o));
    if (t.o === ex.id) neighbours.add(String(t.s));
  }
  if (neighbours.size) {
    parts.push(el("h3", { className: "ex-section" }, "Connected"),
      el("div", { className: "neighbours" }, ...[...neighbours].map((n) => {
        const b = el("button", { type: "button", textContent: shortLabel(n) });
        b.style.borderColor = colorOf(typeOf(n));
        b.onclick = () => setFocus(n);
        return b;
      })));
  }
  panel.replaceChildren(...parts);
}

function overview(): HTMLElement {
  const wrap = el("div");
  wrap.append(el("h2", { textContent: "How Liquidity House reasons" }),
    el("p", { className: "muted" }, "Select or search anything to see what is known about it and, step by step, how each figure was worked out. Explanations come from the same rules and data as the calculations, so they always match the result."));
  wrap.append(el("h3", { className: "ex-section" }, "Rules"),
    ...snap.rules.map((r) => el("div", { className: "card" }, el("div", { textContent: r.text }), can("technical") ? el("div", { className: "muted" }, r.predicate) : "")));
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
  $("stage-empty").hidden = true;
  if (graphView) renderGraph();
  else { network?.destroy(); network = null; }
  if (view === "table") renderTable();
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
