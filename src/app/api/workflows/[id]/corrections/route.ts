import { body, handle } from "@/core/http";
import { HttpError, correct } from "@/core/service";

type Ctx = { params: Promise<{ id: string }> };
export const POST = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { text } = await body<{ text: string }>(req);
    if (!text?.trim()) throw new HttpError(400, "Write the correction first.");
    return correct((await params).id, text.trim());
  });
