# Plan de publicación en Production: #146 y #160 (SUR4)

29/10/2026. Objetivo: publicación controlada el viernes 30/10. Nada de esto se
ejecuta sin la autorización expresa del propietario para cada merge, migración
o despliegue en Production. La aceptación de SUR4/Tamara no es condición
(enmienda de gobernanza del 29/10, `docs/SUR4-ENTREGAS.md`).

## Punto de partida

| Pieza | Estado |
| --- | --- |
| Production | `main` `25f6460`, 86 migraciones |
| Staging | `97fbc59`, 87 migraciones (más `20261028090000` del plan Pro); 89 tras E10 |
| #146 | READY `644bd5b`, sin migraciones; base `9168c89`, detrás de `main` |
| #160 | `c549951` y siguientes: contiene #146 y E0–E11; migraciones `20261028120000` (E5) y `20261028130000` (E7) |
| #158 | Plan Pro (Stripe), trae `20261028090000`. Pista P del acta: P1 simulacro, P2 migración, P3 merge, P4 Live |

## Dependencias técnicas (no negociables)

1. **#146 antes que cualquier PR de #160**, porque #160 la contiene.
2. **`20261028090000` en `main` y en Production antes que `120000`/`130000`.**
   Si `120000` entra antes en `main`:
   - La guarda de migraciones de la CI rechaza la PR #158. Su versión es más
     antigua que la última de `main` (regla `migration-order`,
     `ci/release-gate/migration-guard.ts`).
   - `supabase db push` en Production tendría que aplicarla fuera de orden.
3. `120000` antes que `130000`, cada una con su comprobación.
4. **Copia restaurable de Production** verificada, con simulacro de
   restauración aislada, antes de cualquier migración. Es el P1 del acta; lo
   comparten Stripe y esta entrega.
5. **Auditoría N23** antes de publicar la Hoja sin notas: lectura en
   Production, solo recuentos de `orders.notes` por tenant, con autorización
   propia.
6. **E10 en PASS en Staging**: todo lo que se publique tiene que estar validado
   allí antes.

## Qué cambia para todos los tenants (con las funciones nuevas apagadas)

