# Plan de publicación en Production: #146 y #160 (SUR4)

29/10/2026. Objetivo: publicación controlada en la noche del jueves 29/10 al
viernes 30/10, desde las 21:00Z (ver «Ejecución del 29/10»). Nada de esto se ejecuta sin la
autorización expresa del propietario para cada merge, migración o despliegue
en Production. La aceptación de SUR4/Tamara no es condición (enmienda de
gobernanza del 29/10, `docs/SUR4-ENTREGAS.md`).

## Punto de partida

Comprobado de nuevo el 29/10 a las 17:14Z.

| Pieza | Estado |
| --- | --- |
| Production | `main` `25f6460`, 86 migraciones, despliegue `dpl_HLW3tQt1…` |
| Staging | `c7067b9` tras E10 (PASS), 89 migraciones (`090000`, `120000` y `130000` aplicadas) |
| #146 | Abierta, `7712c12` (P-1: `main` y Novedades incluidas), sin migraciones, CI en verde |
| #160 | Borrador de integración, CI en verde; contiene #146 y E0–E11; migraciones `20261028120000` (E5) y `20261028130000` (E7). No se fusiona |
| P-2 a P-7 | Borradores apilados #164, #165, #166, #167 y #168 (ver «Secuencia de PR») |
| #163 | Borrador, `c90a8b6`, CI en verde: portadora de `20261028090000` y su rollback, sin código de aplicación |
| #158 | Plan Pro (Stripe), sigue en borrador; ya no trae `090000` a Production (va por #163) |

## Dependencias técnicas (no negociables)

1. **#146 antes que cualquier PR de #160**, porque #160 la contiene.
2. **`20261028090000` en `main` y en Production antes que `120000`/`130000`.**
   Si `120000` entra antes en `main`:
   - La guarda de migraciones de la CI rechaza la PR #158. Su versión es más
     antigua que la última de `main` (regla `migration-order`,
     `ci/release-gate/migration-guard.ts`).
   - `supabase db push` en Production tendría que aplicarla fuera de orden.

   **Decisión del propietario (29/10, ~16:50Z): #163 es una dependencia
   crítica de Post-it y secuencia.** Antes de `120000` y `130000`, y en este
   orden:
   1. revisar #163 (`c90a8b6`): CI, compatibilidad y efecto sobre los tenants
      actuales;
   2. copia B1.3 reciente de Production y restauración aislada satisfactoria;
   3. merge de #163 con sus puertas (CI, READY, sondas, vigilancia);
   4. aplicar solo `20261028090000`, con dry-run delante y comprobaciones
      después;
   5. confirmar que no se ha activado Stripe Live ni publicado comercialmente
      el plan Pro;
   6. solo entonces, `120000` y `130000`, por separado.

   #146 y las PR sin migraciones (P-2, P-3) pueden publicarse antes de #163 si
   cumplen sus propios controles. #160 no se fusiona: sigue como borrador de
   integración.

   **Revisión de #163 (29/10, 16:5xZ, integración):**
   - Ficheros: la migración, su rollback, `phase60_commercial_plans_pro.sql`,
     ajustes en `phase33`/`phase54`, una prueba del webhook y la ruta de la
     suite en `release-gate.yml`. Ningún fichero de aplicación.
   - CI de `c90a8b6` en verde: App, Database, Backup recovery (B1.3), Kiosk
     y Vercel.
   - Efecto en Production, consultado en una transacción de solo lectura:
     ningún tenant cambia de funciones. Los dos tenants con suscripción
     (uno Basic en prueba y otro en `mvp`) ya tienen Presupuestos por
     concesión propia, que manda sobre el plan; el resto no tiene suscripción.
     `clients_import` nace retenida (`feature_rollouts`, D2), así que nadie la
     gana.
   - **`090000` redefine `public.tenant_has_feature`** (añade la retención de
     `feature_rollouts`). La huella de referencia de esa función para las
     comprobaciones de `120000` y `130000` se toma después de `090000`, no
     antes. Es la misma definición validada en Staging (E10).
   - No crea precios, no toca suscripciones ni nombra tenants.

   **Vía propuesta por la sesión de Stripe (29/10, 12:18Z), adoptada:** una
   PR portadora desde `main` con solo la migración `090000` y su rollback,
   como la #150 de voz.
   - Pasa la guarda, porque `20261028090000` > `20261022130000`.
   - No cambia el código de Production. Stripe comprobó, en lectura, que
     Production cumple las precomprobaciones y que `25f6460` funciona con la
     base nueva.
   - Desacopla esta entrega de #158, de S10 (que necesita SMTP) y de Stripe
     Live; #158 entra después sin volver a añadir `090000`.
   - Efecto buscado M1 (decisión del 27/10): los tenants Basic activos o en
     prueba ganan Presupuestos por plan. Antes se mira en Production, en
     lectura, qué tenants afecta (P5 de Stripe).
