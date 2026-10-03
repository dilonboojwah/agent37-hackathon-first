import { body, handle, requireAgent } from "@/core/http";
import { HttpError, createRemoteRun } from "@/core/service";

type Ctx = { params: Promise<{ id: string }> };
export const POST = (req: Request, { params }: Ctx) =>
  handle(async () => {
    requireAgent(req);
    const { kind } = await body<{ kind: string }>(req);
    if (kind !== "scheduled" && kind !== "manual") throw new HttpError(400, "kind must be scheduled or manual");
    return createRemoteRun((await params).id, kind);
  });
