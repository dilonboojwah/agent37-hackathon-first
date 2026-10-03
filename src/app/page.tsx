import Link from "next/link";
import { workflowSummaries } from "@/core/service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const wfs = await workflowSummaries();
  return (
    <main className="stack-lg" style={{ marginTop: 12 }}>
      <div className="stack" style={{ maxWidth: 700 }}>
        <h1>Workflows SaaS can't templatize, taught by example</h1>
        <p className="muted">
          Show the agent a few months of your past work. It practices on them, shows you where it did things differently, and learns
          from your corrections. When it matches you, it runs on a schedule in its own Agent37 sandbox and only asks you about the hard calls.
        </p>
      </div>
      <div className="grid2">
        {wfs.map((w) => (
          <Link key={w.id} href={`/w/${w.id}`} className="card wf-card stack">
            <div className="between">
              <h2>{w.name}</h2>
              <span className="chip">{w.schedule}</span>
            </div>
            <p className="muted">{w.client}</p>
            <p>{w.queue}</p>
            <div className="row">
              <span className={`chip ${w.taught ? "good" : ""}`}>{w.taught ? "Taught" : "Not taught yet"}</span>
              {w.practiceScore && <span className="chip accent">Practice: matched {w.practiceScore}</span>}
              {w.liveStatus && <span className="chip warn">Live run: {w.liveStatus.replace("_", " ")}</span>}
              {w.agent37 && <span className="chip on">Agent37 sandbox</span>}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
