# Presupuestos V2.1: diseño técnico de la modalidad «Por cantidades»

**Decisiones:** [ADR 2026-10-18](adr/2026-10-18-quotes-quantity-options-v2-1.md) (D1–D12).

**Base:** `main` `410228e`, PR #128 `1593c62`.

**Estado:** diseño aprobado; implementación pendiente, por PR (§7).

Las rutas son del repositorio. Las migraciones se citan con estas abreviaturas:

| Abreviatura | Migración |
| --- | --- |
| CS | `20261005170000_quote_commercial_schema` |
| CI | `…171000_quote_commercial_invariants` |
| CR | `…172000_quote_commercial_rpcs_backfill` |
| PD | `…173000_quote_pdf_documents` |
| CT | `20261006100000_quote_commercial_transitions` |
| AC | `…110000_quote_accepted_conversion` |
| DC | `…130000_quote_draft_creation` |
| CO | `20261007190056_commercial_operations_v1` |
| CN | `20261016110000_quote_conversion_notes_v1` |
| OL | `20261016130000_order_lines_v1_db` (PR #128) |

## 1. Punto de partida

| Capa | Hoy | Referencia |
| --- | --- | --- |
| Importe por línea | `quote_line_amounts_v1`: base × (1 − dto), con o sin IVA; tres redondeos a 2 decimales | CI:3-11 |
| Total de versión | Trigger: suma de **todas** las líneas más `tax_breakdown` por tipo; `NOT NULL ≥ 0` | CT:36-44; CS:42-44 |
| Proyección | `quotes.subtotal/tax_total/total` `NOT NULL default 0` copian la versión actual | CS:13-15; CI:85-106 |
| Inmutabilidad | Versión editable solo en `draft`; líneas `immutable_items` | CT:4-54; CI:64 |
| Aceptación | `transition_quote_v1(…, 'accept')`: versión completa, sin selección | CT:101-144 |
| Revisión | `create_quote_version_v1` clona la última versión preparada o enviada | DC:197-232 |
| Conversión | `orders.total_amount = v_version.total`; notas heredadas; sin líneas | CN:36-64, 119-191 |
| PDF | Columna «Importe» y bloque de totales incondicional | `lib/quotes/pdf/render.tsx:109-122` |
| Tipos | `mapQuote`/`mapQuoteVersion`/`mapQuoteItem` devuelven `null` sin totales, y el presupuesto desaparece del listado | `lib/quotes/types.ts:349-369, 457-473, 522-546` |
| Editor | Sin cálculo en cliente; «Duplicar partida» crea una línea **sumada** | `lib/quotes/editor.ts:34-48` |
| Test de alcance de #125 | Prohíbe `is_optional|alternativ|option_group` en el editor | `components/quotes/quote-draft-form.test.ts:53-54` |
| Dashboard | Solo conteos | `lib/dashboard/quotes.ts` |

## 2. Modelo de datos

### E1: modalidad y grupos

**Modalidad**

- `quote_versions.pricing_mode text not null default 'standard' check (pricing_mode in ('standard','quantity_options'))`.
- `quotes.pricing_mode`: misma definición. Es la proyección de la versión actual, en el trigger existente (CI:85-106).

**Grupo de cada línea**

- `quote_items.option_group integer null check (option_group > 0)`.
- **Coherencia:** `standard ⇒ null`; `quantity_options ⇒ not null`.
- **Numeración:** los grupos son contiguos (1..n) y su orden sale de `min(position)`.
- **Cabecera del grupo:** el concepto de su primera alternativa.

**Totales por modalidad**

- `quote_versions.subtotal/tax_total/total`: `drop not null`.
- Se añade `check ((pricing_mode = 'standard') = (subtotal is not null and tax_total is not null and total is not null))`. Se mantiene `≥ 0`.
- `quotes.*`: `drop not null`; la proyección copia `NULL`.
- **`tg_quote_version_guard_v1`:**
  - en `standard`, sin cambios;
  - en `quantity_options`, los totales quedan a `NULL` y `tax_breakdown` a `'[]'`;
  - cambiar de modalidad con líneas existentes exige reemplazarlas en el mismo guardado, igual que hace hoy `replace_items_before_tax_mode`.

**Límites de texto en `quote_items`** (alineados con la app y con #128):

- concept ≤ 2000, description ≤ 10000, unit ≤ 100.
- Se crean `NOT VALID` y se validan tras el precheck de longitudes en Staging y Production. Así una llamada directa a la RPC no puede producir una línea que después no se pueda convertir.

**Feature:** fila `quote_quantity_options` en `features`, sin overrides, por tanto desactivada.

### E2: aceptación

**`quote_acceptances`:** una fila por presupuesto aceptado en `quantity_options`.

- **Columnas:**
  - `tenant_id`, `quote_id`, `quote_version_id`;
  - `accepted_subtotal`, `accepted_tax_total`, `accepted_total` (`numeric(20,2) not null ≥ 0`);
  - `accepted_tax_breakdown jsonb array`;
  - `created_by`, `created_at`.
- **Claves y relaciones:**
  - PK `(tenant_id, quote_id)`;
  - FK `(tenant_id, quote_id, quote_version_id)` → `quote_versions(tenant_id, quote_id, id)`.

**`quote_acceptance_items`:**

- **Columnas:** `tenant_id`, `quote_id`, `quote_version_id`, `quote_item_id`, `option_group`.
- **Restricciones:**
  - `unique (quote_version_id, quote_item_id)`;
  - `unique (quote_version_id, option_group)`, que impone como máximo una alternativa por grupo;
  - FK `(tenant_id, quote_version_id, quote_item_id)` → `quote_items(tenant_id, quote_version_id, id)`, con un `unique` nuevo en `quote_items`.

**Inmutabilidad y acceso de las dos tablas:**

- Trigger que prohíbe UPDATE y DELETE.
- INSERT solo con el marcador GUC de la RPC.
- RLS de SELECT para owner, admin, manager y staff con la feature `quotes`.
- Sin grants de escritura a `authenticated` ni a `anon`.

**Importes aceptados:** son la suma de las líneas seleccionadas, ya redondeadas, más el desglose por tipo. Se calculan una vez y quedan persistidos, sin recálculo.

**En `standard` no se escribe nada.** La versión aceptada ya es inmutable y sus totales son los importes aceptados. No hay backfill.

### E3: líneas de pedido con origen (fase B de #128, unificada)

**Columnas de origen en `order_items`** (nullables):

- `source_quote_id`, `source_quote_version_id`, `source_quote_item_id`.
- FK compuestas por `tenant_id` hacia `quotes` y `quote_items`.
- **Inmutables:** el guard de #128 rechaza cambiarlas una vez fijadas.
- `NULL` en las líneas añadidas a mano (D7).

**`replace_order_items_v1` conserva la referencia:**

- acepta un `id` opcional por línea;
- un `id` existente se actualiza en el sitio y conserva su origen;
- una línea sin `id` se inserta sin origen;
- las líneas omitidas se borran;
- el cliente nunca puede fijar los campos de origen (`unknown_field`).

Este contrato cambia antes de que exista una API o una UI de líneas (PR C), así que no tiene coste de compatibilidad.

**Ningún trigger propaga cambios del pedido al presupuesto** (D7).

## 3. Reglas de negocio

1. **Una sola fuente de lo aceptado.** `quote_accepted_lines_v1(p_quote_id)` (interna y revocada) devuelve las líneas aceptadas:
   - `standard`: todas las de `accepted_version_id`;
   - `quantity_options`: las de `quote_acceptance_items`.

   Es lo único que usan la conversión, los importes aceptados y los listados (D6).
2. **Aceptar en `quantity_options`:** `accept_quote_options_v1(p_quote_id, p_version_id, p_expected_row_version, p_item_ids uuid[])`.
   - **Concurrencia:** misma cerradura que hoy (`quote_commercial_lock_v1`, `FOR UPDATE`).
   - **Validaciones:** modalidad `quantity_options`; versión actual en `sent`; código `sent`.
   - **Selección:**
     - ítems de esa versión y de ese tenant;
     - como máximo uno por grupo;
     - al menos uno en total;
     - se admite la aceptación parcial.
   - **Escritura:** inserta la cabecera y las líneas, y aplica la transición `accept` con el GUC existente.
   - **Repetición:** la misma selección es un replay (`replayed: true`); otra distinta devuelve `accepted_selection_immutable`.
   - **Aceptaciones simultáneas:** la cerradura y las restricciones `unique` hacen que solo una gane; la otra recibe conflict o replay.
3. **`transition_quote_v1('accept')` sobre `quantity_options`** devuelve `selection_required`. En `standard` no cambia.
4. **Conversión** (`convert_quote_to_order`, la firma vigente de CN, atómica):
   - **Igual que hoy:** cerradura, precondiciones, replay sin `row_version`, título, notas públicas e internas (D9) y `metadata`.
   - **Pedido:**
     - `total_mode = 'manual'`;
     - `prices_include_tax` de la versión;
     - `total_amount` = importes aceptados: `version.total` en `standard`, `accepted_total` en `quantity_options`.
   - **Líneas:** `order_items` desde `quote_accepted_lines_v1`, con el origen y los flags de #128.
   - **Totales:** el rollup de #128 calcula `items_total` con la misma función fiscal, así que coincide con `total_amount`; se verifica en tests.
   - **Por qué `manual`:** en `items` el importe no se podría editar hasta que exista la interfaz de líneas (PR C de pedidos), lo que sería una regresión.
   - **Presupuestos antiguos** sin líneas (backfill CR:151-170): se convierten como hoy, con 0 líneas y total igual al de la versión.
5. **Revisión:** `create_quote_version_v1` clona `pricing_mode` y `option_group`. La aceptación pertenece a la versión, así que una revisión nueva no la tiene.
6. **Flag desactivado** (D5):
   - **Siempre disponibles** (solo se exige `quotes`): listado, ficha, PDF (GET) e impresión.
   - **Bloqueados** (`feature_disabled`): crear o editar en `quantity_options`, y crear revisiones en esa modalidad.
   - **Siguen funcionando:** las transiciones de documentos ya en curso (enviar, aceptar con selección, convertir), para no dejar procesos comerciales a medias.
   - **Integridad:** la semántica la fija la modalidad guardada, nunca el flag. Nunca se vuelve a sumar las alternativas.

## 4. API y tipos (E4)

**Tipos** (`lib/quotes/types.ts`)

- `QuoteVersion` y `QuoteRecord`:
  - `pricing_mode`;
  - totales `string | null` **solo** si `pricing_mode = 'quantity_options'`; los mappers siguen siendo estrictos en `standard`;
  - `accepted_amounts`, si existe.
- `QuoteItem` y `QuoteDraftItemInput`: `option_group`.

**Parsers** (`lib/quotes/payload.ts`)

- `pricing_mode` en la cabecera.
- `option_group` como 8.º campo, válido solo en `quantity_options`.
- Se actualizan los tests que fijan 7 claves.

**Rutas**

- `POST /api/quotes/[id]/accept`: cuerpo `{version_id, expected_row_version, item_ids?}`.
  - Con `item_ids` usa la RPC nueva.
  - En `standard`, si llegan `item_ids`, devuelve 422.
  - Errores: `selection_required`, `accepted_selection_immutable` e `invalid_selection`.
- `GET /api/quotes/[id]`: devuelve modalidad, grupos, selección e importes aceptados.
- `GET /api/quotes` y `list_client_quotes`: devuelven la modalidad y el total, o `null` junto con los importes aceptados. **Ningún presupuesto se omite.**

**Banda de origen del pedido** (`order_source_quote_v2`): el importe es el aceptado.

**Acceso:** todo sigue tras `requireQuotesAccess`. La feature nueva solo se exige en las operaciones de §3.6.

## 5. Interfaz (E5) y PDF (E6)

### Editor

**Selector**

- Segmentado en la cabecera de `QuoteDraftForm`, visible solo con el flag.
- Fuera de borrador se muestra como etiqueta.

**Modalidad «Por cantidades»**

- Las líneas se ven agrupadas, con «Añadir concepto» (grupo nuevo) y «Añadir cantidad» (alternativa en el grupo).
- «Duplicar partida» crea una alternativa en el mismo grupo, reutilizando `duplicateEditorItem`.
- Los importes por línea vienen del servidor.
- La tarjeta de totales muestra «Opciones alternativas: sin total acumulado».

**Cambio de modalidad**

- De Estándar a Por cantidades: cada línea pasa a ser su propio grupo.
- De Por cantidades a Estándar: pide confirmación («todas las cantidades se sumarán»).

**Test de alcance de #125:** se reescribe a propósito (D11).

### Diálogos y listados

- **Aceptar:** el mismo `QuoteDialog`, con un selector por grupo (radio con las alternativas y «Ninguna»). Valida en el cliente al menos una selección; la validación de verdad es la del servidor.
- **Convertir:** muestra las alternativas aceptadas y su importe.
- **Listados** (`quotes-list.tsx`, `client-quotes.tsx`, revisiones y banda de origen): «Por cantidades» o «Aceptado: X €».

### PDF

- `render.tsx` tiene una rama por `pricing_mode`. **`standard` no cambia (byte a byte para el mismo input).**
- En `quantity_options`:
  - una sección por concepto;
  - tabla con cantidad, precio unitario, descuento, IVA, base, cuota e importe;
  - **sin bloque de totales**;
  - aviso: «Opciones alternativas: los importes no son acumulativos. Indique la opción elegida para cada concepto.»
- Condiciones, footer, numeración y generación idempotente en R2 no cambian.
- `quote_pdf_source_v1` devuelve la modalidad y los grupos.

## 6. PR #128 y orden de integración

### Estado real de #128 (18/10/2026)

| Aspecto | Estado |
| --- | --- |
| Head y base | Head `1593c62`. Base efectiva `65afb10`; no incluye 5 commits de `main`: #123, #124, #126, #132 y #131 |
| Mergeabilidad | `git merge-tree` con `main` `410228e` limpio. `MERGEABLE`/`CLEAN` |
| CI | 5/5 en verde, pero **sobre la base antigua** |
| Revisiones | Ninguna |
| Migración | `20261016130000`, posterior a la última de `main` (`20261016125500`). **No está aplicada en Staging ni en Production**, así que se puede corregir en su propio fichero |
| Pendiente antes del merge | (1) Merge de `main`, sin force. (2) **Límites de texto** (D8): OL:94-97 y OL:407-411, de 500 / 5000 / 40 a 2000 / 10000 / 100, con sus tests. (3) Corregir `docs/ORDER-LINES-V1-DB.md`: base `a6d1846` → real; hotfix `123500` → `125000`; registrar las «decisiones A–F», que hoy no están en el repositorio. (4) CI completo |
| Compatibilidad con la guarda NB `125000` | Correcta: la exige como precondición (OL:43-54) |

### Orden de migraciones

Combina el orden del sprint con V2.1:

```text
#128  20261016130000  (se corrige en su fichero, no está aplicada en ningún sitio)
A1    overrides auditables       } sprint comercial,
B1    #90 renumerada             } con timestamps asignados
C1    plan Pro                   } por sus sesiones
D1    protección del webhook     }
E1    quotes_pricing_mode_v1         (V2.1, PR E1)
E2    quote_acceptances_v1           (V2.1, PR E2)
E3    order_lines_quote_conversion   (V2.1 + fase B de #128, PR E3)
```

**Reglas:**

- Timestamps reales (`YYYYMMDDHHMMSS`) asignados **al crear cada PR**.
- Justo antes del merge se comprueba que el timestamp es mayor que la última migración de `main` y único en todas las ramas abiertas (inventario: `git ls-tree` de todas las ramas y de las PR abiertas). Si otra se ha adelantado, se renumera antes de aplicar.
- Nunca se usa `--include-all`.
- La serie E no depende de A1–D1:
  - E1 solo inserta una fila en `features`, que A1 no altera;
  - si E1 está lista antes que C1 o D1, se puede adelantar avisando a la coordinación del sprint y renumerando.
- E3 debe ir después de #128 y de E2.

## 7. Plan de PR

| PR | Contenido | Depende de | Migración | Complejidad |
| --- | --- | --- | --- | --- |
| E0 | Este ADR y este diseño (solo documentación) | — | — | S |
| #128′ | Ajustes de #128 (§6) y merge con autorización | E0 | `130000` (en el sitio) | S |
| E1 | Modalidad, grupos, totales nulos condicionales, trigger por modalidad, save/create/clone, límites de texto en `quote_items`, feature; tests SQL y rollback | #128′ | E1 | L |
| E2 | `quote_acceptances*`, `accept_quote_options_v1`, `selection_required`, `quote_accepted_lines_v1`, listados de cliente y banda de origen; tests y concurrencia | E1 | E2 | M |
| E3 | Origen en `order_items`, `replace_order_items_v1` con conservación de origen, conversión unificada (atómica e idempotente), notas intactas; regresión de phase43/45/49 | #128′, E2 | E3 | M–L |
| E4 | App: tipos, mappers, parsers, rutas y gating | E2 (E3 para la banda de origen) | — | M |
| E5 | Interfaz: selector, editor agrupado, aceptación con selección, listados, test de #125 | E4 | — | M–L |
| E6 | PDF: rama de opciones con aviso; Estándar byte a byte | E4 | — | S–M |
| E7 | E2E `e2e/staging/quotes-options.ts` y regresión completa con flag activado y desactivado | E3, E5, E6 | — | M |

**Gates de cada PR:**

1. CI verde: App, Database y kiosk-database si aplica.
2. Migraciones primero en local, después Staging y después Production, cada paso con su gate y su autorización.
3. E2E de Staging antes de Production cuando haya cambio visible.
4. Ningún merge sin autorización expresa.

## 8. Pruebas y criterios de aceptación

### SQL

Nuevas suites `phase5x_quote_quantity_options*.sql` y sus scripts de concurrencia:

- **Compatibilidad:** valor por defecto `standard`; importes, revisiones y PDF de los presupuestos existentes sin cambios (phase40, 41, 42, 43, 45 y 49 sin tocar).
- **Coherencia de datos:** entre modalidad y `option_group`; totales `NULL` solo en opciones, nunca 0.
- **Importes por alternativa:** con IVA incluido o no, con descuentos y con IVA del 21 % y del 10 %.
- **Aceptación:**
  - parcial;
  - vacía (rechazada);
  - con dos alternativas en un grupo (rechazada);
  - con ítems de otra versión o de otro tenant (rechazada);
  - replay;
  - otra selección después de aceptar (`accepted_selection_immutable`);
  - dos aceptaciones simultáneas.
- **Conversión:**
  - en `standard`: todas las líneas e `items_total = total_amount = version.total`;
  - en opciones: solo las aceptadas e `items_total = total_amount = accepted_total`;
  - origen inmutable y edición de líneas que lo conserva;
  - líneas manuales sin origen;
  - notas heredadas y escapadas;
  - replay idempotente;
  - concurrencia entre aceptar y convertir.
- **Flag desactivado:** lectura y PDF disponibles; edición en opciones bloqueada; la semántica no cambia.
- **Seguridad:** RLS e invariantes en `release_gate_security_invariants.sql`; sin escritura directa en las tablas nuevas.

### Unitarios

- Parsers: el 8.º campo solo en opciones.
- Mappers: `null` solo en opciones.
- PDF: Estándar byte a byte; opciones sin «Total» y con el aviso.
- Editor: agrupación, añadir cantidad, cambio de modalidad.
- Test de alcance de #125 actualizado.

### E2E de Staging

Tenant `e2e` con la feature; `demo` como tenant ajeno.

1. **Regresión con el flag desactivado y con el flag activado:**
   - `run.ts`: 3/3;
   - `quotes.ts`: 22/22, incluida la herencia de notas y los 404 entre tenants.
2. **Selector:** Estándar por defecto; cambio a «Por cantidades», guardar y recargar: la modalidad persiste.
3. **Contenido del presupuesto:**
   - Folletos A5 a 100/250/500 y Tarjetas a 100/500;
   - IVA del 21 % y del 10 %, con un descuento;
   - importe por alternativa sin total en el editor.
4. **PDF:** secciones por concepto, aviso de no acumulativo, sin «Total», con footer y condiciones, sin notas internas.
5. **Aceptación:**
   - sin selección: rechazada;
   - parcial (Folletos 250, Tarjetas sin seleccionar): aceptada;
   - el listado y la ficha muestran «Aceptado: 72,50 €» y el presupuesto sigue en el listado.
6. **Conversión:**
   - pedido con una línea con origen y `total_amount` 72,50;
   - notas internas heredadas y escapadas;
   - replay que devuelve el mismo pedido.
7. **Inmutabilidad:** cambiar la selección después de aceptar es imposible; editar la línea del pedido no cambia el presupuesto.
8. **Aislamiento:** presupuesto y PDF ajenos (`DEMO-P0001`) dan 404; una selección con ítems ajenos se rechaza.
9. **Cobro:** cobro parcial sobre el pedido convertido.
10. **Flag desactivado después:** el presupuesto Por cantidades se sigue consultando, junto con su PDF, y su importe aceptado no cambia.

### Criterios de aceptación globales

- Estándar sin cambios observables: SQL, PDF byte a byte y E2E.
- Por cantidades:
  - total nulo y nunca 0;
  - selección explícita, parcial, inmutable e idempotente;
  - el pedido suma solo lo aceptado y guarda el origen inmutable.
- Herencia de notas intacta y sin fugas al PDF.
- Aislamiento y permisos intactos.
- Feature por tenant desactivada por defecto, con documentos consultables tras desactivarla.
