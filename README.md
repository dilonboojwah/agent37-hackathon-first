# Show it once

Teach an agent your recurring workflow from a few months of past work. It practices on that work, shows you exactly where it did things differently, and turns your plain-English corrections into permanent rules. When it matches you, it runs on a schedule in its own [Agent37](https://agent37.com) sandbox and only asks you about the hard calls.

Built for the "Build an Agent" Hackathon (October 7, 2026). Product spec: [docs/PRD.md](docs/PRD.md).

## The idea in one paragraph

Templatized workflows (IT tickets, AP, expenses, security questionnaires) are already served by funded AI-native SaaS. The open space is **bespoke** workflows: every firm closes its books or pays commissions a little differently, so SaaS can't templatize them. Agents make bespoke work cheap, but only if you can trust them. Everyone lets you build an agent; nobody tells you if it's right for *your* company before it touches real work. Under the hood this is a company-specific eval harness; on screen it's "your past work", "practice run" and "teach it".

## Quick start

Node 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3737. No keys are needed: with nothing configured the app runs fully offline (file store, in-process agent, offline rule compiler, recorded tool lookups). The header chips show which integrations are live.

## The demo path (about 3 minutes)

1. **Month-end close: Harbor Goods Co.** → **Teach** → *Draft the workflow*. It learns 38 vendor categories, 5 accounts and last month's balances from three past closes.
2. **Practice** → *Run practice*. It redoes June, July and August and scores itself: **9 of 12 checks**. The misses are the rules nobody wrote down: Amazon orders that split by receipt line, and an annual software plan that should be prepaid.
3. Click a suggested correction and *Teach it and re-run* (twice). **11 of 12**, then **12 of 12**.
4. **Run** → *Run now*. September streams in: 146 transactions across 7 statements. It stops on exactly three things: a Shopify payout that's $62.90 short, a EUR account that isn't in the books, and a merchant with no history (looked up via monid, or a recorded lookup offline).
5. Decide the three cards. Before vs. after appears: about 3h 34m by hand, 6 minutes of your time. *Send close packet*.
6. Switch to **Sales commissions: Northwind Analytics** to show the same components on a different seed (9 of 12 → 12 of 12 after "multi-year deals pay on first-year value" and "bookings above quota pay 1.5x").

*Reset demo* (top right) clears a workflow back to the start.

## Integrations

Copy `.env.example` to `.env.local` and fill in what you have. Each one is optional and additive.

| Integration | Env | What turns on | Without it |
| --- | --- | --- | --- |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | Rule compiler for any phrasing, merchant judgment, the plain-model comparison | Offline rule compiler (handles the seed phrasings), keyword guesses, no comparison numbers |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Store runs and workflows in Postgres (run `supabase/migrations/0001_init.sql` first) | `.data/state.json` |
| Agent37 | `AGENT37_API_KEY`, `APP_URL`, `AGENT_INGEST_TOKEN`, `EXECUTOR=agent37` | Each workflow gets its own instance; a platform cron runs it on schedule; Run now executes in the sandbox | Runs in-process |
| monid.ai | `MONID_ENABLED=true`, `MONID_SEARCH_ENDPOINT` + the monid CLI | Live merchant lookups | Recorded lookups from the seed, labeled "recorded" |
| InstaCloud | (deploy target) | Public `APP_URL` the Agent37 sandbox can reach | Use a tunnel for local testing |

### Give a workflow its own Agent37 sandbox

```bash
npm run agent37:provision -- --workflow harbor-goods-close
```

This creates an instance, uploads the bundled runner (`dist/runner.mjs`) and the seeds, checks the sandbox can reach `APP_URL`, creates a platform cron with the workflow's schedule, and registers the instance with the app. Then set `EXECUTOR=agent37` so *Run now* goes to the sandbox. `APP_URL` must be public (deploy to InstaCloud, or use a tunnel). See [ARCHITECTURE.md](ARCHITECTURE.md#agent37).

### Record the plain-model comparison

```bash
npm run baseline:record
```

Runs plain OpenAI once per workflow with the same files and no spec, scores it on the same checks, and saves it to `seeds/<module>/baseline.recorded.json`. The UI shows it labeled with its model and date. The app never shows comparison numbers that didn't come from a real run.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | App on port 3737 |
| `npm test` | Engine, workflow, memory and adapter tests (vitest) |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `npm run seeds` | Regenerate `seeds/` from `scripts/generate-seeds.ts` (deterministic) |
| `npm run runner:build` | Bundle the sandbox runner to `dist/runner.mjs` |
| `npm run runner -- run --workflow <id> --kind manual` | Run the sandbox runner locally against a running app (needs `AGENT_INGEST_TOKEN`) |
| `npm run agent37:provision -- --workflow <id>` | Create and wire an Agent37 instance for a workflow |
| `npm run baseline:record` | Record the plain-model comparison |
| `npm run reset` | Delete `.data/` |

## What's verified and what isn't

- **Verified by running:** both workflows end to end in the browser (teach, practice 9 → 11 → 12 of 12, live run, three reviews, send); 10 automated tests; typecheck and production build; the bundled runner driving a full run over HTTP against the local app.
- **Not yet run against live accounts:** Agent37 (instance, cron, exec), Supabase, OpenAI, monid. Request shapes for Agent37 follow its docs and are unit-tested with a mocked fetch.
- **Placeholder numbers:** the manual-time baselines in `seeds/*/meta.json` are estimates. Time yourself on the seed and replace them before quoting.

## Repo map

```
src/
  app/                Next.js pages and API routes (thin)
  components/         Teach, Practice, Run panels (client)
  core/               engine: types, runner, events, service, store-agnostic logic
  adapters/           store (file, Supabase), OpenAI, monid, Agent37
  workflows/          one folder per workflow module (close, commissions)
  agent/cli.ts        sandbox runner entry point
seeds/                generated data per workflow (inputs, your past work, hidden truth)
scripts/              seed generator, runner bundler, Agent37 provisioning, baseline recorder
supabase/migrations/  schema for the Supabase store
tests/                vitest
docs/PRD.md           product spec
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) for how it works and [AGENTS.md](AGENTS.md) before changing code.
