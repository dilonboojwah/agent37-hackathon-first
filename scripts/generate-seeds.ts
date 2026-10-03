// Generates the synthetic seeds under seeds/. Deterministic (fixed PRNG seed).
//
// This file is the ONLY place that knows each firm's true policies, including the
// ones the person "forgot to write down" (the hidden rules the agent must learn
// through practice and correction). Agent code never imports this file; it reads
// only the JSON it writes. Truth files for the live period are used for the
// plain-model comparison and tests, never shown to the agent.
//
// Run: npm run seeds

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "seeds");

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(37);
const int = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const pick = <T,>(xs: T[]) => xs[int(0, xs.length - 1)];
const pad = (n: number) => String(n).padStart(2, "0");
const day = (period: string, d: number) => `${period}-${pad(Math.min(d, 28))}`;

function write(rel: string, data: unknown) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Month-end close: Harbor Goods Co., a Shopify seller
// ---------------------------------------------------------------------------

type Split = { category: string; amountCents: number };
interface Txn {
  id: string;
  date: string;
  description: string;
  merchant: string;
  amountCents: number;
  receipt?: { lines: { desc: string; amountCents: number }[] };
}
interface Account {
  accountId: string;
  name: string;
  currency: string;
  last4?: string;
  openingCents: number;
  closingCents: number;
  transactions: Txn[];
}
interface Statement {
  file: string;
  item: string;
  accounts: Account[];
  payouts?: { id: string; date: string; ordersCount: number; grossCents: number; feesCents: number; refundsCents: number; chargebacksCents: number; depositCents: number }[];
  register?: { grossWagesCents: number; employerTaxesCents: number; withholdingCents: number; netPayCents: number; runs: { date: string; netPayCents: number; taxesCents: number }[] };
}

const CLOSE_PERIODS = ["2026-06", "2026-07", "2026-08", "2026-09"];
const LIVE = "2026-09";

// True categorization policy (vendor -> category). Some vendors break the rule:
// Amazon splits by receipt line, annual software over $1,000 is prepaid.
const INVENTORY_WORDS = ["phone case", "mailer", "poly bag"];
const AMAZON_OFFICE_ITEMS = ["Printer paper, 10 reams", "Toner cartridge", "Desk lamp", "Label printer tape", "Sticky notes, 24 pack", "USB-C hub"];
const AMAZON_INVENTORY_ITEMS = ["Phone case, clear, 50 pack", "Bubble mailers, 6x9, 250 pack", "Poly bags, 9x12, 500 pack"];

interface VendorSpec {
  merchant: string;
  desc: () => string;
  category: string;
  account: string;
  count: [number, number];
  amount: [number, number]; // dollars, sign applied by direction
  inflow?: boolean;
}

