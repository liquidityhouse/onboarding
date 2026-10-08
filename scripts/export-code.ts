// Bundles all application source into export/_code.txt for sharing as a single file.
//
// Files come from `git ls-files` (tracked + untracked, honouring .gitignore), so
// node_modules and anything else ignored is skipped. Outside git, falls back to
// walking the tree and skipping node_modules/.git.
//
// Run: npm run export

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "export");
const OUT = join(OUT_DIR, "_code.txt");
// Generated or noisy files that aren't application code.
const SKIP = [/^export\//, /^package-lock\.json$/, /(^|\/)\.DS_Store$/];

function listFiles(): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" });
    return out.split("\0").filter(Boolean);
  } catch {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".git") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(relative(ROOT, path));
      }
    };
    walk(ROOT);
    return files;
  }
}

const isText = (buf: Buffer) => !buf.subarray(0, 8000).includes(0);

const files = listFiles()
  .filter((f) => !SKIP.some((re) => re.test(f)))
  .filter((f) => { try { return statSync(join(ROOT, f)).isFile(); } catch { return false; } })
  .sort();

const sections: string[] = [];
const included: string[] = [];
for (const file of files) {
  const buf = readFileSync(join(ROOT, file));
  if (!isText(buf)) continue;
  included.push(file);
  const text = buf.toString("utf8");
  sections.push(`===== ${file} =====\n${text}${text.endsWith("\n") ? "" : "\n"}`);
}

const header = [
  `# Code export — ${new Date().toISOString()}`,
  `# ${included.length} files`,
  ...included.map((f) => `#   ${f}`),
  "",
].join("\n");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, `${header}\n${sections.join("\n")}`);
console.log(`Wrote ${relative(ROOT, OUT)} (${included.length} files)`);
