import { integrations } from "@/core/config";
import { handle } from "@/core/http";

export const dynamic = "force-dynamic";
export const GET = () => handle(async () => ({ ok: true, integrations: integrations() }));