const vendors: VendorSpec[] = [
  { merchant: "META ADS", desc: () => `FACEBK *${int(10000, 99999)}`, category: "Advertising", account: "amex", count: [10, 14], amount: [80, 420] },
  { merchant: "GOOGLE ADS", desc: () => `GOOGLE *ADS${int(1000, 9999)}`, category: "Advertising", account: "amex", count: [6, 9], amount: [60, 300] },
  { merchant: "USPS", desc: () => `USPS PO ${int(1000, 9999)}`, category: "Shipping and postage", account: "amex", count: [14, 20], amount: [12, 96] },
  { merchant: "SHIPPO", desc: () => `SHIPPO LABELS ${int(100, 999)}`, category: "Shipping and postage", account: "amex", count: [10, 16], amount: [20, 180] },
  { merchant: "UPS", desc: () => `UPS*${int(100000, 999999)}`, category: "Shipping and postage", account: "amex", count: [4, 8], amount: [18, 140] },
  { merchant: "ULINE", desc: () => `ULINE *SHIP SUPPLIES`, category: "Packaging and labels", account: "amex", count: [2, 3], amount: [120, 640] },
  { merchant: "STAPLES", desc: () => `STAPLES ${int(100, 999)}`, category: "Office supplies", account: "amex", count: [1, 3], amount: [14, 90] },
  { merchant: "SLACK", desc: () => `SLACK T0${int(1000, 9999)}`, category: "Software", account: "amex", count: [1, 1], amount: [52, 52] },
  { merchant: "NOTION", desc: () => `NOTION LABS`, category: "Software", account: "amex", count: [1, 1], amount: [40, 40] },
  { merchant: "KLAVIYO", desc: () => `KLAVIYO INC`, category: "Software", account: "amex", count: [1, 1], amount: [150, 150] },
  { merchant: "CANVA", desc: () => `CANVA* ${int(100, 999)}`, category: "Software", account: "amex", count: [1, 1], amount: [15, 15] },
  { merchant: "UBER", desc: () => `UBER *TRIP ${int(100, 999)}`, category: "Travel", account: "amex", count: [3, 7], amount: [14, 58] },
  { merchant: "BLUE BOTTLE", desc: () => `BLUE BOTTLE COFFEE`, category: "Meals", account: "amex", count: [4, 8], amount: [6, 24] },
  { merchant: "SWEETGREEN", desc: () => `SWEETGREEN SF`, category: "Meals", account: "amex", count: [3, 6], amount: [14, 38] },
  { merchant: "HARBOR STUDIOS", desc: () => `HARBOR STUDIOS RENT`, category: "Rent", account: "chase-checking", count: [1, 1], amount: [4200, 4200] },
  { merchant: "PG&E", desc: () => `PGANDE WEB ONLINE`, category: "Utilities", account: "chase-checking", count: [1, 1], amount: [180, 260] },
  { merchant: "COMCAST", desc: () => `COMCAST BUSINESS`, category: "Utilities", account: "chase-checking", count: [1, 1], amount: [129, 129] },
  { merchant: "THE HARTFORD", desc: () => `THE HARTFORD INS`, category: "Insurance", account: "chase-checking", count: [1, 1], amount: [310, 310] },
  { merchant: "UPWORK", desc: () => `UPWORK -${int(100000, 999999)}`, category: "Contractors", account: "chase-checking", count: [1, 3], amount: [300, 1400] },
  { merchant: "OWNER TRANSFER", desc: () => `ONLINE TRANSFER TO M. REYES`, category: "Owner draws", account: "chase-checking", count: [1, 2], amount: [1500, 3000] },
  { merchant: "CHASE FEE", desc: () => `MONTHLY SERVICE FEE`, category: "Bank fees", account: "chase-checking", count: [1, 1], amount: [15, 15] },
  { merchant: "SHENZHEN CASEMAKER", desc: () => `REVOLUT FX PAYMENT SHENZHEN CASEMAKER`, category: "Inventory", account: "revolut-usd", count: [2, 4], amount: [1800, 6200] },
  { merchant: "REVOLUT FEE", desc: () => `FX FEE`, category: "Bank fees", account: "revolut-usd", count: [2, 4], amount: [8, 40] },
  { merchant: "LISBON DESIGN STUDIO", desc: () => `TRANSFER LISBON DESIGN STUDIO`, category: "Contractors", account: "revolut-usd", count: [1, 1], amount: [900, 1600] },
];

const WHOLESALE = ["Pacific Outfitters", "Kite and Co", "Mosaic Market", "Driftwood Supply", "Northbeam Retail"];
const CHART = [
  "Sales revenue", "Wholesale revenue", "Refunds and returns", "Interest income",
  "Inventory", "Packaging and labels", "Merchant fees", "Shipping and postage", "Advertising", "Software",
  "Prepaid expenses", "Office supplies", "Rent", "Utilities", "Insurance", "Payroll", "Payroll taxes",
  "Contractors", "Meals", "Travel", "Bank fees", "Owner draws",
  "Transfer between accounts", "Credit card payment",
];

