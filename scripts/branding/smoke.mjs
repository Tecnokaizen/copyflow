// Run against a production build or Preview:
// BRANDING_SMOKE_URL=https://preview.example node --test scripts/branding/smoke.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const base = process.env.BRANDING_SMOKE_URL;
assert.ok(base, "Set BRANDING_SMOKE_URL to a running build or Vercel Preview");
const legacy = /Next\.js (?:and Supabase Starter Kit|Supabase Starter)|Deploy to Vercel|The fastest way to build apps with Next\.js and Supabase/i;
const pages = [
  ["/", "Gestcopy"],
  ["/auth/login", "Iniciar sesión · Gestcopy"],
  ["/auth/sign-up", "Gestcopy"],
  ["/ayuda", "Centro de ayuda · Gestcopy"],
];

for (const [path, title] of pages) {
  test(`${path}: global Gestcopy metadata and publicly accessible icons`, async () => {
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal(html.match(/<title>([^<]+)<\/title>/)?.[1], title);
    assert.match(html, /<html[^>]+lang="es"/);
    assert.doesNotMatch(html, legacy);
    assert.match(html, /<meta name="application-name" content="Gestcopy"/);
    if (path !== "/ayuda") {
      assert.match(html, /<meta name="description" content="Gestiona los pedidos, presupuestos, clientes y equipo de tu copistería en un solo lugar con Gestcopy\."/);
    }

    for (const [rel, file] of [["icon", "favicon.ico"], ["icon", "icon.png"], ["apple-touch-icon", "apple-icon.png"]]) {
      const link = [...html.matchAll(/<link\b[^>]*>/g)].map(([tag]) => tag)
        .find((tag) => tag.includes(`rel="${rel}"`) && tag.includes(`/${file}`));
      assert.ok(link, `${file} must be linked in the rendered document`);
      const href = link.match(/href="([^"]+)"/)?.[1].replaceAll("&amp;", "&");
      const asset = await fetch(new URL(href, base), { redirect: "manual" });
      assert.equal(asset.status, 200, `${file} must work without authentication`);
      assert.match(asset.headers.get("content-type"), /^image\//);
      assert.deepEqual(Buffer.from(await asset.arrayBuffer()), await readFile(`app/${file}`));
    }
  });
}

test("sharing images use the committed Gestcopy assets", async () => {
  for (const file of ["opengraph-image.png", "twitter-image.png"]) {
    const response = await fetch(new URL(`/${file}`, base), { redirect: "manual" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(`app/${file}`));
  }
});
