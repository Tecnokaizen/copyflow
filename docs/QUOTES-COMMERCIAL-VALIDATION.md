# Validación — Presupuestos V1 SQL comercial

Fecha: 5 de octubre de 2026. Rama `feat/quotes-commercial-v1`. Base original: `a7fc903f0d32e77bf877ff61a3eb8ad7753c08bf`. Cambios locales listos para revisión; sin push, PR, merge ni deploy.

Worktree: `/Users/tecnokaizen/.codex/.chatgpt-projects/g-p-6a9c6326398c8191b6de8c0dc2b669b2/gestcopy-quotes-commercial-v1`.

## Entorno y aislamiento

- Node v22.23.2, npm 10.9.8, usando el runtime 22.x declarado por el repositorio.
- Supabase CLI 2.117.0, la misma versión fijada en CI. PostgreSQL local de Supabase, configurado para major 17. psql nativo 18.6.
- Proyecto local exclusivo `quotes-commercial-v1`, puerto PostgreSQL 55422. Configuración de prueba en `/tmp/gestcopy-quotes-sql`. Se preservó el Supabase local existente `copyflow` y todos los servicios externos.
- GitHub origin/main se consultó antes de crear el worktree: coincidía con la auditoría a7fc903; no había diferencias de main que adaptar.
- `sources/` y el checkout original con cambios del usuario permanecen intactos.

## Gates de aplicación

| Gate | Baseline | Final |
|---|---|---|
| Tests `TZ=UTC npx tsx --test` | 818/818 PASS, 0 omitidos | 818/818 PASS, 0 omitidos en Node 22 |
| `npm run lint` | PASS, exit 0 | PASS, exit 0 |
| `npx tsc --noEmit` | PASS, exit 0 | PASS, exit 0 |
| `npm run build` (Turbopack) | FAIL: EPERM al abrir un puerto del proceso CSS | Mismo FAIL ambiental en Node 22: `react-day-picker/src/style.css`, `binding to a port` |
| `npm run build -- --webpack` | PASS, exit 0 | PASS, exit 0 en Node 22 |
| Migraciones Supabase desde cero | PASS hasta main | PASS incluyendo las tres nuevas |
| Diff y sintaxis de shell | — | `git diff --check` y `bash -n` PASS |

El primer baseline bajo Europe/Madrid dio 818 tests: 811 aprobados, 1 fallido y 6 omitidos. El fallo era la fecha esperada en `builds the explicit public DTO without tenant fields` (kiosk), que supone UTC. Repetir con UTC aprobó los 818. La ejecución final usa UTC para reproducir CI.

`npm ci --ignore-scripts` falló antes de editar durante la validación original con npm 11, que detectó dependencias opcionales ausentes del lockfile (@next/swc y sharp, entre otras). Se instaló mediante `npm install --ignore-scripts --package-lock=false`; package.json y package-lock.json no se modificaron. La repetición final usa Node 22.23.2. Turbopack conserva el EPERM ambiental incluso fuera del sandbox de comandos; Webpack compila, comprueba tipos y prerenderiza correctamente.

## Suites SQL

Baseline: 34 de 38 PASS. Final: 35 de 39 PASS, incluida la nueva phase40. Las cuatro restantes reproducen los mismos fallos preexistentes; ninguna suite existente que pasaba dejó de pasar.

Cada suite se ejecutó contra localhost con ON_ERROR_STOP. Para evitar colisiones de fixtures de suites históricas con COMMIT, se suprimieron únicamente sus fronteras transaccionales de nivel superior en el input temporal y se envolvió cada ejecución en BEGIN/ROLLBACK. No se editaron archivos existentes. Las suites phase9 y phase10 emiten `ERROR: PASS ...` deliberadamente al terminar; se registran como PASS semántico, conservando el exit 3 en los logs.

| Suite | Baseline | Final |
|---|---|---|
| `pedido_v2.sql` | PASS | PASS |
| `phase10_invitation_account_state.sql` | PASS | PASS |
| `phase11_invitation_team_member_bootstrap.sql` | FAIL | FAIL |
| `phase12_kiosk_public_orders.sql` | PASS | PASS |
| `phase13_order_lifecycle.sql` | PASS | PASS |
| `phase14_order_archived_immutability.sql` | PASS | PASS |
| `phase15_order_concurrency.sql` | PASS | PASS |
| `phase16_order_concurrency_cleanup.sql` | PASS | PASS |
| `phase17_order_files.sql` | PASS | PASS |
| `phase18_external_folder_url.sql` | PASS | PASS |
| `phase19_order_status_settings.sql` | PASS | PASS |
| `phase20_settings_catalogs.sql` | PASS | PASS |
| `phase21_services_catalog.sql` | PASS | PASS |
| `phase22_tenant_file_limits.sql` | PASS | PASS |
| `phase23_billing_foundation.sql` | PASS | PASS |
| `phase24_billing_checkout_webhook.sql` | PASS | PASS |
| `phase25_paid_onboarding.sql` | PASS | PASS |
| `phase26_paid_onboarding_security.sql` | PASS | PASS |
| `phase27_paid_onboarding_concurrency.sql` | PASS | PASS |
| `phase28_paid_onboarding_checkout_idempotency.sql` | PASS | PASS |
| `phase29_paid_onboarding_checkout_creating_recovery.sql` | PASS | PASS |
| `phase2a_users_permissions.sql` | FAIL | FAIL |
| `phase2cb_resend_rate_limit.sql` | PASS | PASS |
| `phase30_order_statuses_require_initial_security_definer.sql` | PASS | PASS |
| `phase31_tenant_provisioning_state.sql` | PASS | PASS |
| `phase32_stripe_live_hardening.sql` | PASS | PASS |
| `phase33_quotes_v1.sql` | PASS | PASS |
| `phase34_quotes_operational_access.sql` | PASS | PASS |
| `phase35_quote_files.sql` | PASS | PASS |
| `phase36_truncate_privilege_hardening.sql` | PASS | PASS |
| `phase37_security_definer_trigger_hardening.sql` | PASS | PASS |
| `phase38_rich_text_quote_title.sql` | PASS | PASS |
| `phase38_tenant_ownership_transfer.sql` | PASS | PASS |
| `phase39_membership_mutation_lock.sql` | PASS | PASS |
| `phase40_quote_commercial.sql` | Nueva | PASS |
| `phase7_team_roles_operative.sql` | FAIL | FAIL |
| `phase8_invitation_personal.sql` | PASS | PASS |
| `phase9_invitation_direct_signup.sql` | PASS | PASS |
| `quick_order_layout_v1.sql` | FAIL | FAIL |

