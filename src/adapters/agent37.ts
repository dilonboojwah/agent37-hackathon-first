// Agent37 Cloud API client: instances, exec, files, crons.
// Docs: https://www.agent37.com/docs/llms-full.txt
//
// Control plane: https://api.agent37.com with `Authorization: Bearer sk_live_...`
// Instance:      https://{id}.agent37.app with `X-Agent37-Key: sk_live_...`

export interface Agent37Instance {
  id: string;
  status: string;
  url: string;
  template: string;
}

export interface Agent37Cron {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  last_run: number | null;
  next_run: number | null;
}

type Fetch = typeof fetch;

export class Agent37Client {
  constructor(private apiKey: string, private base = "https://api.agent37.com", private fetchImpl: Fetch = fetch) {}

  private async call<T>(method: string, url: string, body?: unknown, instance = false): Promise<T> {
    const headers: Record<string, string> = instance ? { "X-Agent37-Key": this.apiKey } : { Authorization: `Bearer ${this.apiKey}` };
    if (body !== undefined && typeof body !== "string") headers["Content-Type"] = "application/json";
    const res = await this.fetchImpl(url, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Agent37 ${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
    return (text.trim() ? JSON.parse(text) : {}) as T;
  }

  createInstance(opts: { template: string; name: string; user?: string; env: Record<string, string>; budgetCreditMicros?: number; autoSleep?: boolean; metadata?: Record<string, string> }) {
    return this.call<Agent37Instance>("POST", `${this.base}/v1/instances`, {
      template: opts.template,
      name: opts.name,
      user: opts.user,
      env: opts.env,
      metadata: opts.metadata,
      budget: opts.budgetCreditMicros ? { credit_micros: opts.budgetCreditMicros } : undefined,
      auto_sleep: opts.autoSleep ?? true,
      idle_timeout_seconds: 900,
    });
  }

  getInstance(id: string) {
    return this.call<Agent37Instance>("GET", `${this.base}/v1/instances/${id}`);
  }

  deleteInstance(id: string) {
    return this.call<{ id: string; deleted: boolean }>("DELETE", `${this.base}/v1/instances/${id}`);
  }

  /** Runs `sh -c command` inside the instance. Nonzero exit is a normal 200 result. */
  exec(id: string, command: string) {
    return this.call<{ exit_code: number; stdout: string; stderr: string; truncated: boolean }>("POST", `${this.base}/v1/instances/${id}/exec`, { command });
  }

  /** Writes raw bytes to a path on the instance disk (parents created). */
  putFile(instanceUrl: string, filePath: string, content: string) {
    return this.call<{ path: string }>("PUT", `${instanceUrl}/v1/files/content?path=${encodeURIComponent(filePath)}&overwrite=true`, content, true);
  }

  health(instanceUrl: string) {
    return this.call<{ ok?: boolean; healthy?: boolean }>("GET", `${instanceUrl}/v1/health`, undefined, true);
  }

  /** A platform cron sends `prompt` to the instance's agent on schedule, waking it if asleep. */
  createCron(id: string, cron: { name: string; prompt: string; schedule: string; timezone: string }) {
    return this.call<Agent37Cron>("POST", `${this.base}/v1/instances/${id}/crons`, cron);
  }

  listCrons(id: string) {
    return this.call<{ data: Agent37Cron[] }>("GET", `${this.base}/v1/instances/${id}/crons`);
  }
}

export const SANDBOX_DIR = "/home/node/workflow-agent";

/** The command the cron prompt asks the harness to run, and that Run now sends over exec. */
export function runnerCommand(workflowId: string, kind: "scheduled" | "manual", runId?: string) {
  const args = [`--workflow ${workflowId}`, `--kind ${kind}`, runId ? `--run-id ${runId}` : ""].filter(Boolean).join(" ");
  return `cd ${SANDBOX_DIR} && SEEDS_DIR=${SANDBOX_DIR}/seeds node runner.mjs run ${args}`;
}

export function cronPrompt(workflowId: string) {
  return [
    `Run the scheduled ${workflowId} workflow. In a terminal, run exactly:`,
    runnerCommand(workflowId, "scheduled"),
    "Then reply with the last line it printed. Do not change any files.",
  ].join("\n");
}
