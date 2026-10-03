import type { Baseline } from "./types";

export interface TimeSaved {
  manualMinutes: number;
  humanMinutes: number;
  eliminatedMinutes: number;
  formula: string[];
}

/** Human time eliminated = manual baseline minus the minutes the person spends on decisions. */
export function timeSaved(b: Baseline, items: number, decisions: number, unit: string): TimeSaved {
  const perItem = items * b.minutesPerItem;
  const manual = perItem + b.fixedMinutes;
  const human = decisions * b.minutesPerDecision;
  return {
    manualMinutes: manual,
    humanMinutes: human,
    eliminatedMinutes: Math.max(0, manual - human),
    formula: [
      `${items} ${unit} × ${b.minutesPerItem} ${b.perItemLabel} = ${perItem} min`,
      `+ ${b.fixedMinutes} ${b.fixedLabel}`,
      `= ${manual} min by hand`,
      `− ${decisions} decisions × ${b.minutesPerDecision} min = ${human} min of your time`,
      `= ${Math.max(0, manual - human)} min eliminated`,
      `Source: ${b.source}`,
    ],
  };
}

export const fmtMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
