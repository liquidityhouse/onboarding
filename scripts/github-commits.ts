// Counts each developer's commits in each liquidityhouse repository the knowledge base knows,
// from the GitHub API, and writes the Liquidity House pack's github-commits.json (commits_by/3)
// with where they were read from and how. Developers come from the knowledge base: engineers
// with a GitHub user who are still in Slack; a commit on any branch counts once.
//
// Run: npm run github-commits   (GITHUB_TOKEN in .env: read-only Contents access to liquidityhouse;
//      fine-grained tokens for the organisation work once an organisation owner approves them)

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { current } from "../lib/kb-service.ts";
import { runQuery } from "../lib/sandbox.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = "knowledge/liquidity_house/github-commits.json";
const API = "https://api.github.com";

try {
  process.loadEnvFile(join(ROOT, ".env"));
} catch { /* no .env: the token may come from the environment */ }
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set: copy .env.example to .env and put a token after the equals sign.");
  process.exit(1);
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

const { kb } = await current();
const [{ Org: org }] = await ask(kb.program, "github_account(liquidity_house, Org)");
const repos = (await ask(kb.program, "repo(R, liquidity_house)")).map((a) => a.R);
const logins = await ask(kb.program, "works_as(P, J), job_area(J, engineering), slack_member_id(P, _), github_login(P, L)");

const rows: [string, string, number][] = [];
for (const repo of repos) {
  const branches = (await all<{ name: string }>(`/repos/${org}/${repo}/branches`)).map((b) => b.name);
  const byPerson = new Map<string, Set<string>>();
  await Promise.all(logins.map(async ({ P: person, L: login }) => {
    const shas = byPerson.get(person) ?? new Set<string>();
    byPerson.set(person, shas);
    for (const branch of branches) {
      for (const c of await all<{ sha: string }>(`/repos/${org}/${repo}/commits?sha=${encodeURIComponent(branch)}&author=${encodeURIComponent(login)}`)) shas.add(c.sha);
    }
  }));
  for (const [person, shas] of byPerson) if (shas.size) rows.push([repo, person, shas.size]);
  console.log(`${repo}: ${[...byPerson].filter(([, s]) => s.size).map(([p, s]) => `${p} ${s.size}`).join(", ") || "no developer commits"}`);
}
rows.sort((a, b) => repos.indexOf(a[0]) - repos.indexOf(b[0]) || b[2] - a[2]);

const doc = {
  summary: "Commits by each developer (an engineer with a GitHub user, still in Slack) in each liquidityhouse repository, summed over their GitHub users; commits_by/3 facts",
  relation: "commits_by",
  made_by: `npm run github-commits on ${new Date().toISOString().slice(0, 10)}, from the GitHub API: each developer's distinct commits on every branch, counting only the developers the knowledge base names`,
  script: "scripts/github-commits.ts",
  read_from: `https://github.com/${org}/{1}/graphs/contributors`,
};
const head = Object.entries(doc).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
await writeFile(join(ROOT, OUT), `{\n${head},\n  "facts": [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]\n}\n`);
console.log(`Wrote ${OUT} (${rows.length} facts)`);
