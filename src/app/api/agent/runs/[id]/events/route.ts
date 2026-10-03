import { getStore } from "@/adapters/store";
import type { AgentEvent } from "@/core/events";
import { body, handle, requireAgent } from "@/core/http";
import { applyEvent } from "@/core/runs";

type Ctx = { params: Promise<{ id: string }> };
export const POST = (req: Request, { params }: Ctx) =>
  handle(async () => {
    requireAgent(req);
    const { id } = await params;
    const { events } = await body<{ events: AgentEvent[] }>(req);
    for (const e of events ?? []) await applyEvent(getStore(), id, e);
    return { applied: events?.length ?? 0 };
  });
