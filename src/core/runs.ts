// Applies run events to the store. The app is the single writer.
import type { Store } from "@/adapters/store";
import { getModule } from "@/workflows";
import type { AgentEvent } from "./events";
import type { Run, RunItem } from "./types";
import { newId, now } from "./util";

function item(run: Run, itemId: string): RunItem {
  let it = run.items.find((i) => i.id === itemId);
  if (!it) {
    it = { id: itemId, name: itemId, status: "queued", trace: [], checks: [] };
    run.items.push(it);
  }
  return it;
}

export async function applyEvent(store: Store, runId: string, e: AgentEvent): Promise<void> {
  const run = await store.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  const wf = await store.getWorkflow(run.workflowId);
  if (!wf) throw new Error(`Workflow ${run.workflowId} not found`);
  const module = getModule(wf.moduleId);

  await store.mutateRun(runId, (r) => {
    switch (e.type) {
      case "trace": {
        const it = item(r, e.itemId);
        if (it.status === "queued") it.status = "working";
        it.trace.push(e.line);
        break;
      }
      case "status":
        item(r, e.itemId).status = e.status;
        break;
      case "check":
        item(r, e.itemId).checks.push(e.check);
        break;
      case "review":
        r.reviews.push({ ...e.review, id: newId("rv"), runId });
        break;
      case "example_output": {
        const cases = module.grade(e.exampleId, e.output);
        const it = item(r, e.exampleId);
        it.status = cases.every((c) => c.passed) ? "auto" : "failed";
        it.checks = cases.map((c) => ({ name: c.check, passed: c.passed, detail: c.detail }));
        const prev = r.score?.cases.filter((c) => !c.id.startsWith(`${e.exampleId}:`)) ?? [];
        const all = [...prev, ...cases];
        r.score = { passed: all.filter((c) => c.passed).length, total: all.length, cases: all };
        break;
      }
      case "finish":
        r.finishedAt = now();
        r.agentSeconds = Math.round(e.agentSeconds * 10) / 10;
        if (e.output) r.output = e.output;
        r.status = r.reviews.some((x) => !x.decision) ? "needs_review" : "ready";
        break;
      case "error":
        r.status = "failed";
        r.error = e.message;
        r.finishedAt = now();
        break;
    }
  });
}
