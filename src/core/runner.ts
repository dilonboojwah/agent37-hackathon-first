// Runs a workflow module and turns its work into events. The same function runs
// in the Next server (local executor) and in the Agent37 sandbox (runner CLI).
import type { AgentMemory, AgentTools, RunContext, RunKind, Spec, WorkflowModule } from "./types";
import type { EventSink } from "./events";
import { now, sleep } from "./util";

export async function runCore(args: {
  module: WorkflowModule;
  spec: Spec;
  kind: RunKind;
  period: string;
  sink: EventSink;
  memory: AgentMemory;
  tools: AgentTools;
  paceMs: number;
}): Promise<void> {
  const { module, spec, kind, sink, memory, tools } = args;
  const started = Date.now();
  const practice = kind === "practice";
  const pace = practice ? Math.round(args.paceMs / 5) : args.paceMs;

  const ctxFor = (mapItem: (id: string) => string, opts: { quietReviews: boolean }): RunContext => ({
    emit: async (itemId, line) => {
      await sink.send({ type: "trace", itemId: mapItem(itemId), line: { ...line, at: now() } });
      if (pace > 0) await sleep(pace);
    },
    setStatus: async (itemId, status) => {
      if (!practice) await sink.send({ type: "status", itemId: mapItem(itemId), status });
    },
    addCheck: async (itemId, check) => {
      if (!practice) await sink.send({ type: "check", itemId: mapItem(itemId), check });
    },
    addReview: async (review) => {
      if (!opts.quietReviews) await sink.send({ type: "review", review: { ...review, itemId: mapItem(review.itemId) } });
    },
    tools,
    memory,
  });

  try {
    if (practice) {
      // A practice run redoes each past example and is graded against the person's own work.
      for (const ex of module.examples()) {
        await sink.send({ type: "status", itemId: ex.id, status: "working" });
        const { output } = await module.run(ex.period, spec, ctxFor(() => ex.id, { quietReviews: true }), { practice: true });
        await sink.send({ type: "example_output", exampleId: ex.id, output });
      }
      await sink.send({ type: "finish", agentSeconds: (Date.now() - started) / 1000 });
    } else {
      const { output } = await module.run(args.period, spec, ctxFor((id) => id, { quietReviews: false }), { practice: false });
      await sink.send({ type: "finish", output, agentSeconds: (Date.now() - started) / 1000 });
    }
  } catch (err) {
    await sink.send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}
