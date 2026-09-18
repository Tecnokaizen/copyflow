# Testing (smoke suite)

## Single command

```bash
npm run smoke
```

Runs three blocks in order and exits non-zero if any fails (printing which
block failed). It brings up the local Supabase stack if needed and starts the
Next.js dev server if it is not already running.

Internal blocks (also runnable on their own):

| Script | Tool | Scope |
| --- | --- | --- |
| `npm run test:unit` | Vitest | Pure logic (tenant hostname resolution, email transport) |
| `npm run test:db` | pgTAP (`supabase test db`) | RLS multi-tenant isolation at the DB layer |
| `npm run test:integration` | Vitest | Real HTTP API routes + RLS with real user JWTs |

## What it covers

- **Infra**: Supabase REST reachable, Auth health, Next.js `/` and `/auth/login`
  respond, guarded API routes reject anonymous access, migrations applied.
- **Auth + tenant**: two users/tenants created through the real flow (signup +
  `create_organization`); valid sessions; correct owner membership; `/api/me`.
- **RLS (high priority)**: with real JWTs (never service-role for the checks) a
  user cannot read or modify another tenant's data — asserted both via PostgREST
  (integration) and at the DB layer (pgTAP).
- **Orders**: create → list → open → change status → change responsible →
  persistence → activity log records the status change → add note → note shows
  up in the activity log (all through real API routes/RPCs).
- **Clients**: create, list, detail, cross-tenant isolation.
- **Dashboard**: `/api/dashboard` responds with a valid KPI structure and
  `attention_orders` present (no brittle numeric assertions).

Tests are **self-sufficient**: they create their own users/tenants/data through
the real app flow and clean up after themselves (service-role is used only for
controlled teardown, never to validate isolation). No production data, no seeds
depending on real IDs.

## What it does NOT cover (yet)

- Browser E2E / visual testing (Playwright) — deferred to V2 because the
  post-onboarding flow depends on tenant subdomain routing. See "V2" below.
- UX, layout/responsive, copy, business-rule correctness — human review.
- Exhaustive coverage, coverage percentages, load/perf.

## When an agent should run it

**Before considering a feature done** when it touches any of: APIs, DB,
migrations, RLS, orders, clients, users/memberships, or the dashboard — run:

```bash
npm run smoke
```

## V2 (next phase)

- Playwright single critical path: login/signup → onboarding → tenant → create
  order → change status → check activity, using `{slug}.localhost` (dev
  subdomain) or the `?tenant=` preview override.
- Broaden API coverage (services, team management, invitations) and add DB-layer
  pgTAP for role-based policies.
