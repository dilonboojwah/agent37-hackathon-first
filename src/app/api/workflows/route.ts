import { handle } from "@/core/http";
import { workflowSummaries } from "@/core/service";

export const dynamic = "force-dynamic";
export const GET = () => handle(() => workflowSummaries());
