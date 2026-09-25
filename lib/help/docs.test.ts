import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  HELP_CONTEXT_HREFS,
  HELP_DOCS_URL,
  allHelpArticles,
  helpNeighbors,
} from "@/lib/help/catalog";
import {
  helpContentRoot,
  loadHelpDocument,
  technicalDocsAreSeparate,
} from "@/lib/help/content";
import { parseHelpMarkdown } from "@/lib/help/markdown";
import { allowsUnauthenticatedPath } from "@/lib/invitations/public-path";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";

const root = process.cwd();

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe("public help center", () => {
  it("serves app.gestcopy.com/ayuda without a session or tenant", () => {
    assert.equal(getSubdomainFromHostname("app.gestcopy.com"), null);
    assert.equal(getSubdomainFromHostname("sur4.app.gestcopy.com"), "sur4");
    assert.equal(getSubdomainFromHostname("demo.app.gestcopy.com"), "demo");
    assert.equal(allowsUnauthenticatedPath("/ayuda"), true);
    assert.equal(allowsUnauthenticatedPath("/ayuda/pedidos"), true);
    assert.equal(allowsUnauthenticatedPath("/ayuda/pedidos/crear-pedido"), true);
    assert.equal(allowsUnauthenticatedPath("/docs"), false);
    assert.equal(allowsUnauthenticatedPath("/docs/pedidos"), false);
    const gate = source("lib/tenant/inactive-gate.ts");
    assert.match(gate, /pathname === "\/ayuda"/);
    assert.match(gate, /pathname\.startsWith\("\/ayuda\/"\)/);
    assert.equal(gate.includes('pathname === "/docs"'), false);
  });

  it("does not require tenant resolution to read documentation", () => {
    const pages = [
      source("app/ayuda/page.tsx"),
      source("app/ayuda/layout.tsx"),
      source("app/ayuda/[...slug]/page.tsx"),
      source("lib/help/content.ts"),
    ].join("\n");
    assert.equal(pages.includes("getCurrentContext"), false);
    assert.equal(pages.includes("getCurrentTenant"), false);
    assert.equal(pages.includes("resolveRequestTenantSlug"), false);
    assert.equal(source("lib/help/catalog.ts").includes("https://app.gestcopy.com/ayuda"), true);
    assert.equal(pages.includes("app.gestcopy.com/docs"), false);
    assert.equal(source("app/ayuda/page.tsx").includes("canonical: HELP_DOCS_URL"), true);
  });

  it("links the catalog in order and keeps future contextual routes", () => {
    const articles = allHelpArticles();
    assert.ok(articles.length > 10);
    for (const article of articles) {
      const document = loadHelpDocument(article.slug);
      assert.ok(document, article.slug);
      assert.equal(document?.title, article.title);
    }
    const neighbors = helpNeighbors("pedidos");
    assert.equal(neighbors.previous?.slug, "panel-diario");
    assert.equal(neighbors.next?.slug, "pedidos/crear-pedido");
    for (const href of Object.values(HELP_CONTEXT_HREFS)) {
      assert.ok(href.startsWith("/ayuda/"));
      assert.ok(loadHelpDocument(href.replace("/ayuda/", "")));
    }
    assert.equal(loadHelpDocument("no-existe"), null);
    const articlePage = source("app/ayuda/[...slug]/page.tsx");
    assert.match(articlePage, /notFound\(\)/);
    assert.equal(articlePage.includes("/docs/"), false);
  });

  it("exposes Ayuda from the authenticated header", () => {
    const nav = source("components/app-nav.tsx");
    assert.match(nav, /Ayuda/);
    assert.match(nav, /target="_blank"/);
    assert.match(nav, /rel="noopener noreferrer"/);
    assert.equal(HELP_DOCS_URL, "https://app.gestcopy.com/ayuda");
    assert.equal(nav.includes("sur4.app.gestcopy.com/ayuda"), false);
    assert.match(nav, /HELP_DOCS_URL/);
  });

  it("does not serve the public help center from /docs", () => {
    assert.equal(
      source("app/ayuda/page.tsx").includes("Centro de ayuda Gestcopy"),
      true
    );
    let publicDocsRoute = false;
    try {
      source("app/docs/page.tsx");
      publicDocsRoute = true;
    } catch {
      publicDocsRoute = false;
    }
    assert.equal(publicDocsRoute, false);
  });

  it("keeps technical repository docs out of the public source", () => {
    const helpRoot = helpContentRoot();
    assert.equal(technicalDocsAreSeparate(helpRoot), true);
    assert.equal(path.basename(path.dirname(helpRoot)), "content");
    const loader = source("lib/help/content.ts");
    assert.match(loader, /content", "help"/);
    assert.equal(loader.includes('path.join(process.cwd(), "docs")'), false);
  });

  it("keeps a collapsible navigation for small screens", () => {
    const center = source("components/help/help-center.tsx");
    assert.match(center, /<details/);
    assert.match(center, /lg:hidden/);
    assert.match(center, /hidden gap-4 lg:grid/);
  });

  it("keeps public markdown as escaped text", () => {
    const blocks = parseHelpMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n'
    );
    assert.deepEqual(
      blocks.map((block) => (block.type === "p" ? block.text : block.type)),
      ['<script>alert(1)</script>', '<img src=x onerror="alert(1)">']
    );
    const ui = source("components/help/help-center.tsx");
    assert.equal(ui.includes("dangerouslySetInnerHTML"), false);
    assert.equal(source("lib/help/markdown.ts").includes("dangerouslySetInnerHTML"), false);
  });

  it("does not publish internal or unreleased product details", () => {
    const forbidden = /kiosk|sur4|service_role|stripe_secret|storage_key|cron_secret/i;
    const files = walk(helpContentRoot());
    assert.ok(files.length > 0);
    for (const file of files) {
      assert.equal(forbidden.test(readFileSync(file, "utf8")), false, file);
    }
  });
});
