# ADR: Presupuestos V2.1, modalidad «Por cantidades»

**Fecha:** 18 de octubre de 2026.

**Estado:** **aceptado.** El propietario aprobó las decisiones vinculantes el 18/10/2026.

**Base:** `main` `410228e`.

**Diseño técnico:** [QUOTES-V2-1-DESIGN.md](../QUOTES-V2-1-DESIGN.md).

**Relacionado:**

- ADR de líneas de pedido: [2026-10-15-order-lines-v1.md](2026-10-15-order-lines-v1.md).
- PR #128 (capa de BD de líneas de pedido).
- PR #125 (duplicar partida).

## Contexto

Hoy un presupuesto es siempre una suma:

- El trigger de versión suma todas las líneas en `subtotal`, `tax_total` y `total`, que son `NOT NULL` y `≥ 0`.
- La aceptación es de la versión completa.
- La conversión copia `quote_versions.total` en `orders.total_amount`.
- El PDF imprime siempre el bloque de totales.

Las copisterías necesitan ofrecer **cantidades alternativas** de uno o varios conceptos, por ejemplo:

- Folletos A5: 100 u. → 35 €; 250 u. → 72,50 €; 500 u. → 110 €.
- Tarjetas: 100 u. → 18 €; 500 u. → 60 €.

En este caso no hay total acumulado, y el pedido solo debe incluir lo que el cliente acepta.

## Decisiones

| # | Decisión |
| --- | --- |
| D1 | **Dos modalidades por presupuesto: `standard` y `quantity_options`.** `standard` es el valor por defecto y mantiene el comportamiento actual. Selector visible en el formulario: `Tipo de presupuesto: [ Estándar ] [ Por cantidades ]`. La modalidad se guarda en Supabase como propiedad del presupuesto, por versión y proyectada al presupuesto, y se muestra al recuperarlo o editarlo. |
| D2 | **Estándar:** todas las partidas contribuyen al total. Cálculos, PDF, aceptación y conversión sin ningún cambio observable. |
| D3 | **Por cantidades:** las partidas se organizan en grupos (conceptos). Cada línea del grupo es una alternativa con su propio importe: base, IVA y total, calculados con las reglas fiscales actuales (`quote_line_amounts_v1`). No hay total acumulado del documento: es **`NULL`, nunca 0**. Los presupuestos con total nulo **no desaparecen de los listados**. |
| D4 | **Selección:** como máximo una alternativa por grupo y al menos una en total. Se admite la aceptación parcial, con grupos sin seleccionar. Una vez aceptada la versión, **su selección y sus importes aceptados son inmutables** y se guardan de forma persistente. Aceptar sin selección en esta modalidad está prohibido. |
| D5 | **Feature flag:** `quote_quantity_options`, por tenant, **desactivada por defecto**, con el sistema actual (`features`, `tenant_feature_overrides`, `tenant_has_feature`). Requiere también `quotes`. Ningún desarrollo específico para un tenant. Desactivarla después **no impide consultar** los documentos históricos (ficha, listados, PDF) **ni compromete su integridad**: la semántica depende de la modalidad guardada en la versión, nunca del flag. |
| D6 | **Un único motor de conversión**, coordinado con la fase de conversión con líneas de pedido (PR B del ADR de líneas). En Estándar se convierten todas las líneas de la versión aceptada; en Por cantidades, exclusivamente las alternativas aceptadas. No se implementan motores paralelos ni volcados de texto provisionales. |
| D7 | **Trazabilidad.** Las líneas convertidas guardan una referencia inmutable a su presupuesto, versión y línea de origen. Después de la conversión son independientes y editables. Modificar un pedido nunca modifica retroactivamente el presupuesto aceptado. Las líneas añadidas a mano pueden no tener referencia de origen. |
| D8 | **Antes de fusionar #128** se alinean los límites de texto de `order_items` con los de presupuestos: concept 2000, description 10000, unit 100. |
| D9 | **Herencia de notas:** ya está implementada (`20261016110000_quote_conversion_notes_v1`) y **no se reconstruye**. Se mantiene en las dos modalidades y se cubre con pruebas de regresión. Las notas internas nunca aparecen en el PDF comercial. |
| D10 | **Garantías:** conversión atómica e idempotente; protección frente a aceptaciones concurrentes; aislamiento multi-tenant mediante autorización (RPC `SECURITY DEFINER` con roles y features) y RLS; compatibilidad total con los presupuestos Estándar existentes, sin backfill de importes. |
| D11 | El test de alcance de la PR #125 (`components/quotes/quote-draft-form.test.ts`, que prohíbe «alternativas» en el editor) se **actualiza de forma consciente**: en Estándar sigue fijando que una copia se suma; en Por cantidades fija que es una alternativa del mismo grupo. |
| D12 | **Desarrollo en PR pequeñas** con dependencias explícitas, pruebas y criterios de aceptación. Sin merges ni despliegues hasta superar los gates. Sin cambios de arquitectura fuera de alcance: un repositorio, un proyecto Vercel, un deployment de producción, un proyecto Supabase y una BD compartida por todos los tenants. |

## Consecuencias

- **Base de datos (aditiva):**
  - `pricing_mode` y `option_group`;
  - totales de versión y de presupuesto nullables **solo** en `quantity_options` (CHECK por modalidad);
  - tablas `quote_acceptances` y `quote_acceptance_items` (inmutables);
  - nueva RPC de aceptación con selección;
  - conversión unificada sobre líneas de pedido con referencia de origen.
- **Aplicación:** tipos, mappers, parsers y rutas aceptan total nulo solo en `quantity_options`; editor agrupado sin pantallas nuevas; diálogo de aceptación con selección; rama del PDF sin totales con el aviso «los importes no son acumulativos».
- **#128 cambia antes del merge:** límites de texto (D8).
- **La fase B de líneas de pedido queda unificada con V2.1** (D6, D7). Incluye:
  - columnas de origen en `order_items`;
  - que `replace_order_items_v1` conserve esa referencia;
  - la conversión desde las líneas aceptadas;
  - pedidos convertidos con `total_mode = 'manual'` hasta que exista la interfaz de líneas, para no restringir la edición actual del importe.
- **Fuera de alcance:** elección múltiple por grupo, nuevos planes o precios, cambios en Billing, en el Dashboard (que solo cuenta presupuestos) y en la infraestructura.

## Orden de integración

1. Ajustar y fusionar #128 (`20261016130000`).
2. A1, B1, C1 y D1 del sprint comercial, según su propio plan.
3. Las migraciones de V2.1: E1 → E2 → E3.

Detalle en el diseño técnico, §6.