| Cambio | PR | Lo ven todos | Riesgo | Mitigación |
| --- | --- | --- | --- | --- |
| Tamaño, color y alineación en instrucciones y notas internas (#146) | P-1 | Sí: botones nuevos en el editor del pedido; la impresión respeta los estilos | Bajo; sin migración | E2E de Staging `order-rich-text` (12/12); los otros editores no cambian (prueba de lista permitida) |
| Pistas PostgREST hacia `team_members` (E1) | P-2 | No | Muy bajo | Prueba que falla sin la pista |
| Ficha reorganizada (E3) | P-3 | Sí: cabecera nueva y dos columnas desde `lg` | Medio (cambio visual) | Etiquetas de siempre salvo con `order_custom_labels`; Novedades |
| Hoja de trabajo sin `orders.notes` (E2) | P-4 | Sí: deja de imprimir «Notas internas» | Medio: quien la usaba para notas lo nota | N23 antes del merge, aviso en pantalla si el pedido tiene notas, Novedades y aviso directo a los tenants afectados |
| Resguardo PDF (E4) | P-4 | Sí: documento adicional, no sustituye a nada | Bajo | 404 para otro tenant; sin R2 |
| Post-its (E5, E6) | P-5 | No: rutas en 404 sin concesión | Bajo | Nacen apagadas en todos los tenants |
| Secuencia, fases, «Le toca» (E7–E9) | P-6 | No: sin función o sin fases, respuestas iguales a hoy (13 peticiones comparadas) | Bajo | Nacen apagadas |
| Ayuda (E11) y Novedades | P-7 | Sí, solo texto | Muy bajo | — |

## Secuencia de PR

Cada PR sale de `main`, con los commits de #160 que le tocan (cherry-pick, sin
reescribir #160), CI completa en verde y merge squash. El árbol final de
`main` tiene que ser igual al validado en E10 en `src`, `lib`, `app`,
`components` y `supabase`. Se comprueba con diff antes del último merge.

| PR | Contenido | Commits de #160 | Migración | Ventana |
| --- | --- | --- | --- | --- |
| P-1 | #146 (existente), actualizada con `main` y con Novedades | — | No | V1 |
| P-2 | E1, pistas PostgREST | `d0129d8`, `c956523` | No | V1 |
| P-3 | E3, ficha reorganizada y etiquetas por concesión | `9b37118`, `ef31ee1` | No | V1 |
| P-4 | E2 + E4: Hoja segura y Resguardo, más `crear-pedido` en la ayuda | `b28bd2e` | No | V1 |
| P-5 | E5 + E6, post-its; suites `phase61` | `ca03c4e`, `01170c8`, parte de `958660c` | `120000` | V2 |
| P-6 | E7–E9, secuencia; suites `phase62`/`phase63` | `99207b4`, `8623491`, `38f21dc`, `ac83417`, `df7856d`, resto de `958660c` | `130000` | V2 |
| P-7 | E11 (ayuda), E2E de E10, ADR, contrato y registro | `19e80c4`, `9e612ef`, `29c1638`, docs | No | V2 |

Los estados intermedios (P-2 a P-4 sin las tablas de E5/E7) no se han probado
en Staging tal cual. Al cortar cada rama:
- tipos, lint, pruebas y build;
- smoke en local contra una base sin `120000`/`130000`: ficha, Hoja estándar
  y Resguardo. El perfil ficha y las etiquetas propias dependen de
  concesiones que todavía no existen, así que deben caer en el perfil
  estándar.

## Ventanas

Horario de SUR4: lunes a viernes, 07:05–19:40Z. Las ventanas van fuera de ese
horario. Por cada merge:
- CI en verde;
- Vercel READY;
- sondas 6/6 (`~/copyflow-ops/publicacion-lote-20261028/sondas.sh`);
- 15 min de vigilancia de logs filtrando por despliegue;
- rollback anotado al despliegue anterior.

- **V1, sin migraciones** (jueves 29/10 desde las 20:00Z, o viernes 30/10
  de 05:30 a 07:00Z): P-1 → P-2 → P-3 → P-4. Requisitos: E10 en PASS y N23
  hecha.
- **V2, con migraciones** (después del P2 de Stripe: `090000` en Production y
  #158 en `main`):
  1. copia B1.3 nueva, verificada y con simulacro aislado;
  2. `120000`, dry-run (solo debe listar esa) y comprobación;
  3. P-5;
  4. `130000`, dry-run y comprobación;
  5. P-6;
  6. P-7.
  Las funciones nacen apagadas.
- **Concesiones a SUR4** (`order_sticky_notes`, `order_work_sequence`,
  `order_custom_labels`, `order_work_sheet_ficha`): con
  `set_tenant_feature_v2` (auditada) y autorización expresa, cuando el
  propietario lo decida. Se retiran con la misma RPC y los datos se
  conservan.

Escenarios para el viernes:

- **A.** Si el P2 de Stripe puede ir antes de las 07:05Z del viernes, V1 y V2
  van seguidas y SUR4 prueba post-its y secuencia el mismo viernes.
- **B.** Si el P2 se queda el viernes a partir de las 19:40Z, el viernes SUR4
  prueba la ficha, la Hoja, el Resguardo y el formato de texto. Post-its y
  secuencia llegan desde la noche del viernes (V2 tras el P2).

## Rollback

- **Código:** rollback de Vercel al despliegue anterior, inmediato. Después,
  `git revert` de la PR.
- **Funciones:** retirar la concesión. Los datos quedan ocultos, no se borran.
- **Migraciones:** `supabase/rollbacks/20261028130000_…` y después `…120000_…`,
  en orden inverso. Se niegan si hay post-its o pasos, así que primero hay que
  retirar las concesiones y decidir qué pasa con los datos. Restaurar la copia
  completa necesita autorización propia.

## Release Gate y comprobaciones

- **CI:** release gate (app, base de datos, recuperación B1.3), kiosk,
  Pedido V2 y Tamara.
- **Copia:** B1.3 nueva, `verify` y simulacro aislado con
  `RESTORE_DATABASE_ISOLATED_SUCCESS` antes de V2.
- **Migraciones:**
  - dry-run con solo la migración del paso;
  - comprobación de solo lectura después: tablas con RLS, sin escritura
    directa, RPC `SECURITY DEFINER` con `search_path`, funciones sin
    concesiones, huellas sin cambios de `tenant_has_feature` y de las guardas
    R5/R6;
  - es la misma que `~/copyflow-ops/staging-e10-20261029/verify-staging-e10.sql`,
    que se usa en Staging.
- **Novedades:** una release por día en `lib/help/changelog.ts`, con la fecha
  real del merge.

## Autorizaciones que hacen falta (Production)

1. Auditoría N23: lectura de recuentos en Production.
2. Fecha y hora de V1, y merge de P-1 a P-4, uno a uno.
3. P1 (copia y simulacro) y P2 de Stripe; los coordina la sesión de Stripe.
4. Fecha y hora de V2: cada migración y el merge de P-5 a P-7, uno a uno.
5. Concesiones a SUR4.
