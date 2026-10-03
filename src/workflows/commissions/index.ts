// Monthly sales commissions for one company. Items are reps.
//
// Every comp plan is different, which is why commission SaaS needs long
// implementations. The agent learns the base rate from past statements; the
// person's written rules cover splits and clawbacks; practice exposes the rules
// they forgot to write down (first-year value on multi-year deals, accelerators).

import { readSeed } from "@/core/seeds";
import type { Baseline, CaseResult, ExampleRef, QueueSummary, Rule, RunOutput, WorkflowModule } from "@/core/types";
import { money, monthLabel, slug } from "@/core/util";

interface Rep { id: string; name: string; quotaCents: number; endDate?: string }
interface Deal { id: string; account: string; amountCents: number; termMonths: number; signedDate: string | null; closedWonDate: string; ownerId: string; splits?: { repId: string; pct: number }[] }
interface Churn { dealId: string; churnDate: string; repId: string; commissionPaidCents: number }
interface PeriodFile { period: string; company: string; reps: Rep[]; deals: Deal[]; churn: Churn[]; crmClosedWonTotalCents: number }
interface Line { dealId: string; creditCents: number; commissionCents: number; note: string }
interface Statement { commissionCents: number; lines: Line[] }
interface Expected {
  period: string; statements: Record<string, Statement>; crmClosedWonTotalCents: number; exceptions?: string[];
  heldReps?: string[]; exceptionChecks?: { label: string; pattern: string }[];
}
interface Meta {
  name: string; client: string; clientNote: string; unit: string;
  schedule: { cron: string; timezone: string; label: string };
  livePeriod: string; deadline: string; writtenRules: string; suggestedCorrections: string[];
  baseline: Baseline; examples: ExampleRef[];
}

export interface CommissionsOutputData {
  period: string;
  statements: Record<string, Statement>;
  creditedBookingsCents: number;
  crmClosedWonTotalCents: number;
  dealsCredited: Record<string, number>;
  held: string[];
}

const meta = () => readSeed<Meta>("commissions/meta.json");
const periodFile = (p: string) => readSeed<PeriodFile>(`commissions/periods/${p}.json`);
const expected = (p: string) => readSeed<Expected>(`commissions/examples/${p}.json`);

