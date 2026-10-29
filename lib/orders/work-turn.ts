import type { SupabaseClient } from "@supabase/supabase-js";

import { tenantHasFeature } from "@/lib/features/tenant-has-feature";
import {
  classifyMineOrder,
  compareMineOrders,
  MINE_QUEUE_SECTIONS,
  type MineOrder,
  type MineQueueSection,
  type MineQueueSectionId,
} from "@/lib/orders/mine";
import { ORDER_FEATURE_CODES } from "@/lib/orders/order-features";
import { getZonedDayBounds } from "@/lib/time/zoned-day";

// SUR4 E9 (ADR SUR4-01, f1 §3 and §6): the work sequence in lists, Mis pedidos,
// Mostrador and the dashboard. Three ideas that never mix:
//   * Responsable  orders.assigned_team_member_id, unchanged.
//   * Participa    anyone with a step in the sequence, done or not.
//   * Le toca      the person of the first step not done (is_current). With no
//                  sequence, or a finished one, the order is in the hands of its
//                  responsible person.
// Every helper here is pure, except loadWorkSequenceEnabled, which only reads.

// --- PostgREST embeds -------------------------------------------------------
// order_work_steps has three foreign keys towards team_members: every embed of
// the person names order_work_steps_team_member_fk (E1, lib/orders/postgrest-hints.test.ts).
export const WORK_STEPS_EMBED =
  "work_steps:order_work_steps(position, is_current, completed_at, team_member_id, stage:work_stages!order_work_steps_stage_fk(name, icon), team_member:team_members!order_work_steps_team_member_fk(id, name, active))";

// Semi-joins: `!inner` keeps the orders with at least one matching step and
// returns each order once, so `count` and the pagination stay exact.
export const WORK_TURN_FILTER_ALIAS = "work_turn_filter";
export const WORK_PARTICIPANT_FILTER_ALIAS = "work_participant_filter";
export const MY_PENDING_STEPS_ALIAS = "my_pending_steps";

const SEMI_JOIN_ALIASES = [
  WORK_TURN_FILTER_ALIAS,
  WORK_PARTICIPANT_FILTER_ALIAS,
  MY_PENDING_STEPS_ALIAS,
] as const;

type SemiJoinAlias = (typeof SEMI_JOIN_ALIASES)[number];

export function semiJoinEmbed(alias: SemiJoinAlias) {
  return `${alias}:order_work_steps!inner(id)`;
}

export type WorkTurnListFilters = {
  turnTeamMemberId?: string | null;
  participantTeamMemberId?: string | null;
};

/** Adds the steps embed and, when asked, the semi-joins of the two filters. */
export function withWorkTurnSelect(select: string, filters: WorkTurnListFilters = {}) {
  const parts = [select.trim(), WORK_STEPS_EMBED];
  if (filters.turnTeamMemberId) {
    parts.push(semiJoinEmbed(WORK_TURN_FILTER_ALIAS));
  }
  if (filters.participantTeamMemberId) {
    parts.push(semiJoinEmbed(WORK_PARTICIPANT_FILTER_ALIAS));
  }
  return parts.join(",\n  ");
}

/**
 * Le toca a (turn_team_member_id): the current step is that person's.
 * Participa (participant_team_member_id): that person has a step, done or not.
 */
export function applyWorkTurnFilters<T>(query: T, filters: WorkTurnListFilters): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase builder, same as operational.ts
  let next: any = query;
  if (filters.turnTeamMemberId) {
    next = next
      .eq(`${WORK_TURN_FILTER_ALIAS}.team_member_id`, filters.turnTeamMemberId)
      .is(`${WORK_TURN_FILTER_ALIAS}.is_current`, true);
  }
  if (filters.participantTeamMemberId) {
    next = next.eq(
      `${WORK_PARTICIPANT_FILTER_ALIAS}.team_member_id`,
      filters.participantTeamMemberId
    );
  }
  return next as T;
}

// --- Feature gate -------------------------------------------------------------

/**
 * Server only. The sequence shows up only with the A1 feature
 * order_work_sequence AND at least one active stage (f1 §3: while a tenant has
 * no active stages the sequence appears on no screen). Without the feature no
 * new table is read.
 */
