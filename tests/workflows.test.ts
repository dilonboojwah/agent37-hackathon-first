import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createFileStore, type Store } from "@/adapters/store";
import { correct, decide, send, startRun, teach, workflowView, requireWorkflow } from "@/core/service";
import { readSeed } from "@/core/seeds";
import { closeModule } from "@/workflows/close";
import { commissionsModule } from "@/workflows/commissions";

process.env.DEMO_PACE_MS = "0";
delete process.env.OPENAI_API_KEY;

let store: Store;
beforeEach(() => {
  store = createFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "sio-")));
});

async function practiceScore(id: string) {
  const run = await startRun(id, "practice", store, { awaitCompletion: true });
  const done = (await store.getRun(run.id))!;
  expect(done.status).toBe("ready");
  return done.score!;
}

describe("seeds", () => {
  it("every close statement ties opening + activity = closing", () => {
    for (const p of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
      const f = readSeed<{ statements: { accounts: { openingCents: number; closingCents: number; transactions: { amountCents: number }[] }[] }[] }>(`close/periods/${p}.json`);
      for (const st of f.statements) for (const a of st.accounts) {
        expect(a.openingCents + a.transactions.reduce((s, t) => s + t.amountCents, 0)).toBe(a.closingCents);
      }
    }
  });
});

describe("month-end close", () => {
  const id = "harbor-goods-close";

  it("learns from past closes, misses the unwritten rules, and is fixed by two corrections", async () => {
    const { module } = await requireWorkflow(id, store);
    const wf = await teach(id, module.defaults.writtenRules, store);
    expect(wf.spec!.learnedSummary[0]).toMatch(/vendor categories/);

    const first = await practiceScore(id);
    expect(first.total).toBe(12);
    expect(first.passed).toBe(9);
    const misses = first.cases.filter((c) => !c.passed);
    expect(misses.every((c) => c.check === "Categories match your past work")).toBe(true);
    expect(misses.flatMap((c) => c.diffs).some((d) => d.ref.startsWith("AMZN"))).toBe(true);
    expect(misses.flatMap((c) => c.diffs).some((d) => d.ref.includes("FIGMA ANNUAL"))).toBe(true);

    const [amazon, annual] = closeModule.suggestedCorrections();
    const r1 = await correct(id, amazon, store, { awaitCompletion: true });
    expect(r1.rule.kind).toBe("split_by_receipt");
    expect((await store.getRun(r1.runId))!.score!.passed).toBe(11);

    const r2 = await correct(id, annual, store, { awaitCompletion: true });
    expect(r2.rule.kind).toBe("annual_prepaid");
    expect((await store.getRun(r2.runId))!.score!.passed).toBe(12);
  });

  it("live run stops on exactly the three planted exceptions, then sends after decisions", async () => {
    const { module } = await requireWorkflow(id, store);
    await teach(id, module.defaults.writtenRules, store);
    for (const c of closeModule.suggestedCorrections()) await correct(id, c, store, { awaitCompletion: true });

    const run = await startRun(id, "manual", store, { awaitCompletion: true });
    let live = (await store.getRun(run.id))!;
    expect(live.status).toBe("needs_review");
    expect(live.reviews.map((r) => r.type).sort()).toEqual(["New account", "Reconciliation break", "Unknown merchant"]);
    expect(live.items.filter((i) => i.status === "auto").length).toBe(4);
    expect(live.items.filter((i) => i.status === "needs_review").length).toBe(3);
    expect(live.items.flatMap((i) => i.checks).every((c) => c.passed || c.name.startsWith("Payouts"))).toBe(true);

    await expect(send(run.id, store)).rejects.toThrow(/Decide every review/);
    for (const r of live.reviews) await decide(run.id, r.id, r.actions[0], true, store);
    live = (await store.getRun(run.id))!;
    expect(live.status).toBe("ready");
    expect((await send(run.id, store)).status).toBe("sent");

    // Remembering the merchant decision added a rule for next month.
    const wf = (await store.getWorkflow(id))!;
    expect(wf.spec!.rules.some((r) => r.origin === "decision" && r.kind === "vendor_category")).toBe(true);

    const view = await workflowView(id, store);
    expect(view.agentScore!.passed).toBe(view.agentScore!.total);
    expect(view.timeSaved.eliminatedMinutes).toBeGreaterThan(0);
  });

  it("without corrections, the live run books the unwritten-rule cases wrong", async () => {
    const { module } = await requireWorkflow(id, store);
    await teach(id, module.defaults.writtenRules, store);
    const run = await startRun(id, "manual", store, { awaitCompletion: true });
    const view = await workflowView(id, store);
    expect((await store.getRun(run.id))!.reviews.length).toBe(3);
    expect(view.agentScore!.passed).toBeLessThan(view.agentScore!.total);
  });
});

