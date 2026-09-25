import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { canManageOrganizationIdentity } from "@/lib/auth/membership-roles";
import {
  brandMarkUsesFill,
  buildLogoStorageKey,
  displayBusinessName,
  identityPayloadExposesSecrets,
  monogramFromName,
  publicOrganizationIdentity,
  validateLogoBytes,
} from "./branding";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("organization identity", () => {
  it("lets owner and admin edit identity and rejects manager, staff and viewer", () => {
    assert.equal(canManageOrganizationIdentity("owner"), true);
    assert.equal(canManageOrganizationIdentity("admin"), true);
    for (const role of ["manager", "staff", "viewer", null]) {
      assert.equal(canManageOrganizationIdentity(role), false);
    }
    const page = readSource("app/settings/organization/page.tsx");
    const settings = readSource("app/settings/page.tsx");
    assert.match(page, /canManageOrganizationIdentity/);
    assert.match(settings, /canManageOrganizationIdentity/);
    assert.doesNotMatch(page, /canManageSettingsCatalogs/);
  });

  it("falls back to the tenant name when business_name is empty", () => {
    assert.equal(
      displayBusinessName({ businessName: "  ", tenantName: "Sur 4 Colores" }),
      "Sur 4 Colores"
    );
    assert.equal(
      displayBusinessName({ businessName: "Imprenta Norte", tenantName: "Sur 4 Colores" }),
      "Imprenta Norte"
    );
  });

  it("keeps the header free of the slug and switches logo or monogram", () => {
    const nav = readSource("components/app-nav.tsx");
    const brand = readSource("components/tenant-brand.tsx");
    assert.doesNotMatch(nav, /tenant\.slug/);
    assert.doesNotMatch(brand, /slug/);
    assert.match(brand, /logoUrl/);
    assert.match(brand, /monogramFromName/);
    assert.match(brand, /object-contain/);
    assert.match(brand, /onError/);
    assert.equal(monogramFromName("Sur 4 Colores"), "SC");
    assert.match(nav, /display_name/);
    assert.match(nav, /logo_url/);
  });

  it("rejects SVG, oversize and unknown bytes, and accepts PNG", () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    assert.equal(validateLogoBytes(svg).ok, false);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    assert.equal(validateLogoBytes(png).ok, true);
    assert.equal(validateLogoBytes(new Uint8Array(2 * 1024 * 1024 + 1)).ok, false);
    assert.equal(validateLogoBytes(new Uint8Array([1, 2, 3, 4])).ok, false);
  });

  it("does not count branding logos in commercial file usage", () => {
    const usage = readSource(
      "supabase/migrations/20260924180000_quote_files_v1.sql"
    );
    assert.doesNotMatch(usage, /branding\//);
    const logoRoute = readSource("app/api/settings/organization/logo/route.ts");
    assert.doesNotMatch(logoRoute, /order_files|quote_files|tenant_storage_usage/);
    assert.match(logoRoute, /buildLogoStorageKey\(context\.tenant\.id/);
    assert.match(readSource("lib/tenant/branding.ts"), /branding\/\$\{tenantId\}\/logo\//);
    assert.equal(
      buildLogoStorageKey(
        "22222222-2222-4222-8222-222222222222",
        "44444444-4444-4444-8444-444444444444"
      ).startsWith("branding/"),
      true
    );
  });

  it("publishes a safe logo reference and keeps brand color theme-safe", () => {
    const identity = publicOrganizationIdentity({
      businessName: "Norte",
      tenantName: "Norte legal",
      branding: {
        brand_color: "#112233",
        logo: {
          storage_key: "branding/tenant/logo/file",
          content_type: "image/png",
        },
      },
    });
    assert.equal(identity.logo_url, "/api/tenant/logo");
    assert.equal(identity.branding.brand_color, "#112233");
    assert.equal(identityPayloadExposesSecrets(identity), false);
    assert.equal(JSON.stringify(identity).includes("storage_key"), false);
    assert.equal(brandMarkUsesFill("#112233"), true);
    assert.equal(brandMarkUsesFill("#F8FAFC"), false);
    const context = readSource("app/api/context/route.ts");
    assert.match(context, /publicOrganizationIdentity/);
    assert.doesNotMatch(context, /storage_key/);
    const org = readSource("app/api/settings/organization/route.ts");
    assert.match(org, /context\.tenant\.id/);
    assert.match(org, /tenant_id/);
    assert.doesNotMatch(org, /searchParams/);
  });
});
