# E2E V0 — Staging real

Batería Playwright contra el despliegue real de Staging: tenant `e2e`,
Supabase Staging (`fmmfsbhcwxkaszrrarpw`), bucket R2 `gestcopy-files-staging`.
Sin mocks de API. Production queda fuera por diseño (ver *Seguridad*).

## Recorridos (un pedido sintético por ejecución)

| Flujo | Pasos | Verificación |
|---|---|---|
| Pedidos | login → `GESTCOPY · Panel diario` → `Nuevo cliente` → `/orders?create=1` (cliente, título, entrega «Mañana») → listado `filter=all` + búsqueda → recarga | `POST /api/clients` 200, `POST /api/orders` 201, referencia `E2E-NNNN`, fila con título/referencia/cliente/`Recibido`, entrega a las 18:00, `GET /api/orders/{id}` |
| Archivos R2 | `Añadir archivos` → `.txt` de ~600 B con contenido único → recarga → `Descargar` | INIT 201 con URL presignada al bucket de Staging, PUT 200 en R2, COMPLETE 200 `status: ready` (HEAD en servidor), fila tras recarga, SHA-256 descargado = subido |
| Cobro parcial | `Definir total` 100 € → `Registrar entrega a cuenta` 20 € → recarga → `Cambiar estado` En proceso → Listo → Entregado (`Confirmar entrega`) → recarga | `PATCH …/total` (`unpaid`), `POST …/payments` (`partial`, pendiente `80.00`), UI `100,00 €` / `20,00 €` / `80,00 €` / `Parcial` antes y después de recargar, `ready_at` y `delivered_at` fijados, el saldo parcial se mantiene tras Entregado. Nunca archiva. |

Reglas de negocio aplicadas tal cual existen hoy: el pago exige total previo,
no hay grafo de transiciones (cualquier estado activo), «Entregado» (`closed`)
es un estado y no implica cobro completo, archivar es una acción aparte.

Identificadores únicos por ejecución (`20261014T183044Z-196a`) en nombre de
cliente, email `e2e-client-…@example.com`, título de pedido y nombre de archivo.
No se borra nada: cada ejecución añade un cliente, un pedido y un archivo al
tenant `e2e`.

## Ficheros

| Fichero | Función |
|---|---|
| `e2e/staging/guard.ts` | Interlock: host `e2e.preview.app.gestcopy.com`, Supabase Staging por SHA-256 del ref, bucket Staging; clasifica el tráfico del navegador |
| `e2e/staging/guard.test.ts` | Pruebas del interlock y del redactor (entran en el Release Gate) |
| `e2e/staging/redact.ts` | Redacción de secretos, JWT, `Bearer` y firmas presignadas en todo artefacto |
| `e2e/staging/harness.ts` | Navegador, preflight (TLS / Deployment Protection), egress, artefactos |
| `e2e/staging/run.ts` | Los tres recorridos |
| `e2e/staging/seed.ts` | Aprovisionamiento idempotente del tenant `e2e` (solo terminal de confianza) |
| `.github/workflows/e2e-staging.yml` | Workflow manual (`workflow_dispatch`, entorno `staging`) |

Playwright `1.58.2` se instala fuera de `package.json`, igual que en
`pedido-v2.yml` (sin dependencias nuevas).

## Seguridad

- **Rechazo previo a cualquier red** (`resolveStagingTarget`): URL Supabase
  distinta de Staging (Production se identifica explícitamente), host distinto
  de `e2e.preview.app.gestcopy.com` (dominios Production, `demo`, `audit`,
  `sur4` rechazados), bucket Production, `NEXT_PUBLIC_SUPABASE_URL` /
  `SUPABASE_URL` discordantes, `VERCEL_ENV=production`, email no sintético.
  Los refs se comparan por hash: no hay refs fuera de `docs/`.
