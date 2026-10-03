import { handle } from "@/core/http";
import { HttpError } from "@/core/service";
import { getStore } from "@/adapters/store";

type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const GET = (_req: Request, { params }: Ctx) =>
  handle(async () => {
    const run = await getStore().getRun((await params).id);
    if (!run) throw new HttpError(404, "No such run");
    return run;
  });
