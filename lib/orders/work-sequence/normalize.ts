import type {
  WorkStageDto,
  WorkStepDto,
  WorkStepExecutorDto,
  WorkStepPersonDto,
  WorkStepStageDto,
} from "@/lib/orders/work-sequence/types";

// SUR4 E8: PostgREST rows → API DTOs. Embeds of a many-to-one come back as an
// object (or null); an array is tolerated in case PostgREST ever returns one.

type Row = Record<string, unknown>;

function one(value: unknown): Row | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object" ? (candidate as Row) : null;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const textOrNull = (value: unknown) => (typeof value === "string" ? value : null);

export function toWorkStepStage(value: unknown): WorkStepStageDto | null {
  const row = one(value);
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    name: text(row.name),
    icon: typeof row.icon === "string" ? row.icon : "other",
    active: row.active === true,
  };
}

export function toWorkStepPerson(value: unknown): WorkStepPersonDto | null {
  const row = one(value);
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    name: text(row.name),
    active: row.active === true,
    can_receive_orders: row.can_receive_orders === true,
  };
}

export function toWorkStepExecutor(value: unknown): WorkStepExecutorDto | null {
  const row = one(value);
  if (!row || typeof row.id !== "string") return null;
  return { id: row.id, name: text(row.name) };
}

export function toWorkStepDto(row: Row): WorkStepDto {
  const completedAt = textOrNull(row.completed_at);
  return {
    id: String(row.id),
    position: typeof row.position === "number" ? row.position : Number(row.position) || 0,
    stage: toWorkStepStage(row.stage),
    team_member: toWorkStepPerson(row.team_member),
    executed_by: toWorkStepExecutor(row.executed_by),
    done: completedAt !== null,
    completed_at: completedAt,
    completed_by_name: textOrNull(row.completed_by_name),
    is_current: row.is_current === true,
  };
}

export function toWorkStageDto(row: Row): WorkStageDto {
  return {
    id: String(row.id),
    name: text(row.name),
    icon: typeof row.icon === "string" ? row.icon : "other",
    active: row.active === true,
    sort_order: typeof row.sort_order === "number" ? row.sort_order : Number(row.sort_order) || 0,
  };
}

/** Settings order: sort_order, then name (Spanish collation). */
export function sortWorkStages<T extends { sort_order: number; name: string }>(stages: T[]): T[] {
  return [...stages].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "es")
  );
}
