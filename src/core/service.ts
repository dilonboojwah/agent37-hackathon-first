// App-level operations used by the API routes. Keeps routes thin.
import { getStore, type Store } from "@/adapters/store";
import { Agent37Client, runnerCommand } from "@/adapters/agent37";
import { complete, completeJson } from "@/adapters/llm";
import { agentAsBaseline, scoreAgainstTruth } from "@/workflows/close";
import { commissionsAgentAsBaseline, scoreCommissions } from "@/workflows/commissions";
import { defaultWorkflows, getModule } from "@/workflows";
import { config, integrations } from "./config";
import type { AgentEvent, EventSink } from "./events";
import { runCore } from "./runner";
import { toolsFor } from "./tools";
import { applyEvent } from "./runs";
import { readSeed, seedExists } from "./seeds";
import { timeSaved } from "./timeSaved";
import type { AgentMemory, Rule, Run, RunKind, WorkflowModule, WorkflowRecord } from "./types";
import { monthLabel, newId, now } from "./util";

export async function ensureWorkspace(store: Store = getStore()): Promise<WorkflowRecord[]> {
  for (const d of defaultWorkflows) {
    if (await store.getWorkflow(d.id)) continue;
    const m = getModule(d.moduleId);
    const t = now();
    await store.saveWorkflow({ id: d.id, moduleId: m.id, ...m.defaults, corrections: [], createdAt: t, updatedAt: t });
  }
  return store.listWorkflows();
}

