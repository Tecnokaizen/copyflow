/** Real AppNav header with deterministic /api/context doubles. No production access.
 * Tenant logo (#58) next to the Pro early-access badge (#105): wide 3:1, tall 1:3
 * and no logo; badge on/off; 320–1440 px; light/dark. Asserts no overflow, no
 * overlap, proportional logos within their size limits, and no page errors.
 * Node 22: PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/tenant-header-ui-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";

import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), "tenant-header-"));
const out = process.env.SMOKE_OUTPUT_DIR || temp;
const svg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#2563eb"/></svg>`;
const LOGOS = { "wide.svg": svg(600, 200), "tall.svg": svg(200, 600) };
await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ThemeProvider} from 'next-themes';
    import {AppNav} from './components/app-nav';
    const params = new URLSearchParams(location.search);
    createRoot(document.getElementById('root')).render(<ThemeProvider attribute="class" forcedTheme={params.get('theme') || 'light'}><div className="px-6 md:px-8 lg:px-10"><AppNav/></div></ThemeProvider>);`, resolveDir: root, loader: "tsx" },
  jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), bundle: true,
  outfile: path.join(temp, "app.js"), platform: "browser",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "next-browser-boundary", setup(api) {
    api.onResolve({ filter: /^next\/(navigation|link)$/ }, ({ path }) => ({ path, namespace: "test-next" }));
    api.onLoad({ filter: /.*/, namespace: "test-next" }, ({ path: module }) => ({ contents: module.endsWith("navigation")
      ? `export const useSearchParams = () => new URLSearchParams(location.search);
        export const usePathname = () => '/orders';
        export const useRouter = () => ({push(){}, replace(){}, refresh(){}});`
      : `import React from 'react'; export default function Link({href,children,prefetch,...props}) {return React.createElement('a',{...props,href},children)}`,
      resolveDir: root,
    }));
  } }],
});
execFileSync(process.execPath, ["node_modules/tailwindcss/lib/cli.js", "-i", "app/globals.css", "-o", path.join(temp, "style.css")], { cwd: root, stdio: "pipe" });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/app.js" || pathname === "/style.css") {
    res.setHeader("Content-Type", pathname.endsWith("js") ? "text/javascript" : "text/css");
    res.end(await readFile(path.join(temp, pathname.slice(1))));
  } else if (pathname.startsWith("/logos/") && LOGOS[pathname.slice(7)]) {
    res.setHeader("Content-Type", "image/svg+xml");
    res.end(LOGOS[pathname.slice(7)]);
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
const logos = { wide: "/logos/wide.svg", tall: "/logos/tall.svg", none: null };
for (const [logoName, logoUrl] of Object.entries(logos)) {
  for (const pro of [true, false]) {
    for (const width of [320, 375, 768, 1440]) {
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({ viewport: { width, height: 700 } });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/api/**", async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname === "/api/context") {
            return route.fulfill({ json: {
              user: { id: "u1", email: "owner@example.com", full_name: "Persona Propietaria" },
              tenant: { id: "t1", slug: "demo", name: "Copistería Demo", display_name: "Copistería Demo con nombre largo", logo_url: logoUrl, branding: { brand_color: "#1d4ed8" } },
              membership: { role: "owner", active: true },
              team_member: null,
              features: { quotes: true },
              early_access: pro ? { pro: true, voice_orders: { status: "planned" } } : { pro: false },
            } });
          }
          return route.fulfill({ json: {} });
        });
        await page.goto(`${url}/?theme=${theme}`);
        await page.locator("header").first().waitFor();
        if (pro) await page.getByRole("link", { name: /Pro/ }).first().waitFor();
        if (logoUrl) {
          await page.waitForFunction(() => { const i = document.querySelector("header img"); return !!i && i.complete && i.naturalWidth > 0; });
        }
        const m = await page.evaluate(() => {
          const header = document.querySelector("header");
          const row = header.firstElementChild;
          const img = header.querySelector("img");
          const badge = [...header.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/pro");
          const controls = row.lastElementChild.getBoundingClientRect();
          const r = (el) => el ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect()) : null;
          return {
            overflow: document.documentElement.scrollWidth > window.innerWidth,
            rowHeight: Math.round(row.getBoundingClientRect().height),
            img: r(img), badge: r(badge),
            controlsRight: Math.round(controls.right), viewport: window.innerWidth,
            badgeOverlapsLogo: !!(img && badge && badge.getBoundingClientRect().left < img.getBoundingClientRect().right - 0.5),
          };
        });
        const label = `${logoName}/${pro ? "pro" : "no-pro"}/${width}/${theme}`;
        if (theme === "light" && (width === 320 || width === 375 || width === 1440)) await page.screenshot({ path: path.join(out, `tenant-header-${logoName}-${pro ? "pro" : "nopro"}-${width}.png`), clip: { x: 0, y: 0, width, height: 90 } });
        const fails = [];
        const ok = (cond, msg) => { if (!cond) fails.push(msg); };
        ok(m.overflow === false, "horizontal overflow");
        ok(m.controlsRight <= m.viewport, "controls off-screen");
        ok(m.badgeOverlapsLogo === false, "badge overlaps logo");
        if (pro) ok(m.badge && m.badge.x + m.badge.w <= m.viewport, "Pro badge not visible");
        if (logoUrl) {
          const maxW = width >= 640 ? 160 : 112; const maxH = width >= 640 ? 40 : 36;
          ok(m.img.w <= maxW && m.img.h <= maxH, `logo ${m.img.w}x${m.img.h} exceeds ${maxW}x${maxH}`);
          const ratio = m.img.w / m.img.h;
          if (logoName === "wide") ok(ratio > 2.5 && ratio < 3.5, `wide ratio ${ratio.toFixed(2)}`);
          if (logoName === "tall") ok(ratio > 0.25 && ratio < 0.45, `tall ratio ${ratio.toFixed(2)}`);
        }
        ok(errors.length === 0, "page errors: " + errors.join(" | "));
        results.push({ label, img: m.img, badge: m.badge, rowHeight: m.rowHeight, fails });
        await page.close();
      }
    }
  }
}
await browser.close(); server.close();
const failed = results.filter((r) => r.fails.length);
console.log(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", cases: results.length, failed: failed.map((r) => ({ label: r.label, fails: r.fails, img: r.img, badge: r.badge })), artifacts: out }, null, 2));
if (failed.length) process.exit(1);
