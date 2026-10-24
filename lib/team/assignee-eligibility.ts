/**
 * One rule for the person in charge of an order or a quote: same tenant,
 * active and able to receive orders. The database enforces it on every write
 * (public.team_member_is_assignable, migration 20261022130000); selectors list
 * only eligible people, and an assignment that already exists is kept even
 * when that person stops being eligible.
 */

/** Message raised by tg_assignee_eligibility_guard (SQLSTATE 22023). */
export const ASSIGNEE_NOT_ELIGIBLE_DB_MESSAGE = "team member cannot receive orders";

type DatabaseErrorLike = {
  code?: string | null;
  message?: string | null;
} | null | undefined;

export function isAssigneeNotEligibleError(error: DatabaseErrorLike): boolean {
  return (
    error?.code === "22023" &&
    (error.message ?? "").includes(ASSIGNEE_NOT_ELIGIBLE_DB_MESSAGE)
  );
}

export type AssigneeOption = {
  id: string;
  name: string;
  /** The current assignee is no longer eligible: shown, but not selectable. */
  unavailable?: boolean;
};

/**
 * Selector options plus the current assignee when it is no longer eligible,
 * so the select shows who has the order instead of an empty value.
 */
export function assigneeOptionsWithCurrent(
  options: readonly { id: string; name: string }[],
  current: { id: string | null | undefined; name?: string | null }
): AssigneeOption[] {
  const list: AssigneeOption[] = options.map(({ id, name }) => ({ id, name }));
  if (!current.id || list.some((option) => option.id === current.id)) {
    return list;
  }
  const name = current.name?.trim() || "Responsable actual";
  return [...list, { id: current.id, name: `${name} (no disponible)`, unavailable: true }];
}
