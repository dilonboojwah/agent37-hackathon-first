import { WorkflowView } from "@/components/WorkflowView";
import { workflowSummaries } from "@/core/service";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const all = await workflowSummaries();
  return <WorkflowView id={id} others={all.filter((w) => w.id !== id).map((w) => ({ id: w.id, name: w.name }))} />;
}