3. `120000` antes que `130000`, cada una con su comprobación.
4. **Copia restaurable de Production** verificada, con simulacro de
   restauración aislada, antes de cualquier migración. Es el P1 del acta; lo
   comparten Stripe y esta entrega.
5. **Auditoría N23** antes de publicar la Hoja sin notas: lectura en
   Production, solo recuentos de `orders.notes` por tenant, con autorización
   propia. **Hecha el 29/10 a las 16:5xZ** con autorización del propietario,
   en una transacción de solo lectura y sin leer contenido. Resultado: el
   tenant SUR4 usa las notas internas en una parte apreciable de sus pedidos
   activos, así que notará el cambio de la Hoja; DEMO apenas las usa y el
   resto no las usa. Los recuentos están en el acta de coordinación, fuera de
   este repositorio público.
6. **E10 en PASS en Staging**: todo lo que se publique tiene que estar validado
   allí antes.

## Qué cambia para todos los tenants (con las funciones nuevas apagadas)

| Cambio | PR | Lo ven todos | Riesgo | Mitigación |
| --- | --- | --- | --- | --- |
| Tamaño, color y alineación en instrucciones y notas internas (#146) | P-1 | Sí: botones nuevos en el editor del pedido; la impresión respeta los estilos | Bajo; sin migración | E2E de Staging `order-rich-text` (12/12); los otros editores no cambian (prueba de lista permitida) |
| Pistas PostgREST hacia `team_members` (E1) | P-2 | No | Muy bajo | Prueba que falla sin la pista |
| Ficha reorganizada (E3) | P-3 | Sí: cabecera nueva y dos columnas desde `lg` | Medio (cambio visual) | Etiquetas de siempre salvo con `order_custom_labels`; Novedades |
| Hoja de trabajo sin `orders.notes` (E2) | P-3 | Sí: deja de imprimir «Notas internas» | Medio: quien la usaba para notas lo nota | N23 antes del merge, aviso en pantalla si el pedido tiene notas, Novedades y aviso directo a los tenants afectados |
| Resguardo PDF (E4) | P-3 | Sí: documento adicional, no sustituye a nada | Bajo | 404 para otro tenant; sin R2 |
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
| P-3 | E3 + E2 + E4: ficha reorganizada y etiquetas por concesión, Hoja segura y Resguardo, más `crear-pedido` en la ayuda | `9b37118`, `ef31ee1`, `b28bd2e` | No | V1 |
| P-5 | E5 + E6, post-its; suites `phase61` | `ca03c4e`, `01170c8`, parte de `958660c` | `120000` | V2 |
| P-6 | E7–E9, secuencia; suites `phase62`/`phase63` | `99207b4`, `8623491`, `38f21dc`, `ac83417`, `df7856d`, resto de `958660c` | `130000` | V2 |
| P-7 | E11 (ayuda), E2E de E10, ADR, contrato y registro | `19e80c4`, `9e612ef`, `29c1638`, docs | No | V2 |

P-3 y P-4 se juntan en una sola PR (29/10, al cortar las ramas). P-5 a P-7 conservan su número:
- E3 enlaza al Resguardo (`/api/orders/{id}/receipt`), que llega con E4. Por
  separado, entre un despliegue y otro, la ficha mostraría un enlace que da 404.
- E4 importa módulos de E3: `lib/orders/order-features`, `labels` y
  `work-stage-icons`.

Ramas de release (desde el 29/10 a las 16:5xZ las lleva la sesión de
integración, que se encarga de la publicación). Están apiladas: cada una
contiene la anterior, así que la CI prueba el estado acumulado. Tras cada
merge squash, la PR siguiente se cambia a base `main` y se le fusiona `main`
(mismo contenido, sin conflictos); su CI vuelve a pasar durante la vigilancia.

| PR | Rama | Cabeza | Contenido | Comprobación local |
| --- | --- | --- | --- | --- |
| #146 (P-1) | `feat/orders-rich-text-styles` | `7712c12` | #146 + `main` `25f6460`, más Novedades del 29/10 | CI completa en verde |
| #164 (P-2) | `release/p2-postgrest-hints` | `849d1b2` | E1 | Release gate en verde |
| #165 (P-3) | `release/p3-ficha-hoja-resguardo` | `309d55c` | E3 + E2 + E4, Novedades y el aviso de notas | Release gate en verde; guarda (0 migraciones), 1458 pruebas, tsc y lint |
| #166 (P-5) | `release/p5-postits` | `059f39f` | #163 fusionada + E5 + E6; suites `phase61` | Guarda (2 migraciones), 1499 pruebas y tsc |
| #167 (P-6) | `release/p6-secuencia` | `b8d2ebf` | E7 + E8 + E9; suites `phase62`/`phase63` | Guarda (3 migraciones), 1592 pruebas, tsc y lint |
| #168 (P-7) | `release/p7-ayuda-e2e-docs` | `07dabc3` | E11, E2E de E10 y `docs/` | Guarda, 1599 pruebas, tsc y lint |

El árbol de #168 es igual al de #160 salvo los ficheros de #163 y la entrada
de Novedades del 29/10. Las pruebas locales van con `TZ=UTC`, como la CI: una
prueba del quiosco depende de la zona horaria.

Las consultas a `order_notes` y `order_work_steps` solo se hacen con la
función activa y devuelven vacío si hay error. `tenant_has_feature`, tal como
está en Production (`20260923190000`), responde `false` a un código sin fila,
y lo mismo con la definición de `090000` (misma regla más la retención). Por
eso P-3 funciona sin `120000`/`130000`, antes o después de #163.

Los estados intermedios (P-2 y P-3 sin las tablas de E5/E7) no se han probado
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

- **V1, sin migraciones** (jueves 29/10 desde las 21:00Z; el propietario no
  admite merges ni despliegues de Production antes de las 22:00 de Madrid):
  P-1 → P-2 → P-3. Requisitos: E10 en PASS, N23 hecha y la comunicación a
  SUR4 sobre la Hoja de trabajo preparada antes de P-3 (la envía el
  propietario).
- **V2, con migraciones** (después de #163 en `main` y `090000` en
  Production; ya no espera a #158):
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
  - Por la vía de #158 completa no es viable: necesita S10, y S10 necesita
    SMTP.
  - Con la PR portadora sí lo es (Stripe, 29/10). El jueves, desde las 19:40Z:
    1. copia de menos de 2 h;
    2. merge de la portadora (READY, sondas y vigilancia);
    3. P2 (`090000`, dry-run, push y comprobación), entre 1 y 1,5 h;
    4. V1 y V2 de esta entrega.

    Cabe entre las 19:40Z y las 07:05Z si el propietario está disponible para
    cada autorización. Antes de la portadora hace falta el P1: copia,
    `verify` y simulacro aislado de Production. La consolidación del
    propietario (29/10) cambia la hora y el orden: ver «Ejecución del 29/10».
- **B.** Si el P2 se queda el viernes a partir de las 19:40Z, el viernes SUR4
  prueba la ficha, la Hoja, el Resguardo y el formato de texto. Post-its y
  secuencia llegan desde la noche del viernes (V2 tras el P2). Para Billing no
  tiene coste: el plazo de Live (02/11, 13:08Z) sigue cubierto.

Orden en Production recogido en el acta (adenda A2 de la sesión de
integración): simulacro → `090000` → #158 → #146 → `120000` → `130000` →
#160, cada paso con su GO. Con la portadora, #158 sale de la cadena: va cuando
esté lista y no bloquea `120000`/`130000`. P-1 a P-3 no traen migraciones y
pueden ir antes de `090000` (V1).

## Ejecución del 29/10 (escenario A)

Decisiones del propietario del 29/10 (16:5xZ):
- **Reparto.** La sesión de release hace las operaciones de base de datos de
  Production: copia B1.3, verificación, restauración aislada y cada
  migración. La sesión de integración prepara y comprueba las PR, hace cada
  merge tras el GO, lanza sondas y vigilancia, y lleva el registro.
- **Simulacro.** Una copia nueva al empezar la ventana, con restauración
  aislada, sustituye al simulacro pendiente de la copia de las 11:27Z. Vale
  como simulacro obligatorio y como copia de menos de 2 h.
- **Decisiones N3, N4, N5, N8, N9, N11 y N12:** cerradas con la recomendación
  implementada (registro de entregas).

Consolidación del propietario (29/10, ~17:0xZ; prevalece sobre lo anterior):
- Ningún merge ni despliegue de Production antes de las 22:00 de Madrid
  (21:00Z) del 29/10.
- V1 primero, cada PR verificada por separado. Después, la copia B1.3 nueva
  con restauración aislada. Después, #163 y solo `090000`.
- La copia debe tener menos de 2 h en cada migración; si no, se renueva antes.
- Comunicación a SUR4 sobre la Hoja de trabajo preparada antes de P-3. Las
  notas no se convierten ni se borran.
- E3 entra. Quedan fuera las vistas A/B/C/D, su selector y las preferencias
  visuales por tenant.

Secuencia, desde las 21:00Z, con un GO por paso:

| Paso | Quién | Qué | Puertas |
| --- | --- | --- | --- |
| P-1 | integración | Merge de #146 (actualizada con `main` y Novedades) | CI, READY, sondas 6/6, 15 min |
| P-2 | integración | #164, pistas PostgREST | Ídem |
| P-3 | integración | #165, ficha, Hoja sin notas y Resguardo | Ídem; comunicación a SUR4 preparada antes |
| W1 | release | Copia B1.3 de Production, `verify` y restauración aislada | Hashes y manifiesto v2; `RESTORE_DATABASE_ISOLATED_SUCCESS` y comprobaciones R5/R6 sobre la copia restaurada |
| W2 | integración | Merge de #163 | CI, READY, sondas 6/6, 15 min |
| W3 | release | Solo `20261028090000` | Dry-run con solo esa; comprobación (0 cambios en la matriz efectiva tenant × función); Stripe confirma Live sin activar y Pro sin publicar |
| W4 | release | `20261028120000` | Copia de menos de 2 h; dry-run con solo esa; comprobación de RLS y RPC (huella de `tenant_has_feature` tomada tras W3) |
| P-5 | integración | #166, post-its | CI, READY, sondas 6/6, 15 min |
| W5 | release | `20261028130000` | Copia de menos de 2 h (si no, se renueva); dry-run con solo esa; comprobación de RLS y RPC |
| P-6 | integración | #167, secuencia | CI, READY, sondas 6/6, 15 min |
| P-7 | integración | #168, ayuda, E2E de E10, ADR, contrato y registro; diff final con lo validado | Ídem |

Cada migración se aplica antes del merge de la PR que la trae a `main`:
`090000` con #163, `120000` con #166 y `130000` con #167. Las funciones nacen
apagadas.

Acordado con la sesión de release (29/10, 17:1xZ):
- W3 se lanza desde el SHA exacto de `main` tras el squash de #163; W4 desde
  la cabeza de #166 y W5 desde la de #167. Si una cabeza cambia por el
  retarget, la sesión de integración envía el SHA nuevo y la de release
  vuelve a comprobar los blobs antes del push. Cada migración tiene el mismo
  blob en todas las ramas (comprobado en modo lectura).
- Mientras corre un push y su comprobación no hay merges ni despliegues de
  Production. P-5 y P-6 van después de la comprobación de fase 88 y 89.
- Límite de 2 h: con la copia hacia las 22:05Z, vence hacia las 00:05Z. Si W5
  va más tarde, el set automático de las 23:27Z la renueva una vez
  verificado (hashes y huella en vivo), sin pushes entre las 23:17Z y las
  23:35Z; si no, el propietario lanza otra copia manual.
- La copia de W1 la lanza el propietario desde Coolify y da la autorización
  directa para ese set en la sesión de release, y su GO antes de W3, W4 y
  W5.

Las concesiones a SUR4 o DEMO son una operación aparte, auditada y con su
propia autorización.

Fecha de Novedades: `2026-10-29`. Si P-1 o P-3 se fusionan después de las
23:00Z (medianoche en Madrid), la fecha se cambia a `2026-10-30` antes del
merge.

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
    R5/R6 (la de `tenant_has_feature` se toma después de `090000`, que la
    redefine);
  - es la misma que `~/copyflow-ops/staging-e10-20261029/verify-staging-e10.sql`,
    que se usa en Staging.
- **Novedades:** una release por día en `lib/help/changelog.ts`, con la fecha
  real del merge.

## Autorizaciones que hacen falta (Production)

1. ~~Auditoría N23: lectura de recuentos en Production.~~ Autorizada y hecha
   el 29/10 (16:5xZ).
2. Merge de P-1 a P-3, uno a uno, desde las 21:00Z (hora fijada por el
   propietario).
3. Copia y simulacro (W1, sesión de release, después de V1), merge de #163
   (W2) y `090000` (W3), cada uno con su GO. Vía para `090000` decidida: la
   portadora #163 (`c90a8b6`).
4. Fecha y hora de V2: cada migración y el merge de P-5 a P-7, uno a uno.
5. Concesiones a SUR4 o DEMO (operación aparte).
