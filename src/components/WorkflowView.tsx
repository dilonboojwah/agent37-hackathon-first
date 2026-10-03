"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { post, type View } from "./api";
import { TeachPanel } from "./TeachPanel";
import { PracticePanel } from "./PracticePanel";
import { RunPanel } from "./RunPanel";

type Tab = "teach" | "practice" | "run";

export function WorkflowView({ id, others }: { id: string; others: { id: string; name: string }[] }) {
  const [view, setView] = useState<View | null>(null);
  const [tab, setTab] = useState<Tab>("teach");
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/workflows/${id}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setView(data);
    return data as View;
  }, [id]);

  useEffect(() => {
    load().then((v) => {
      if (chosen) return;
      // Open on the furthest step reached.
      setTab(v.live ? "run" : v.practice ? "practice" : "teach");
    }).catch((e) => setError(String(e.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const running = view?.practice?.status === "running" || view?.live?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => load().catch(() => undefined), 450);
    return () => clearInterval(t);
  }, [running, load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      await load().catch(() => undefined);
    },
    [load],
  );

  const go = (t: Tab) => { setChosen(true); setTab(t); };

  if (!view) return <div className="card muted">{error ?? "Loading…"}</div>;
  const wf = view.workflow;
  const practiceDone = view.practice?.score && view.practice.status !== "running";
  const perfect = practiceDone && view.practice!.score!.passed === view.practice!.score!.total;

  return (
    <main>
      <div className="between" style={{ marginTop: 8 }}>
        <div className="stack" style={{ gap: 4 }}>
          <div className="row">
            <Link href="/" className="faint small">Workflows</Link>
            <span className="faint small">/</span>
            {others.map((o) => (
              <Link key={o.id} href={`/w/${o.id}`} className="faint small" title="Same components, different seed">
                Switch to {o.name.toLowerCase()} →
              </Link>
            ))}
          </div>
          <h1>{wf.name}: {wf.client}</h1>
        </div>
        <div className="row">
          <span className={`chip ${wf.agent37 ? "on" : ""}`}>
            <span className="dot" />
            {wf.agent37 ? `${wf.schedule.label} on Agent37` : `${wf.schedule.label} (Agent37 not connected)`}
          </span>
          <button className="small ghost" onClick={() => act(() => post(`/api/workflows/${id}/reset`)).then(() => go("teach"))}>Reset demo</button>
        </div>
      </div>

      <nav className="tabs">
        <button className={`tab ${tab === "teach" ? "active" : ""} ${wf.spec ? "done" : ""}`} onClick={() => go("teach")}>
          <span className="num">{wf.spec ? "✓" : 1}</span> Teach
        </button>
        <button className={`tab ${tab === "practice" ? "active" : ""} ${perfect ? "done" : ""}`} onClick={() => go("practice")} disabled={!wf.spec}>
          <span className="num">{perfect ? "✓" : 2}</span> Practice on your past work
        </button>
        <button className={`tab ${tab === "run" ? "active" : ""} ${view.live?.status === "sent" ? "done" : ""}`} onClick={() => go("run")} disabled={!wf.spec}>
          <span className="num">{view.live?.status === "sent" ? "✓" : 3}</span> Run
        </button>
      </nav>

      {error && <div className="banner bad" style={{ marginBottom: 16 }}>{error}</div>}

      {tab === "teach" && <TeachPanel view={view} act={act} onNext={() => go("practice")} />}
      {tab === "practice" && <PracticePanel view={view} act={act} onNext={() => go("run")} />}
      {tab === "run" && <RunPanel view={view} act={act} onPractice={() => go("practice")} />}
    </main>
  );
}
