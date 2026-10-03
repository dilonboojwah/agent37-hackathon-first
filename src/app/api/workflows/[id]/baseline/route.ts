import { handle } from "@/core/http";
import { runBaseline } from "@/core/service";

type Ctx = { params: Promise<{ id: string }> };
export const POST = (_req: Request, { params }: Ctx) => handle(async () => runBaseline((await params).id));
