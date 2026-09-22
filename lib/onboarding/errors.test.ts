import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ONBOARDING_ERROR_CODES,
  mapOnboardingPostgresError,
  onboardingUserFacingError,
} from "./errors";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("onboarding error mapping", () => {
  it("maps duplicate slug (23505) to tenant_slug_conflict", () => {
    const mapped = mapOnboardingPostgresError("23505");
    assert.equal(mapped.status, 409);
    assert.equal(mapped.code, ONBOARDING_ERROR_CODES.TENANT_SLUG_CONFLICT);
    assert.equal(mapped.error, "Tenant slug already exists");
    assert.equal(
      onboardingUserFacingError(mapped.status, mapped),
      "Ese identificador ya está en uso."
    );
  });

  it("maps organization limit (54000) without slug-in-use copy", () => {
    const mapped = mapOnboardingPostgresError("54000");
    assert.equal(mapped.status, 409);
    assert.equal(
      mapped.code,
      ONBOARDING_ERROR_CODES.ORGANIZATION_LIMIT_REACHED
    );
    assert.equal(mapped.error, "Organization limit reached");

    const ui = onboardingUserFacingError(mapped.status, mapped);
    assert.equal(
      ui,
      "Esta cuenta ya administra una organización y no puede crear otra desde este proceso."
    );
    assert.doesNotMatch(ui, /identificador ya está en uso/i);
  });

  it("uses a generic conflict message for unknown 409", () => {
    const ui = onboardingUserFacingError(409, {
      error: "Something else",
    });
    assert.equal(ui, "No se pudo completar la operación por un conflicto.");
    assert.doesNotMatch(ui, /identificador ya está en uso/i);
  });

  it("preserves non-conflict status semantics", () => {
    assert.equal(mapOnboardingPostgresError("28000").status, 401);
    assert.equal(mapOnboardingPostgresError("22023").status, 400);
    assert.equal(mapOnboardingPostgresError("23514").status, 400);
    assert.equal(mapOnboardingPostgresError("XX000").status, 500);
    assert.equal(
      onboardingUserFacingError(401, { error: "Unauthorized" }),
      "Tu sesión no es válida. Vuelve a iniciar sesión."
    );
    assert.equal(
      onboardingUserFacingError(500, { error: "Could not create organization" }),
      "No se pudo crear la organización."
    );
  });

  it("API route returns stable codes and form maps by code not bare 409", () => {
    const route = readSource("app/api/onboarding/route.ts");
    assert.match(route, /mapOnboardingPostgresError/);
    assert.match(route, /code: mapped\.code/);

    const form = readSource("components/onboarding/onboarding-form.tsx");
    assert.match(form, /onboardingUserFacingError/);
    assert.doesNotMatch(form, /function errorFromStatus/);
    assert.doesNotMatch(
      form,
      /if \(status === 409\)[\s\S]*identificador ya está en uso/
    );
  });
});