export async function loadWorkSequenceEnabled(
  supabase: SupabaseClient,
  tenantId: string
): Promise<boolean> {
  const enabled = await tenantHasFeature(
    supabase,
    tenantId,
    ORDER_FEATURE_CODES.workSequence
  );
  if (!enabled) {
    return false;
  }

  const { count, error } = await supabase
    .from("work_stages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("active", true);

  return !error && (count ?? 0) > 0;
}

// --- Turn of one order --------------------------------------------------------

export type WorkTurnPerson = {
  id: string;
  name: string;
  active: boolean;
};

export type WorkTurnCurrent = {
  /** 1-based place of the current step in the sequence. */
  position: number;
  total: number;
  stage_name: string;
  stage_icon: string;
  /** null: step without a person yet (D14). */
  team_member: WorkTurnPerson | null;
};

/** Public field `work_turn` of the lists. null: the order has no sequence. */
export type WorkTurn = {
  total: number;
  done: number;
  /** null: every step is done. */
  current: WorkTurnCurrent | null;
};

export type WorkStepsSummary = {
  turn: WorkTurn | null;
  /** Everyone with a step, done or not (Participa). */
  participantIds: string[];
  /** People with a pending step that is not the current one. */
  upcomingIds: string[];
};

type ParsedStep = {
  position: number;
  isCurrent: boolean;
  done: boolean;
  teamMemberId: string | null;
  stageName: string;
  stageIcon: string;
  person: WorkTurnPerson | null;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return readRecord(value[0]);
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parseStep(value: unknown): ParsedStep | null {
  const record = readRecord(value);
  if (!record || typeof record.position !== "number") {
    return null;
  }

  const stage = readRecord(record.stage);
  const member = readRecord(record.team_member);
  const teamMemberId =
    typeof record.team_member_id === "string" ? record.team_member_id : null;
  const memberName = typeof member?.name === "string" ? member.name.trim() : "";

  return {
    position: record.position,
    isCurrent: record.is_current === true,
    done: typeof record.completed_at === "string" && record.completed_at.length > 0,
    teamMemberId,
    stageName: typeof stage?.name === "string" ? stage.name : "Fase",
    stageIcon: typeof stage?.icon === "string" ? stage.icon : "other",
    person: teamMemberId
      ? {
          id: teamMemberId,
          name: memberName,
          active: member ? member.active !== false : true,
        }
      : null,
  };
}

export function summarizeWorkSteps(raw: unknown): WorkStepsSummary {
  const steps = (Array.isArray(raw) ? raw : [])
    .map(parseStep)
    .filter((step): step is ParsedStep => step !== null)
    .sort((left, right) => left.position - right.position);

  if (steps.length === 0) {
    return { turn: null, participantIds: [], upcomingIds: [] };
  }

  // is_current is kept by the RPCs (one per unfinished order); the first step
  // not done is the same rule, used only if the flag were missing.
  let currentIndex = steps.findIndex((step) => step.isCurrent && !step.done);
  if (currentIndex < 0) {
    currentIndex = steps.findIndex((step) => !step.done);
  }

  const current = currentIndex >= 0 ? steps[currentIndex] : null;
  const participantIds = [
    ...new Set(steps.flatMap((step) => (step.teamMemberId ? [step.teamMemberId] : []))),
  ];
  const upcomingIds = [
    ...new Set(
      steps.flatMap((step, index) =>
        !step.done && index !== currentIndex && step.teamMemberId
          ? [step.teamMemberId]
          : []
      )
    ),
  ];

  return {
    turn: {
      total: steps.length,
      done: steps.filter((step) => step.done).length,
      current: current
        ? {
            position: currentIndex + 1,
            total: steps.length,
            stage_name: current.stageName,
            stage_icon: current.stageIcon,
            team_member: current.person,
          }
        : null,
    },
    participantIds,
    upcomingIds,
  };
}

const INTERNAL_KEYS = ["work_steps", ...SEMI_JOIN_ALIASES] as const;

/** Replaces the raw embeds of a list row with the public `work_turn` field. */
export function attachWorkTurn(row: unknown): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return row;
  }
  const record = { ...(row as Record<string, unknown>) };
  const turn = summarizeWorkSteps(record.work_steps).turn;
  for (const key of INTERNAL_KEYS) {
    delete record[key];
  }
  record.work_turn = turn;
  return record;
}

// --- Labels (Spanish copy, f1 §6) ---------------------------------------------

export const RESPONSIBLE_LABEL = "Responsable";
export const UNASSIGNED_STEP_LABEL = "Sin asignar";

export function firstName(name: string | null | undefined) {
  const trimmed = (name ?? "").trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "";
}

function personFirstName(person: WorkTurnPerson | null) {
  if (!person) {
    return UNASSIGNED_STEP_LABEL;
  }
  return firstName(person.name) || "Sin nombre";
}

function personFullName(person: WorkTurnPerson | null) {
  if (!person) {
    return UNASSIGNED_STEP_LABEL;
  }
  const name = person.name.trim() || "Sin nombre";
  return person.active ? name : `${name} (inactiva)`;
}

function progress(current: WorkTurnCurrent) {
  return `${current.position}/${current.total}`;
}

/** «Raquel 2/3» for lists, grid and calendar; «Hecha 3/3» once finished. */
export function workTurnCompactLabel(turn: WorkTurn | null | undefined) {
  if (!turn) {
    return null;
  }
  if (!turn.current) {
    return `Hecha ${turn.done}/${turn.total}`;
  }
  return `${personFirstName(turn.current.team_member)} ${progress(turn.current)}`;
}

/** Full sentence for `title` and screen readers. */
export function workTurnTitle(turn: WorkTurn | null | undefined) {
  if (!turn) {
    return null;
  }
  if (!turn.current) {
    return `Secuencia hecha · ${turn.total} de ${turn.total} pasos`;
  }
  const { current } = turn;
  const who = current.team_member
    ? `Le toca a ${personFullName(current.team_member)}`
    : "Paso sin asignar";
  return `${who} · ${current.stage_name} · paso ${current.position} de ${current.total}`;
}

