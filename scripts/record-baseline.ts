// Records one live plain-model run per workflow to seeds/<module>/baseline.recorded.json,
// so the comparison can be shown offline, labeled as recorded with its date and model.
// Usage: OPENAI_API_KEY=... npm run baseline:record
import fs from "node:fs";
import path from "node:path";
import { complete } from "../src/adapters/llm";
import { config } from "../src/core/config";
import { modules } from "../src/workflows";

process.loadEnvFile?.(".env");
if (!config.openaiKey) throw new Error("Set OPENAI_API_KEY");
for (const m of Object.values(modules)) {
  const p = m.baselinePrompt(m.livePeriod);
  const started = Date.now();
  const text = (await complete(p.system, p.user, true)) ?? "";
  const score = m.gradeBaseline(m.livePeriod, text);
  const run = {
    id: `recorded-${m.id}`, workflowId: "", kind: "baseline", status: "ready", executor: "local", specVersion: 0, period: m.livePeriod,
    startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), agentSeconds: (Date.now() - started) / 1000,
    items: [], reviews: [], score: { passed: score.passed, total: score.total, cases: [] },
    output: { headline: `Plain ${config.openaiModel}, same files, no spec`, lines: score.notes, data: null },
    source: `Recorded OpenAI run, ${config.openaiModel}, ${new Date().toISOString().slice(0, 10)}`,
  };
  fs.writeFileSync(path.join("seeds", m.id, "baseline.recorded.json"), JSON.stringify(run, null, 2) + "\n");
  console.log(`${m.id}: ${score.passed}/${score.total}`, score.notes);
}
