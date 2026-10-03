import { body, handle } from "@/core/http";
import { HttpError, startRun } from "@/core/service";

type Ctx = { params: Promise<{ id: string }> };
export const POST = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { kind } = await body<{ kind: string }>(req);
    if (kind !== "practice" && kind !== "manual") throw new HttpError(400, "kind must be practice or manual");
    const run = await startRun((await params).id, kind);
    return { runId: run.id };
  });
