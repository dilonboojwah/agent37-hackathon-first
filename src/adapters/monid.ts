// monid.ai tool gateway. Live calls go through the monid CLI (`npm i -g @monid-ai/cli`,
// then `monid keys add`). The endpoint is chosen once with `monid discover -q "company lookup"`
// and set as MONID_SEARCH_ENDPOINT. Without that, lookups come from the seed's recorded
// responses and are labeled "recorded" in the activity feed.
//
// Not verified against a live monid account in this iteration.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "@/core/config";

const run = promisify(execFile);

export async function monidLookup(query: string): Promise<{ name: string; description: string } | null> {
  if (!config.monidEnabled || !config.monidEndpoint) return null;
  try {
    const { stdout } = await run("monid", ["run", config.monidEndpoint, "-i", JSON.stringify({ query }), "--wait", "-j"], {
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 60_000,
    });
    const parsed = JSON.parse(stdout) as { output?: unknown; result?: unknown };
    const body = JSON.stringify(parsed.output ?? parsed.result ?? parsed);
    const first = body.match(/"title"\s*:\s*"([^"]+)"/)?.[1] ?? query;
    const desc = body.match(/"(?:text|snippet|description|summary)"\s*:\s*"([^"]{0,240})/)?.[1] ?? "";
    return { name: first, description: desc };
  } catch {
    return null;
  }
}
