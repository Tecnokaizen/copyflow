# Handoff Gestcopy — octubre 2026

Documento de continuidad para seguir sin repetir auditorías. Estado al 16/10/2026,
02:05 (hora de Madrid). Detalle por funcionalidad en
[SPRINT-CLOSURE-OCT-2026.md](SPRINT-CLOSURE-OCT-2026.md).

## 1. `main`

`25875b9`: #106 (`f120dbc`), #99 (`53deec7`), #105 (`725deff`), #94 (`8e5dfe1`), #95 (`6e3fc12`), #107 (`81aa3de`), #108 (`1e50228`), #58 (`4877db7`) y la documentación #109 (`25875b9`)
integradas el 15/10 con autorización expresa, con CI y Production verificados. Las
migraciones de #105, #95, #107 y #108 están aplicadas en Production (cada una antes
de su merge salvo la de #105) y ningún tenant tiene Pro activado. #91 se cerró el
16/10 como sustituida por #95. Solo queda sin fusionar #90 (voz).

## 2. `gestcopy-staging`

`4570ea5`, integrado solo con fast-forwards, con las mismas PR que ya están en
`main`. Sirve `demo`, `audit` y `e2e.preview.app.gestcopy.com`. #90 **no** está.
Mismas migraciones que `main` y Production. En código de la app, solo le falta la
corrección del logo de #58 (`d487d54`, `components/tenant-brand.tsx`), probada en
local con `scripts/tenant-header-ui-smoke.mjs`. Para igualarlo con `main`, otro
fast-forward cuando se autorice.

## 3. PR abiertas

| PR | Estado | Siguiente acción |
| --- | --- | --- |
| #105 Pro V1 | **Integrada** (`725deff`), migración aplicada | Activar el piloto SUR4 solo con autorización expresa |
| #99 Novedades | **Integrada** (`53deec7`) | — |
| #95 Cobros y justificantes | **Integrada** (`6e3fc12`), migraciones aplicadas | PR de contract pasadas 24 h |
| #106 Pie (#100) | **Integrada** (`f120dbc`) | — |
| #107 Dirección (#101) | **Integrada** (`81aa3de`), migración aplicada | — |
| #108 Notas (#102) | **Integrada** (`1e50228`), migración aplicada | — |
| #94 Sesión | **Integrada** (`8e5dfe1`) | — |
| #58 Logos | **Integrada** (`4877db7`) | — |
| #109 Documentación y Novedades | **Integrada** (`25875b9`) | — |
| #91 Total | **Cerrada** el 16/10, sustituida por #95 (migración idéntica en Production; la parte de app la cubre #93) | — |
| #90 Voz | Borrador, en conflicto | Ver `AI-VOICE-ORDERS-PLAN.md` |
| #32 Kiosk, #11, #2 | Fuera de alcance | Aparcadas |

## 4. Completado

- **Integrado en `main`**: Pro V1 (sin tenants enrolados), Novedades, pie de
  presupuestos, resiliencia de sesión, cobros con método y justificante (expand),
  dirección opcional de clientes, notas de presupuesto en pedidos y logos del
  tenant (con la corrección para la etiqueta Pro en móviles estrechos).

## 5. Pendiente

- #104 líneas de pedido: decisiones de producto y ADR propuesto.
- Contract de #95.
- Integración de la voz (#90).
- Operación de lanzamiento: #34, #35 y #84.

## 6. Migraciones por entorno

| Versión | Production (`wsclqvlzjdgwkxbolhoy`) | Staging (`fmmfsbhcwxkaszrrarpw`) |
| --- | --- | --- |
| ≤ `20261014120000` | Sí | Sí |
| `20261015200000` Pro | Sí (15/10, 21:44 UTC) | Sí |
| `20261016090000` total, `20261016091000` cobros (expand) | Sí (15/10, 22:32 UTC) | Sí |
| `20261016100000` dirección | Sí (15/10, 22:57 UTC) | Sí |
| `20261016110000` notas | Sí (15/10, 23:23 UTC) | Sí |

Todas son aditivas y compatibles con la app anterior. #108 solo cambia el valor de
`orders.notes` en conversiones nuevas.

## 7. Supabase y R2

- **Staging**: tenants `audit`, `demo` y `e2e` (sin datos de SUR4).
  - `e2e` tiene dos usuarios sintéticos: `e2e-owner@example.com` (owner) y
    `e2e-viewer@example.com` (viewer, creado con `e2e/staging/seed-viewer.ts`, de
    #105). Su contraseña no se guarda en el repo; se resincroniza volviendo a
    ejecutar el seed.
  - Pro **sin** concesiones. Overrides: solo `demo.quotes = true`.
  - Pedidos sintéticos `E2E-0001` a `E2E-0018` en `e2e`.
- **R2 Staging**: `gestcopy-files-staging`. Justificantes y archivos de E2E en
  `e2e`. CORS solo para los orígenes `demo` y `e2e` (`audit` sigue sin subir
  archivos).
- **Production**: migración de #105 aplicada (catálogo `pro_early_access` y
  `ai_voice_orders`, sin filas de plan ni overrides) y expand de #95 (columnas
  nulas, guardas y firma nueva de `record_order_payment`; los cobros anteriores
  intactos y «Sin especificar»). Reversión de la expand en
  `supabase/rollbacks/20261016091000_order_payment_methods_receipts_expand.sql`,
  válida solo mientras no haya cobros con método. Por lo demás, solo lectura.

## 8. Release Gate y E2E

