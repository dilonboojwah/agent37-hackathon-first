import { handle } from "@/core/http";
import { send } from "@/core/service";

type Ctx = { params: Promise<{ id: string }> };
export const POST = (_req: Request, { params }: Ctx) => handle(async () => send((await params).id));
