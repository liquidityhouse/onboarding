// The one live engine the web server and the scripts share, rebuilt when the KB files change, with answers cached
// per KB version. Callers put the role in the cache key.

import { loadKb, type Kb } from "./kb-source.ts";
import { KbEngine } from "./prolog.ts";

const RECHECK_MS = 1000;

interface Loaded {
  kb: Kb;
  engine: Promise<KbEngine>;
  cache: Map<string, Promise<unknown>>;
}

let loaded: Loaded | null = null;
let checked = 0;
let checking: Promise<Loaded> | null = null;

async function refresh(): Promise<Loaded> {
  const kb = await loadKb();
  checked = Date.now();
  if (loaded?.kb.version !== kb.version) {
    const engine = KbEngine.create(kb.program).then((e) => {
      if (e.warnings) console.error(`[kb ${kb.version}] ${e.warnings}`);
      return e;
    });
    loaded = { kb, engine, cache: new Map() };
    console.error(`[kb] loaded version ${kb.version}`);
  }
  return loaded;
}

export interface Current {
  kb: Kb;
  engine: KbEngine;
  /** Memoise an answer for this KB version; a failed answer is not kept. */
  cached<T>(key: string, compute: () => Promise<T>): Promise<T>;
}

/** Re-read the files on the next call, as after a change to the local overrides. */
export function invalidate(): void {
  checked = 0;
}

/** The engine for the current KB version. Files are re-read at most once a second. */
export async function current(): Promise<Current> {
  if (!loaded || Date.now() - checked > RECHECK_MS) {
    checking ??= refresh().finally(() => { checking = null; });
    await checking;
  }
  const { kb, engine, cache } = loaded!;
  return {
    kb,
    engine: await engine,
    cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
      let hit = cache.get(key) as Promise<T> | undefined;
      if (!hit) {
        hit = compute();
        cache.set(key, hit);
        hit.catch(() => cache.delete(key));
      }
      return hit;
    },
  };
}
