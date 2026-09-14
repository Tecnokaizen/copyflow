import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatOperativeProfile } from "./operative-profile";

describe("formatOperativeProfile", () => {
  it("formats name, job title and area", () => {
    assert.equal(
      formatOperativeProfile({
        name: "Rubén",
        job_title: "Administrador",
        department: "Gestión",
      }),
      "Rubén · Administrador · Gestión"
    );
  });

  it("says Sin asociar when there is no associated team member", () => {
    assert.equal(formatOperativeProfile(null), "Sin asociar");
  });
});
