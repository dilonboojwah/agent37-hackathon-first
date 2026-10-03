// Shared contract between the engine, workflow modules, the store, and the UI.
// A new workflow implements WorkflowModule and ships a seed; nothing else changes.

export type RuleOrigin = "written" | "learned" | "correction" | "decision";

export interface Rule {
  id: string;
  /** Plain-English text the user sees. */
  text: string;
  /** Machine kind, interpreted by the workflow module. */
  kind: string;
  params: Record<string, unknown>;
  origin: RuleOrigin;
  createdAt: string;
}

export interface Spec {
  version: number;
  steps: string[];
  rules: Rule[];
  stopConditions: string[];
  /** Summary of what was learned from past work, shown on the Teach screen. */
  learnedSummary: string[];
  /** Module-specific learned state (e.g. vendor map, base rate). */
  learned: Record<string, unknown>;
}

export interface ExampleRef {
  id: string;
  label: string;
  period: string;
  files: string[];
  stats: string;
}

export type TraceKind = "think" | "tool" | "check" | "stop" | "done";

export interface TraceLine {
  kind: TraceKind;
  text: string;
  at: string;
}

export type ItemStatus = "queued" | "working" | "auto" | "needs_review" | "failed";

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface RunItem {
  id: string;
  name: string;
  status: ItemStatus;
  trace: TraceLine[];
  checks: CheckResult[];
}

export interface Review {
  id: string;
  runId: string;
  itemId: string;
  title: string;
  type: string;
  evidence: [string, string][];
  proposal: string;
  actions: [string, string];
  /** If set, approving with "remember" turns the decision into this rule. */
  ruleIfRemembered?: Omit<Rule, "id" | "createdAt" | "origin">;
  decision?: string;
  remembered?: boolean;
  decidedBy?: string;
  decidedAt?: string;
}

export interface CaseResult {
  id: string;
  example: string;
  check: string;
  passed: boolean;
  detail: string;
  /** Rows where the agent differed from the person's past work. */
  diffs: { ref: string; expected: string; actual: string }[];
}

export type RunKind = "practice" | "scheduled" | "manual" | "baseline";
export type RunStatus = "running" | "needs_review" | "ready" | "sent" | "failed";

export interface Run {
  id: string;
  workflowId: string;
  kind: RunKind;
  status: RunStatus;
  executor: "local" | "agent37";
  specVersion: number;
  period: string;
  startedAt: string;
  finishedAt?: string;
  agentSeconds?: number;
  items: RunItem[];
  reviews: Review[];
  score?: { passed: number; total: number; cases: CaseResult[] };
  output?: RunOutput;
  error?: string;
  /** For baseline runs: where the numbers came from. */
  source?: string;
}

export interface RunOutput {
  headline: string;
  lines: string[];
  data: unknown;
}

export interface Correction {
  id: string;
  workflowId: string;
  text: string;
  ruleId?: string;
  caseNote?: string;
  createdAt: string;
}

export interface Baseline {
  minutesPerItem: number;
  fixedMinutes: number;
  fixedLabel: string;
  minutesPerDecision: number;
  perItemLabel: string;
  source: string;
}

export interface QueueSummary {
  headline: string;
  subline: string;
  facts: [string, string][];
  deadline: string;
}

export interface WorkflowRecord {
  id: string;
  moduleId: string;
  name: string;
  client: string;
  unit: string;
  schedule: { cron: string; timezone: string; label: string };
  writtenRules: string;
  spec?: Spec;
  corrections: Correction[];
  agent37?: { instanceId: string; instanceUrl: string; cronId?: string; nextRun?: number | null; lastRun?: number | null };
  createdAt: string;
  updatedAt: string;
}

/** Context handed to a workflow module while it runs. */
export interface RunContext {
  emit: (itemId: string, line: Omit<TraceLine, "at">) => Promise<void>;
  setStatus: (itemId: string, status: ItemStatus) => Promise<void>;
  addCheck: (itemId: string, check: CheckResult) => Promise<void>;
  addReview: (review: Omit<Review, "id" | "runId">) => Promise<void>;
  tools: AgentTools;
  memory: AgentMemory;
}

export interface AgentTools {
  /** Identify an unknown merchant or company. Live via monid when enabled, else recorded. */
  lookupEntity: (query: string) => Promise<{ name: string; description: string; source: "monid" | "recorded" | "none" } | null>;
  /** Ask the model for a structured judgment. Returns null when no model is configured. */
  judge: <T>(prompt: string, schemaHint: string) => Promise<T | null>;
}

/** Per-workflow memory that persists between runs (in the Agent37 sandbox, or .data locally). */
export interface AgentMemory {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
}

export interface RuleKindDoc {
  kind: string;
  description: string;
  params: string;
}

export interface WorkflowModule {
  id: string;
  name: string;
  unit: string;
  /** Default workflow record values for a fresh workspace. */
  defaults: Pick<WorkflowRecord, "name" | "client" | "unit" | "schedule" | "writtenRules">;
  examples: () => ExampleRef[];
  queue: () => QueueSummary;
  baseline: () => Baseline;
  /** Suggested correction phrasings shown as chips on the Correct screen. */
  suggestedCorrections: () => string[];
  ruleKinds: RuleKindDoc[];
  /** Turn written rules plus past examples into a spec. Deterministic. */
  draftSpec: (writtenRules: string, previous?: Spec) => Spec;
  /** Offline compiler for plain-English rules. Returns null when it can't parse. */
  compileRuleOffline: (text: string) => Omit<Rule, "id" | "createdAt" | "origin"> | null;
  /** Run the workflow on a period. Practice runs use example periods. */
  run: (period: string, spec: Spec, ctx: RunContext, opts: { practice: boolean }) => Promise<{ output: RunOutput; itemIds: string[] }>;
  /** Items to show as queued before a run starts. */
  items: (period: string) => { id: string; name: string }[];
  /** Grade a practice output against the person's past work for that example. */
  grade: (exampleId: string, output: RunOutput) => CaseResult[];
  /** Period that scheduled runs process. */
  livePeriod: string;
  /** Files and prompt for the plain-model baseline. */
  baselinePrompt: (period: string) => { system: string; user: string };
  gradeBaseline: (period: string, modelText: string) => { passed: number; total: number; notes: string[] };
}