/** «→ Raquel» for the Sunday list of the calendar. */
export function workTurnArrowLabel(turn: WorkTurn | null | undefined) {
  if (!turn?.current) {
    return null;
  }
  return `→ ${personFirstName(turn.current.team_member)}`;
}

/** «Te toca: Preparación 2/3». */
export function myTurnLabel(current: WorkTurnCurrent) {
  return `Te toca: ${current.stage_name} ${progress(current)}`;
}

// --- Mis pedidos and Mostrador -------------------------------------------------

export const MINE_TURN_BUCKETS = [
  { id: "all", label: "Todo" },
  { id: "turn", label: "Me toca" },
  { id: "responsible", label: "Soy responsable" },
  { id: "upcoming", label: "Más adelante" },
] as const;

export type MineTurnBucketId = (typeof MINE_TURN_BUCKETS)[number]["id"];

export type MineTurnFlags = {
  /** Me toca: the current step is mine, or there is none and I am responsible. */
  turn: boolean;
  /** The current step is mine (the card says «Te toca: …»). */
  step_turn: boolean;
  /** Soy responsable: orders.assigned_team_member_id. */
  responsible: boolean;
  /** Más adelante: a later pending step is mine and the current one is not. */
  upcoming: boolean;
};

export type MineTurnOrder = MineOrder & {
  work_turn: WorkTurn | null;
  my_turn: MineTurnFlags;
};

export type MineTurnBucket = {
  id: MineTurnBucketId;
  label: string;
  count: number;
  sections: MineQueueSection[];
};

export function mineTurnFlags(
  input: { assignedTeamMemberId: string | null; summary: WorkStepsSummary },
  teamMemberId: string
): MineTurnFlags {
  const responsible = input.assignedTeamMemberId === teamMemberId;
  const current = input.summary.turn?.current ?? null;
  const stepTurn = current?.team_member?.id === teamMemberId;

  return {
    turn: stepTurn || (current === null && responsible),
    step_turn: stepTurn,
    responsible,
    upcoming: !stepTurn && input.summary.upcomingIds.includes(teamMemberId),
  };
}

/**
 * Todo for Mis pedidos and Mostrador: Soy responsable ∪ Me toca. Without a
 * sequence (`turn` absent or null) it is exactly today's rule.
 */
export function isMineOrder(
  order: { assignedTeamMemberId: string | null; turn?: WorkTurn | null },
  teamMemberId: string | null | undefined
) {
  if (!teamMemberId) {
    return false;
  }
  if (order.assignedTeamMemberId === teamMemberId) {
    return true;
  }
  return order.turn?.current?.team_member?.id === teamMemberId;
}

/** Union by id, first occurrence wins (the Map pattern of review-load.ts). */
export function mergeRowsById<T>(...lists: T[][]): T[] {
  const byId = new Map<string, T>();
  for (const list of lists) {
    for (const row of list) {
      const id =
        row && typeof row === "object" ? (row as { id?: unknown }).id : null;
      if (typeof id === "string" && !byId.has(id)) {
        byId.set(id, row);
      }
    }
  }
  return [...byId.values()];
}

/**
 * Same sections and order as groupMyOrdersQueue (Urgentes, Retrasados,
 * Entrega hoy, Listos, Resto) without its «assigned to me» filter: the caller
 * already chose the orders of the bucket.
 */
export function groupMineSections<T extends MineOrder>(
  orders: T[],
  options: { now: Date; timeZone: string }
): Array<Omit<MineQueueSection, "orders"> & { orders: T[] }> {
  const todayCivil = getZonedDayBounds(options.now, options.timeZone).date;
  const buckets: Record<MineQueueSectionId, T[]> = {
    urgent: [],
    overdue: [],
    due_today: [],
    ready: [],
    active: [],
  };

  for (const order of orders) {
    const section = classifyMineOrder(order, todayCivil, options.timeZone);
    if (section) {
      buckets[section].push(order);
    }
  }

  return MINE_QUEUE_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    orders: [...buckets[section.id]].sort(compareMineOrders),
  })).filter((section) => section.orders.length > 0);
}

export function bucketMineTurnOrders(
  orders: MineTurnOrder[],
  options: { now: Date; timeZone: string }
): MineTurnBucket[] {
  const pick: Record<MineTurnBucketId, (order: MineTurnOrder) => boolean> = {
    all: (order) => order.my_turn.responsible || order.my_turn.turn,
    turn: (order) => order.my_turn.turn,
    responsible: (order) => order.my_turn.responsible,
    upcoming: (order) => order.my_turn.upcoming,
  };

  return MINE_TURN_BUCKETS.map((bucket) => {
    const selected = mergeRowsById(orders.filter(pick[bucket.id]));
    return {
      id: bucket.id,
      label: bucket.label,
      count: selected.length,
      sections: groupMineSections(selected, options),
    };
  });
}
