// The single knowledge source: the KB files in kb/manifest.json joined into one program, plus
// facts generated from what the repository already records, versioned by content hash.
// Shared by the web server and the MCP server, so both always see the same KB.

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const MANIFEST = join(ROOT, "kb", "manifest.json");
const PACKAGE = join(ROOT, "package.json");

export interface KbFile {
  name: string;
  lines: number;
  sha: string;
  modified: number;
}

export interface Kb {
  version: string;
  loadedAt: number;
  files: KbFile[];
  program: string;
}

const sha = (text: string, n: number) => createHash("sha1").update(text).digest("hex").slice(0, n);

export async function loadKb(): Promise<Kb> {
  const { sources } = JSON.parse(await readFile(MANIFEST, "utf8")) as { sources: string[] };
  const files: KbFile[] = [];
  const parts: string[] = [];
  for (const rel of sources) {
    const path = join(ROOT, rel);
    let text = await readFile(path, "utf8");
    if (!text.endsWith("\n")) text += "\n";
    files.push({
      name: rel,
      lines: text.split("\n").length - 1,
      sha: sha(text, 10),
      modified: Math.floor((await stat(path)).mtimeMs / 1000),
    });
    parts.push(`% ===== ${rel} =====\n${text}`);
  }
  parts.push(await generatedFacts(sources));
  const program = parts.join("\n");
  return { version: sha(program, 12), loadedAt: Math.floor(Date.now() / 1000), files, program };
}

const atom = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\t/g, "\\t")}'`;

/** Files that get a file_summary/2 besides the KB files: TypeScript, and ASP programs in kb/. */
const SUMMARY_FILES: [dir: string, pattern: RegExp][] = [
  ["", /^[^.].*\.ts$/], ["lib", /^[^.].*\.ts$/], ["public", /^[^.].*\.ts$/], ["scripts", /^[^.].*\.ts$/], ["kb", /^[^.].*\.lp$/],
];

/**
 * Facts the repository already records, so nobody restates them (see kb/system.pl):
 * kb_file/2 from the manifest; package_version/2, engine_requirement/2, npm_script/2 and
 * npm_script_file/2 from package.json; file_summary/2 from each file's header comment.
 * clause_source/6 holds each fact and explained rule as written, for technical readers. Each generated
 * predicate is also listed in generated_predicate/2, so the audit counts these as free;
 * generated_origin/4 says where each fact was read from, and generator_code/4 which
 * statement in this file generates each predicate.
 */
async function generatedFacts(sources: string[]): Promise<string> {
  type Package = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    engines?: Record<string, string>; scripts?: Record<string, string> };
  const pkgText = await readFile(PACKAGE, "utf8");
  const pkg = JSON.parse(pkgText) as Package;
  const manifestText = await readFile(MANIFEST, "utf8");
  const facts: string[] = [];
  const generated = new Map<string, number>();
  /** A generated fact, with the place it was read from (file, first line, text) when known. */
  const fact = (name: string, args: string[], origin?: Origin) => {
    generated.set(name, args.length);
    const term = `${name}(${args.map(atom).join(", ")})`;
    facts.push(`${term}.`);
    if (origin) facts.push(`generated_origin(${term}, ${atom(origin.file)}, ${origin.line}, ${atom(origin.text)}).`);
  };
  const inPackage = (section: string, key: string) => jsonLine("package.json", pkgText, section, key);
  for (const f of sources) fact("kb_file", ["knowledge_base", f], jsonLine("kb/manifest.json", manifestText, "sources", f));
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) fact("package_version", [name, version], inPackage("dependencies", name));
  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) fact("package_version", [name, version], inPackage("devDependencies", name));
  for (const [engine, range] of Object.entries(pkg.engines ?? {})) fact("engine_requirement", [engine, range], inPackage("engines", engine));
  const scripts = Object.entries(pkg.scripts ?? {});
  for (const [name, command] of scripts) fact("npm_script", [name, command], inPackage("scripts", name));
  for (const [name, command] of scripts) {
    for (const file of command.split(/\s+/).filter((w) => /\.(ts|js)$/.test(w))) fact("npm_script_file", [name, file], inPackage("scripts", name));
  }
  for (const file of await describedFiles(sources)) {
    const text = await readFile(join(ROOT, file), "utf8");
    const summary = headerSummary(text);
    if (summary) fact("file_summary", [file, summary], headerOrigin(file, text));
  }
  // Facts and explained rules (those declared dynamic, practice dynamic_rules) as written,
  // numbered like clause/2 numbers them across the whole program.
  const texts = await Promise.all(sources.map((f) => readFile(join(ROOT, f), "utf8")));
  const dynamic = new Set(texts.flatMap((t) => [...t.matchAll(/^:-\s*dynamic\(?\s*([a-z]\w*\/\d+)/gm)].map((m) => m[1])));
  const seen = new Map<string, number>();
  for (const [k, file] of sources.entries()) {
    for (const c of sourceClauses(texts[k])) {
      const key = `${c.name}/${c.arity}`;
      const index = (seen.get(key) ?? 0) + 1;
      seen.set(key, index);
      if (!c.rule || dynamic.has(key)) {
        generated.set("clause_source", 6);
        facts.push(`clause_source(${c.name}, ${c.arity}, ${index}, ${atom(file)}, ${c.line}, ${atom(c.text)}).`);
      }
    }
  }
  // The statement in this file that generates each predicate, read from this file itself.
  const self = await readFile(import.meta.filename, "utf8");
  const selfFile = relative(ROOT, import.meta.filename);
  const code = [...generated.keys()].flatMap((name) => {
    const at = statementOf(self, name === "clause_source" ? "clause_source(${" : `fact("${name}"`);
    return at ? [`generator_code(${name}, ${atom(selfFile)}, ${at.line}, ${atom(at.text)}).`] : [];
  });
  return [
    "% ===== generated by lib/kb-source.ts from kb/manifest.json, package.json and file headers =====",
    ...facts,
    ...[...generated].map(([name, arity]) => `generated_predicate(${name}, ${arity}).`),
    ...code,
    "",
  ].join("\n");
}

