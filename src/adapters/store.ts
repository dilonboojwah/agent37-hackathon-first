// System of record. The app is the only writer: the sandbox runner posts events
// to the app, and the app applies them here.
//
// FileStore: .data/state.json, default, zero setup.
// SupabaseStore: used when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
// Both keep an in-process cache and serialize writes, so rapid trace events from
// one run don't race each other.

import fs from "node:fs";
import path from "node:path";
import type { Run, WorkflowRecord } from "@/core/types";
import { config } from "@/core/config";

export interface Store {
  listWorkflows(): Promise<WorkflowRecord[]>;
  getWorkflow(id: string): Promise<WorkflowRecord | undefined>;
  saveWorkflow(w: WorkflowRecord): Promise<void>;
  createRun(run: Run): Promise<void>;
  getRun(id: string): Promise<Run | undefined>;
  mutateRun(id: string, fn: (run: Run) => void): Promise<Run>;
  listRuns(workflowId: string): Promise<Run[]>;
  deleteRuns(workflowId: string): Promise<void>;
  getMemory<T>(workflowId: string, key: string): Promise<T | undefined>;
  setMemory(workflowId: string, key: string, value: unknown): Promise<void>;
  clearMemory(workflowId: string): Promise<void>;
}

interface State {
  workflows: Record<string, WorkflowRecord>;
  runs: Record<string, Run>;
  memory: Record<string, Record<string, unknown>>;
}

class FileStore implements Store {
  private state: State;
  private file: string;

  constructor(dir = path.join(process.cwd(), ".data")) {
    this.file = path.join(dir, "state.json");
    fs.mkdirSync(dir, { recursive: true });
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, "utf8")) : { workflows: {}, runs: {}, memory: {} };
  }

  private flush() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }

  async listWorkflows() { return Object.values(this.state.workflows); }
  async getWorkflow(id: string) { return this.state.workflows[id]; }
  async saveWorkflow(w: WorkflowRecord) { this.state.workflows[w.id] = w; this.flush(); }
  async createRun(run: Run) { this.state.runs[run.id] = run; this.flush(); }
  async getRun(id: string) { return this.state.runs[id]; }
  async mutateRun(id: string, fn: (run: Run) => void) {
    const run = this.state.runs[id];
    if (!run) throw new Error(`Run ${id} not found`);
    fn(run);
    this.flush();
    return run;
  }
  async listRuns(workflowId: string) {
    return Object.values(this.state.runs).filter((r) => r.workflowId === workflowId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async deleteRuns(workflowId: string) {
    for (const [id, r] of Object.entries(this.state.runs)) if (r.workflowId === workflowId) delete this.state.runs[id];
    this.flush();
  }
  async getMemory<T>(workflowId: string, key: string) { return this.state.memory[workflowId]?.[key] as T | undefined; }
  async setMemory(workflowId: string, key: string, value: unknown) { (this.state.memory[workflowId] ??= {})[key] = value; this.flush(); }
  async clearMemory(workflowId: string) { delete this.state.memory[workflowId]; this.flush(); }
}

// Supabase: aggregate rows as JSONB (see supabase/migrations). The normalized
// schema in docs/PRD.md is the target once the shape settles.
class SupabaseStore implements Store {
  private cache = new Map<string, Run>();
  private queues = new Map<string, Promise<unknown>>();
  // Lazily imported so the offline path never loads the client.
  private clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(config.supabaseUrl!, config.supabaseKey!, { auth: { persistSession: false } }),
  );

  private async db() { return this.clientPromise; }

  private enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(key, next.catch(() => undefined));
    return next;
  }

  private check<T>(res: { data: T; error: { message: string } | null }): T {
    if (res.error) throw new Error(`Supabase: ${res.error.message}`);
    return res.data;
  }

  async listWorkflows() {
    const rows = this.check(await (await this.db()).from("workflows").select("data")) as { data: WorkflowRecord }[];
    return rows.map((r) => r.data);
  }
  async getWorkflow(id: string) {
    const rows = this.check(await (await this.db()).from("workflows").select("data").eq("id", id)) as { data: WorkflowRecord }[];
    return rows[0]?.data;
  }
  async saveWorkflow(w: WorkflowRecord) {
    this.check(await (await this.db()).from("workflows").upsert({ id: w.id, data: w, updated_at: w.updatedAt }));
  }
  private async writeRun(run: Run) {
    this.check(await (await this.db()).from("runs").upsert({ id: run.id, workflow_id: run.workflowId, kind: run.kind, status: run.status, started_at: run.startedAt, data: run }));
  }
  async createRun(run: Run) { this.cache.set(run.id, run); await this.enqueue(run.id, () => this.writeRun(run)); }
  async getRun(id: string) {
    if (this.cache.has(id)) return this.cache.get(id);
    const rows = this.check(await (await this.db()).from("runs").select("data").eq("id", id)) as { data: Run }[];
    return rows[0]?.data;
  }
  async mutateRun(id: string, fn: (run: Run) => void) {
    const run = await this.getRun(id);
    if (!run) throw new Error(`Run ${id} not found`);
    fn(run);
    this.cache.set(id, run);
    await this.enqueue(id, () => this.writeRun(run));
    return run;
  }
  async listRuns(workflowId: string) {
    const rows = this.check(await (await this.db()).from("runs").select("data").eq("workflow_id", workflowId).order("started_at", { ascending: false })) as { data: Run }[];
    return rows.map((r) => this.cache.get(r.data.id) ?? r.data);
  }
  async deleteRuns(workflowId: string) {
    for (const [id, r] of this.cache) if (r.workflowId === workflowId) this.cache.delete(id);
    this.check(await (await this.db()).from("runs").delete().eq("workflow_id", workflowId));
  }
  async getMemory<T>(workflowId: string, key: string) {
    const rows = this.check(await (await this.db()).from("agent_memory").select("value").eq("workflow_id", workflowId).eq("key", key)) as { value: T }[];
    return rows[0]?.value;
  }
  async setMemory(workflowId: string, key: string, value: unknown) {
    this.check(await (await this.db()).from("agent_memory").upsert({ workflow_id: workflowId, key, value }));
  }
  async clearMemory(workflowId: string) {
    this.check(await (await this.db()).from("agent_memory").delete().eq("workflow_id", workflowId));
  }
}

const g = globalThis as unknown as { __store?: Store };

/** One store per server process (Next dev reloads modules; globalThis survives). */
export function getStore(): Store {
  if (!g.__store) g.__store = config.supabaseUrl && config.supabaseKey ? new SupabaseStore() : new FileStore();
  return g.__store;
}

/** For tests: an isolated file store in a temp dir. */
export function createFileStore(dir: string): Store {
  return new FileStore(dir);
}