export async function requireWorkflow(id: string, store: Store = getStore()) {
  await ensureWorkspace(store);
  const wf = await store.getWorkflow(id);
  if (!wf) throw new HttpError(404, `No workflow ${id}`);
  return { wf, module: getModule(wf.moduleId) };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// --- Teach ---------------------------------------------------------------

export async function teach(id: string, writtenRules: string, store: Store = getStore()) {
  const { wf, module } = await requireWorkflow(id, store);
  const spec = module.draftSpec(writtenRules, wf.spec);
  const updated = { ...wf, writtenRules, spec, updatedAt: now() };
  await store.saveWorkflow(updated);
  return updated;
}

// --- Runs ----------------------------------------------------------------

export function storeMemory(store: Store, workflowId: string): AgentMemory {
  return {
    get: (key) => store.getMemory(workflowId, key),
    set: (key, value) => store.setMemory(workflowId, key, value),
  };
}

function newRun(wf: WorkflowRecord, module: WorkflowModule, kind: RunKind, executor: Run["executor"]): Run {
  const practice = kind === "practice";
  const items = practice ? module.examples().map((e) => ({ id: e.id, name: e.label })) : module.items(module.livePeriod);
  return {
    id: newId("run"),
    workflowId: wf.id,
    kind,
    status: "running",
    executor,
    specVersion: wf.spec!.version,
    period: practice ? "examples" : module.livePeriod,
    startedAt: now(),
    items: items.map((i) => ({ ...i, status: "queued", trace: [], checks: [] })),
    reviews: [],
  };
}

export async function startRun(id: string, kind: RunKind, store: Store = getStore(), opts: { awaitCompletion?: boolean } = {}) {
  const { wf, module } = await requireWorkflow(id, store);
  if (!wf.spec) throw new HttpError(400, "Teach this workflow first: draft its spec from your past work.");
  const remote = kind !== "practice" && config.executor === "agent37" && !!wf.agent37 && !!config.agent37Key;
  const run = newRun(wf, module, kind, remote ? "agent37" : "local");
  await store.createRun(run);

  if (remote) {
    const client = new Agent37Client(config.agent37Key!);
    const cmd = `nohup sh -c '${runnerCommand(wf.id, kind === "scheduled" ? "scheduled" : "manual", run.id)}' > /tmp/run-${run.id}.log 2>&1 &`;
    const res = await client.exec(wf.agent37!.instanceId, cmd);
    if (res.exit_code !== 0) await applyEvent(store, run.id, { type: "error", message: `Agent37 exec failed: ${res.stderr.slice(0, 300)}` });
    return run;
  }

  const sink: EventSink = { send: (e: AgentEvent) => applyEvent(store, run.id, e) };
  const job = runCore({ module, spec: wf.spec, kind, period: module.livePeriod, sink, memory: storeMemory(store, wf.id), tools: toolsFor(module), paceMs: config.paceMs });
  if (opts.awaitCompletion) await job;
  else void job;
  return run;
}

/** Called by the sandbox runner when a cron fires: creates the run record it will stream into. */
export async function createRemoteRun(id: string, kind: RunKind, store: Store = getStore()) {
  const { wf, module } = await requireWorkflow(id, store);
  if (!wf.spec) throw new HttpError(400, "Teach this workflow first.");
  const run = newRun(wf, module, kind, "agent37");
  await store.createRun(run);
  return { runId: run.id, moduleId: module.id, spec: wf.spec, period: run.period, kind };
}

export async function remoteRunInfo(runId: string, store: Store = getStore()) {
  const run = await store.getRun(runId);
  if (!run) throw new HttpError(404, "No such run");
  const wf = (await store.getWorkflow(run.workflowId))!;
  return { runId, moduleId: wf.moduleId, spec: wf.spec!, period: run.period, kind: run.kind };
}

export async function registerAgent37(id: string, info: NonNullable<WorkflowRecord["agent37"]>, store: Store = getStore()) {
  const { wf } = await requireWorkflow(id, store);
  await store.saveWorkflow({ ...wf, agent37: info, updatedAt: now() });
}

// --- Correct -------------------------------------------------------------

export async function compileRule(module: WorkflowModule, text: string): Promise<Omit<Rule, "id" | "createdAt" | "origin">> {
  if (config.openaiKey) {
    const kinds = module.ruleKinds.map((k) => `- ${k.kind}: ${k.description} params ${k.params}`).join("\n");
    const res = await completeJson<{ kind: string; params: Record<string, unknown> } | { kind: "unsupported" }>(
      "Turn a bookkeeper's plain-English correction into one structured rule. Reply with JSON {kind, params}. Use kind \"unsupported\" if none fits.",
      `Rule kinds:\n${kinds}\n\nCorrection: ${text}`,
    );
    if (res && res.kind !== "unsupported" && module.ruleKinds.some((k) => k.kind === res.kind)) {
      return { text, kind: res.kind, params: (res as { params: Record<string, unknown> }).params ?? {} };
    }
  }
  const offline = module.compileRuleOffline(text);
  if (offline) return offline;
  throw new HttpError(
    422,
    config.openaiKey
      ? "Couldn't turn that into a rule. Try naming the merchant or condition and the category."
      : `Couldn't turn that into a rule offline. Set OPENAI_API_KEY, or phrase it like: "${module.suggestedCorrections()[0]}"`,
  );
}

export async function correct(id: string, text: string, store: Store = getStore(), opts: { awaitCompletion?: boolean } = {}) {
  const { wf, module } = await requireWorkflow(id, store);
  if (!wf.spec) throw new HttpError(400, "Teach this workflow first.");
  const compiled = await compileRule(module, text);
  const rule: Rule = { ...compiled, id: newId("rule"), origin: "correction", createdAt: now() };
  const correction = { id: newId("fix"), workflowId: wf.id, text, ruleId: rule.id, caseNote: "Every practice run now re-checks your past work with this rule.", createdAt: now() };
  const updated: WorkflowRecord = {
    ...wf,
    spec: { ...wf.spec, version: wf.spec.version + 1, rules: [...wf.spec.rules, rule] },
    corrections: [...wf.corrections, correction],
    updatedAt: now(),
  };
  await store.saveWorkflow(updated);
  const run = await startRun(id, "practice", store, opts);
  return { rule, correction, runId: run.id };
}

// --- Review and send -----------------------------------------------------

export async function decide(runId: string, reviewId: string, decision: string, remember: boolean, store: Store = getStore()) {
  const run = await store.getRun(runId);
  if (!run) throw new HttpError(404, "No such run");
  const review = run.reviews.find((r) => r.id === reviewId);
  if (!review) throw new HttpError(404, "No such review");
  if (!review.actions.includes(decision)) throw new HttpError(400, `Decision must be one of: ${review.actions.join(", ")}`);

  const updated = await store.mutateRun(runId, (r) => {
    const rv = r.reviews.find((x) => x.id === reviewId)!;
    rv.decision = decision;
    rv.remembered = remember && !!rv.ruleIfRemembered && decision === rv.actions[0];
    rv.decidedBy = "you";
    rv.decidedAt = now();
    const it = r.items.find((i) => i.id === rv.itemId);
    if (it && r.reviews.filter((x) => x.itemId === it.id).every((x) => x.decision)) it.status = "auto";
    if (r.status === "needs_review" && r.reviews.every((x) => x.decision)) r.status = "ready";
  });

  if (remember && review.ruleIfRemembered && decision === review.actions[0]) {
    const wf = (await store.getWorkflow(run.workflowId))!;
    const rule: Rule = { ...review.ruleIfRemembered, id: newId("rule"), origin: "decision", createdAt: now() };
    await store.saveWorkflow({ ...wf, spec: { ...wf.spec!, version: wf.spec!.version + 1, rules: [...wf.spec!.rules, rule] }, updatedAt: now() });
  }
  return updated;
}

export async function send(runId: string, store: Store = getStore()) {
  const run = await store.getRun(runId);
  if (!run) throw new HttpError(404, "No such run");
  if (run.reviews.some((r) => !r.decision)) throw new HttpError(409, "Decide every review card before sending.");
  if (run.status === "running") throw new HttpError(409, "The run is still working.");
  if (run.status === "failed") throw new HttpError(409, "The run failed; there's nothing to send.");
  return store.mutateRun(runId, (r) => {
    r.status = "sent";
  });
}

export async function reset(id: string, store: Store = getStore()) {
  const { wf, module } = await requireWorkflow(id, store);
  await store.deleteRuns(id);
  await store.clearMemory(id);
  const t = now();
  await store.saveWorkflow({ id: wf.id, moduleId: module.id, ...module.defaults, corrections: [], agent37: wf.agent37, createdAt: wf.createdAt, updatedAt: t });
}

// --- Plain-model comparison ----------------------------------------------

function agentScore(module: WorkflowModule, run: Run | undefined) {
  if (!run?.output) return null;
  const flags = run.reviews.map((r) => `${r.type}: ${r.title}`);
  if (module.id === "close") return scoreAgainstTruth(module.livePeriod, agentAsBaseline(run.output, flags));
  const b = commissionsAgentAsBaseline(run.output, flags);
  return scoreCommissions(module.livePeriod, b.payouts, b.flags);
}

export async function runBaseline(id: string, store: Store = getStore()) {
  const { wf, module } = await requireWorkflow(id, store);
  if (!config.openaiKey) throw new HttpError(400, "The plain-model comparison needs OPENAI_API_KEY. Run `npm run baseline:record` once with a key to store a recorded run.");
  const prompt = module.baselinePrompt(module.livePeriod);
  const started = Date.now();
  const text = (await complete(prompt.system, prompt.user, true)) ?? "";
  const score = module.gradeBaseline(module.livePeriod, text);
  const run: Run = {
    id: newId("run"), workflowId: wf.id, kind: "baseline", status: "ready", executor: "local", specVersion: 0,
    period: module.livePeriod, startedAt: new Date(started).toISOString(), finishedAt: now(), agentSeconds: (Date.now() - started) / 1000,
    items: [], reviews: [], score: { passed: score.passed, total: score.total, cases: [] },
    output: { headline: `Plain ${config.openaiModel}, same files, no spec`, lines: score.notes, data: null },
    source: `Live OpenAI run, ${config.openaiModel}, ${now().slice(0, 10)}`,
  };
  await store.createRun(run);
  return run;
}

function recordedBaseline(module: WorkflowModule): Run | null {
  const rel = `${module.id}/baseline.recorded.json`;
  return seedExists(rel) ? readSeed<Run>(rel) : null;
}

// --- View model for the UI ----------------------------------------------

export async function workflowView(id: string, store: Store = getStore()) {
  const { wf, module } = await requireWorkflow(id, store);
  const runs = await store.listRuns(id);
  const practice = runs.find((r) => r.kind === "practice");
  const live = runs.find((r) => r.kind === "manual" || r.kind === "scheduled");
  const baseline = runs.find((r) => r.kind === "baseline") ?? recordedBaseline(module);
  const b = module.baseline();
  const decisions = live?.reviews.length ?? 0;
  return {
    workflow: wf,
    module: {
      id: module.id,
      name: module.name,
      unit: module.unit,
      examples: module.examples(),
      queue: module.queue(),
      baseline: b,
      suggestedCorrections: module.suggestedCorrections(),
      livePeriod: module.livePeriod,
      livePeriodLabel: monthLabel(module.livePeriod),
      itemCount: module.items(module.livePeriod).length,
    },
    practice: practice ?? null,
    live: live ?? null,
    baseline: baseline ?? null,
    agentScore: agentScore(module, live),
    timeSaved: timeSaved(b, module.items(module.livePeriod).length, decisions, module.unit),
    integrations: integrations(),
    executor: config.executor,
  };
}

export async function workflowSummaries(store: Store = getStore()) {
  const wfs = await ensureWorkspace(store);
  return Promise.all(
    wfs.map(async (wf) => {
      const module = getModule(wf.moduleId);
      const runs = await store.listRuns(wf.id);
      const practice = runs.find((r) => r.kind === "practice");
      const live = runs.find((r) => r.kind === "manual" || r.kind === "scheduled");
      return {
        id: wf.id,
        name: wf.name,
        client: wf.client,
        schedule: wf.schedule.label,
        queue: module.queue().headline,
        taught: !!wf.spec,
        practiceScore: practice?.score ? `${practice.score.passed} of ${practice.score.total}` : null,
        liveStatus: live?.status ?? null,
        agent37: !!wf.agent37,
      };
    }),
  );
}