- Release Gate en todas las PR del sprint, con suites nuevas `phase47`, `phase48`,
  `phase49`, `phase46_order_total_validation` y `phase46_payment_receipts`.
- En el árbol integrado: 1157 unitarias y 56 suites SQL (concurrencia incluida) en
  verde.
- `E2E staging` (manual): run `38825177132` 3/3 sobre `main` `4877db7` (pedido
  `E2E-0022`); con #95 elige método Bizum y adjunta justificante.
- Scripts nuevos en #105: `e2e/staging/pro-early-access.ts` (recorrido Pro ON/OFF)
  y `seed-viewer.ts`.

## 9. Problemas identificados

- Latencia esporádica de Staging (6 a 20 s en algunas API).
- Copias locales con ramas antiguas en otros worktrees (`copyflow-pr95`,
  `copyflow-staging` y la carpeta raíz en `feat/changelog-novedades`, rama ya
  integrada por squash en `53deec7`). Antes de trabajar en ellas, `git pull --ff-only`.
- `phase12` y `phase39` de concurrencia necesitan `node`/`python3` en el host:
  solo se ejecutan en CI.

## 10. Próximas acciones priorizadas

1. ~~Merge de #106 y #99~~ (hecho el 15/10).
2. ~~Merge de #105 y migración en Production~~ (hecho el 15/10).
3. ~~Merge de #94 con la resolución conocida~~ (hecho el 15/10).
4. ~~Migraciones de #95 en Production y merge~~ (hecho el 15/10) y ~~cierre de #91~~
   (16/10). Pendiente: no antes del 16/10 a las 22:34 UTC y con autorización, el
   contract de #95.
5. ~~#107~~ (hecho el 15/10, 22:58 UTC) y ~~#108~~ (hecho el 15/10, 23:23 UTC).
6. ~~Merge de #58~~ (hecho el 15/10, 23:41 UTC).
7. Decisiones de #104.
8. Alinear #90 y pasar sus gates.
9. Checklist de lanzamiento de SUR4 (#34, #35, #84) con el usuario.

## 11. Comandos

```bash
# Validación local (Node 22)
npx tsc --noEmit
npm run lint
TZ=UTC npx tsx --test
TZ=UTC npm run build
```

```bash
# Migraciones: siempre dry-run primero, desde un checkout enlazado al proyecto correcto
npx supabase@2.117.0 db push --dry-run --linked
npx supabase@2.117.0 db push --linked
```

```bash
# E2E de Staging (credenciales en .env.e2e.local, fuera del repo)
set -a; source .env.e2e.local; set +a
PLAYWRIGHT_MODULE=/tmp/e2e-browser/node_modules/playwright/index.mjs npx tsx e2e/staging/run.ts
```

```bash
# E2E desde GitHub (solo se puede lanzar sobre main)
gh workflow run e2e-staging.yml --ref main
```

```bash
# Desplegar una PR en Staging sin force push: merge-tree + commit-tree + fast-forward
git merge-tree --write-tree origin/gestcopy-staging origin/<rama>
```

## 12. Decisiones arquitectónicas

- **Pro**: override por tenant de `pro_early_access`, sin plan ni Stripe. Voz
  `planned`.
- **Cobros**: expand/contract. La firma antigua sigue viva hasta el contract. El
  ledger no se borra nunca.
- **Dirección**: RPC v2 con nombre nuevo para evitar sobrecargas ambiguas en
  PostgREST. Estado triple en la UI («no cargada» frente a «vacía»).
- **Notas**: las notas del presupuesto solo pasan a las notas internas del pedido,
  etiquetadas. Nada pasa a campos visibles para el cliente.
- **#104**: no se improvisa un modelo de líneas sin decidir la fuente de verdad del
  total.
- **Integración en Staging**: fast-forward sobre `gestcopy-staging`, sin force
  push y sin tocar `main`.

## 13. Riesgos para Production

- **Contract de #95**: retirar la firma de 4 argumentos solo cuando no quede
  ningún cliente con la versión anterior (≥ 24 h tras el despliegue del
  15/10, 22:34 UTC).
- **Conflicto #94/#105** en `/api/context`: resuelto al integrar #94.
- **Integrar sin seguir el orden de versión de las migraciones** bloquea la
  guarda de migraciones.
- **Stripe Live**: no está configurado y no se ha tocado en el sprint. Basic sigue en 39 €/mes.

## 14. Roadmap restante

- **Técnico**: contract de #95, líneas de pedido, voz V1 tras sus gates,
  importación CSV/XLSX (no existe en `main`), observabilidad de latencia.
- **Comercial**: alta manual de datos de SUR4, Stripe Live con decisión
  explícita, entregabilidad de correo, demo comercial con datos ficticios. Pro
  como programa por tenant y add-ons independientes de la suscripción.


## 15. Ampliación del roadmap — 27/10/2026

Aprobado **Seguimiento visual de pedidos V1**: primero timeline en ficha interna,
después portal público con token opaco y acceso de mínimo privilegio. Primer
incremento en rama local `feat/order-visual-tracking-v1`, sobre `main` `a63cbdb`.
Reutiliza estados configurables por tenant, memberships/RLS y audit trail;
Terminado y Entregado separados. Ningún paso ni fecha se deduce por posición.

El [plan y contrato de implementación](ORDER-VISUAL-TRACKING-V1.md) contiene el
inventario de PR revisado el 27/10 y la validación actual de esta funcionalidad.
Los apartados anteriores conservan su fecha histórica; esta ampliación no certifica
el estado actual de los despliegues. Siguiente gate: revisión local, autorización
para validar en Staging y, por separado, autorización de merge/Production.
