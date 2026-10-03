// Month-end close for one client. Items are statement files.
//
// What the agent can learn from past closes: each vendor's usual category, the
// accounts in the books, last month's closing balances. What it cannot learn from
// a vendor map alone (and must be taught by correction): receipt-level splits and
// threshold policies like "annual plans over $1,000 are prepaid".

import { readSeed } from "@/core/seeds";
import type { Baseline, CaseResult, ExampleRef, QueueSummary, Rule, RunContext, RunOutput, Spec, WorkflowModule } from "@/core/types";
import { money, monthLabel, slug } from "@/core/util";

type Split = { category: string; amountCents: number };
type Category = string | Split[];

interface Txn { id: string; date: string; description: string; merchant: string; amountCents: number; receipt?: { lines: { desc: string; amountCents: number }[] } }
interface Account { accountId: string; name: string; currency: string; last4?: string; openingCents: number; closingCents: number; transactions: Txn[] }
interface Payout { id: string; date: string; ordersCount: number; grossCents: number; feesCents: number; refundsCents: number; chargebacksCents: number; depositCents: number }
interface Statement {
  file: string;
  item: string;
  accounts: Account[];
  payouts?: Payout[];
  register?: { netPayCents: number; employerTaxesCents: number; withholdingCents: number; grossWagesCents: number; runs: { date: string; netPayCents: number; taxesCents: number }[] };
}
interface PeriodFile { period: string; client: string; statements: Statement[] }
interface Expected {
  period: string;
  accountsFound: string[];
  accounts: Record<string, { openingCents: number; closingCents: number }>;
  categories: Record<string, Category>;
  payouts: Record<string, { salesCents: number; feesCents: number; refundsCents: number; chargebacksCents: number; depositCents: number; unexplainedCents: number }>;
  payroll: { netPayCents: number; taxesCents: number; tiesToBank: boolean };
  exceptions?: string[];
  exceptionChecks?: { label: string; pattern: string }[];
}
interface Meta {
  name: string; client: string; clientNote: string; unit: string;
  schedule: { cron: string; timezone: string; label: string };
  livePeriod: string; deadline: string; chart: string[]; writtenRules: string;
  wiring: { bankAccountId: string; payrollNetMerchant: string; payrollTaxMerchant: string };
  suggestedCorrections: string[]; baseline: Baseline; examples: ExampleRef[];
  liveStats: { transactions: number; statements: number };
  recordedLookups: Record<string, { name: string; description: string }>;
}

export interface CloseOutputData {
  period: string;
  accountsFound: string[];
  accounts: Record<string, { openingCents: number; closingCents: number; ties: boolean }>;
  categories: Record<string, Category>;
  payouts: Record<string, { salesCents: number; feesCents: number; refundsCents: number; chargebacksCents: number; depositCents: number; unexplainedCents: number }>;
  payroll: { netPayCents: number; taxesCents: number; tiesToBank: boolean };
  pending: string[];
}

const meta = () => readSeed<Meta>("close/meta.json");
const periodFile = (p: string) => readSeed<PeriodFile>(`close/periods/${p}.json`);
const expected = (p: string) => readSeed<Expected>(`close/examples/${p}.json`);

const catText = (c: Category | undefined): string =>
  c === undefined ? "not categorized" : typeof c === "string" ? c : "Split: " + c.map((s) => `${s.category} ${money(s.amountCents)}`).join(", ");
const sameCat = (a: Category | undefined, b: Category | undefined) => catText(a) === catText(b);

function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function singular(word: string): string {
  const w = word.trim().toLowerCase();
  return w.endsWith("s") ? w.slice(0, -1) : w;
}

function matchChart(text: string): string | null {
  const t = text.trim().replace(/\.$/, "").toLowerCase();
  return meta().chart.find((c) => c.toLowerCase() === t) ?? meta().chart.find((c) => t.includes(c.toLowerCase())) ?? null;
}

