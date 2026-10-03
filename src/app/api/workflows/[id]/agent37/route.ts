import { body, handle, requireAgent } from "@/core/http";
import { registerAgent37 } from "@/core/service";
import type { WorkflowRecord } from "@/core/types";

type Ctx = { params: Promise<{ id: string }> };
export const POST = (req: Request, { params }: Ctx) =>
  handle(async () => {
    requireAgent(req);
    await registerAgent37((await params).id, await body<NonNullable<WorkflowRecord["agent37"]>>(req));
    return { ok: true };
  });
