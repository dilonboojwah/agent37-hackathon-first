// Tools the agent can call while it works. Shared by the local executor and the sandbox runner.
import { completeJson } from "@/adapters/llm";
import { monidLookup } from "@/adapters/monid";
import { readSeed, seedExists } from "./seeds";
import type { AgentTools, WorkflowModule } from "./types";

export function toolsFor(module: WorkflowModule): AgentTools {
  return {
    lookupEntity: async (query) => {
      const live = await monidLookup(query);
      if (live) return { ...live, source: "monid" };
      const rel = `${module.id}/meta.json`;
      const recorded = seedExists(rel) ? readSeed<{ recordedLookups?: Record<string, { name: string; description: string }> }>(rel).recordedLookups?.[query] : undefined;
      return recorded ? { ...recorded, source: "recorded" } : null;
    },
    judge: async <T,>(prompt: string, schemaHint: string) => completeJson<T>(`You are a careful bookkeeper. Reply with JSON matching ${schemaHint}.`, prompt),
  };
}