export const closeModule: WorkflowModule = {
  id: "close",
  name: "Month-end close",
  unit: "statements",

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
    return {
      headline: `${m.liveStats.transactions} transactions across ${m.liveStats.statements} statements waiting for close`,
      subline: `${m.client}, ${m.clientNote} · ${monthLabel(m.livePeriod)}`,
      facts: [
        ["Statements", String(m.liveStats.statements)],
        ["Learned from", `${m.examples.length} past closes`],
        ["Deadline", m.deadline],
      ],
      deadline: m.deadline,
    };
  },

  ruleKinds: [
    { kind: "split_by_receipt", description: "Split a merchant's charges by receipt line; lines matching inventory words go to one category, the rest to another.", params: "{ merchant: string, inventoryWords: string[], inventoryCategory: string, otherCategory: string }" },
    { kind: "annual_prepaid", description: "Charges described as annual plans at or above a threshold go to a prepaid category.", params: "{ thresholdCents: number, category: string }" },
    { kind: "vendor_category", description: "Always book a merchant to a category.", params: "{ merchant: string, category: string }" },
  ],

  items(period) {
    return periodFile(period).statements.map((s) => ({ id: slug(s.item), name: s.item }));
  },

  draftSpec(writtenRules, previous) {
    const m = meta();
    const votes: Record<string, Record<string, number>> = {};
    const known = new Set<string>();
    const txnsById = new Map<string, Txn>();
    for (const ex of m.examples) {
      for (const st of periodFile(ex.period).statements) for (const a of st.accounts) for (const t of a.transactions) txnsById.set(t.id, t);
      const e = expected(ex.period);
      e.accountsFound.forEach((a) => known.add(a));
      for (const [id, cat] of Object.entries(e.categories)) {
        if (typeof cat !== "string") continue;
        const t = txnsById.get(id);
        if (!t) continue;
        (votes[t.merchant] ??= {})[cat] = (votes[t.merchant]?.[cat] ?? 0) + 1;
      }
    }
    const vendorMap: Record<string, string> = {};
    for (const [merchant, counts] of Object.entries(votes)) {
      vendorMap[merchant] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
    const last = m.examples[m.examples.length - 1];
    const lastClosings = Object.fromEntries(Object.entries(expected(last.period).accounts).map(([k, v]) => [k, v.closingCents]));

    const written: Rule[] = writtenRules
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((text, i) => ({ id: `w${i + 1}`, text, kind: "policy", params: {}, origin: "written" as const, createdAt: new Date().toISOString() }));
    const kept = (previous?.rules ?? []).filter((r) => r.origin === "correction" || r.origin === "decision");

    return {
      version: (previous?.version ?? 0) + 1,
      steps: [
        "Read each statement and list every account inside it",
        "Check opening plus activity equals closing, to the cent",
        "Check each opening balance matches last month's closing",
        "Book each transaction: your rules first, then your vendor history",
        "Look up merchants with no history; ask you if still unsure",
        "Break each Shopify payout into sales, fees, refunds, and chargebacks",
        "Tie the payroll register to the bank",
        "Assemble the close packet",
      ],
      rules: [...written, ...kept],
      stopConditions: [
        "An account in a statement isn't in your books",
        "A payout doesn't break down to its deposit",
        "A merchant has no history and no rule covers it",
        "Balances don't tie to the cent",
      ],
      learnedSummary: [
        `Learned ${Object.keys(vendorMap).length} vendor categories from ${m.examples.length} past closes`,
        `Knows your ${known.size} accounts`,
        `Remembers ${monthLabel(last.period)} closing balances for continuity checks`,
      ],
      learned: { vendorMap, knownAccounts: [...known], lastClosings },
    };
  },

  compileRuleOffline(text) {
    const t = text.trim();
    if (/split/i.test(t) && /(amazon|amzn)/i.test(t)) {
      const inv = t.match(/:\s*(.+?)\s+(?:are|is)\s+inventory/i);
      const words = inv ? inv[1].split(/,|\band\b/i).map((w) => w.trim()).filter(Boolean).map((w) => w.split(/\s+/).map((x, i, arr) => (i === arr.length - 1 ? singular(x) : x.toLowerCase())).join(" ")) : [];
      if (!words.length) return null;
      const other = t.match(/everything else (?:is|goes to)\s+(.+?)\.?$/i);
      return {
        text: t,
        kind: "split_by_receipt",
        params: { merchant: "AMZN MKTP", inventoryWords: words, inventoryCategory: "Inventory", otherCategory: (other && matchChart(other[1])) || "Office supplies" },
      };
    }
    if (/annual/i.test(t) && /prepaid/i.test(t)) {
      const amt = t.match(/\$\s?([\d,]+)/);
      const threshold = amt ? Number(amt[1].replace(/,/g, "")) * 100 : 100000;
      return { text: t, kind: "annual_prepaid", params: { thresholdCents: threshold, category: "Prepaid expenses" } };
    }
    const v = t.match(/^(.+?)\s+(?:always\s+)?(?:goes|go|belongs?|should go|is booked)\s+(?:to|in|under|as)\s+(.+?)\.?$/i);
    if (v) {
      const category = matchChart(v[2]);
      if (category) return { text: t, kind: "vendor_category", params: { merchant: v[1].trim().toUpperCase(), category } };
    }
    return null;
  },

  async run(period, spec, ctx, opts) {
    const file = periodFile(period);
    const learned = spec.learned as { vendorMap: Record<string, string>; knownAccounts: string[]; lastClosings: Record<string, number> };
    const rules = spec.rules;
    const splitRules = rules.filter((r) => r.kind === "split_by_receipt");
    const annualRules = rules.filter((r) => r.kind === "annual_prepaid");
    const vendorRules = rules.filter((r) => r.kind === "vendor_category");
    // Memory holds closing balances by period, so a re-run of the same month still
    // compares against the month before it.
    const byPeriod = (await ctx.memory.get<Record<string, Record<string, number>>>("closingsByPeriod")) ?? {};
    const remembered = byPeriod[previousPeriod(period)] ?? learned.lastClosings;

    const data: CloseOutputData = { period, accountsFound: [], accounts: {}, categories: {}, payouts: {}, payroll: { netPayCents: 0, taxesCents: 0, tiesToBank: false }, pending: [] };
    const wiring = meta().wiring;
    const chase = file.statements.flatMap((s) => s.accounts).find((a) => a.accountId === wiring.bankAccountId);
    const itemIds: string[] = [];
    const reviewedMerchants = new Set<string>();

    const categorize = async (itemId: string, t: Txn): Promise<{ cat?: Category; via: "rule" | "history" | "review" }> => {
      for (const r of vendorRules) if ((r.params.merchant as string) === t.merchant.toUpperCase()) return { cat: r.params.category as string, via: "rule" };
      for (const r of splitRules) {
        if (t.merchant !== r.params.merchant || !t.receipt) continue;
        const words = r.params.inventoryWords as string[];
        const parts: Split[] = t.receipt.lines.map((l) => ({
          category: words.some((w) => l.desc.toLowerCase().includes(w)) ? (r.params.inventoryCategory as string) : (r.params.otherCategory as string),
          amountCents: l.amountCents,
        }));
        const cats = new Set(parts.map((p) => p.category));
        if (cats.size > 1) {
          await ctx.emit(itemId, { kind: "think", text: `${t.merchant} ${money(-t.amountCents)} split by receipt: ${parts.map((p) => `${money(p.amountCents)} ${p.category.toLowerCase()}`).join(", ")}` });
          return { cat: parts, via: "rule" };
        }
        return { cat: parts[0].category, via: "rule" };
      }
      for (const r of annualRules) {
        if (/annual/i.test(t.description) && -t.amountCents >= (r.params.thresholdCents as number)) {
          await ctx.emit(itemId, { kind: "think", text: `${t.description} ${money(-t.amountCents)} is an annual plan over ${money(r.params.thresholdCents as number)}: prepaid` });
          return { cat: r.params.category as string, via: "rule" };
        }
      }
      const hist = learned.vendorMap[t.merchant];
      if (hist) return { cat: hist, via: "history" };

      // No rule, no history: look it up, then ask.
      if (!reviewedMerchants.has(t.merchant)) {
        reviewedMerchants.add(t.merchant);
        const found = await ctx.tools.lookupEntity(t.merchant);
        await ctx.emit(itemId, { kind: "tool", text: found ? `Looked up "${t.merchant}" via ${found.source}: ${found.name}` : `No match found for "${t.merchant}"` });
        const judged = await ctx.tools.judge<{ category: string; confidence: number }>(
          `Merchant "${t.merchant}" (${found?.description ?? "no description"}), charge ${money(-t.amountCents)}. Pick one category from: ${meta().chart.join(", ")}.`,
          '{"category": string, "confidence": number between 0 and 1}',
        );
        const desc = (found?.description ?? "").toLowerCase();
        const guess = judged?.category ?? (/(box|label|packag)/.test(desc) ? "Packaging and labels" : /(flyer|marketing|ads?)\b/.test(desc) ? "Advertising" : "Office supplies");
        const confidence = judged?.confidence ?? 0.58;
        if (!opts.practice) {
          await ctx.emit(itemId, { kind: "stop", text: `Stopped: no history for ${t.merchant}, best guess ${guess} at ${confidence.toFixed(2)} confidence` });
          await ctx.addReview({
            itemId,
            title: `${t.merchant} ${money(-t.amountCents)} has no history`,
            type: "Unknown merchant",
            evidence: [
              ["Looked up", found ? `${found.name} (${found.source})` : "No match"],
              ["What they do", found?.description ?? "Unknown"],
              ["Best guess", `${guess}, confidence ${confidence.toFixed(2)}`],
            ],
            proposal: `Book to ${guess}`,
            actions: [`Book as ${guess.toLowerCase()}`, "Ask the client"],
            ruleIfRemembered: { text: `${t.merchant} goes to ${guess}`, kind: "vendor_category", params: { merchant: t.merchant.toUpperCase(), category: guess } },
          });
        }
      }
      data.pending.push(t.id);
      return { via: "review" };
    };

    for (const st of file.statements) {
      const itemId = slug(st.item);
      itemIds.push(itemId);
      let needsReview = false;
      await ctx.setStatus(itemId, "working");
      await ctx.emit(itemId, { kind: "think", text: `Reading ${st.file}` });

      if (st.accounts.length) {
        await ctx.emit(itemId, { kind: "tool", text: `Found ${st.accounts.length} account${st.accounts.length > 1 ? "s" : ""} in the file: ${st.accounts.map((a) => `${a.name}${a.last4 ? ` ··${a.last4}` : ""}`).join(", ")}` });
      }

      for (const a of st.accounts) {
        data.accountsFound.push(a.accountId);
        const activity = a.transactions.reduce((s, t) => s + t.amountCents, 0);
        const ties = a.openingCents + activity === a.closingCents;
        data.accounts[a.accountId] = { openingCents: a.openingCents, closingCents: a.closingCents, ties };
        await ctx.addCheck(itemId, { name: `${a.name} ties to the cent`, passed: ties, detail: `${money(a.openingCents, a.currency)} + ${money(activity, a.currency)} = ${money(a.closingCents, a.currency)}` });
        await ctx.emit(itemId, { kind: "check", text: ties ? `${a.name}: opening + activity = closing, ties to the cent` : `${a.name} does not tie` });

        if (!learned.knownAccounts.includes(a.accountId)) {
          needsReview = true;
          await ctx.emit(itemId, { kind: "stop", text: `Stopped: ${a.name} isn't in your books` });
          if (!opts.practice) {
            await ctx.addReview({
              itemId,
              title: `${a.name} in ${st.file} isn't in your books`,
              type: "New account",
              evidence: [
                ["Account", `${a.name}, ${a.currency}${a.last4 ? `, ··${a.last4}` : ""}`],
                ["Transactions", String(a.transactions.length)],
                ["Closing balance", money(a.closingCents, a.currency)],
              ],
              proposal: `Add the account and book its ${a.transactions.length} transactions`,
              actions: ["Add account", "Skip with a reason"],
            });
          }
          a.transactions.forEach((t) => data.pending.push(t.id));
          continue;
        }

        const prev = remembered[a.accountId];
        if (prev !== undefined && !opts.practice) {
          const ok = prev === a.openingCents;
          await ctx.addCheck(itemId, { name: `${a.name} opening matches last month`, passed: ok, detail: `last closing ${money(prev)}, opening ${money(a.openingCents)}` });
          await ctx.emit(itemId, { kind: "check", text: ok ? `Opening matches last month's closing from memory` : `Opening differs from last month's closing` });
        }

        let byRule = 0, byHistory = 0, held = 0;
        for (const t of a.transactions) {
          const r = await categorize(itemId, t);
          if (r.cat !== undefined) data.categories[t.id] = r.cat;
          if (r.via === "rule") byRule++;
          else if (r.via === "history") byHistory++;
          else { held++; needsReview = true; }
        }
        await ctx.emit(itemId, { kind: "tool", text: `Booked ${byRule + byHistory} of ${a.transactions.length}: ${byRule} by your rules, ${byHistory} by vendor history${held ? `, ${held} held for you` : ""}` });
      }

      if (st.payouts) {
        let breaks = 0;
        for (const p of st.payouts) {
          const computed = p.grossCents - p.feesCents - p.refundsCents - p.chargebacksCents;
          const unexplained = computed - p.depositCents;
          const inBank = chase?.transactions.some((t) => t.description.includes(p.id) && t.amountCents === p.depositCents) ?? false;
          data.payouts[p.id] = { salesCents: p.grossCents, feesCents: p.feesCents, refundsCents: p.refundsCents, chargebacksCents: p.chargebacksCents, depositCents: p.depositCents, unexplainedCents: unexplained };
          if (unexplained !== 0) {
            breaks++;
            needsReview = true;
            await ctx.emit(itemId, { kind: "stop", text: `Stopped: payout ${p.id} deposit ${money(p.depositCents)} is ${money(unexplained)} short of the report` });
            if (!opts.practice) {
              await ctx.addReview({
                itemId,
                title: `Shopify payout ${money(p.depositCents)} vs ${money(p.grossCents)} of sales`,
                type: "Reconciliation break",
                evidence: [
                  ["Fees", money(p.feesCents)],
                  ["Refunds", money(p.refundsCents)],
                  ["Unexplained", money(unexplained)],
                ],
                proposal: `Book fees and refunds; ask about ${money(unexplained)} (likely a chargeback missing from the report)`,
                actions: ["Approve entries", "Ask the client"],
              });
            }
          } else if (!inBank) {
            await ctx.emit(itemId, { kind: "check", text: `Payout ${p.id} not found in Chase` });
          }
        }
        await ctx.addCheck(itemId, { name: "Payouts break down to deposits", passed: breaks === 0, detail: `${st.payouts.length - breaks} of ${st.payouts.length} explained` });
        await ctx.emit(itemId, { kind: "check", text: `${st.payouts.length - breaks} of ${st.payouts.length} payouts break down to their deposits and match Chase` });
      }

      if (st.register) {
        const net = chase?.transactions.filter((t) => t.merchant === wiring.payrollNetMerchant).reduce((s, t) => s - t.amountCents, 0) ?? 0;
        const tax = chase?.transactions.filter((t) => t.merchant === wiring.payrollTaxMerchant).reduce((s, t) => s - t.amountCents, 0) ?? 0;
        const regTax = st.register.runs.reduce((s, r) => s + r.taxesCents, 0);
        const ties = net === st.register.netPayCents && tax === regTax;
        data.payroll = { netPayCents: st.register.netPayCents, taxesCents: regTax, tiesToBank: ties };
        await ctx.addCheck(itemId, { name: "Payroll register ties to the bank", passed: ties, detail: `net pay ${money(net)}, taxes ${money(tax)}` });
        await ctx.emit(itemId, { kind: "check", text: ties ? `Payroll register ties to Chase: net pay ${money(net)}, taxes ${money(tax)}` : "Payroll register does not tie to Chase" });
      }

      await ctx.emit(itemId, needsReview && !opts.practice ? { kind: "stop", text: "Waiting on your decision" } : { kind: "done", text: "Completed automatically" });
      await ctx.setStatus(itemId, needsReview && !opts.practice ? "needs_review" : "auto");
    }

    if (!opts.practice) {
      await ctx.memory.set("closingsByPeriod", { ...byPeriod, [period]: Object.fromEntries(Object.entries(data.accounts).map(([k, v]) => [k, v.closingCents])) });
    }

    const booked = Object.keys(data.categories).length;
    const output: RunOutput = {
      headline: `${monthLabel(period)} close packet for ${file.client}`,
      lines: [
        `${data.accountsFound.length} accounts reconciled; ${Object.values(data.accounts).filter((a) => a.ties).length} tie to the cent`,
        `${booked} transactions booked, ${data.pending.length} held for your decisions`,
        `${Object.keys(data.payouts).length} Shopify payouts broken into sales, fees, refunds, and chargebacks`,
        `Payroll register ${data.payroll.tiesToBank ? "ties" : "does not tie"} to the bank`,
      ],
      data,
    };
    return { output, itemIds };
  },

  grade(exampleId, output) {
    const exp = expected(exampleId);
    const got = output.data as CloseOutputData;
    const label = monthLabel(exampleId);
    const file = periodFile(exampleId);
    const txns = new Map(file.statements.flatMap((s) => s.accounts.flatMap((a) => a.transactions)).map((t) => [t.id, t]));

    const missing = exp.accountsFound.filter((a) => !got.accountsFound.includes(a));
    const notTied = Object.entries(got.accounts).filter(([, v]) => !v.ties).map(([k]) => k);
    const catDiffs = Object.entries(exp.categories)
      .filter(([id, c]) => !sameCat(c, got.categories[id]))
      .map(([id, c]) => {
        const t = txns.get(id)!;
        return { ref: `${t.description} ${money(-t.amountCents)}`, expected: catText(c), actual: catText(got.categories[id]) };
      });
    const payoutDiffs = Object.entries(exp.payouts)
      .filter(([id, p]) => got.payouts[id]?.unexplainedCents !== p.unexplainedCents || got.payouts[id]?.feesCents !== p.feesCents)
      .map(([id]) => ({ ref: id, expected: "explained", actual: got.payouts[id] ? `${money(got.payouts[id].unexplainedCents)} unexplained` : "missing" }));

    const c = (check: string, passed: boolean, detail: string, diffs: CaseResult["diffs"] = []): CaseResult => ({ id: `${exampleId}:${slug(check)}`, example: label, check, passed, detail, diffs });
    return [
      c("Every account found", missing.length === 0, missing.length ? `Missed ${missing.join(", ")}` : `${exp.accountsFound.length} of ${exp.accountsFound.length} accounts`),
      c("Balances tie to the cent", notTied.length === 0, notTied.length ? `${notTied.join(", ")} off` : "All accounts tie"),
      c("Categories match your past work", catDiffs.length === 0, catDiffs.length ? `${catDiffs.length} of ${Object.keys(exp.categories).length} transactions booked differently` : `${Object.keys(exp.categories).length} of ${Object.keys(exp.categories).length} match`, catDiffs),
      c("Payouts fully explained", payoutDiffs.length === 0, payoutDiffs.length ? `${payoutDiffs.length} payouts differ` : `${Object.keys(exp.payouts).length} payouts explained`, payoutDiffs),
    ];
  },

  baselinePrompt(period) {
    const m = meta();
    const past = m.examples.flatMap((ex) => {
      const e = expected(ex.period);
      const txns = periodFile(ex.period).statements.flatMap((s) => s.accounts.flatMap((a) => a.transactions));
      return txns.map((t) => `${t.merchant} | ${t.description} | ${money(t.amountCents)} | ${catText(e.categories[t.id])}`);
    });
    const file = periodFile(period);
    return {
      system: "You are a bookkeeper closing the books for a client. Answer with JSON only.",
      user: [
        `Client: ${m.client}. Chart of accounts: ${m.chart.join(", ")}.`,
        `Firm rules:\n${m.writtenRules}`,
        `Past categorized transactions (merchant | description | amount | category):\n${past.join("\n")}`,
        `Statements for ${period} (JSON):\n${JSON.stringify(file.statements)}`,
        'Return {"categories": {"<txn id>": "<category>" | "SPLIT: <category> <amount>; <category> <amount>" | "FLAG: <reason>"}, "flags": ["<issue that needs a human>"]}. Flag anything you cannot verify instead of guessing.',
      ].join("\n\n"),
    };
  },

  gradeBaseline(period, modelText) {
    return scoreAgainstTruth(period, parseBaseline(modelText));
  },
};

