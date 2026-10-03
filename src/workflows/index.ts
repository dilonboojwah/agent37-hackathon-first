import type { WorkflowModule } from "@/core/types";
import { closeModule } from "./close";
import { commissionsModule } from "./commissions";

// Register new workflows here. Each needs a module and a seed under seeds/<module id>/.
export const modules: Record<string, WorkflowModule> = {
  close: closeModule,
  commissions: commissionsModule,
};

/** Default workspace: one workflow record per module, for one demo client each. */
export const defaultWorkflows: { id: string; moduleId: string }[] = [
  { id: "harbor-goods-close", moduleId: "close" },
  { id: "northwind-commissions", moduleId: "commissions" },
];

export function getModule(id: string): WorkflowModule {
  const m = modules[id];
  if (!m) throw new Error(`Unknown workflow module: ${id}`);
  return m;
}
