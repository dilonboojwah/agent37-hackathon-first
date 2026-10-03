// Runner CLI. Runs inside the workflow's Agent37 sandbox (bundled to runner.mjs),
// or locally with `npm run runner -- ...` for testing against a running app.
//
//   node runner.mjs run --workflow <id> --kind scheduled|manual [--run-id <id>]
//   node runner.mjs check
//
// It fetches the workflow's current spec from the app, runs the module, and posts
// every event back to the app (the system of record). Memory lives on the sandbox
// disk, so the agent remembers last month between runs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, EventSink } from "@/core/events";
import { runCore } from "@/core/runner";
import { toolsFor } from "@/core/tools";
import type { AgentMemory, RunKind, Spec } from "@/core/types";
import { getModule } from "@/workflows";

const APP_URL = process.env.APP_URL ?? "http://localhost:3737";
const TOKEN = process.env.AGENT_INGEST_TOKEN ?? "";
const MEMORY_DIR = process.env.MEMORY_DIR ?? path.join(os.homedir(), "workflow-agent", "memory");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${APP_URL}${route}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

function fileMemory(workflowId: string): AgentMemory {
  const file = path.join(MEMORY_DIR, `${workflowId}.json`);
  const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}) as Record<string, unknown>;
  return {
    get: async <T,>(key: string) => read()[key] as T | undefined,
    set: async (key, value) => {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ ...read(), [key]: value }, null, 2));
    },
  };
}

function httpSink(runId: string): EventSink {
  // Events are sent in order; a failed post is retried a few times before giving up.
  return {
    send: async (event: AgentEvent) => {
      for (let attempt = 0; ; attempt++) {
        try {
          await api("POST", `/api/agent/runs/${runId}/events`, { events: [event] });
          return;
        } catch (err) {
          if (attempt >= 3) throw err;
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    },
  };
}

async function run() {
  const workflowId = arg("workflow");
  const kind = (arg("kind") ?? "scheduled") as RunKind;
  const runIdArg = arg("run-id");
  if (!workflowId) throw new Error("--workflow is required");

  const info = runIdArg
    ? await api<{ runId: string; moduleId: string; spec: Spec; period: string }>("GET", `/api/agent/runs/${runIdArg}`)
    : await api<{ runId: string; moduleId: string; spec: Spec; period: string }>("POST", `/api/agent/workflows/${workflowId}/runs`, { kind });

  const module = getModule(info.moduleId);
  const pace = Number(process.env.DEMO_PACE_MS ?? 140);
  await runCore({ module, spec: info.spec, kind, period: module.livePeriod, sink: httpSink(info.runId), memory: fileMemory(workflowId), tools: toolsFor(module), paceMs: pace });
  const final = await api<{ status: string; reviews: unknown[] }>("GET", `/api/runs/${info.runId}`);
  console.log(`Run ${info.runId} finished: ${final.status}, ${final.reviews.length} decisions waiting.`);
}

async function check() {
  const health = await fetch(`${APP_URL}/api/health`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  console.log(JSON.stringify({ node: process.version, appUrl: APP_URL, app: health, seeds: process.env.SEEDS_DIR ?? "./seeds", memory: MEMORY_DIR }));
}

const cmd = process.argv[2];
(cmd === "check" ? check() : cmd === "run" ? run() : Promise.reject(new Error("usage: runner.mjs run|check"))).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
