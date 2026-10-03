import { handle, requireAgent } from "@/core/http";
import { remoteRunInfo } from "@/core/service";

type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const GET = (req: Request, { params }: Ctx) =>
  handle(async () => {
    requireAgent(req);
    return remoteRunInfo((await params).id);
  });
