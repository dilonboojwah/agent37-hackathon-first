"use client";
import { useState } from "react";
import type { CaseResult } from "@/core/types";
import { post, type View } from "./api";

export function PracticePanel({ view, act, onNext }: { view: View; act: (fn: () => Promise<unknown>) => Promise<void>; onNext: () => void }) {
  const wf = view.workflow;
  const run = view.practice;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const start = () => act(() => post(`/api/workflows/${wf.id}/runs`, { kind: "practice" }));
  const teachIt = async () => {
    setBusy(true);
    await act(async () => {
      await post(`/api/workflows/${wf.id}/corrections`, { text });
      setText("");
    });
    setBusy(false);
  };

  if (!run) {
    return (
      <section className="card stack" style={{ alignItems: "flex-start" }}>
        <h2>Practice on your past work</h2>
        <p className="muted">
          The agent redoes each of your {view.module.examples.length} past examples using only the workflow it drafted, then compares its
          result with yours, check by check. Nothing real is touched.
        </p>
        <button className="primary" onClick={start}>Run practice</button>
      </section>
    );
  }

  const score = run.score;
  const running = run.status === "running";
  const cases = score?.cases ?? [];
  const checks = [...new Set(cases.map((c) => c.check))];
  const months = view.module.examples.map((e) => e.label);
  const misses = cases.filter((c) => !c.passed);
  const perfect = !!score && !running && score.passed === score.total && score.total > 0;
  const lastCorrection = wf.corrections.at(-1);
  const lastRule = lastCorrection ? wf.spec?.rules.find((r) => r.id === lastCorrection.ruleId) : undefined;

  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="between">
          <div className="stack" style={{ gap: 2 }}>
            <span className="muted small">Practice run · spec v{run.specVersion}</span>
            <div className="hero-number">
              {running && !score ? "Practicing…" : score ? `Matched your work on ${score.passed} of ${score.total} checks` : "Practicing…"}
            </div>
          </div>
          <div className="row">
            {running && <span className="chip accent"><span className="dot" />Working</span>}
            {!running && <button onClick={start}>Run practice again</button>}
            {perfect && <button className="primary" onClick={onNext}>Next: run it live →</button>}
          </div>
        </div>

        {running && (
          <div className="items">
            {run.items.map((it) => (
              <div key={it.id} className={`item ${it.status}`}>
                <div className="between"><strong className="small">{it.name}</strong><span className="faint small">{it.status === "queued" ? "waiting" : it.status === "working" ? "redoing" : it.status === "auto" ? "matches" : "differs"}</span></div>
                <div className="faint mono" style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.trace.at(-1)?.text ?? ""}</div>
              </div>
            ))}
          </div>
        )}

        {checks.length > 0 && (
          <div className="scoregrid" style={{ gridTemplateColumns: `140px repeat(${checks.length}, minmax(0, 1fr))` }}>
            <div />
            {checks.map((c) => <div key={c} className="faint small" style={{ padding: "0 4px" }}>{c}</div>)}
            {months.map((m) => (
              <Row key={m} month={m} checks={checks} cases={cases} open={open} setOpen={setOpen} />
            ))}
          </div>
        )}

        {perfect && <div className="banner good">It matches your past work on every check. Each correction is now a permanent test, so it can't quietly slip back.</div>}
      </section>

      {misses.length > 0 && !running && (
        <section className="card stack">
          <h2>Where it did it differently than you</h2>
          {misses.map((c) => (
            <div key={c.id} className="stack" style={{ gap: 6 }}>
              <button className="ghost small" style={{ justifyContent: "flex-start", padding: 0 }} onClick={() => setOpen(open === c.id ? null : c.id)}>
                <span className="chip bad">{c.example}</span> <strong style={{ color: "var(--text)" }}>{c.check}</strong> <span className="muted">· {c.detail}</span>
              </button>
              {(open === c.id || misses.length <= 3) && c.diffs.length > 0 && <Diff c={c} />}
            </div>
          ))}
        </section>
      )}

      {!running && score && (
        <section className="card stack">
          <h2>Teach it</h2>
          <p className="muted small">Say what you'd tell a new hire. It becomes a rule and a test, then practice re-runs on all your past work.</p>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={view.module.suggestedCorrections.find((x) => !wf.corrections.some((c) => c.text === x)) ?? "Tell it what you'd tell a new hire"} />
          <div className="row">
            <button className="primary" onClick={teachIt} disabled={busy || !text.trim()}>{busy ? "Teaching…" : "Teach it and re-run"}</button>
            {view.module.suggestedCorrections
              .filter((s) => !wf.corrections.some((c) => c.text === s))
              .map((s) => (
                <button key={s} className="small" onClick={() => setText(s)} title="Fill the box with this correction">
                  {s.length > 64 ? `${s.slice(0, 62)}…` : s}
                </button>
              ))}
          </div>
          {lastCorrection && lastRule && (
            <div className="banner info small">
              Last correction became a rule ({lastRule.kind.replace(/_/g, " ")}) and a test on every past example: “{lastCorrection.text}”
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Row({ month, checks, cases, open, setOpen }: { month: string; checks: string[]; cases: CaseResult[]; open: string | null; setOpen: (id: string | null) => void }) {
  return (
    <>
      <div className="small" style={{ alignSelf: "center" }}>{month}</div>
      {checks.map((ch) => {
        const c = cases.find((x) => x.example === month && x.check === ch);
        if (!c) return <div key={ch} className="cell faint">…</div>;
        return (
          <button key={ch} className={`cell ${c.passed ? "pass" : "fail"}`} onClick={() => setOpen(open === c.id ? null : c.id)} title={c.detail}>
            {c.passed ? "✓ Matches" : "✗ Differs"}
          </button>
        );
      })}
    </>
  );
}

function Diff({ c }: { c: CaseResult }) {
  return (
    <table className="diff">
      <thead>
        <tr><th style={{ width: "40%" }}>Item</th><th>Your past work</th><th>Agent</th></tr>
      </thead>
      <tbody>
        {c.diffs.slice(0, 8).map((d, i) => (
          <tr key={i}><td className="mono">{d.ref}</td><td className="exp">{d.expected}</td><td className="act">{d.actual}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
