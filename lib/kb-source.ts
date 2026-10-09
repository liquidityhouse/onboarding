// The single knowledge source: the Prolog files listed in kb/manifest.json,
// concatenated into one program and versioned by content hash. Shared by the
// web server (GET /api/kb) and the MCP server, so both always see the same KB.

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const MANIFEST = join(ROOT, "kb", "manifest.json");

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
  const program = parts.join("\n");
  return { version: sha(program, 12), loadedAt: Math.floor(Date.now() / 1000), files, program };
}
