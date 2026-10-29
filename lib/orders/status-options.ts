/**
 * Status selectors in the order detail ("Cambiar estado" and the edit form)
 * offer only active statuses: the database refuses a change to an inactive
 * one (change_order_status_v2 filters `active = true`). An order that already
 * has an inactive status keeps showing it, marked and not selectable, so the
 * select never displays a different value from the stored one.
 */

export type StatusOptionSource = {
  id: string;
  name: string;
  /** Missing means active (older payloads did not send the flag). */
  active?: boolean;
};

export type StatusOption = {
  id: string;
  name: string;
  /** The order's current status is deactivated: shown, but not selectable. */
  unavailable?: boolean;
};

export const INACTIVE_STATUS_SUFFIX = " (desactivado)";

export function isSelectableStatus(status: StatusOptionSource): boolean {
  return status.active !== false;
}

export function statusOptionsWithCurrent(
  statuses: readonly StatusOptionSource[],
  current: { id: string | null | undefined; name?: string | null }
): StatusOption[] {
  const options: StatusOption[] = [];

  for (const status of statuses) {
    if (isSelectableStatus(status)) {
      options.push({ id: status.id, name: status.name });
    } else if (status.id === current.id) {
      options.push({
        id: status.id,
        name: `${status.name}${INACTIVE_STATUS_SUFFIX}`,
        unavailable: true,
      });
    }
  }

  // Catalogue not loaded yet (or out of date): keep the stored value visible
  // without claiming it is deactivated.
  if (current.id && !statuses.some((status) => status.id === current.id)) {
    const name = current.name?.trim() || "Estado actual";
    options.push({ id: current.id, name, unavailable: true });
  }

  return options;
}
