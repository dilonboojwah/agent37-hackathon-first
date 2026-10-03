import { handle } from "@/core/http";
import { reset } from "@/core/service";

type Ctx = { params: Promise<{ id: string }> };
export const POST = (_req: Request, { params }: Ctx) => handle(async () => { await reset((await params).id); return { ok: true }; });
