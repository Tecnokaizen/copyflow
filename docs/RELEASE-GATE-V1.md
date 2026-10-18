# Release gate V1 (lite)

Workflow: `.github/workflows/release-gate.yml`. Runs on **every** pull request
to `main`, on every push to `main` and on demand. No path filters, no secrets,
read-only token, databases only on `127.0.0.1`.

## Job `app`

| Control | Source |
|---|---|
| Migration guard | `ci/release-gate/check-migrations.ts` |
| Unit and integration tests (existing suite, `TZ=UTC`) | `npx tsx --test` |
| API authentication contract | `ci/release-gate/api-route-guards.test.ts` |
| Production safety | `ci/release-gate/production-safety.test.ts` |
| TypeScript, lint, build | `tsc --noEmit`, `npm run lint`, `npm run build` |

### Migration guard

Compares HEAD with the PR base (or the previous `main` commit on push):

- Applied migrations are immutable: modify, delete or rename fails.
- New versions must be later than every existing migration.
- New SQL is scanned (ignoring comments, literals and function bodies, but
  including `DO` blocks) for: `DROP` of tables, columns, functions, policies…;
  `RENAME` and column type changes; `TRUNCATE` and `DELETE`; disabling RLS or
  triggers; `GRANT … TO anon/PUBLIC`; `SECURITY DEFINER` without
  `SET search_path` (cannot be waived).

An intentional exception (for example a contract-phase drop) is declared
in the migration itself, so it is visible in review:

```sql
-- release-gate: allow destructive-ddl: contract phase, Files V1.1 stable in Production since 2026-10-20
```

Rules: `destructive-ddl`, `data-deletion`, `rls-disable`, `public-grant`.
The reason must have at least 10 characters.

### API authentication contract

Every `app/api/**/route.ts` must call `getCurrentContext`,
`requireQuotesAccess`, `requireOrganizationEditor`, `auth.getUser`, a
`CRON_SECRET` check or Stripe signature verification. Otherwise it must be
listed in `EXCEPTIONS` with a reason or a guarded delegate. Only allowlisted
routes may create the service_role client. Client components never import it.

### Production safety

- Workflows: no `pull_request_target`, no `secrets.*`, no `supabase db push`
  / `link` / `--linked` / `--project-ref`, no Vercel deploy, no credential
  names, `permissions: contents: read`, local databases only.
- Repository: Supabase project refs only in `docs/`, no committed env files,
  `.env.example` placeholders only, no live-looking keys (the public
  `supabase-demo` local JWT is allowed).

## Job `database`

Fresh local Supabase and all migrations (`db reset`), then:

1. `supabase/tests/release_gate_security_invariants.sql`: every public table
   has RLS; anon has no table privileges; authenticated cannot TRUNCATE;
   every SECURITY DEFINER routine pins `search_path`; anon can execute only
   the 4 allowlisted public RPCs (invitation preview, kiosk); private schemas
   are closed to API roles.
2. Billing suites (rollback-only): storage quota `phase22_tenant_file_limits`,
   `phase23`–`phase32` (foundation, checkout and webhook, paid onboarding,
   idempotency, provisioning state, Stripe Test/Live separation) and
   `phase53_billing_checkout_resubscribe`. `kiosk-supabase.yml` also runs
   them, but only when its path filter matches, so it cannot be a required
   check.
3. Existing suites that cover tenant isolation, roles, lifecycle and files:
   `pedido_v2`, `tamara_operational_access`, `phase17`, `phase18`,
   `phase34`, `phase35`, `phase44` (×2), `phase46`, `phase13`–`phase16`,
   `phase8`. Before this gate, 9 of them were never run in CI.

## Recommended GitHub setting (manual, repository admin)

Branch protection on `main`: require the checks
`Release gate / App (guards, tests, types, lint, build)` and
`Release gate / Database (security invariants, tenant isolation)`.

## Known gaps

- SQL suites not run in CI because they are stale or broken on current `main`:
  `phase2a_users_permissions`, `phase7_team_roles_operative`,
  `phase11_invitation_team_member_bootstrap`, `phase2cb_resend_rate_limit`
  and `quick_order_layout_v1`. `phase9_invitation_direct_signup` and
  `phase10_invitation_account_state` signal success by raising an exception,
  so they need adapting before they can run in CI.
- No authenticated end-to-end navigation: the Playwright smoke scripts use
  component fixtures and stay in their feature workflows.
- No HTTP-level cross-tenant test against a running app. Isolation is
  covered in SQL, plus the route authentication contract.
