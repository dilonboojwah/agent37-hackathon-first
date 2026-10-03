import { body, handle } from "@/core/http";
import { teach } from "@/core/service";

type Ctx = { params: Promise<{ id: string }> };
export const POST = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { writtenRules } = await body<{ writtenRules: string }>(req);
    return teach((await params).id, writtenRules ?? "");
  });
