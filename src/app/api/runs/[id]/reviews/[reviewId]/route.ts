import { body, handle } from "@/core/http";
import { decide } from "@/core/service";

type Ctx = { params: Promise<{ id: string; reviewId: string }> };
export const POST = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { id, reviewId } = await params;
    const { decision, remember } = await body<{ decision: string; remember?: boolean }>(req);
    return decide(id, reviewId, decision, !!remember);
  });
