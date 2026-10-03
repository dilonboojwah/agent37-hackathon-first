// Every integration is optional. Missing keys select the offline path.
const env = (k: string) => (process.env[k] && process.env[k]!.trim() !== "" ? process.env[k]!.trim() : undefined);

export const config = {
  get openaiKey() { return env("OPENAI_API_KEY"); },
  get openaiModel() { return env("OPENAI_MODEL") ?? "gpt-5-mini"; },
  get supabaseUrl() { return env("SUPABASE_URL"); },
  get supabaseKey() { return env("SUPABASE_SERVICE_ROLE_KEY"); },
  get agent37Key() { return env("AGENT37_API_KEY"); },
  get agent37Template() { return env("AGENT37_TEMPLATE") ?? "agent37-hermes"; },
  get executor(): "local" | "agent37" { return env("EXECUTOR") === "agent37" ? "agent37" : "local"; },
  get appUrl() { return env("APP_URL") ?? "http://localhost:3737"; },
  get ingestToken() { return env("AGENT_INGEST_TOKEN"); },
  get monidEnabled() { return env("MONID_ENABLED") === "true"; },
  get monidEndpoint() { return env("MONID_SEARCH_ENDPOINT"); },
  get paceMs() { const v = Number(env("DEMO_PACE_MS") ?? 140); return Number.isFinite(v) ? v : 140; },
};

export function integrations() {
  return {
    openai: { on: !!config.openaiKey, label: config.openaiKey ? `OpenAI ${config.openaiModel}` : "OpenAI off: offline rule compiler" },
    supabase: { on: !!(config.supabaseUrl && config.supabaseKey), label: config.supabaseUrl ? "Supabase store" : "File store (.data)" },
    agent37: { on: !!config.agent37Key, label: config.agent37Key ? `Agent37 (${config.executor} executor)` : "Agent37 not connected" },
    monid: { on: config.monidEnabled, label: config.monidEnabled ? "monid live lookups" : "Recorded lookups" },
  };
}