export const commissionsModule: WorkflowModule = {
  id: "commissions",
  name: "Sales commissions",
  unit: "reps",

  get defaults() {
    const m = meta();
    return { name: m.name, client: m.client, unit: m.unit, schedule: m.schedule, writtenRules: m.writtenRules };
  },
  get livePeriod() {
    return meta().livePeriod;
  },
  examples: () => meta().examples,
  baseline: () => meta().baseline,
  suggestedCorrections: () => meta().suggestedCorrections,

  queue(): QueueSummary {
    const m = meta();
    const f = periodFile(m.livePeriod);
    return {
      headline: `${f.deals.length} closed-won deals across ${f.reps.length} reps waiting for commission statements`,
      subline: `${m.client}, ${m.clientNote} · ${monthLabel(m.livePeriod)}`,
      facts: [
        ["Bookings", money(f.crmClosedWonTotalCents)],
        ["Learned from", `${m.examples.length} approved months`],
        ["Deadline", m.deadline],
      ],
      deadline: m.deadline,
    };
  },

  ruleKinds: [
    { kind: "first_year_value", description: "Multi-year deals pay commission on first-year value only (amount × 12 / term months).", params: "{}" },
    { kind: "accelerator", description: "Bookings above a rep's monthly quota pay the base rate times a multiplier.", params: "{ multiplier: number }" },
    { kind: "base_rate", description: "Commission rate on bookings.", params: "{ rate: number }" },
  ],

  items(period) {
    return periodFile(period).reps.map((r) => ({ id: r.id, name: r.name }));
  },

  draftSpec(writtenRules, previous) {
    const m = meta();
    // Learn the base rate from past lines with no note (plain bookings, no accelerator, no clawback).
    const ratios: number[] = [];
    for (const ex of m.examples) {
      const f = periodFile(ex.period);
      const e = expected(ex.period);
      for (const st of Object.values(e.statements)) {
        for (const l of st.lines) {
          const d = f.deals.find((x) => x.id === l.dealId);
          if (!d || l.note || d.termMonths !== 12 || d.splits) continue;
          ratios.push(l.commissionCents / d.amountCents);
        }
      }
    }
    ratios.sort((a, b) => a - b);
    const rate = Math.round(ratios[Math.floor(ratios.length / 2)] * 1000) / 1000;

    const written: Rule[] = writtenRules
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((text, i) => ({ id: `w${i + 1}`, text, kind: "policy", params: {}, origin: "written" as const, createdAt: new Date().toISOString() }));
    const kept = (previous?.rules ?? []).filter((r) => r.origin === "correction" || r.origin === "decision");

    return {
      version: (previous?.version ?? 0) + 1,
      steps: [
        "Read the CRM closed-won report and the rep roster",
        "Credit each deal to its owner, or to each rep's split share",
        "Apply your commission rules to each rep's credited bookings",
        "Apply clawbacks from the churn report",
        "Check credited bookings tie to the CRM total",
        "Draft each rep's statement",
      ],
      rules: [...written, ...kept],
      stopConditions: [
        "A deal's splits don't add to 100%",
        "A deal's owner had left before it was signed",
        "A deal has no signed date, so the pay month is unknown",
      ],
      learnedSummary: [
        `Learned a ${(rate * 100).toFixed(1)}% base rate from ${ratios.length} past commission lines`,
        `Knows ${periodFile(m.examples[m.examples.length - 1].period).reps.length} reps and their quotas`,
        `Read ${m.examples.length} months of approved statements`,
      ],
      learned: { rate },
    };
  },

  compileRuleOffline(text) {
    const t = text.trim();
    if (/(multi-?year|multiyear)/i.test(t) && /(first[- ]year|year one|annual)/i.test(t)) {
      return { text: t, kind: "first_year_value", params: {} };
    }
    if (/quota/i.test(t) && /(\d+(?:\.\d+)?)\s*x/i.test(t)) {
      const mult = Number(t.match(/(\d+(?:\.\d+)?)\s*x/i)![1]);
      return { text: t, kind: "accelerator", params: { multiplier: mult } };
    }
    const r = t.match(/(\d+(?:\.\d+)?)\s*%/);
    if (r && /rate|commission|earn/i.test(t)) return { text: t, kind: "base_rate", params: { rate: Number(r[1]) / 100 } };
    return null;
  },

  async run(period, spec, ctx, opts) {
    const f = periodFile(period);
    const rateRule = spec.rules.find((r) => r.kind === "base_rate");
    const rate = (rateRule?.params.rate as number) ?? (spec.learned.rate as number);
    const fyv = spec.rules.some((r) => r.kind === "first_year_value");
    const accel = spec.rules.find((r) => r.kind === "accelerator");
    const mult = (accel?.params.multiplier as number) ?? 1;

    const data: CommissionsOutputData = { period, statements: {}, creditedBookingsCents: 0, crmClosedWonTotalCents: f.crmClosedWonTotalCents, dealsCredited: {}, held: [] };
    const credit = (d: Deal) => (fyv && d.termMonths > 12 ? Math.round((d.amountCents * 12) / d.termMonths) : d.amountCents);
    const repById = new Map(f.reps.map((r) => [r.id, r]));
    const flagged = new Set<string>();
    const reviewFor: Record<string, number> = {};

    // Screen every deal once for stop conditions before building statements.
    for (const d of f.deals) {
      const shares = d.splits ?? [{ repId: d.ownerId, pct: 100 }];
      const sum = shares.reduce((s, x) => s + x.pct, 0);
      const owner = repById.get(d.ownerId);
      let problem: Parameters<typeof ctx.addReview>[0] | null = null;
      if (sum !== 100) {
        problem = {
          itemId: d.ownerId,
          title: `${d.account} splits add to ${sum}%`,
          type: "Split over 100%",
          evidence: [["Deal", `${d.id}, ${money(d.amountCents)}`], ["Splits", shares.map((s) => `${repById.get(s.repId)?.name ?? s.repId} ${s.pct}%`).join(", ")], ["Rule", "Split deals pay each rep their share"]],
          proposal: `Scale to ${shares.map((s) => `${Math.round((s.pct * 100) / sum)}%`).join(" / ")}`,
          actions: [`Approve ${shares.map((s) => Math.round((s.pct * 100) / sum)).join("/")}`, "Ask sales ops"],
        };
      } else if (owner?.endDate && d.signedDate && d.signedDate > owner.endDate) {
        problem = {
          itemId: d.ownerId,
          title: `${d.account} was signed after ${owner.name} left`,
          type: "Departed owner",
          evidence: [["Signed", d.signedDate], ["Last day", owner.endDate], ["Deal", `${d.id}, ${money(d.amountCents)}`]],
          proposal: `Pay ${owner.name.split(" ")[0]}: signed within 30 days of leaving`,
          actions: [`Pay ${owner.name.split(" ")[0]}`, "Route to the manager"],
        };
      } else if (!d.signedDate) {
        problem = {
          itemId: d.ownerId,
          title: `${d.account} has no signed date`,
          type: "Missing date",
          evidence: [["Closed-won", d.closedWonDate], ["Signed", "missing"], ["Rule", "Paid in the month the contract is signed"]],
          proposal: `Use the closed-won date, ${d.closedWonDate}`,
          actions: ["Use closed-won date", "Hold until signed copy"],
        };
      }
      if (problem) {
        flagged.add(d.id);
        data.held.push(d.id);
        reviewFor[d.ownerId] = (reviewFor[d.ownerId] ?? 0) + 1;
        if (!opts.practice) await ctx.addReview(problem);
      }
    }

    let creditedTotal = 0;
    for (const rep of f.reps) {
      await ctx.setStatus(rep.id, "working");
      const mine = f.deals.filter((d) => (d.splits ?? [{ repId: d.ownerId, pct: 100 }]).some((s) => s.repId === rep.id));
      await ctx.emit(rep.id, { kind: "think", text: `Building ${rep.name}'s statement: ${mine.length} deal${mine.length === 1 ? "" : "s"}, quota ${money(rep.quotaCents)}` });

      let cum = 0;
      const lines: Line[] = [];
      for (const d of mine.sort((a, b) => a.id.localeCompare(b.id))) {
        const share = (d.splits ?? [{ repId: d.ownerId, pct: 100 }]).find((s) => s.repId === rep.id)!;
        data.dealsCredited[d.id] = (data.dealsCredited[d.id] ?? 0) + share.pct;
        creditedTotal += Math.round((d.amountCents * share.pct) / 100);
        if (flagged.has(d.id)) {
          await ctx.emit(rep.id, { kind: "stop", text: `Stopped: ${d.account} held for your decision` });
          continue;
        }
        const c = Math.round((credit(d) * share.pct) / 100);
        if (fyv && d.termMonths > 12) await ctx.emit(rep.id, { kind: "think", text: `${d.account} is ${d.termMonths / 12} years: credit first-year value ${money(c)} of ${money(d.amountCents)}` });
        const below = Math.max(0, Math.min(c, rep.quotaCents - cum));
        const above = accel ? c - below : 0;
        cum += c;
        const commission = Math.round((accel ? below : c) * rate + above * rate * mult);
        if (above > 0) await ctx.emit(rep.id, { kind: "think", text: `${money(above)} is above quota: ${mult}x rate` });
        lines.push({ dealId: d.id, creditCents: c, commissionCents: commission, note: above > 0 ? "accelerator above quota" : "" });
      }
      for (const ch of f.churn.filter((x) => x.repId === rep.id)) {
        lines.push({ dealId: ch.dealId, creditCents: 0, commissionCents: -ch.commissionPaidCents, note: "clawback: churned within 90 days" });
        await ctx.emit(rep.id, { kind: "tool", text: `Clawback ${money(-ch.commissionPaidCents)}: ${ch.dealId} churned on ${ch.churnDate}` });
      }
      const total = lines.reduce((s, l) => s + l.commissionCents, 0);
      data.statements[rep.id] = { commissionCents: total, lines };
      await ctx.emit(rep.id, { kind: "tool", text: `Statement drafted: ${money(total)} on ${lines.length} line${lines.length === 1 ? "" : "s"}` });

      const needs = (reviewFor[rep.id] ?? 0) > 0 && !opts.practice;
      await ctx.emit(rep.id, needs ? { kind: "stop", text: "Waiting on your decision" } : { kind: "done", text: "Completed automatically" });
      await ctx.setStatus(rep.id, needs ? "needs_review" : "auto");
    }
    data.creditedBookingsCents = creditedTotal;
    const ties = creditedTotal === f.crmClosedWonTotalCents;
    if (f.reps[0]) await ctx.addCheck(f.reps[0].id, { name: "Credited bookings tie to CRM", passed: ties, detail: `${money(creditedTotal)} vs ${money(f.crmClosedWonTotalCents)}` });

    const totalPay = Object.values(data.statements).reduce((s, x) => s + x.commissionCents, 0);
    return {
      itemIds: f.reps.map((r) => r.id),
      output: {
        headline: `${monthLabel(period)} commission statements for ${f.company}`,
        lines: [
          `${Object.keys(data.statements).length} rep statements, ${money(totalPay)} total commission`,
          `Credited bookings ${money(creditedTotal)} ${ties ? "tie" : "do not tie"} to the CRM total`,
          `${data.held.length} deals held for your decisions`,
        ],
        data,
      },
    };
  },

  grade(exampleId, output) {
    const exp = expected(exampleId);
    const got = output.data as CommissionsOutputData;
    const f = periodFile(exampleId);
    const label = monthLabel(exampleId);
    const repName = (id: string) => f.reps.find((r) => r.id === id)?.name ?? id;
    const c = (check: string, passed: boolean, detail: string, diffs: CaseResult["diffs"] = []): CaseResult => ({ id: `${exampleId}:${slug(check)}`, example: label, check, passed, detail, diffs });

    const uncredited = f.deals.filter((d) => got.dealsCredited[d.id] !== 100);
    const payDiffs = Object.entries(exp.statements)
      .filter(([rep, st]) => got.statements[rep]?.commissionCents !== st.commissionCents)
      .map(([rep, st]) => ({ ref: repName(rep), expected: money(st.commissionCents), actual: got.statements[rep] ? money(got.statements[rep].commissionCents) : "missing" }));
    const expClaw = Object.values(exp.statements).flatMap((s) => s.lines.filter((l) => l.note.startsWith("clawback")));
    const gotClaw = Object.values(got.statements).flatMap((s) => s.lines.filter((l) => l.note.startsWith("clawback")));
    const clawOk = expClaw.length === gotClaw.length && expClaw.every((e) => gotClaw.some((g) => g.dealId === e.dealId && g.commissionCents === e.commissionCents));

    return [
      c("Every deal credited", uncredited.length === 0, uncredited.length ? `${uncredited.length} deals not fully credited` : `${f.deals.length} of ${f.deals.length} deals`),
      c("Payouts match your statements", payDiffs.length === 0, payDiffs.length ? `${payDiffs.length} of ${Object.keys(exp.statements).length} reps paid differently` : `${Object.keys(exp.statements).length} of ${Object.keys(exp.statements).length} reps match`, payDiffs),
      c("Bookings tie to the CRM", got.creditedBookingsCents === exp.crmClosedWonTotalCents, `${money(got.creditedBookingsCents)} vs ${money(exp.crmClosedWonTotalCents)}`),
      c("Clawbacks applied", clawOk, expClaw.length ? `${gotClaw.length} of ${expClaw.length} clawbacks` : "No churn this month"),
    ];
  },

  baselinePrompt(period) {
    const m = meta();
    const past = m.examples.map((ex) => ({ period: ex.period, crm: periodFile(ex.period), statements: expected(ex.period).statements }));
    return {
      system: "You are a sales-ops analyst calculating monthly commissions. Answer with JSON only.",
      user: [
        `Company: ${m.client}. Comp plan rules as written:\n${m.writtenRules}`,
        `Past months with approved statements (JSON):\n${JSON.stringify(past)}`,
        `This month's CRM export (JSON):\n${JSON.stringify(periodFile(period))}`,
        'Return {"payouts": {"<rep id>": <commission in cents> | "FLAG: <reason>"}, "flags": ["<issue that needs a human>"]}. Flag anything you cannot verify instead of guessing.',
      ].join("\n\n"),
    };
  },

  gradeBaseline(period, modelText) {
    const json = modelText.slice(modelText.indexOf("{"), modelText.lastIndexOf("}") + 1);
    let v: { payouts?: Record<string, number | string>; flags?: string[] } = {};
    try { v = JSON.parse(json); } catch { /* scored as empty */ }
    return scoreCommissions(period, v.payouts ?? {}, v.flags ?? []);
  },
};

