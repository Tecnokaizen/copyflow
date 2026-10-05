# Pre-merge audit: locked client integrity

6 October 2026. Base a7fc903f0d32e77bf877ff61a3eb8ad7753c08bf; feature head before fix 89cc9082e674c4e908c5b37c214a95790049c543.

Finding QPA-01, HIGH, demonstrated on isolated PostgreSQL 17.6 with authenticated role and a rollback fixture: changing quotes.client_id after acceptance succeeded, while accepted_version.client_snapshot remained unchanged. Conversion then copied the changed client into orders. The UI disabled the client selector, but HTTP operational PATCH and direct authorized DML did not enforce that rule.

The additive migration 20261006120000_quote_locked_client_integrity.sql rejects a client change whenever the old current version is prepared or sent. It checks the complete tenant/quote/version identity, protects normal HTTP and direct authenticated writes, and leaves draft client selection and service/assignee operations available. The trigger is private; no new service_role capability. HTTP maps locked_quote_client to 409 with an actionable message.

Regression coverage: phase43_quote_conversion.sql proves draft remains editable and prepared/sent/accepted reject client changes. lib/quotes/http.test.ts proves the HTTP 409 mapping. Existing conversion/concurrency suites continue to pass.

Validation: explicit Node 22.23.2; full application suite 884 tests, 878 pass, zero fail, six existing PostgREST skips; Quotes 99/99; lint/types/Webpack pass; SQL 38/42 with the same four legacy failures; 11 concurrency executions pass; UI 458 assertions; local R2 double 7 assertions and one PUT. Clean migrations and upgrade from the prior schema pass. Next remains 16.3.4; no push, PR, merge, deploy, Production or sources changes.
