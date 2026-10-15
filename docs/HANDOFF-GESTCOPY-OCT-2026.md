# Handoff Gestcopy — octubre 2026

Documento de continuidad para seguir sin repetir auditorías. Estado al 15/10/2026,
22:00 (hora de Madrid). Detalle por funcionalidad en
[SPRINT-CLOSURE-OCT-2026.md](SPRINT-CLOSURE-OCT-2026.md).

## 1. `main`

`53deec7`: #106 (`f120dbc`) y #99 (`53deec7`) integradas el 15/10 con
autorización expresa, con CI y Production verificados. Nada más se ha fusionado.

## 2. `gestcopy-staging`

`4570ea5` = `main` + #105, #99, #95, #106, #107, #108, #94 y #58, integradas solo con
fast-forwards. Sirve `demo`, `audit` y `e2e.preview.app.gestcopy.com`. #90
**no** está. El contenido de pruebas y documentación de los últimos commits de
#95 (`8886ecf`) y #108 (`53d3e3a`) no se ha desplegado porque no cambia la app.

## 3. PR abiertas

| PR | Estado | Siguiente acción |
| --- | --- | --- |
| #105 Pro V1 | Lista | Merge y migración en Production |
| #99 Novedades | **Integrada** (`53deec7`) | — |
| #95 Cobros y justificantes | Lista | Migración en Production **antes** del merge; contract después |
| #106 Pie (#100) | **Integrada** (`f120dbc`) | — |
| #107 Dirección (#101) | Lista | Migración y merge |
| #108 Notas (#102) | Lista | Migración y merge |
| #94 Sesión | Lista | Merge tras #105, con la resolución de `3d1f386` |
| #58 Logos | Lista (validada en Staging) | Merge |
| #91 Total | Sustituida por #95 | Cerrar al integrar #95 |
| #90 Voz | Borrador, en conflicto | Ver `AI-VOICE-ORDERS-PLAN.md` |
| #32 Kiosk, #11, #2 | Fuera de alcance | Aparcadas |

## 4. Completado (validado en Staging, sin fusionar)

Pro V1, Novedades, cobros con método y justificante (con expand), pie de
presupuestos, dirección de clientes, notas de presupuesto en pedidos,
resiliencia de sesión y logos del tenant.

## 5. Pendiente

- #104 líneas de pedido: decisiones de producto y ADR propuesto.
- Contract de #95.
- Integración de la voz (#90).
- Operación de lanzamiento: #34, #35 y #84.

## 6. Migraciones por entorno

| Versión | Production (`wsclqvlzjdgwkxbolhoy`) | Staging (`fmmfsbhcwxkaszrrarpw`) |
| --- | --- | --- |
| ≤ `20261014120000` | Sí | Sí |
| `20261015200000` Pro | No | Sí |
| `20261016090000` total, `20261016091000` cobros (expand) | No | Sí |
| `20261016100000` dirección | No | Sí |
| `20261016110000` notas | No | Sí |

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
- **Production**: solo lectura del historial de migraciones; sin cambios.

## 8. Release Gate y E2E

- Release Gate en todas las PR del sprint, con suites nuevas `phase47`, `phase48`,
  `phase49`, `phase46_order_total_validation` y `phase46_payment_receipts`.
- En el árbol integrado: 1157 unitarias y 56 suites SQL (concurrencia incluida) en
  verde.
- `E2E staging` (manual): run `38796720614` 3/3 sobre `main`. **Aviso**: mientras
  Staging tenga #95 y `main` no, ese workflow falla en el paso de cobro, porque no
  elige método.
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
2. Merge de #105 y migración en Production.
3. Merge de #94 con la resolución conocida.
4. Migraciones de #95 en Production, después merge de #95 y cierre de #91.
5. #107 y después #108, con sus migraciones.
6. Merge de #58.
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

- **Orden de las migraciones de #95**: si el código se despliega antes, el
  registro de cobros falla. Hay que aplicar la expand primero.
- **Conflicto #94/#105** en `/api/context`: aplicar la resolución probada.
- **Integrar sin seguir el orden de versión de las migraciones** bloquea la
  guarda de migraciones.
- **Stripe Live**: no está configurado y no se ha tocado en el sprint. Basic sigue en 39 €/mes.

## 14. Roadmap restante

- **Técnico**: contract de #95, líneas de pedido, voz V1 tras sus gates,
  importación CSV/XLSX (no existe en `main`), observabilidad de latencia.
- **Comercial**: alta manual de datos de SUR4, Stripe Live con decisión
  explícita, entregabilidad de correo, demo comercial con datos ficticios. Pro
  como programa por tenant y add-ons independientes de la suscripción.
