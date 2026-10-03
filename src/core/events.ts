import type { CheckResult, ItemStatus, Review, RunOutput, TraceLine } from "./types";

// Everything a run produces travels as events, whether the run executes in-process
// or inside an Agent37 sandbox (posted to /api/agent/runs/:id/events).
export type AgentEvent =
  | { type: "trace"; itemId: string; line: TraceLine }
  | { type: "status"; itemId: string; status: ItemStatus }
  | { type: "check"; itemId: string; check: CheckResult }
  | { type: "review"; review: Omit<Review, "id" | "runId"> }
  | { type: "example_output"; exampleId: string; output: RunOutput }
  | { type: "finish"; output?: RunOutput; agentSeconds: number }
  | { type: "error"; message: string };

export interface EventSink {
  send(event: AgentEvent): Promise<void>;
}