interface Origin { file: string; line: number; text: string }

/** The line of `"key":` (or of the array entry `"key"`) inside the `"section"` of a JSON file. */
function jsonLine(file: string, text: string, section: string, key: string): Origin | undefined {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.includes(`"${section}"`));
  if (start < 0) return undefined;
  const i = lines.findIndex((l, k) => k > start && (l.includes(`"${key}":`) || l.trim().replace(/,$/, "") === `"${key}"`));
  return i < 0 ? undefined : { file, line: i + 1, text: lines[i].trim() };
}

/** The leading comment block a file's summary is read from. */
function headerOrigin(file: string, text: string): Origin | undefined {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => /^\s*(%|\/\/)/.test(l));
  if (first < 0) return undefined;
  let last = first;
  while (last + 1 < lines.length && /^\s*(%|\/\/)/.test(lines[last + 1])) last++;
  return { file, line: first + 1, text: lines.slice(first, last + 1).join("\n") };
}

/** The statement around the first line containing `needle`, from its enclosing loop to the loop's end. */
function statementOf(source: string, needle: string): { line: number; text: string } | undefined {
  const lines = source.split("\n");
  const hit = lines.findIndex((l) => l.includes(needle) && !l.includes("statementOf("));
  if (hit < 0) return undefined;
  const indent = (l: string) => l.length - l.trimStart().length;
  // Climb the enclosing blocks: start at the outermost loop, stop at the function itself.
  let start = hit;
  let level = indent(lines[hit]);
  for (let j = hit - 1; j >= 0; j--) {
    const l = lines[j];
    if (!l.trim() || indent(l) >= level || !l.trimEnd().endsWith("{")) continue;
    if (!/^\s*(for|if)\s*\(/.test(l)) break;
    level = indent(l);
    if (/^\s*for\s*\(/.test(l)) start = j;
  }
  let end = hit;
  if (lines[start].trimEnd().endsWith("{")) {
    const close = lines.findIndex((l, k) => k > start && indent(l) === indent(lines[start]) && l.trim().startsWith("}"));
    if (close > 0) end = close;
  }
  const text = lines.slice(start, end + 1);
  const pad = Math.min(...text.filter((l) => l.trim()).map(indent));
  return { line: start + 1, text: text.map((l) => l.slice(pad)).join("\n") };
}

async function describedFiles(sources: string[]): Promise<string[]> {
  const files = new Set(sources);
  for (const [dir, pattern] of SUMMARY_FILES) {
    for (const name of (await readdir(join(ROOT, dir))).sort()) {
      if (pattern.test(name)) files.add(dir ? `${dir}/${name}` : name);
    }
  }
  return [...files];
}

export interface SourceClause { name: string; arity: number; line: number; rule: boolean; text: string }

const SYMBOL_CHARS = new Set("+-*/\\^<>=~:.?@#&$");

/**
 * The clauses of a Prolog file as written: head name and arity, first line, whether it
 * is a rule, and its text with the comment lines directly above it. Directives are
 * skipped. Enough of Prolog's syntax to split clauses: quotes, 0'c, comments, end dots.
 */
export function sourceClauses(text: string): SourceClause[] {
  const out: SourceClause[] = [];
  const lineAt = (i: number) => text.slice(0, i).split("\n").length;
  const n = text.length;
  let i = 0;
  let comment: { start: number; lastLine: number } | null = null;
  const skipQuoted = (q: string) => {
    for (i++; i < n; i++) {
      if (text[i] === "\\") { i++; continue; }
      if (text[i] === q) {
        if (text[i + 1] === q) { i++; continue; }
        return;
      }
    }
  };
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "%") {
      // Only a comment on a line of its own describes the clause below; a trailing one does not.
      const line = lineAt(i);
      const lineStart = text.lastIndexOf("\n", i) + 1;
      if (text.slice(lineStart, i).trim()) comment = null;
      else if (!comment || comment.lastLine !== line - 1) comment = { start: lineStart, lastLine: line };
      else comment.lastLine = line;
      const eol = text.indexOf("\n", i);
      i = eol < 0 ? n : eol;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") { const e = text.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    // A clause starts here and ends at a dot followed by layout.
    const start = i;
    const line = lineAt(start);
    let end = n;
    let body = -1;
    let depth = 0;
    for (; i < n; i++) {
      const ch = text[i];
      if (ch === "'" || ch === '"' || ch === "`") {
        if (ch === "'" && text[i - 1] === "0" && !/[A-Za-z0-9_]/.test(text[i - 2] ?? "")) { i += text[i + 1] === "\\" ? 2 : 1; continue; }
        skipQuoted(ch); continue;
      }
      if (ch === "%") { const eol = text.indexOf("\n", i); i = eol < 0 ? n : eol; continue; }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (depth === 0 && ch === ":" && text[i + 1] === "-" && body < 0) body = i;
      else if (ch === "." && (i + 1 >= n || /[\s%]/.test(text[i + 1])) && !SYMBOL_CHARS.has(text[i - 1])) { end = i + 1; break; }
    }
    // A comment after the dot on the same line is part of the clause as written.
    const rest = text.slice(end).match(/^[ \t]*%[^\n]*/);
    if (rest) end += rest[0].length;
    i = end;
    const clause = text.slice(start, end);
    const attached = comment && comment.lastLine === line - 1
      ? text.slice(comment.start, start).split("\n").filter((l) => !/^\s*%\s*---/.test(l)).join("\n")
      : "";
    comment = null;
    if (clause.startsWith(":-")) continue;
    const head = clause.match(/^([a-z][A-Za-z0-9_]*|'(?:[^'\\]|\\.|'')*')(\()?/);
    if (!head) continue;
    out.push({ name: head[1], arity: head[2] ? headArity(clause, head[0].length) : 0, line, rule: body >= 0, text: attached + clause });
  }
  return out;
}

/** Arguments of the head whose "(" ends at `from`: top-level commas until the matching ")". */
function headArity(clause: string, from: number): number {
  let depth = 1;
  let commas = 0;
  for (let i = from; i < clause.length && depth > 0; i++) {
    const ch = clause[i];
    if (ch === "'" || ch === '"') {
      for (i++; i < clause.length && clause[i] !== ch; i++) if (clause[i] === "\\") i++;
    } else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 1) commas++;
  }
  return commas + 1;
}

/** First sentence of a file's leading comment, without "name.pl — " and the full stop. */
export function headerSummary(text: string): string | null {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:%|\/\/)\s?(.*)$/);
    if (!m) break;
    const content = m[1].trim();
    if (!content) {
      if (lines.length) break;
      continue;
    }
    lines.push(content);
  }
  if (!lines.length) return null;
  const joined = lines.join(" ").replace(/^[\w./-]+\s+—\s+/, "");
  const end = joined.search(/[.!?](\s|$)/);
  return end >= 0 ? joined.slice(0, end) : joined;
}
