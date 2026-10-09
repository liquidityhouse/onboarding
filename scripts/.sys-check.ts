import { current } from "../lib/kb-service.ts";
const { engine } = await current();
console.log("warnings:", JSON.stringify(engine.warnings));
const ex = async (e: string) => {
  const r = await engine.explain(e, "developer");
  return { type: r.type, facts: r.facts, conclusions: r.conclusions.map((c) => c.lines.map((l) => "  ".repeat(l.depth) + `[${l.kind}] ${l.text}`)) };
};
const g = await engine.graph("developer");
console.log("system rules:", g.rules.filter((r) => ["runs_on", "relies_on", "can_call", "served_by", "same_answer"].includes(r.predicate)).map((r) => r.text));
console.log("system triples:", g.triples.filter((t) => t.domain === "system").length, "derived:", g.triples.filter((t) => t.domain === "system" && t.derived).length);
console.log(JSON.stringify({ web_server: await ex("web_server"), query: (await ex("POST /api/query")).conclusions.slice(0, 2), sameAnswer: (await ex("GET /api/overview")).conclusions.find((c) => c[0].includes("same answer")) }, null, 1));
for (const [r, e] of [["risk_officer", "POST /api/query"], ["developer", "POST /api/query"], ["risk_officer", "GET /api/graph"], ["admin", "GET /api/kb"], ["risk_officer", "GET /api/kb"], ["developer", "GET /api/nonexistent"]])
  console.log("allowed", r, e, (await engine.api<{ allowed: boolean }>(`allowed('${r}', '${e}')`)).allowed);
console.log("tool_docs:", await engine.api("tool_docs"));
const rel = await engine.explainGoal("relies_on(web_server, What)", 20, "developer");
console.log("web_server relies on:", rel.answers?.map((a) => a.bindings.What).join(", "), "| total", rel.answers_total);
console.log("risk officer graph has system?", (await engine.graph("risk_officer")).domains.map((d) => d.id));