function genClose() {
  let txSeq = 0;
  const tid = (p: string) => `${p.replace("-", "")}-${String(++txSeq).padStart(4, "0")}`;
  const balances: Record<string, number> = {
    "chase-checking": 4123012, "chase-savings": 2500000, amex: -612044, stripe: 182033, "revolut-usd": 950000,
  };

  const out: Record<string, { statements: Statement[]; truth: Record<string, unknown> }> = {};

  for (const period of CLOSE_PERIODS) {
    const live = period === LIVE;
    const tx: Record<string, Txn[]> = { "chase-checking": [], "chase-savings": [], amex: [], stripe: [], "revolut-usd": [], "revolut-eur": [] };
    const categories: Record<string, string | Split[]> = {};
    const add = (acct: string, t: Omit<Txn, "id">, category: string | Split[]) => {
      const id = tid(period);
      tx[acct].push({ id, ...t });
      categories[id] = category;
      return id;
    };

    // Routine vendors
    for (const v of vendors) {
      const n = int(v.count[0], v.count[1]);
      for (let i = 0; i < n; i++) {
        const dollars = v.amount[0] === v.amount[1] ? v.amount[0] : int(v.amount[0] * 100, v.amount[1] * 100) / 100;
        const cents = Math.round(dollars * 100);
        add(v.account, { date: day(period, int(1, 28)), description: v.desc(), merchant: v.merchant, amountCents: v.inflow ? cents : -cents }, v.category);
      }
    }

    // Software with monthly and annual plans (the annual rule hides here)
    const monthlyFigma = period !== "2026-06";
    if (monthlyFigma) add("amex", { date: day(period, 3), description: "FIGMA MONTHLY", merchant: "FIGMA", amountCents: -4500 }, "Software");
    else add("amex", { date: day(period, 3), description: "FIGMA ANNUAL PLAN", merchant: "FIGMA", amountCents: -144000 }, "Prepaid expenses");
    if (period !== LIVE) add("amex", { date: day(period, 5), description: "LINEAR APP MONTHLY", merchant: "LINEAR", amountCents: -9600 }, "Software");
    else add("amex", { date: day(period, 5), description: "LINEAR APP ANNUAL PLAN", merchant: "LINEAR", amountCents: -120000 }, "Prepaid expenses");

    // Amazon orders: office supplies, except mixed receipts that split
    const amazonPlan: Record<string, ("office" | "mixed")[]> = {
      "2026-06": ["office", "office", "office"],
      "2026-07": ["office", "mixed"],
      "2026-08": ["office", "office", "mixed"],
      "2026-09": ["office", "mixed"],
    };
    for (const kind of amazonPlan[period]) {
      const officeLines = [{ desc: pick(AMAZON_OFFICE_ITEMS), amountCents: int(1800, 9800) }, { desc: pick(AMAZON_OFFICE_ITEMS), amountCents: int(900, 4200) }];
      const lines = kind === "office" ? officeLines : [{ desc: pick(AMAZON_INVENTORY_ITEMS), amountCents: int(8900, 18900) }, officeLines[0]];
      const total = lines.reduce((s, l) => s + l.amountCents, 0);
      const cat: string | Split[] = kind === "office"
        ? "Office supplies"
        : lines.map((l) => ({ category: INVENTORY_WORDS.some((w) => l.desc.toLowerCase().includes(w)) ? "Inventory" : "Office supplies", amountCents: l.amountCents }));
      add("amex", { date: day(period, int(2, 27)), description: `AMZN MKTP US*${int(100, 999)}K${int(10, 99)}`, merchant: "AMZN MKTP", amountCents: -total, receipt: { lines } }, cat);
    }

    // Live-period unknown merchant (only a human decision reveals the category)
    if (live) add("amex", { date: day(period, 16), description: "SQ *KESTREL PRINT 4471", merchant: "SQ *KESTREL PRINT", amountCents: -64000 }, "Packaging and labels");

    // Shopify payouts (twice weekly)
    const payouts: NonNullable<Statement["payouts"]> = [];
    const payoutTruth: Record<string, unknown> = {};
    for (let i = 0; i < 8; i++) {
      const id = `PO-${period.replace("-", "")}-${i + 1}`;
      const date = day(period, 2 + i * 3 + 1);
      const orders = int(70, 140);
      let gross = int(700000, 1250000);
      let refunds = rng() < 0.6 ? int(5000, 90000) : 0;
      let chargebacks = rng() < 0.15 ? int(3000, 12000) : 0;
      let fees = Math.round(gross * 0.029) + orders * 30;
      let deposit = gross - fees - refunds - chargebacks;
      let reportedChargebacks = chargebacks;
      if (live && i === 4) {
        // The planted break: a chargeback missing from the payout report.
        gross = 990000; fees = 28710; refunds = 113800; chargebacks = 6290; reportedChargebacks = 0;
        deposit = gross - fees - refunds - chargebacks; // 841200
      }
      payouts.push({ id, date, ordersCount: orders, grossCents: gross, feesCents: fees, refundsCents: refunds, chargebacksCents: reportedChargebacks, depositCents: deposit });
      payoutTruth[id] = { salesCents: gross, feesCents: fees, refundsCents: refunds, chargebacksCents: chargebacks, depositCents: deposit, unexplainedCents: 0 };
      add("chase-checking", { date, description: `SHOPIFY PAYOUT ${id}`, merchant: "SHOPIFY PAYOUT", amountCents: deposit }, "Transfer between accounts");
    }

    // Stripe wholesale invoices
    let stripeIn = 0;
    for (let i = 0; i < int(5, 8); i++) {
      const amt = int(120000, 640000);
      stripeIn += amt;
      add("stripe", { date: day(period, int(1, 26)), description: `INVOICE PAYMENT ${pick(WHOLESALE)}`, merchant: "STRIPE INVOICE", amountCents: amt }, "Wholesale revenue");
      add("stripe", { date: day(period, int(1, 26)), description: "STRIPE PROCESSING FEE", merchant: "STRIPE FEE", amountCents: -Math.round(amt * 0.029) }, "Merchant fees");
    }
    const stripePayout = Math.round(stripeIn * 0.9);
    add("stripe", { date: day(period, 27), description: "PAYOUT TO CHASE 4410", merchant: "STRIPE PAYOUT", amountCents: -stripePayout }, "Transfer between accounts");
    add("chase-checking", { date: day(period, 28), description: "STRIPE TRANSFER", merchant: "STRIPE TRANSFER", amountCents: stripePayout }, "Transfer between accounts");

    // Payroll via Gusto: two runs
    const runs = [0, 1].map((k) => ({ date: day(period, k === 0 ? 14 : 28), netPayCents: int(1650000, 1720000), taxesCents: int(520000, 560000) }));
    for (const r of runs) {
      add("chase-checking", { date: r.date, description: "GUSTO PAYROLL NET", merchant: "GUSTO PAYROLL", amountCents: -r.netPayCents }, "Payroll");
      add("chase-checking", { date: r.date, description: "GUSTO TAX", merchant: "GUSTO TAX", amountCents: -r.taxesCents }, "Payroll taxes");
    }
    const netPay = runs.reduce((s, r) => s + r.netPayCents, 0);
    const taxes = runs.reduce((s, r) => s + r.taxesCents, 0);
    const withholding = Math.round(netPay * 0.24);

    // Card payment and savings sweep
    const amexSpend = -tx.amex.reduce((s, t) => s + t.amountCents, 0);
    const cardPayment = amexSpend;
    add("chase-checking", { date: day(period, 25), description: "AMEX EPAYMENT ACH PMT", merchant: "AMEX EPAYMENT", amountCents: -cardPayment }, "Credit card payment");
    add("amex", { date: day(period, 25), description: "PAYMENT RECEIVED - THANK YOU", merchant: "AMEX PAYMENT", amountCents: cardPayment }, "Credit card payment");
    add("chase-checking", { date: day(period, 26), description: "TRANSFER TO SAV 8821", merchant: "SAVINGS TRANSFER", amountCents: -500000 }, "Transfer between accounts");
    add("chase-savings", { date: day(period, 26), description: "TRANSFER FROM CHK 4410", merchant: "SAVINGS TRANSFER", amountCents: 500000 }, "Transfer between accounts");
    add("chase-savings", { date: day(period, 28), description: "INTEREST PAYMENT", merchant: "INTEREST", amountCents: int(4100, 5200) }, "Interest income");

    // Revolut EUR pocket appears for the first time in the live period
    let eurOpening = 0;
    if (live) {
      const payments = Array.from({ length: 10 }, () => int(19000, 26000));
      const fee = 1240;
      const topUp = payments.reduce((s, x) => s + x, 0) + fee + 833; // leaves EUR 8.33
      add("revolut-eur", { date: day(period, 2), description: "TOP UP FROM USD", merchant: "REVOLUT EXCHANGE", amountCents: topUp }, "Transfer between accounts");
      payments.forEach((amt, i) => add("revolut-eur", { date: day(period, 3 + i * 2), description: `CARD PAYMENT EU SUPPLIER ${i + 1}`, merchant: "EU SUPPLIER", amountCents: -amt }, "Inventory"));
      add("revolut-eur", { date: day(period, 27), description: "FX FEE", merchant: "REVOLUT FEE", amountCents: -fee }, "Bank fees");
    }

    const mk = (acct: string, name: string, currency: string, last4: string | undefined, opening: number): Account => {
      const sorted = tx[acct].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      const closing = opening + sorted.reduce((s, t) => s + t.amountCents, 0);
      return { accountId: acct, name, currency, last4, openingCents: opening, closingCents: closing, transactions: sorted };
    };

    const accounts: Record<string, Account> = {
      "chase-checking": mk("chase-checking", "Chase checking", "USD", "4410", balances["chase-checking"]),
      "chase-savings": mk("chase-savings", "Chase savings", "USD", "8821", balances["chase-savings"]),
      amex: mk("amex", "Amex business card", "USD", "1007", balances.amex),
      stripe: mk("stripe", "Stripe balance", "USD", undefined, balances.stripe),
      "revolut-usd": mk("revolut-usd", "Revolut USD", "USD", "3302", balances["revolut-usd"]),
    };
    if (live) accounts["revolut-eur"] = mk("revolut-eur", "Revolut EUR pocket", "EUR", "3381", eurOpening);
    for (const k of Object.keys(balances)) balances[k] = accounts[k].closingCents;

    const statements: Statement[] = [
      { file: `chase_checking_${period}.csv`, item: "Chase checking", accounts: [accounts["chase-checking"]] },
      { file: `chase_savings_${period}.csv`, item: "Chase savings", accounts: [accounts["chase-savings"]] },
      { file: `amex_business_${period}.csv`, item: "Amex business card", accounts: [accounts.amex] },
      { file: `shopify_payouts_${period}.csv`, item: "Shopify payouts", accounts: [], payouts },
      { file: `stripe_balance_${period}.csv`, item: "Stripe", accounts: [accounts.stripe] },
      { file: `gusto_payroll_register_${period}.csv`, item: "Gusto payroll", accounts: [], register: { grossWagesCents: netPay + withholding, employerTaxesCents: taxes - withholding, withholdingCents: withholding, netPayCents: netPay, runs } },
      { file: `revolut_${period}.pdf`, item: "Revolut", accounts: live ? [accounts["revolut-usd"], accounts["revolut-eur"]] : [accounts["revolut-usd"]] },
    ];

    const truth = {
      period,
      accountsFound: Object.keys(accounts),
      accounts: Object.fromEntries(Object.values(accounts).map((a) => [a.accountId, { openingCents: a.openingCents, closingCents: a.closingCents }])),
      categories,
      payouts: payoutTruth,
      payroll: { netPayCents: netPay, taxesCents: taxes, tiesToBank: true },
      exceptions: live ? ["shopify-break:PO-202609-5", "new-account:revolut-eur", "unknown-merchant:SQ *KESTREL PRINT"] : [],
      // How the comparison recognizes each planted exception in a flag's text.
      exceptionChecks: live
        ? [
            { label: "Caught the Shopify payout break", pattern: "po-202609-5|62\\.90|payout" },
            { label: "Caught the new EUR account", pattern: "eur|revolut|new account|3381" },
            { label: "Asked about Kestrel instead of guessing", pattern: "kestrel" },
          ]
        : [],
    };
    out[period] = { statements, truth };
  }

  const txnCount = (p: string) =>
    out[p].statements.reduce((s, st) => s + st.accounts.reduce((a, acc) => a + acc.transactions.length, 0) + (st.payouts?.length ?? 0), 0);

  for (const p of CLOSE_PERIODS) {
    write(`close/periods/${p}.json`, { period: p, client: "Harbor Goods Co.", statements: out[p].statements });
    if (p === LIVE) write(`close/truth/${p}.json`, out[p].truth);
    else write(`close/examples/${p}.json`, out[p].truth);
  }

  write("close/meta.json", {
    moduleId: "close",
    name: "Month-end close",
    client: "Harbor Goods Co.",
    clientNote: "Shopify seller, accrual basis",
    unit: "statements",
    schedule: { cron: "0 7 1 * *", timezone: "America/Los_Angeles", label: "Runs on the 1st at 7:00 AM" },
    livePeriod: LIVE,
    deadline: "CPA review due Oct 5",
    chart: CHART,
    // Client-specific wiring the module needs: which account receives payouts and payroll debits.
    wiring: { bankAccountId: "chase-checking", payrollNetMerchant: "GUSTO PAYROLL", payrollTaxMerchant: "GUSTO TAX" },
    writtenRules: [
      "Use our chart of accounts. Book each transaction to the same category we used before for that vendor.",
      "Shopify and Stripe payouts are transfers; revenue comes from the payout reports.",
      "Balances must tie to the cent. Never guess a missing exchange rate.",
      "Ask before adding an account that isn't in our books.",
    ].join("\n"),
    suggestedCorrections: [
      "Split Amazon orders by receipt line: phone cases, mailers and poly bags are inventory; everything else is office supplies.",
      "Annual software plans over $1,000 go to prepaid expenses.",
    ],
    baseline: {
      minutesPerItem: 22,
      perItemLabel: "min to reconcile each statement by hand",
      fixedMinutes: 60,
      fixedLabel: "min to categorize leftovers and write the close summary",
      minutesPerDecision: 2,
      source: "Placeholder estimate. Replace with a timed manual pass on this seed before quoting.",
    },
    examples: CLOSE_PERIODS.filter((p) => p !== LIVE).map((p) => ({
      id: p,
      label: new Date(`${p}-15`).toLocaleString("en-US", { month: "long", year: "numeric" }),
      period: p,
      files: out[p].statements.map((s) => s.file),
      stats: `${txnCount(p)} transactions, closed and reviewed`,
    })),
    liveStats: { transactions: txnCount(LIVE), statements: out[LIVE].statements.length },
    recordedLookups: {
      "SQ *KESTREL PRINT": { name: "Kestrel Print Co.", description: "Commercial printer in Oakland, CA: custom boxes, labels, and marketing flyers." },
    },
  });
}