describe("sales commissions", () => {
  const id = "northwind-commissions";

  it("learns the base rate, misses first-year value and accelerators, then passes", async () => {
    const { module } = await requireWorkflow(id, store);
    const wf = await teach(id, module.defaults.writtenRules, store);
    expect(wf.spec!.learned.rate).toBe(0.1);

    const first = await practiceScore(id);
    expect(first.total).toBe(12);
    expect(first.passed).toBe(9);

    const [fyv, accel] = commissionsModule.suggestedCorrections();
    const r1 = await correct(id, fyv, store, { awaitCompletion: true });
    expect(r1.rule.kind).toBe("first_year_value");
    expect((await store.getRun(r1.runId))!.score!.passed).toBe(10);
    const r2 = await correct(id, accel, store, { awaitCompletion: true });
    expect(r2.rule.params.multiplier).toBe(1.5);
    expect((await store.getRun(r2.runId))!.score!.passed).toBe(12);
  });

  it("live run raises split, departed-owner, and missing-date reviews", async () => {
    const { module } = await requireWorkflow(id, store);
    await teach(id, module.defaults.writtenRules, store);
    for (const c of commissionsModule.suggestedCorrections()) await correct(id, c, store, { awaitCompletion: true });
    const run = await startRun(id, "manual", store, { awaitCompletion: true });
    const live = (await store.getRun(run.id))!;
    expect(live.reviews.map((r) => r.type).sort()).toEqual(["Departed owner", "Missing date", "Split over 100%"]);
    expect(live.items.filter((i) => i.status === "auto").length).toBe(5);
    const view = await workflowView(id, store);
    expect(view.agentScore!.passed).toBe(view.agentScore!.total);
  });
});

describe("offline rule compiler", () => {
  it("parses vendor rules and rejects what it can't parse", () => {
    expect(closeModule.compileRuleOffline("SQ *KESTREL PRINT goes to Packaging and labels")).toMatchObject({ kind: "vendor_category", params: { merchant: "SQ *KESTREL PRINT", category: "Packaging and labels" } });
    expect(closeModule.compileRuleOffline("be more careful")).toBeNull();
    expect(commissionsModule.compileRuleOffline("Commission rate is 12% of bookings")).toMatchObject({ kind: "base_rate", params: { rate: 0.12 } });
  });
});

describe("memory", () => {
  it("re-running the same month still checks continuity against the month before", async () => {
    const id = "harbor-goods-close";
    const { module } = await requireWorkflow(id, store);
    await teach(id, module.defaults.writtenRules, store);
    for (let i = 0; i < 2; i++) {
      const run = await startRun(id, "manual", store, { awaitCompletion: true });
      const checks = (await store.getRun(run.id))!.items.flatMap((it) => it.checks).filter((c) => c.name.endsWith("opening matches last month"));
      expect(checks.length).toBeGreaterThan(0);
      expect(checks.every((c) => c.passed)).toBe(true);
    }
  });
});
