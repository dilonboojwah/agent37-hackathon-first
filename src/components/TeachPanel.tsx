"use client";
import { useState } from "react";
import { post, type View } from "./api";

const originLabel: Record<string, string> = { written: "You wrote", learned: "Learned", correction: "Your correction", decision: "Your decision" };

export function TeachPanel({ view, act, onNext }: { view: View; act: (fn: () => Promise<unknown>) => Promise<void>; onNext: () => void }) {
  const wf = view.workflow;
  const [rules, setRules] = useState(wf.writtenRules);
  const [busy, setBusy] = useState(false);
  const spec = wf.spec;

  const draft = async () => {
    setBusy(true);
    await act(() => post(`/api/workflows/${wf.id}/teach`, { writtenRules: rules }));
    setBusy(false);
  };

  return (
    <div className="stack-lg">
      <div className="grid2">
        <section className="card stack">
          <div className="between">
            <h2>Your past work</h2>
            <span className="chip">{view.module.examples.length} examples</span>
          </div>
          <p className="muted small">Finished, reviewed work. Each example becomes practice cases with known answers.</p>
          <div className="list">
            {view.module.examples.map((ex) => (
              <div key={ex.id} className="stack" style={{ gap: 4 }}>
                <div className="between">
                  <strong>{ex.label}</strong>
                  <span className="faint small">{ex.stats}</span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {ex.files.slice(0, 7).map((f) => <span key={f} className="chip mono">{f}</span>)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card stack">
          <h2>What you told it</h2>
          <p className="muted small">A few sentences of house rules, the way you'd brief a new hire. It's fine to leave things out: practice finds the gaps.</p>
          <textarea rows={8} value={rules} onChange={(e) => setRules(e.target.value)} />
          <div className="row">
            <button className="primary" onClick={draft} disabled={busy || !rules.trim()}>
              {busy ? "Drafting…" : spec ? "Redraft the workflow" : "Draft the workflow"}
            </button>
            {spec && <span className="faint small">Spec v{spec.version}. Corrections are kept when you redraft.</span>}
          </div>
        </section>
      </div>

      {spec && (
        <section className="card stack">
          <div className="between">
            <h2>The workflow it drafted</h2>
            <button className="primary" onClick={onNext}>Next: practice on your past work →</button>
          </div>
          <div className="row">
            {spec.learnedSummary.map((s) => <span key={s} className="chip accent">{s}</span>)}
          </div>
          <div className="grid2">
            <div className="stack">
              <h3>Steps</h3>
              <ol style={{ margin: 0, paddingLeft: 20 }} className="small">
                {spec.steps.map((s) => <li key={s} style={{ padding: "3px 0" }}>{s}</li>)}
              </ol>
              <h3 style={{ marginTop: 8 }}>It stops and asks you when</h3>
              <ul style={{ margin: 0, paddingLeft: 20 }} className="small">
                {spec.stopConditions.map((s) => <li key={s} style={{ padding: "3px 0" }}>{s}</li>)}
              </ul>
            </div>
            <div className="stack">
              <h3>Rules</h3>
              <div className="list small">
                {spec.rules.map((r) => (
                  <div key={r.id} className="between" style={{ alignItems: "flex-start" }}>
                    <span style={{ flex: 1 }}>{r.text}</span>
                    <span className={`badge-origin origin-${r.origin}`}>{originLabel[r.origin]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