// ---------------------------------------------------------------------------
// Sales commissions: Northwind Analytics, a B2B SaaS company
// ---------------------------------------------------------------------------

interface Rep { id: string; name: string; quotaCents: number; endDate?: string }
interface Deal {
  id: string;
  account: string;
  amountCents: number; // total contract value
  termMonths: number;
  signedDate: string | null;
  closedWonDate: string;
  ownerId: string;
  splits?: { repId: string; pct: number }[];
}

const COMM_PERIODS = ["2026-06", "2026-07", "2026-08", "2026-09"];
const REPS: Rep[] = [
  { id: "ava", name: "Ava Chen", quotaCents: 10000000 },
  { id: "ben", name: "Ben Ortiz", quotaCents: 12000000 },
  { id: "carlos", name: "Carlos Diaz", quotaCents: 12000000, endDate: "2026-08-31" },
  { id: "dana", name: "Dana Kim", quotaCents: 12000000 },
  { id: "eli", name: "Eli Novak", quotaCents: 12000000 },
  { id: "farah", name: "Farah Aziz", quotaCents: 12000000 },
  { id: "gus", name: "Gus Patel", quotaCents: 12000000 },
  { id: "hana", name: "Hana Ito", quotaCents: 12000000 },
];
const ACCOUNTS = ["Acme Freight", "Bluefin Health", "Cobalt Labs", "Delta Dental Group", "Evergreen Foods", "Fathom Media", "Granite Bank", "Helix Robotics", "Ion Energy", "Juniper Schools", "Keystone Legal", "Lumen Retail", "Meridian Hotels", "Nimbus Air", "Orchard Clinics", "Pioneer Logistics", "Quartz Insurance", "Redwood Credit Union", "Summit Realty", "Tidal Networks"];

