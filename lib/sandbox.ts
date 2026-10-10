// Free-form queries (the MCP query_knowledge_base tool) run in a throwaway worker with a
// time limit, so a runaway goal or halt/0 cannot block or kill the shared engine.

import { Worker } from "node:worker_threads";

export function runQuery(program: string, goal: string, { timeoutMs = 3000, limit = 50 } = {}): Promise<string[]> {
  const text = goal.trim().replace(/\.?$/, ".");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./query-worker.ts", import.meta.url), {
      workerData: { program, goal: text, limit },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`stopped after ${timeoutMs / 1000} s`));
    }, timeoutMs);
    worker.once("message", (lines: string[]) => {
      clearTimeout(timer);
      resolve(lines);
      worker.terminate();
    });
    worker.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`query ended without an answer (exit ${code})`));
    });
  });
}