- **Egress del navegador**: `context.route` solo *clasifica*; lo permitido
  continúa sin tocar (`route.continue()`), nunca se fabrica una respuesta.
  Production → se aborta y la ejecución falla aunque el flujo pase.
  Además se comprueba que la URL presignada de INIT, el PUT y la descarga
  apuntan al bucket `gestcopy-files-staging`.
- **Sin service_role en el navegador**: el navegador usa solo la sesión del
  usuario sintético. La clave secreta solo la usa `seed.ts`, en un proceso Node
  local; el workflow de CI no la recibe.
- **Secretos fuera de artefactos**: no se graban trazas Playwright (incluyen
  cookies, tokens y cuerpos). Artefactos: `steps.log`, `network.json`
  (método, ruta sin query, estado, duración), `console-errors.json`,
  `blocked-requests.json`, `report.json` y capturas en fallo. Todo pasa por
  `Redactor` y al final se escanea cada fichero (también los PNG) en busca de
  los valores secretos; si aparece uno, la ejecución falla.
- **Deployment Protection**: el secreto de bypass se canjea una sola vez por la
  cookie `_vercel_jwt` del host; no viaja en las peticiones de página ni a
  Supabase/R2.

## Release Gate

`ci/release-gate/production-safety.ts` mantiene la prohibición de `secrets.*`
para todos los workflows salvo `.github/workflows/e2e-staging.yml`, que además
debe cumplir: solo `workflow_dispatch`, `environment: staging`, solo los
secretos `E2E_USER_PASSWORD` y `VERCEL_AUTOMATION_BYPASS_SECRET`, token de solo
lectura y el resto de reglas (sin nombres de credenciales Production, sin
comandos remotos). Probado en `production-safety.test.ts`.

## Puesta en marcha (una vez)

1. **Vercel** (proyecto `copyflow`): añadir el dominio
   `e2e.preview.app.gestcopy.com` con Git branch `gestcopy-staging`, como
   `demo`/`audit`. Crear un *Protection Bypass for Automation*.
2. **Seed** desde un terminal de confianza, con `.env.e2e.local` (ignorado
   por git):

   ```bash
   set -a; source .env.e2e.local; set +a; npx tsx e2e/staging/seed.ts
   ```

   Variables: `E2E_BASE_URL`, `E2E_SUPABASE_URL`, `E2E_R2_BUCKET`,
   `E2E_USER_EMAIL` (`e2e-owner@example.com`), `E2E_USER_PASSWORD` (≥ 16),
   `E2E_SUPABASE_SECRET_KEY` (Staging). Usa
   `create_internal_organization_v1` (tenant, membership owner, ajustes,
   estados, canales, tienda). Repetirlo solo resincroniza la contraseña.
   Rechaza continuar si el usuario tiene memberships fuera de `e2e`.
3. **GitHub** → Environments → `staging`: restringir ramas/revisores;
   variables `E2E_BASE_URL`, `E2E_SUPABASE_URL`, `E2E_R2_BUCKET`,
   `E2E_USER_EMAIL`; secretos `E2E_USER_PASSWORD`,
   `VERCEL_AUTOMATION_BYPASS_SECRET`.

## Ejecución

```bash
npm install --prefix /tmp/e2e-browser --no-audit --no-fund --ignore-scripts playwright@1.58.2
node /tmp/e2e-browser/node_modules/playwright/cli.js install chromium
set -a; source .env.e2e.local; set +a
PLAYWRIGHT_MODULE=/tmp/e2e-browser/node_modules/playwright/index.mjs npx tsx e2e/staging/run.ts
```

Salida: `0` todo pasa, `1` fallo de flujo, `2` rechazo de configuración.
Artefactos en `e2e-artifacts/<run-id>/` (ignorado por git) o en
`E2E_ARTIFACTS_DIR`. `E2E_HEADED=1` abre el navegador.

## Automatización futura

Cuando sea estable: ejecutar tras cada despliegue de Staging y usarlo como
condición para promocionar a Production. Sigue separado del Release Gate,
que protege el código en cada PR sin secretos.
