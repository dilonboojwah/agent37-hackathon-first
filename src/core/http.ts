import { NextResponse } from "next/server";
import { config } from "./config";
import { HttpError } from "./service";

export async function handle<T>(fn: () => Promise<T>) {
  try {
    return NextResponse.json(await fn());
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}

/** Agent routes accept only the sandbox runner's shared token. */
export function requireAgent(req: Request) {
  const token = config.ingestToken;
  if (!token) throw new HttpError(403, "AGENT_INGEST_TOKEN is not set on the app");
  if (req.headers.get("authorization") !== `Bearer ${token}`) throw new HttpError(401, "Bad agent token");
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Expected a JSON body");
  }
}
