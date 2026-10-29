import { MANAGEMENT_ROLES, OPERATIVE_ROLES, hasMembershipRole } from "@/lib/auth/membership-roles";
import type { NotePermissions, NoteState } from "@/lib/orders/notes/types";
import { NOTES_PER_ORDER_LIMIT } from "@/lib/orders/notes/types";

// UI hints computed on the server for the current account (main.md §3, N4).
// The RPCs remain the authority: a stale hint only ends in a 403/409.

export type NotePermissionInput = {
  role: string | null | undefined;
  userId: string;
  archived: boolean;
  note: {
    author_user_id: string;
    state: NoteState;
    pinned: boolean;
    redacted: boolean;
  };
};

export function canWriteOrderNotes(role: string | null | undefined) {
  return hasMembershipRole(role, OPERATIVE_ROLES);
}

export function canRedactOrderNotes(role: string | null | undefined) {
  return role === "owner";
}

export function canCreateOrderNote(input: {
  role: string | null | undefined;
  archived: boolean;
  total: number;
}) {
  return canWriteOrderNotes(input.role) && !input.archived && input.total < NOTES_PER_ORDER_LIMIT;
}

export function computeNotePermissions({ role, userId, archived, note }: NotePermissionInput): NotePermissions {
  const writable = canWriteOrderNotes(role) && !archived;
  const own = note.author_user_id === userId;
  return {
    edit: writable && own && note.state === "open" && !note.redacted,
    pin: writable && note.state === "open",
    resolve: writable && note.state === "open",
    reopen: writable && note.state === "resolved",
    void: writable && note.state !== "voided" && (own || hasMembershipRole(role, MANAGEMENT_ROLES)),
    // N22: works on archived orders too; repeating it flags other reasons.
    redact: canRedactOrderNotes(role),
  };
}
