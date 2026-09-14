<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cloud Agent testing rule

Before considering a feature **done** when it touches any of: APIs, DB,
migrations, RLS, orders, clients, users/memberships, or the dashboard — run:

```bash
npm run smoke
```

It must pass (exit 0). `npm run smoke` runs unit + pgTAP (RLS/tenant isolation)
+ integration (real HTTP API with real JWTs). See `docs/testing.md`. The Cursor
Environment that backs this (local Supabase + Docker, isolated from production)
is described in `docs/cursor-environment.md`.
