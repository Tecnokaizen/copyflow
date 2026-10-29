import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canCreateOrderNote, computeNotePermissions } from "./permissions";

const me = "user-me";
const other = "user-other";

function perms(role: string, author: string, state: "open" | "resolved" | "voided" = "open", archived = false, redacted = false) {
  return computeNotePermissions({
    role,
    userId: me,
    archived,
    note: { author_user_id: author, state, pinned: false, redacted },
  });
}

describe("post-it permissions (main.md §3, N4)", () => {
  it("edits only own open notes, for every operative role", () => {
    for (const role of ["owner", "admin", "manager", "staff"]) {
      assert.equal(perms(role, me).edit, true, role);
      assert.equal(perms(role, other).edit, false, role);
      assert.equal(perms(role, me, "resolved").edit, false, role);
      assert.equal(perms(role, me, "open", false, true).edit, false, role);
    }
  });

  it("pins, resolves and reopens any note unless viewer", () => {
    for (const role of ["owner", "admin", "manager", "staff"]) {
      assert.equal(perms(role, other).pin, true);
      assert.equal(perms(role, other).resolve, true);
      assert.equal(perms(role, other, "resolved").reopen, true);
      assert.equal(perms(role, other, "resolved").resolve, false);
      assert.equal(perms(role, other, "voided").pin, false);
    }
    assert.deepEqual(perms("viewer", me), { edit: false, pin: false, resolve: false, reopen: false, void: false, redact: false });
  });

  it("voids any note as owner, admin or manager; staff only its own", () => {
    for (const role of ["owner", "admin", "manager"]) assert.equal(perms(role, other).void, true, role);
    assert.equal(perms("staff", other).void, false);
    assert.equal(perms("staff", me).void, true);
    assert.equal(perms("staff", me, "resolved").void, true);
    assert.equal(perms("owner", me, "voided").void, false);
  });

  it("redacts only as owner, also on archived orders", () => {
    assert.equal(perms("owner", other, "voided", true).redact, true);
    for (const role of ["admin", "manager", "staff", "viewer"]) assert.equal(perms(role, me).redact, false, role);
  });

  it("archived orders are read-only", () => {
    const archived = perms("owner", me, "open", true);
    assert.deepEqual({ ...archived, redact: false }, { edit: false, pin: false, resolve: false, reopen: false, void: false, redact: false });
  });

  it("creates while operative, not archived and under 200 notes", () => {
    assert.equal(canCreateOrderNote({ role: "staff", archived: false, total: 199 }), true);
    assert.equal(canCreateOrderNote({ role: "staff", archived: false, total: 200 }), false);
    assert.equal(canCreateOrderNote({ role: "viewer", archived: false, total: 0 }), false);
    assert.equal(canCreateOrderNote({ role: "owner", archived: true, total: 0 }), false);
  });
});
