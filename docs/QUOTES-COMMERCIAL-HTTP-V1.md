# Presupuestos V1 — contratos HTTP comerciales

Fecha: 5 de octubre de 2026. Rama `feat/quotes-commercial-v1`. Este bloque parte del commit SQL `62d03be` y no incluye PDF, R2, envío, aceptación/rechazo, canal público, mensajería ni conversión comercial a pedido.

## Autoridad y aislamiento

- El tenant se resuelve exclusivamente desde la sesión y el host mediante `requireQuotesAccess`; ningún `tenant_id` del cliente se acepta.
- Sin sesión se responde `401`. Un rol sin acceso responde `403`; la feature `quotes` desactivada responde `404`.
- Las lecturas filtran explícitamente por `tenant_id` y además quedan sujetas a RLS.
- Antes de llamar a cualquier RPC comercial, HTTP comprueba que el presupuesto pertenece al tenant resuelto por el host; esto también protege a usuarios con memberships en varios tenants. Las mutaciones comerciales llaman a `ensure_quote_draft_v1`, `save_quote_draft_v1`, `create_quote_version_v1` y `prepare_quote_version_v1`. TypeScript no vuelve a calcular importes.
- `reference`, `version_number`, importes, timestamps y `created_by` aportados por el cliente se descartan al construir los argumentos RPC.
- Los decimales de PostgreSQL se exponen como cadenas para no introducir redondeos binarios en el contrato HTTP.
- Los snapshots completos de vendedor y cliente no se seleccionan ni se devuelven. La UI recibe únicamente el contacto editable del agregado y la información comercial necesaria.

## Endpoints

### `GET /api/quotes`

Conserva la envolvente y los campos anteriores. Cada elemento de `quotes` añade:

- `current_version_id`, `current_version_number`, `current_version_state`;
- `accepted_version_id`;
- `subtotal`, `tax_total`, `total`, `currency`;
- `issue_date`, `valid_until`, `prices_include_tax`;
- contacto y facturación comercial;
- `converted_order_id` además del objeto `converted_order` existente.

La versión actual se resuelve mediante una relación embebida en la misma consulta; no hay una consulta por presupuesto.

### `POST /api/quotes`

Conserva el alta operativa existente. El editor comercial asegura la primera draft con `POST /api/quotes/:id/draft`. No se añade una segunda mutación al alta existente ni se introduce un alta comercial no atómica.

### `GET /api/quotes/:id`

Devuelve:

```json
{
  "tenant": "tenant-slug",
  "quote": {},
  "current_version": {},
  "items": [],
  "versions": []
}
```

`versions` es un historial resumido. `current_version` contiene la cabecera, importes, estado, fechas y concurrencia, pero no snapshots internos. La carga usa un número fijo de consultas, independientemente del número de versiones o partidas.

### `POST /api/quotes/:id/draft`

Asegura la primera versión draft de forma idempotente. Devuelve `201` si la crea y `200` con `replayed: true` si ya existía. Cuando existe historia bloqueada sin draft, responde `409 new_version_required`; se debe usar el endpoint de nueva versión.

### `PUT /api/quotes/:id/draft`

Payload:

```json
{
  "version_id": "uuid",
  "expected_row_version": 4,
  "header": {
    "title": "Congreso",
    "description": "<p>Material</p>",
    "terms": "<p>Pago a 30 días</p>",
    "contact_name": "Raquel",
    "contact_email": "raquel@example.com",
    "contact_phone": null,
    "billing_name": "ANFRE",
    "tax_id": null,
    "billing_address": null,
    "issue_date": "2026-10-05",
    "valid_until": "2026-10-31",
    "currency": "EUR",
    "prices_include_tax": true
  },
  "items": [
    {
      "concept": "Roll Up",
      "description": null,
      "quantity": "2",
      "unit": "ud",
      "unit_price": "105.000000",
      "discount_percent": "0",
      "tax_rate": "21"
    }
  ]
}
```

La cabecera es reemplazo completo. Admite hasta 500 partidas. El resultado devuelve la versión ya recalculada por PostgreSQL y una proyección `totals`. IDs, posiciones e importes calculados que aparezcan en las partidas de entrada no pasan a la RPC.

### `POST /api/quotes/:id/versions`

No necesita body. Clona la última versión `prepared` o `sent` mediante la RPC. Devuelve `201` al crear. Un doble submit que encuentre la draft recién creada devuelve `200`, `created: false` y `replayed: true` con esa misma versión; no duplica historia ni numeración.

### `POST /api/quotes/:id/prepare`

Payload:

```json
{
  "version_id": "uuid",
  "expected_row_version": 5
}
```

