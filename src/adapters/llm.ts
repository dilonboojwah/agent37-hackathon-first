// OpenAI adapter. Returns null when no key is configured so callers take the offline path.
import { config } from "@/core/config";

type Client = { chat: { completions: { create: (args: Record<string, unknown>) => Promise<{ choices: { message: { content: string | null } }[] }> } } };

let client: Client | null = null;
async function getClient(): Promise<Client | null> {
  if (!config.openaiKey) return null;
  if (!client) {
    const { default: OpenAI } = await import("openai");
    client = new OpenAI({ apiKey: config.openaiKey }) as unknown as Client;
  }
  return client;
}

export async function complete(system: string, user: string, json = true): Promise<string | null> {
  const c = await getClient();
  if (!c) return null;
  const res = await c.chat.completions.create({
    model: config.openaiModel,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    ...(json ? { response_format: { type: "json_object" } } : {}),
  });
  return res.choices[0]?.message.content ?? null;
}

export async function completeJson<T>(system: string, user: string): Promise<T | null> {
  const text = await complete(system, user, true);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