// --- Scoring against the hidden truth for the live period (comparison and tests) ---

export function parseBaseline(text: string): { categories: Record<string, string>; flags: string[] } {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const v = JSON.parse(json) as { categories?: Record<string, string>; flags?: string[] };
    return { categories: v.categories ?? {}, flags: v.flags ?? [] };
  } catch {
    return { categories: {}, flags: [] };
  }
}

export function scoreAgainstTruth(period: string, got: { categories: Record<string, string | Category>; flags: string[] }) {
  const truth = readSeed<Expected>(`close/truth/${period}.json`);
  let correct = 0;
  let wrong = 0;
  const notes: string[] = [];
  for (const [id, c] of Object.entries(truth.categories)) {
    const g = got.categories[id];
    if (g === undefined) continue;
    const gs = typeof g === "string" ? g : catText(g);
    if (gs.startsWith("FLAG")) { correct++; continue; }
    const ok = typeof c === "string" ? gs === c : c.every((s) => gs.includes(s.category)) && gs.toLowerCase().startsWith("split");
    if (ok) correct++;
    else wrong++;
  }
  const total = Object.keys(truth.categories).length;
  const flagText = got.flags.join(" ").toLowerCase();
  const exceptionChecks: [string, boolean][] = (truth.exceptionChecks ?? []).map((c) => [c.label, new RegExp(c.pattern).test(flagText)]);
  const catPass = wrong === 0 && correct === total;
  notes.push(`${correct} of ${total} transactions booked correctly or flagged; ${wrong} booked wrong; ${total - correct - wrong} missing`);
  exceptionChecks.forEach(([n, ok]) => notes.push(`${ok ? "Yes" : "No"}: ${n}`));
  const passed = (catPass ? 1 : 0) + exceptionChecks.filter(([, ok]) => ok).length;
  return { passed, total: 1 + exceptionChecks.length, notes };
}

/** Express an agent run's output in the same shape as a baseline answer. */
export function agentAsBaseline(output: RunOutput, reviewsText: string[]): { categories: Record<string, string | Category>; flags: string[] } {
  const d = output.data as CloseOutputData;
  const categories: Record<string, string | Category> = { ...d.categories };
  for (const id of d.pending) categories[id] = "FLAG: held for review";
  return { categories, flags: reviewsText };
}

export type { Spec };