// True comp plan
const BASE_RATE = 0.1;
const ACCEL = 1.5;
const firstYear = (d: Deal) => (d.termMonths > 12 ? Math.round((d.amountCents * 12) / d.termMonths) : d.amountCents);

function genCommissions() {
  let seq = 0;
  const did = () => `D-${String(++seq + 1000)}`;
  const history: { deal: Deal; commissionByRep: Record<string, number> }[] = [];

  for (const period of COMM_PERIODS) {
    const live = period === "2026-09";
    // The roster lists every rep, including anyone who left (with an end date).
    const active = REPS;
    const deals: Deal[] = [];

    for (const rep of active.filter((r) => !r.endDate || r.endDate >= `${period}-01`)) {
      const n = int(1, 2);
      for (let i = 0; i < n; i++) {
        const d = int(2, 27);
        deals.push({ id: did(), account: pick(ACCOUNTS), amountCents: int(18, 40) * 100000, termMonths: 12, signedDate: day(period, d), closedWonDate: day(period, d), ownerId: rep.id });
      }
    }

    // Planted hidden-rule cases in examples
    if (period === "2026-06" || period === "2026-08") {
      deals.push({ id: did(), account: "Granite Bank", amountCents: 10800000, termMonths: 36, signedDate: day(period, 18), closedWonDate: day(period, 18), ownerId: "dana" });
    }
    if (period === "2026-07" || period === "2026-08") {
      // Ava beats quota
      deals.push({ id: did(), account: "Meridian Hotels", amountCents: 9000000, termMonths: 12, signedDate: day(period, 21), closedWonDate: day(period, 21), ownerId: "ava" });
    }
    if (period === "2026-07") {
      deals.push({ id: did(), account: "Tidal Networks", amountCents: 3000000, termMonths: 12, signedDate: day(period, 9), closedWonDate: day(period, 9), ownerId: "eli", splits: [{ repId: "eli", pct: 60 }, { repId: "farah", pct: 40 }] });
    }

    // Live-period exceptions
    if (live) {
      deals.push({ id: did(), account: "Helix Robotics", amountCents: 4400000, termMonths: 12, signedDate: day(period, 12), closedWonDate: day(period, 12), ownerId: "ava", splits: [{ repId: "ava", pct: 60 }, { repId: "ben", pct: 50 }] });
      deals.push({ id: did(), account: "Orchard Clinics", amountCents: 2600000, termMonths: 12, signedDate: day(period, 3), closedWonDate: day(period, 3), ownerId: "carlos" });
      deals.push({ id: did(), account: "Summit Realty", amountCents: 2200000, termMonths: 12, signedDate: null, closedWonDate: day(period, 18), ownerId: "dana" });
      deals.push({ id: did(), account: "Pioneer Logistics", amountCents: 7200000, termMonths: 24, signedDate: day(period, 22), closedWonDate: day(period, 22), ownerId: "gus" });
    }

    // Churn report: a June deal churns in August, inside 90 days
    const churn: { dealId: string; churnDate: string; repId: string; commissionPaidCents: number }[] = [];
    if (period === "2026-08") {
      const june = history.find((h) => h.deal.signedDate?.startsWith("2026-06") && h.deal.ownerId === "hana")!;
      churn.push({ dealId: june.deal.id, churnDate: day(period, 20), repId: "hana", commissionPaidCents: june.commissionByRep.hana });
    }

    // True statements
    const credited: Record<string, { dealId: string; firstYearCents: number; sharePct: number }[]> = {};
    for (const d of deals) {
      const shares = d.splits ?? [{ repId: d.ownerId, pct: 100 }];
      for (const s of shares) (credited[s.repId] ??= []).push({ dealId: d.id, firstYearCents: Math.round((firstYear(d) * s.pct) / 100), sharePct: s.pct });
    }
    const statements: Record<string, { commissionCents: number; lines: { dealId: string; creditCents: number; commissionCents: number; note: string }[] }> = {};
    for (const rep of active) {
      const rows = (credited[rep.id] ?? []).sort((a, b) => a.dealId.localeCompare(b.dealId));
      let cum = 0;
      const lines = rows.map((r) => {
        const below = Math.max(0, Math.min(r.firstYearCents, rep.quotaCents - cum));
        const above = r.firstYearCents - below;
        cum += r.firstYearCents;
        const c = Math.round(below * BASE_RATE + above * BASE_RATE * ACCEL);
        return { dealId: r.dealId, creditCents: r.firstYearCents, commissionCents: c, note: above > 0 ? "accelerator above quota" : "" };
      });
      for (const ch of churn.filter((c) => c.repId === rep.id)) lines.push({ dealId: ch.dealId, creditCents: 0, commissionCents: -ch.commissionPaidCents, note: "clawback: churned within 90 days" });
      statements[rep.id] = { commissionCents: lines.reduce((s, l) => s + l.commissionCents, 0), lines };
    }
    for (const d of deals) {
      const byRep: Record<string, number> = {};
      for (const [repId, st] of Object.entries(statements)) {
        const l = st.lines.find((x) => x.dealId === d.id);
        if (l) byRep[repId] = l.commissionCents;
      }
      history.push({ deal: d, commissionByRep: byRep });
    }

    const crmTotal = deals.reduce((s, d) => s + d.amountCents, 0);
    write(`commissions/periods/${period}.json`, { period, company: "Northwind Analytics", reps: active, deals, churn, crmClosedWonTotalCents: crmTotal });
    const truth = {
      period,
      statements,
      crmClosedWonTotalCents: crmTotal,
      exceptions: live ? ["split-over-100", "departed-owner:carlos", "missing-signed-date"] : [],
      // Reps whose correct payout depends on a human decision, and how flags are recognized.
      heldReps: live ? ["ava", "ben", "carlos", "dana"] : [],
      exceptionChecks: live
        ? [
            { label: "Caught the split over 100%", pattern: "110|split" },
            { label: "Caught the departed owner", pattern: "carlos|left|departed" },
            { label: "Caught the missing signed date", pattern: "signed date|summit|missing" },
          ]
        : [],
    };
    if (live) write(`commissions/truth/${period}.json`, truth);
    else write(`commissions/examples/${period}.json`, truth);
  }

  write("commissions/meta.json", {
    moduleId: "commissions",
    name: "Sales commissions",
    client: "Northwind Analytics",
    clientNote: "B2B SaaS, 8 account executives",
    unit: "reps",
    schedule: { cron: "0 6 2 * *", timezone: "America/Los_Angeles", label: "Runs on the 2nd at 6:00 AM" },
    livePeriod: "2026-09",
    deadline: "Payroll cutoff Oct 5",
    writtenRules: [
      "Reps earn 10% of bookings, paid in the month the contract is signed.",
      "Split deals pay each rep their share.",
      "If a customer churns within 90 days of signing, claw back that deal's commission.",
    ].join("\n"),
    suggestedCorrections: [
      "Multi-year deals only pay on first-year value.",
      "Bookings above monthly quota pay 1.5x the rate.",
    ],
    baseline: {
      minutesPerItem: 25,
      perItemLabel: "min to build each rep's statement by hand",
      fixedMinutes: 45,
      fixedLabel: "min to pull the CRM report and reconcile bookings",
      minutesPerDecision: 3,
      source: "Placeholder estimate. Replace with a timed manual pass on this seed before quoting.",
    },
    examples: COMM_PERIODS.filter((p) => p !== "2026-09").map((p) => ({
      id: p,
      label: new Date(`${p}-15`).toLocaleString("en-US", { month: "long", year: "numeric" }),
      period: p,
      files: [`crm_closed_won_${p}.csv`, `commission_statements_${p}.pdf`],
      stats: "Statements approved by finance",
    })),
  });
}

genClose();
genCommissions();
console.log(`Seeds written to ${ROOT}`);