Fallos preexistentes confirmados sobre main y tras el cambio:

- `phase11_invitation_team_member_bootstrap.sql`: `ERROR:  function min(uuid) does not exist`.
- `phase2a_users_permissions.sql`: `ERROR:  FAIL J: expected 42501 got GTI01`.
- `phase7_team_roles_operative.sql`: `ERROR:  not authenticated`.
- `quick_order_layout_v1.sql`: `ERROR:  query returned no rows`.

quick_order_layout_v1 requiere tenants DEMO/SUR4 del seed; se verificó sin seed, por lo que no encuentra esos fixtures. Los otros tres fallos son del contrato actual de las suites antiguas. No se corrigieron dentro del bloque comercial.

## Concurrencia

Las seis suites concurrentes existentes pasaron también en el baseline de main. En la validación final pasan las seis, la nueva comercial y la variante staff de presupuestos: ocho ejecuciones, todas exit 0.

Para ejecutar los scripts de CI en macOS se usaron adaptadores temporales de timeout y date +%s%3N en `/tmp/quotes-local-bin`. Se utilizó psql nativo; el wrapper inicial de Docker no compartía barreras de archivos con el host. Kiosk se ejecutó después de su suite SQL con fixtures persistidos, conforme al orden de CI. Estos adaptadores no forman parte de los cambios productivos.

| Suite | Exit final |
|---|---|
| `phase12_kiosk_concurrency.sh` | 0 |
| `phase19_order_status_concurrency.sh` | 0 |
| `phase22_storage_quota_concurrency.sh` | 0 |
| `phase33_quotes_concurrency.sh` | 0 |
| `phase35_quote_files_concurrency.sh` | 0 |
| `phase39_membership_mutation_deadlock.sh` | 0 |
| `phase40_quote_commercial_concurrency.sh` | 0 |
| `phase33_quotes_concurrency.sh (staff)` | 0 |

La nueva concurrencia comprueba 8 ensures simultáneas -> una sola draft; 2 saves con el mismo expected_row_version -> un éxito y un conflicto; 3 rondas de 8 clones simultáneos -> una nueva versión por ronda, 4 version_number distintos en total y una sola draft final. Espera explícitamente todos los procesos y limpia sus fixtures locales.

## Cobertura comercial

Aislamiento con partidas reales en dos tenants; feature OFF; owner/admin/manager/staff frente a viewer; membership revocada y anon; DML directo prohibido; helpers privados; FK de tenant y presupuesto, incluyendo PDF; IVA incluido/excluido; descuentos; importes del cliente ignorados; redondeo por partida y tax_breakdown; prepared/sent y partidas inmutables; una draft y números únicos; guardados concurrentes; rollback de payload inválido; snapshots; clonado de prepared y sent histórico; backfill draft/pending/sent/accepted/rejected, idempotencia, total 0 sin partidas; no renumeración de presupuestos ni pedidos; accepted_version solo sent; preparar no marca enviado.

Fixture ANFRE: líneas de 210 + 303 + 66 + 51 = 630 IVA incluido. Base redondeada por partidas 520.66; IVA 109.34. Se utiliza únicamente en tests.

## Revisión y límites

Se revisaron completos las tres migraciones, ambas suites nuevas, el cambio de CI y el documento de contratos. Solo hay archivos nuevos y una modificación del workflow; no cambian migraciones aplicadas ni archivos de aplicación. No se añadieron contratos TypeScript porque los actuales siguen compilando.

La UI no consume todavía el núcleo comercial. El envío explícito y PDF requieren un diseño compatible con la inmutabilidad; prepared -> sent está bloqueado en este bloque. El snapshot vendedor no inventa datos fiscales que no existen en tenant_settings. El backfill incrementa quotes.row_version y toma locks; evaluar duración antes de una aplicación futura autorizada.

Logs completos de la validación original disponibles en `/tmp/quotes-final-*.log`, `/tmp/quotes-final-sql/`, `/tmp/quotes-final-concurrency/` y sus equivalentes de baseline. Este informe conserva los resultados aunque los temporales se eliminen. La repetición de cierre con Node 22 confirmó 818/818 tests, lint, TypeScript y Webpack; reconstruyó desde cero el Supabase local aislado y volvió a aprobar `phase40_quote_commercial.sql` y su suite de concurrencia.
