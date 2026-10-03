# Working in this repo

For any coding agent (Claude Code, Codex, Cursor) and any person picking this up. Read [README.md](README.md), then [ARCHITECTURE.md](ARCHITECTURE.md). The product spec is [docs/PRD.md](docs/PRD.md).

## Ground rules

- **Synthetic data only.** Never add real client, employer (United Accountants) or Oleum code, data, or names. Seeds come from `scripts/generate-seeds.ts`.
- **No credentials in the repo.** Keys go in `.env.local` (gitignored). Never enter or paste real credentials into code, tests, or fixtures.
- **Offline must keep working.** Every integration is optional. A change that breaks `npm run dev` with no `.env.local` is a regression.
- **Never fake a number.** No hardcoded scores, comparison results, or time saved. If a figure needs a live call, show that it's missing and how to get it (see the comparison card).
- **Deterministic where it must be right.** Totals, ties, and grading are code. Models may compile rules and make labeled judgments; they never decide whether books tie.
- **The app is the only writer to the store.** Runs change only through `applyEvent` in `src/core/runs.ts`.

## Where things go

| Change | Put it in |
| --- | --- |
| Domain behavior (how a close or commission is computed, what stops a run) | `src/workflows/<module>/index.ts` |
| Something every workflow needs | `src/core/` (and the `WorkflowModule` contract in `types.ts` if the shape changes) |
| A new external service | `src/adapters/`, with an offline fallback and a config flag in `src/core/config.ts` |
| A route | `src/app/api/...`, calling one function in `src/core/service.ts` |
| UI | `src/components/`; keep the words "your past work", "practice run", "teach it"; never show "eval" |
| Data | `scripts/generate-seeds.ts`, then `npm run seeds` and commit the JSON |

## Before you say it's done

```bash
npm run typecheck
npm test
npm run build
```

Then run the demo path in the README in a browser. Tests prove the engine; only the browser proves the screens. When you hand off, say what you verified by running and what you didn't.

If you change seeds, the test expectations (9 of 12 → 12 of 12, three reviews, 4 of 7 automatic) are the story the demo tells. Keep them true or update tests, README, and PRD together.

## Style

- TypeScript, strict. Match the surrounding code: small modules, comments only where the why isn't obvious.
- Money is integer cents.
- UI copy: sentence case, plain words, no em dashes, no "successfully", no exclamation marks.
- Commits stay local until the owner says push.

## Worktrees and parallel sessions

The code splits cleanly for parallel work: one session per workflow module, one on UI, one on adapters. They meet only at `src/core/types.ts`. Change that file in one place first, then branch.
