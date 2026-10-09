import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultSingleCatalogId,
  groupQuickOrderPrimaryFields,
  isQuickCreateMode,
  shouldStayOnCreateForm,
  showEntryChannelInMainForm,
  showEntryChannelInMoreOptions,
  suggestedAssigneeId,
  quickFieldIsAvailable,
} from "./create-form-layout";

describe("create order form layout", () => {
  it("groups only configured primary fields in croquis order without duplicating priority", () => {
    const groups = groupQuickOrderPrimaryFields([
      "description", "priority", "service", "client", "store",
      "due_at", "assigned_team_member", "files", "file_status",
    ]);
    assert.deepEqual(groups.identification, ["store", "due_at"]);
    assert.deepEqual(groups.assignment, ["client", "assigned_team_member", "priority"]);
    assert.equal(groups.description, true);
    assert.deepEqual(groups.additional, ["service", "files", "file_status"]);
    assert.equal(groups.assignment.filter(field => field === "priority").length, 1);
  });

  it("preserves tenant placements when fields are omitted from primary", () => {
    const groups = groupQuickOrderPrimaryFields(["client", "notes"]);
    assert.deepEqual(groups.identification, []);
    assert.deepEqual(groups.assignment, ["client"]);
    assert.equal(groups.description, false);
    assert.deepEqual(groups.additional, ["notes"]);
  });

  it("keeps the full form on Pedidos and stays on Pedido rápido after creating", () => {
    assert.equal(isQuickCreateMode("full"), false);
    assert.equal(isQuickCreateMode("quick"), true);
    assert.equal(shouldStayOnCreateForm("full"), false);
    assert.equal(shouldStayOnCreateForm("quick"), true);
  });

  it("moves the channel picker to Más opciones only in quick mode with several channels", () => {
    assert.equal(showEntryChannelInMainForm("full", 2), true);
    assert.equal(showEntryChannelInMainForm("quick", 2), false);
    assert.equal(showEntryChannelInMoreOptions("quick", 2), true);
    assert.equal(showEntryChannelInMoreOptions("quick", 1), false);
    assert.equal(showEntryChannelInMoreOptions("full", 3), false);
    assert.equal(defaultSingleCatalogId([{ id: "ch-1" }]), "ch-1");
    assert.equal(
      defaultSingleCatalogId([{ id: "ch-1" }, { id: "ch-2" }]),
      null
    );
  });

  it("autoselects the staff Personal card without imposing it on managers", () => {
    const staffId = "member-staff";
    assert.equal(
      suggestedAssigneeId({
        currentAssigneeId: "",
        role: "staff",
        sessionTeamMemberId: staffId,
        availableMemberIds: [staffId, "member-b"],
      }),
      staffId
    );
    assert.equal(
      suggestedAssigneeId({
        currentAssigneeId: "",
        role: "manager",
        sessionTeamMemberId: staffId,
        availableMemberIds: [staffId],
      }),
      ""
    );
    assert.equal(
      suggestedAssigneeId({
        currentAssigneeId: "member-b",
        role: "staff",
        sessionTeamMemberId: staffId,
        availableMemberIds: [staffId, "member-b"],
      }),
      "member-b"
    );
    assert.equal(
      suggestedAssigneeId({
        currentAssigneeId: "",
        role: "staff",
        sessionTeamMemberId: staffId,
        availableMemberIds: ["member-b"],
      }),
      ""
    );
  });

  it("keeps legacy catalog availability independent from placement", () => {
    const counts = {
      stores: 0,
      entryChannels: 1,
      orderContexts: 0,
    };

    assert.equal(quickFieldIsAvailable("client", counts), true);
    assert.equal(quickFieldIsAvailable("service", counts), true);
    assert.equal(quickFieldIsAvailable("store", counts), false);
    assert.equal(quickFieldIsAvailable("entry_channel", counts), false);
    assert.equal(quickFieldIsAvailable("order_context", counts), false);
    assert.equal(
      quickFieldIsAvailable("entry_channel", {
        ...counts,
        entryChannels: 2,
      }),
      true
    );
  });
});
