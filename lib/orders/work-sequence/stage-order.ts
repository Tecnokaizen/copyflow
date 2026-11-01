import type { WorkStageDto } from "@/lib/orders/work-sequence/types";

// SUR4 E8: «Fases de trabajo» up/down. The new order is written as
// sort_order = position, patching only the stages whose value changes (two
// for an already numbered list; the first move also numbers a list with
// repeated or sparse values).

export function reorderWorkStages(
  stages: readonly WorkStageDto[],
  index: number,
  delta: -1 | 1
): { next: WorkStageDto[]; updates: Array<{ id: string; sort_order: number }> } {
  const target = index + delta;
  if (index < 0 || index >= stages.length || target < 0 || target >= stages.length) {
    return { next: [...stages], updates: [] };
  }
  const moved = [...stages];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  const updates = moved.flatMap((stage, position) =>
    stage.sort_order === position ? [] : [{ id: stage.id, sort_order: position }]
  );
  return {
    next: moved.map((stage, position) => ({ ...stage, sort_order: position })),
    updates,
  };
}