Devuelve `quote`, `prepared_version` y `totals`. La RPC recalcula y bloquea. Este endpoint no escribe `status_id`, `sent_at`, PDF ni Files.

## Errores

| HTTP | `code` | Significado |
|---:|---|---|
| 400 | `invalid` | Forma, fecha, moneda, texto o decimal inválido |
| 401 | — | No autenticado |
| 403 | — | Rol autenticado sin acceso operativo |
| 404 | `not_found` | Presupuesto/versión inexistente, ajeno o feature no disponible |
| 409 | `stale_row_version` | Edición concurrente; incluye `current_row_version` cuando la RPC lo aporta |
| 409 | `immutable_version` | La versión ya está preparada o enviada |
| 409 | `new_version_required` / `draft_exists` | Transición incompatible con la historia actual |
| 422 | `items_required` / `history_required` / `business_invariant` | Regla comercial incumplida |
| 500 | `database_error` / `invalid_rpc_result` | Error interno sin filtrar detalles SQL |

## Compatibilidad y límite deliberado

El `PATCH /api/quotes/:id` operativo anterior se conserva para no romper la UI existente. El editor comercial debe usar exclusivamente `PUT /draft`; por ello, el siguiente bloque debe migrar la pantalla de edición a estos contratos y dejar los campos documentales fuera del PATCH legado. Las versiones y partidas preparadas/enviadas siguen siendo inmutables en PostgreSQL, incluso para llamadas directas o intentos de reutilizar las RPC.

El alta operativa y el inicio de edición comercial son acciones explícitas independientes. Una futura alta comercial atómica requeriría una RPC específica y debe evaluarse como cambio SQL separado.

## Cobertura

Los tests TypeScript cubren allowlists, saneado, fechas, monedas, decimales, límite de partidas, DTOs, importes como strings, conflicto 409, taxonomía de errores, compatibilidad del listado y wiring de los cuatro RPC. `phase40_quote_commercial.sql` y su suite de concurrencia cubren con usuarios autenticados el aislamiento entre tenants, roles, feature gate, importes manipulados, concurrencia, clonado, preparación, no-envío, inmutabilidad y relaciones cross-tenant.

## Validación final del bloque

Entorno: Node 22.23.2 y npm 10.9.8.

| Gate | Resultado |
|---|---|
| Tests focalizados de contratos Quotes | 51/51 PASS (todas las suites Quotes) |
| Suite completa de aplicación en UTC | 836/836 PASS, 0 omitidos |
| ESLint | PASS |
| TypeScript `--noEmit` | PASS |
| Build Next con Webpack | PASS; incluye `/draft`, `/versions` y `/prepare` |
| Build normal con Turbopack | FAIL ambiental reproducido: `react-day-picker/src/style.css`, creación de proceso y apertura de puerto `EPERM` |
| Migraciones desde cero en Supabase local aislado | PASS |
| `phase40_quote_commercial.sql` | PASS |
| Concurrencia comercial | PASS: 8 ensures, 2 saves concurrentes y 24 clones concurrentes |
| Matriz de concurrencia completa | 8/8 PASS, incluida la variante staff |
| Suites SQL secuenciales del workflow tras phase40 | 22/22 PASS |

La matriz SQL completa del commit `62d03be` permanece en 35/39 PASS, con los mismos cuatro fallos preexistentes documentados en `QUOTES-COMMERCIAL-VALIDATION.md`. La matriz completa se ha repetido tras reconstruir desde cero: 35/39 PASS, con los mismos cuatro fallos. El bloque HTTP no modifica migraciones ni suites SQL.

Se añaden siete tests que ejecutan los handlers HTTP con dependencias controladas, además de los tests de validación y DTOs. Cubren rechazo previo por auth/rol/feature, alcance por host incluso con varias memberships, totales autoritativos, conflictos, versión ajena, preparación sin envío, doble submit e historial resumido. La suite SQL verifica las reglas contra PostgreSQL real.


## Estado entregado

- Commit SQL core: `62d03bedb4f6a3910a8ed7c6896b8f439c8827af`.
- HTTP, contratos y tests quedan locales sin commit, push, merge ni despliegue.
- Se preservan las tres migraciones SQL originales. `kiosk-supabase.yml` es el pipeline general histórico: ejecuta Settings, Billing, Onboarding, Quotes y hardening además de Kiosk.
- Logs de esta revalidación: `/tmp/quotes-resume-*.log`, `/tmp/quotes-resume-sql.json`, `/tmp/quotes-resume-sql/`, `/tmp/quotes-resume-concurrent/`.
- Siguiente bloque: Draft Editor UI, con conflictos de versión visibles y distinción entre prepared y sent.
