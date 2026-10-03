import { handle } from "@/core/http";
import { workflowView } from "@/core/service";

type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const GET = (_req: Request, { params }: Ctx) => handle(async () => workflowView((await params).id));
