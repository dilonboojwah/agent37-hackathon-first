// Gives a workflow its own Agent37 sandbox:
//   1. creates an instance (one per workflow, auto-sleep on)
//   2. uploads the bundled runner and the seeds to /home/node/workflow-agent
//   3. checks Node and that the sandbox can reach APP_URL
//   4. creates a platform cron that asks the agent to run the workflow on schedule
//   5. registers the instance with the app so Run now can use exec
//
// Usage: npm run agent37:provision -- --workflow harbor-goods-close
// Needs AGENT37_API_KEY, a public APP_URL, and AGENT_INGEST_TOKEN in .env.
// Not yet run against a live Agent37 account; the client calls follow the docs.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Agent37Client, SANDBOX_DIR, cronPrompt } from "../src/adapters/agent37";
import { defaultWorkflows, getModule } from "../src/workflows";

process.loadEnvFile?.(".env");
const root = path.resolve(import.meta.dirname, "..");
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };

const workflowId = arg("workflow") ?? "harbor-goods-close";
const def = defaultWorkflows.find((w) => w.id === workflowId);
if (!def) throw new Error(`Unknown workflow ${workflowId}. Options: ${defaultWorkflows.map((w) => w.id).join(", ")}`);
const key = process.env.AGENT37_API_KEY;
const appUrl = process.env.APP_URL;
const token = process.env.AGENT_INGEST_TOKEN;
if (!key || !appUrl || !token) throw new Error("Set AGENT37_API_KEY, APP_URL (public), and AGENT_INGEST_TOKEN in .env");
if (/localhost|127\.0\.0\.1/.test(appUrl)) console.warn("Warning: APP_URL is local; the sandbox can't reach it. Deploy to InstaCloud or use a tunnel.");

const module = getModule(def.moduleId);
const client = new Agent37Client(key);

execSync("npm run runner:build", { cwd: root, stdio: "inherit" });

const env: Record<string, string> = { APP_URL: appUrl, AGENT_INGEST_TOKEN: token, SEEDS_DIR: `${SANDBOX_DIR}/seeds`, DEMO_PACE_MS: "140" };
if (process.env.OPENAI_API_KEY && process.argv.includes("--with-openai")) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;

console.log(`Creating Agent37 instance for ${workflowId}...`);
const inst = await client.createInstance({ template: process.env.AGENT37_TEMPLATE ?? "agent37-hermes", name: `show-it-once-${workflowId}`, user: workflowId, env, budgetCreditMicros: 1_000_000, metadata: { workflow: workflowId } });
console.log(`Instance ${inst.id} at ${inst.url}`);

for (let i = 0; i < 36; i++) {
  const h = await client.health(inst.url).catch(() => ({ healthy: false }));
  if (h.healthy) break;
  await new Promise((r) => setTimeout(r, 5000));
}

await client.putFile(inst.url, `${SANDBOX_DIR}/runner.mjs`, fs.readFileSync(path.join(root, "dist/runner.mjs"), "utf8"));
const seedRoot = path.join(root, "seeds", module.id);
for (const rel of fs.readdirSync(seedRoot, { recursive: true }) as string[]) {
  const full = path.join(seedRoot, rel);
  if (fs.statSync(full).isFile()) await client.putFile(inst.url, `${SANDBOX_DIR}/seeds/${module.id}/${rel}`, fs.readFileSync(full, "utf8"));
}
const check = await client.exec(inst.id, `cd ${SANDBOX_DIR} && SEEDS_DIR=${SANDBOX_DIR}/seeds node runner.mjs check`);
console.log("Sandbox check:", check.stdout.trim() || check.stderr.trim());

const defaults = module.defaults;
const cron = await client.createCron(inst.id, { name: `${module.name}: ${defaults.client}`, prompt: cronPrompt(workflowId), schedule: defaults.schedule.cron, timezone: defaults.schedule.timezone });
console.log(`Cron ${cron.id}: "${defaults.schedule.cron}" ${defaults.schedule.timezone}, next run ${cron.next_run ? new Date(cron.next_run * 1000).toISOString() : "n/a"}`);

const res = await fetch(`${appUrl}/api/workflows/${workflowId}/agent37`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ instanceId: inst.id, instanceUrl: inst.url, cronId: cron.id, nextRun: cron.next_run, lastRun: cron.last_run }),
});
console.log(res.ok ? "Registered with the app. Set EXECUTOR=agent37 to send Run now to the sandbox." : `Register failed: ${res.status} ${await res.text()}`);
