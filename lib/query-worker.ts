// Runs one free-form Prolog goal against its own copy of the KB, in a worker
// thread that lib/sandbox.ts can terminate. Nothing here can touch the shared engine.

import { parentPort, workerData } from "node:worker_threads";
import { load, Prolog } from "trealla";

const { program, goal, limit } = workerData as { program: string; goal: string; limit: number };

await load();
const pl = new Prolog();
await pl.consultText(program);

const out: string[] = [];
for await (const answer of pl.query(goal, { format: "prolog" })) {
  out.push(String(answer));
  if (out.length >= limit) {
    out.push(`… stopped after ${limit} answers`);
    break;
  }
}
parentPort!.postMessage(out.length ? out : ["false."]);
