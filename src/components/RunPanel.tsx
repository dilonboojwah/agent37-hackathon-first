"use client";
import { useState } from "react";
import type { Review, Run } from "@/core/types";
import { fmtMinutes, post, type View } from "./api";

type Act = (fn: () => Promise<unknown>) => Promise<void>;

export function RunPanel({ view, act, onPractice }: { view: View; act: Act; onPractice: () => void }) {
  const run = view.live;
  const start = () => act(() => post(`/api/workflows/${view.workflow.id}/runs`, { kind: "manual" }));
  if (!run) return <Waiting view={view} onRun={start} onPractice={onPractice} />;
  return (
    <div className="stack-lg">
      <Activity run={run} view={view} />
      {run.reviews.length > 0 && <Reviews run={run} act={act} />}
      {(run.status === "ready" || run.status === "sent") && <Done view={view} run={run} act={act} onRunAgain={start} />}
      {run.status === "failed" && <div className="banner bad">The run failed: {run.error}</div>}
    </div>
  );
}

function Waiting({ view, onRun, onPractice }: { view: View; onRun: () => void; onPractice: () => void }) {
  const q = view.module.queue;
  const score = view.practice?.score;
  const perfect = score && score.passed === score.total;
  return (
    <section className="card stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted small">{view.module.livePeriodLabel} · {view.workflow.schedule.label}</span>
        <div className="hero-number">{q.headline}</div>
        <p className="muted">{q.subline}</p>
      </div>
      <div className="grid3">
        {q.facts.map(([k, v]) => (
          <div key={k} className="metric"><div className="label">{k}</div><div style={{ fontWeight: 600 }}>{v}</div></div>
        ))}
      </div>
      <div className="metric" style={{ maxWidth: 360 }}>
        <div className="label">By hand, this takes about</div>
        <div className="value">{fmtMinutes(view.timeSaved.manualMinutes)}</div>
      </div>
      {!score && <div className="banner warn">It hasn't practiced on your past work yet. <button className="small" onClick={onPractice}>Practice first</button></div>}
      {score && !perfect && <div className="banner warn">Practice matched {score.passed} of {score.total} checks. You can run anyway, but it may book things differently than you would. <button className="small" onClick={onPractice}>Keep teaching</button></div>}
      <div className="row">
        <button className="primary" onClick={onRun}>▶ Run now</button>
        <span className="faint small">
          {view.workflow.agent37 ? `Scheduled on Agent37: ${view.workflow.schedule.label.toLowerCase()}.` : `Runs ${view.executor === "agent37" ? "in its Agent37 sandbox" : "in this app"}. Connect Agent37 to run on schedule.`}
        </span>
      </div>
    </section>
  );
}

function Activity({ run, view }: { run: Run; view: View }) {
  const lines = run.items
    .flatMap((it) => it.trace.map((l) => ({ ...l, who: it.name })))
    .sort((a, b) => a.at.localeCompare(b.at));
  const done = run.items.filter((i) => i.status === "auto" || i.status === "needs_review").length;
  const running = run.status === "running";
  return (
    <section className="card stack">
      <div className="between">
        <div className="stack" style={{ gap: 2 }}>
          <span className="muted small">{view.module.livePeriodLabel} · {run.executor === "agent37" ? "running in its Agent37 sandbox" : "running in this app"} · spec v{run.specVersion}</span>
          <h2>{running ? "Agent working" : "Agent activity"}</h2>
        </div>
        <span className={`chip ${running ? "accent" : "good"}`}>
          <span className="dot" /> {done} of {run.items.length} {view.module.unit}
        </span>
      </div>
      <div className="items">
        {run.items.map((it) => (
          <div key={it.id} className={`item ${it.status}`}>
            <div className="between">
              <strong className="small">{it.name}</strong>
              <StatusChip status={it.status} />
            </div>
            {it.checks.length > 0 && (
              <div className="faint small" style={{ marginTop: 4 }}>
                {it.checks.filter((c) => c.passed).length} of {it.checks.length} checks pass
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="feed" style={{ maxHeight: running ? 360 : 220, overflow: "hidden", justifyContent: "flex-end" }}>
        {lines.slice(running ? -16 : -10).map((l, i) => (
          <div key={`${l.at}-${i}`} className="feed-line">
            <span className="who">{l.who}</span>
            <span className={`k-${l.kind}`}>{icon(l.kind)} {l.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Items the agent finished with no human decision (status turns "auto" once decisions are made, so count by reviews). */
const autoCount = (run: Run) => run.items.filter((i) => i.status === "auto" && !run.reviews.some((r) => r.itemId === i.id)).length;

const icon = (k: string) => ({ think: "·", tool: "→", check: "✓", stop: "■", done: "✓" })[k] ?? "·";

function StatusChip({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    queued: ["", "Waiting"], working: ["accent", "Working"], auto: ["good", "Done"], needs_review: ["warn", "Needs you"], failed: ["bad", "Failed"],
  };
  const [cls, label] = map[status] ?? ["", status];
  return <span className={`chip ${cls}`}>{label}</span>;
}

function Reviews({ run, act }: { run: Run; act: Act }) {
  const open = run.reviews.filter((r) => !r.decision).length;
  return (
    <section className="stack">
      <div className="between">
        <h2>{open > 0 ? `${open} decision${open === 1 ? "" : "s"} need${open === 1 ? "s" : ""} you` : "All decisions made"}</h2>
        <span className="faint small">{autoCount(run)} of {run.items.length} completed automatically</span>
      </div>
      {run.reviews.map((r) => <ReviewCard key={r.id} run={run} review={r} act={act} />)}
    </section>
  );
}

function ReviewCard({ run, review, act }: { run: Run; review: Review; act: Act }) {
  const [remember, setRemember] = useState(true);
  const decide = (decision: string) => act(() => post(`/api/runs/${run.id}/reviews/${review.id}`, { decision, remember }));
  return (
    <div className={`review ${review.decision ? "decided" : ""}`}>
      <div className="between">
        <strong>{review.title}</strong>
        <span className="chip warn">{review.type}</span>
      </div>
      <div className="evidence">
        {review.evidence.map(([k, v]) => (
          <div key={k}><div className="k">{k}</div><div className="small">{v}</div></div>
        ))}
      </div>
      <p className="small" style={{ marginBottom: 12 }}><span className="muted">Agent proposes:</span> {review.proposal}</p>
      {review.decision ? (
        <p className="small" style={{ color: "var(--good)" }}>
          ✓ {review.decision} · decided by {review.decidedBy}{review.remembered ? " · remembered as a rule for next time" : ""}
        </p>
      ) : (
        <div className="row">
          <button className="primary" onClick={() => decide(review.actions[0])}>{review.actions[0]}</button>
          <button onClick={() => decide(review.actions[1])}>{review.actions[1]}</button>
          {review.ruleIfRemembered && (
            <label className="small muted row" style={{ gap: 6 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember this as a rule
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function Done({ view, run, act, onRunAgain }: { view: View; run: Run; act: Act; onRunAgain: () => void }) {
  const t = view.timeSaved;
  const [showCalc, setShowCalc] = useState(false);
  const decisions = run.reviews.length;
  const auto = autoCount(run);
  const sent = run.status === "sent";
  return (
    <section className="stack-lg">
      <div className="grid2">
        <div className="card stack" style={{ gap: 4 }}>
          <span className="muted small">Before</span>
          <div className="hero-number">{fmtMinutes(t.manualMinutes)}</div>
          <span className="muted small">{view.module.itemCount} {view.module.unit} by hand, every step</span>
        </div>
        <div className="card stack" style={{ gap: 4, borderColor: "var(--good)" }}>
          <span className="small" style={{ color: "var(--good)" }}>After</span>
          <div className="hero-number">{t.humanMinutes} min of your time</div>
          <span className="muted small">{decisions} decisions · agent ran {run.agentSeconds ?? 0}s</span>
        </div>
      </div>

      <div className="grid3">
        <div className="metric"><div className="label">Completed automatically</div><div className="value">{auto} of {run.items.length}</div></div>
        <div className="metric"><div className="label">Your decisions</div><div className="value">{decisions}</div></div>
        <div className="metric"><div className="label">Human time eliminated</div><div className="value" style={{ color: "var(--good)" }}>{fmtMinutes(t.eliminatedMinutes)}</div></div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <button className="ghost small" style={{ alignSelf: "flex-start", padding: 0 }} onClick={() => setShowCalc(!showCalc)}>ⓘ How this is calculated</button>
        {showCalc && <div className="calc">{t.formula.map((l) => <div key={l}>{l}</div>)}</div>}
      </div>

      <div className="card stack">
        <span className="muted small">Output ready</span>
        <h2>{run.output?.headline}</h2>
        <ul className="serif" style={{ margin: 0, paddingLeft: 20 }}>
          {run.output?.lines.map((l) => <li key={l}>{l}</li>)}
          {run.reviews.map((r) => <li key={r.id}>Decision: {r.title}: {r.decision}</li>)}
        </ul>
        <div className="row">
          <button className="primary" disabled={sent} onClick={() => act(() => post(`/api/runs/${run.id}/send`))}>
            {sent ? "Sent" : view.module.id === "close" ? "Send close packet" : "Send statements to payroll"}
          </button>
          <button onClick={onRunAgain}>Run again</button>
        </div>
        {sent && <div className="banner good small">Recorded as sent. Nothing leaves this demo; in production this posts to the ledger or payroll system.</div>}
      </div>

      <Compare view={view} act={act} />
    </section>
  );
}

function Compare({ view, act }: { view: View; act: Act }) {
  const [busy, setBusy] = useState(false);
  const b = view.baseline;
  const a = view.agentScore;
  const runIt = async () => {
    setBusy(true);
    await act(() => post(`/api/workflows/${view.workflow.id}/baseline`));
    setBusy(false);
  };
  return (
    <div className="card stack">
      <div className="between">
        <h2>Compare with a plain model</h2>
        <button onClick={runIt} disabled={busy || !view.integrations.openai.on} title={view.integrations.openai.on ? "" : "Needs OPENAI_API_KEY"}>
          {busy ? "Running…" : b ? "Run the comparison again" : "Run the comparison"}
        </button>
      </div>
      <p className="muted small">Same files and written rules, no spec, no practice. Both are scored on the same checks against the answer key for {view.module.livePeriodLabel}.</p>
      <div className="grid2">
        <div className="metric">
          <div className="label">Plain model{b?.source ? ` · ${b.source}` : ""}</div>
          {b?.score ? (
            <>
              <div className="value" style={{ color: b.score.passed < b.score.total ? "var(--bad)" : undefined }}>{b.score.passed} of {b.score.total} checks</div>
              <ul className="small muted" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{b.output?.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </>
          ) : (
            <div className="small muted" style={{ marginTop: 4 }}>
              {view.integrations.openai.on ? "Not run yet." : "Needs OPENAI_API_KEY, or a recorded run from npm run baseline:record. No numbers are shown until a real run exists."}
            </div>
          )}
        </div>
        <div className="metric">
          <div className="label">This agent · this run</div>
          {a ? (
            <>
              <div className="value" style={{ color: a.passed === a.total ? "var(--good)" : "var(--bad)" }}>{a.passed} of {a.total} checks</div>
              <ul className="small muted" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{a.notes.map((l) => <li key={l}>{l}</li>)}</ul>
            </>
          ) : <div className="small muted">Run it first.</div>}
        </div>
      </div>
    </div>
  );
}
