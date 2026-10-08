import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { canManageOrganizationIdentity } from "@/lib/auth/membership-roles";
import {
  activeNavAccent,
  brandColorAlpha,
  brandMarkUsesFill,
  buildLogoStorageKey,
  displayBusinessName,
  identityPayloadExposesSecrets,
  logoDeclaredSizeIsAllowed,
  mergeBranding,
  monogramFromName,
  parseBusinessName,
  parseQuoteFooter,
  publicOrganizationIdentity,
  quoteFooterFromBranding,
  settingsOrganizationIdentity,
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
    assert.equal(logoDeclaredSizeIsAllowed(0), false);
    assert.equal(logoDeclaredSizeIsAllowed(2 * 1024 * 1024), true);
    assert.equal(logoDeclaredSizeIsAllowed(2 * 1024 * 1024 + 1), false);
    const name = parseBusinessName(` ${"a".repeat(120)} `);
    assert.equal(name.ok, true);
    if (name.ok) assert.equal(name.value?.length, 120);
    const empty = parseBusinessName("   ");
    assert.equal(empty.ok, true);
    if (empty.ok) assert.equal(empty.value, null);
    assert.equal(parseBusinessName("a".repeat(121)).ok, false);
    const save = readSource("lib/tenant/organization.ts");
    assert.match(save, /\.select\("tenant_id"\)/);
    assert.match(save, /\.maybeSingle\(\)/);
    assert.match(save, /Organization settings row was not updated/);
    assert.doesNotMatch(save, /\.upsert\(|\.insert\(/);
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
    assert.equal(brandColorAlpha("#facc15", 0.1), "rgba(250, 204, 21, 0.1)");
    assert.equal(brandColorAlpha("yellow", 0.1), null);
    const plain = activeNavAccent(null);
    assert.equal(plain.className, "bg-primary/10 text-primary");
    assert.equal(plain.style, undefined);
    const branded = activeNavAccent("#facc15");
    assert.equal(branded.className, "text-foreground");
    assert.equal(branded.style?.backgroundColor, "rgba(250, 204, 21, 0.1)");
    assert.match(branded.style?.boxShadow ?? "", /#facc15/);
    assert.equal("color" in (branded.style ?? {}), false);
    const brand = readSource("components/tenant-brand.tsx");
    assert.match(brand, /border-l-2/);
    assert.match(brand, /borderLeftColor: brandColor/);
    assert.doesNotMatch(brand, /color: brandColor/);
    const nav = readSource("components/app-nav.tsx");
    assert.match(nav, /activeNavAccent/);
    assert.equal(brandMarkUsesFill("#112233"), true);
    assert.equal(brandMarkUsesFill("#F8FAFC"), false);
    const context = readSource("app/api/context/route.ts");
    assert.match(context, /publicOrganizationIdentity/);
    assert.doesNotMatch(context, /storage_key/);
    const org = readSource("app/api/settings/organization/route.ts");
    assert.match(org, /context\.tenant\.id/);
    assert.match(org, /tenant_id/);
    assert.doesNotMatch(org, /searchParams/);
    assert.doesNotMatch(context, /quote_footer/);
    assert.equal("quote_footer" in identity, false);
    assert.equal("quote_footer" in identity.branding, false);
  });

  it("stores a quote footer without exposing logo secrets or other tenants", () => {
    const logo = {
      storage_key: "branding/tenant-a/logo/file",
      content_type: "image/png" as const,
    };
    const tenantA = {
      brand_color: "#112233",
      logo,
      quote_footer: "Pie A",
    };
    const tenantB = {
      brand_color: "#abcdef",
      logo: { storage_key: "branding/tenant-b/logo/file", content_type: "image/png" },
      quote_footer: "Pie B",
    };
    const saved = parseQuoteFooter("  SUR 4\r\nC/ Ejemplo  ");
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.value, "SUR 4\nC/ Ejemplo");
    const next = mergeBranding(tenantA, { quoteFooter: saved.value });
    assert.equal(next.quote_footer, "SUR 4\nC/ Ejemplo");
    assert.equal(next.brand_color, "#112233");
    assert.deepEqual(next.logo, logo);
    assert.equal(tenantA.quote_footer, "Pie A");
    assert.equal(tenantB.quote_footer, "Pie B");
    assert.equal(quoteFooterFromBranding(next), "SUR 4\nC/ Ejemplo");

    const cleared = mergeBranding(next, { quoteFooter: null });
    assert.equal("quote_footer" in cleared, false);
    assert.equal(cleared.brand_color, "#112233");
    assert.deepEqual(cleared.logo, logo);
    const blank = parseQuoteFooter("   \n  ");
    assert.equal(blank.ok, true);
    if (blank.ok) assert.equal(blank.value, null);

    assert.equal(parseQuoteFooter("a".repeat(401)).ok, false);
    assert.equal(parseQuoteFooter("1\n2\n3\n4\n5").ok, false);
    assert.equal(parseQuoteFooter(12).ok, false);
    assert.equal(parseQuoteFooter("1\n2\n3\n4").ok, true);

    const settings = settingsOrganizationIdentity({
      businessName: "Norte",
      tenantName: "Norte",
      branding: next,
    });
    assert.equal(settings.quote_footer, "SUR 4\nC/ Ejemplo");
    assert.equal(identityPayloadExposesSecrets(settings), false);
    assert.equal(JSON.stringify(settings).includes("storage_key"), false);
    assert.equal(JSON.stringify(publicOrganizationIdentity({
      businessName: "Norte",
      tenantName: "Norte",
      branding: next,
    })).includes("quote_footer"), false);
    const model = readSource("lib/quotes/pdf/model.ts");
    const render = readSource("lib/quotes/pdf/render.tsx");
    assert.match(model, /This projection is a whitelist/);
    assert.match(model, /quoteFooterFromBranding\(seller\.branding\)/);
    assert.doesNotMatch(model, /tenant_settings/);
    assert.doesNotMatch(render, /tenant_settings/);
    assert.match(render, /PDFDocument\.load/);
  });
});
