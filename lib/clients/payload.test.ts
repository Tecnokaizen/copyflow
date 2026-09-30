import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseClientPayload } from "./payload";
import { toClientPayload, type ClientFormData } from "./types";

const form: ClientFormData = {
  customer_type_id: "",
  name: "Lucía Navarro",
  contact_name: "",
  company_name: "",
  tax_id: "",
  email: "",
  phone: "",
  notes: "Llama por la tarde",
};

describe("client notes", () => {
  it("writes sanitized HTML and strips an API payload", () => {
    const written = toClientPayload(form);
    assert.equal(written.notes, "<p>Llama por la tarde</p>");

    const parsed = parseClientPayload({
      name: "Lucía Navarro",
      notes: '<p>Interna</p><script>alert(1)</script><img src=x onerror=alert(1)>',
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.data.notes, "<p>Interna</p>");
  });
});
