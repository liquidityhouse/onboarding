// Refreshes the Liquidity House pack's GitHub data from the GitHub API by the same rule-built
// steps an agent is given (agent_tasks.pl): each organisation member's last commit
// (github-activity.json), then, as the rules decide who is active, each active developer's
// commits per repository (github-commits.json), a commit on any branch counted once. Without a
// token it prints those steps.
//
// Run: npm run github-commits                  (GITHUB_TOKEN in .env: read-only Contents access to
//      liquidityhouse; fine-grained tokens work once an organisation owner approves them)
//      npm run github-commits -- --instructions (the agent steps, from the knowledge base)

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { current, invalidate } from "../lib/kb-service.ts";
import { runQuery } from "../lib/sandbox.ts";

const ROOT = join(import.meta.dirname, "..");

// A refused or failed request ends the run with its message rather than a stack trace.
process.on("uncaughtException", (e) => {
  console.error(e.message);
  process.exit(1);
});
const API = "https://api.github.com";

try {
  process.loadEnvFile(join(ROOT, ".env"));
} catch { /* no .env: the token may come from the environment */ }
const token = process.env.GITHUB_TOKEN;
const { kb, engine } = await current();

// The agent steps (agent_tasks.pl): what to do by hand, in a signed-in browser, when there is no token.
if (!token || process.argv.includes("--instructions")) {
  if (!token) console.error("GITHUB_TOKEN is not set (see .env.example). An agent can do the same in a signed-in browser:\n");
  for (const task of ["commit_activity", "commit_counts"]) {
    const a = await engine.api<{ purpose: string; steps: string[] }>(`agent_instructions(${task})`);
    console.log(`${task}: ${a.purpose}.\n${a.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`);
  }
  process.exit(token ? 0 : 1);
}

/** Each answer's bindings, e.g. "P = adam, L = 'ProgracomRasmus'." → { P: "adam", L: "ProgracomRasmus" }. */
async function ask(program: string, goal: string): Promise<Record<string, string>[]> {
  const lines = (await runQuery(program, goal, { timeoutMs: 5000, limit: 500 })).filter((l) => l !== "false." && !l.startsWith("…"));
  return lines.map((l) => Object.fromEntries([...l.matchAll(/(\w+) = ('(?:[^'\\]|\\.)*'|[^,]+?)(?=, \w+ = |\.$)/g)]
    .map(([, k, v]) => [k, v.startsWith("'") ? v.slice(1, -1).replace(/\\'/g, "'") : v])));
}

async function github<T>(path: string): Promise<T> {
  const res = await fetch(API + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (res.status === 404) throw new Error(`GitHub answered 404 for ${path}: the token cannot see it (is the token approved by a liquidityhouse owner?)`);
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}: ${(await res.json().catch(() => ({}))).message ?? ""}`);
  return res.json() as Promise<T>;
}

/** Every page of a list endpoint. */
async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const items = await github<T[]>(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    out.push(...items);
    if (items.length < 100) return out;
  }
}

/** A task's step items (agent_tasks.pl), the same ones the agent steps are worded from. */
const items = (program: string, task: string, item: string) => ask(program, `task_step(${task}, _, ${item})`);

/** Rewrite a data file: its other fields kept, the given ones set, its facts replaced. */
async function writeData(file: string, fields: Record<string, string>, rows: (string | number)[][]) {
  const { facts: _old, ...kept } = JSON.parse(await readFile(join(ROOT, file), "utf8")) as Record<string, unknown>;
  const head = Object.entries({ ...kept, ...fields }).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
  await writeFile(join(ROOT, file), `{\n${head},\n  "facts": [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]\n}\n`);
  console.log(`Wrote ${file} (${rows.length} facts)`);
}

const today = new Date().toISOString().slice(0, 10);
const made = (what: string) => `npm run github-commits on ${today}, from the GitHub API: ${what}, following the steps in agent_tasks.pl`;

// 1. commit_activity: when each member of the organisation last committed (list_members, then
//    last_commit for each), which decides who is active.
const [{ Org: org }] = await items(kb.program, "commit_activity", "list_members(Org)");
const repos = (await items(kb.program, "commit_counts", "read_repository(_, R)")).map((a) => a.R);
const [{ F: activityFile }] = await ask(kb.program, "agent_task(commit_activity, F)");
const activity: [string, string][] = [];
for (const { login } of await all<{ login: string }>(`/orgs/${org}/members`)) {
  const dates = await Promise.all(repos.map(async (repo) =>
    (await github<{ commit: { author: { date: string } } }[]>(`/repos/${org}/${repo}/commits?author=${encodeURIComponent(login)}&per_page=1`))[0]?.commit.author.date ?? ""));
  const last = dates.filter(Boolean).sort().at(-1);
  if (last) activity.push([login, last.slice(0, 10)]);
}
activity.sort((a, b) => b[1].localeCompare(a[1]));
await writeData(activityFile, { as_of: today, made_by: made("each organisation member's latest commit in any repository") }, activity);

// 2. commit_counts: with that activity, the rules say whose commits count and whose are skipped.
invalidate();
const { kb: now } = await current();
for (const s of await items(now.program, "commit_counts", "skip(L, D, _)")) console.log(`skipping ${s.L}: inactive, ${s.D} days since the last commit`);
for (const u of await items(now.program, "commit_counts", "unknown(L)")) console.log(`skipping ${u.L}: active, but the knowledge base does not say who it is`);
const counted = await items(now.program, "commit_counts", "count(P, L, _)");
const [{ F: countsFile }] = await ask(now.program, "agent_task(commit_counts, F)");
const rows: [string, string, number][] = [];
for (const repo of repos) {
  const branches = (await all<{ name: string }>(`/repos/${org}/${repo}/branches`)).map((b) => b.name);
  const byPerson = new Map<string, Set<string>>();
  await Promise.all(counted.map(async ({ P: person, L: login }) => {
    const shas = byPerson.get(person) ?? new Set<string>();
    byPerson.set(person, shas);
    for (const branch of branches) {
      for (const c of await all<{ sha: string }>(`/repos/${org}/${repo}/commits?sha=${encodeURIComponent(branch)}&author=${encodeURIComponent(login)}`)) shas.add(c.sha);
    }
  }));
  for (const [person, shas] of byPerson) if (shas.size) rows.push([repo, person, shas.size]);
  console.log(`${repo}: ${[...byPerson].filter(([, s]) => s.size).map(([p, s]) => `${p} ${s.size}`).join(", ") || "no commits by active developers"}`);
}
rows.sort((a, b) => repos.indexOf(a[0]) - repos.indexOf(b[0]) || b[2] - a[2]);
await writeData(countsFile, { made_by: made("each active developer's distinct commits on every branch") }, rows);