export function scoreCommissions(period: string, payouts: Record<string, number | string>, flags: string[]) {
  const truth = readSeed<Expected>(`commissions/truth/${period}.json`);
  const f = periodFile(period);
  const heldReps = new Set(truth.heldReps ?? []);
  let ok = 0;
  const reps = Object.keys(truth.statements);
  for (const rep of reps) {
    const g = payouts[rep];
    if (typeof g === "string" && g.startsWith("FLAG")) { ok++; continue; }
    if (heldReps.has(rep)) continue; // truth depends on a human decision
    if (g === truth.statements[rep].commissionCents) ok++;
  }
  const scorable = reps.filter((r) => !heldReps.has(r)).length;
  const flagText = flags.join(" ").toLowerCase();
  const checks: [string, boolean][] = (truth.exceptionChecks ?? []).map((c) => [c.label, new RegExp(c.pattern).test(flagText)]);
  const payPass = ok >= scorable;
  return {
    passed: (payPass ? 1 : 0) + checks.filter(([, x]) => x).length,
    total: 1 + checks.length,
    notes: [`${ok} of ${reps.length} rep payouts correct or flagged (${f.deals.length} deals)`, ...checks.map(([n, x]) => `${x ? "Yes" : "No"}: ${n}`)],
  };
}

export function commissionsAgentAsBaseline(output: RunOutput, reviewsText: string[]) {
  const d = output.data as CommissionsOutputData;
  const payouts: Record<string, number | string> = {};
  for (const [rep, st] of Object.entries(d.statements)) payouts[rep] = st.commissionCents;
  return { payouts, flags: reviewsText };
}
