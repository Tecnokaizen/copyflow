# GESTCOPY · integración y validación preventiva de R6 · 27/10/2026

**Resultado: PASS. #148 sigue abierta y sin cambios en `370695565b7d9560cf24277be32f190167dc8634`. No se ha iniciado D.2/F10 ni F11.**

El registro verificable de esta validación es [evidence/staging-20261027/validation.json](evidence/staging-20261027/validation.json). La descripción de la PR de cierre registra el commit que queda desplegado al terminar el ciclo. Este documento identifica las versiones que se probaron; no presupone que un despliegue posterior sea equivalente.

## Código y esquema comprobados

| Elemento | Versión / resultado |
| --- | --- |
| `main`, al inicio y al cierre de las pruebas | `a63cbdb01f1e3aa190e320490da197394b2f3c45`; no modificado |
| Staging inicial | `f8fe9b35177bc3675c1d78a08fa0bdb01d13967a` |
| Lote 1, PR #152 | Integración `31e3147`; deployment `6388a0d3aad1f6f4675dde0ffe626eb4d0cf9271` |
| Lote 2, PR #154 | Integra `main` y el HEAD exacto de #148; deployment `6931bcdebef2fb52b5936e9f5f6bba5e04ad5fe6` |
| Deployment de la batería R6 | `dpl_FWWvEZTr7TBPEgASZaQv7DA4CBsu`, READY, Preview; dominio `e2e.preview.app.gestcopy.com` comprobado antes y después |
| Fuente de la batería R6 que pasó | `2f4544b1f429f2b8e442b87da2e9458fb3728330`, SHA-256 del script en el JSON |
| Supabase Staging | `fmmfsbhcwxkaszrrarpw`, PostgreSQL 17.11, 86 migraciones |
| R5 → R6 | `20261022120000` → `20261022130000`, ya aplicadas; tres triggers activos; cuerpos idénticos a las migraciones |
| R2 / Stripe | `gestcopy-files-staging` / Test |
| App exacta para compatibilidad | HEAD `3706955` sin modificar, servidor local y BD nueva de 84 migraciones, última `20261018190000`; R5/R6 ausentes antes y después |

La batería en Preview prueba la **integración** de Staging que contiene `3706955`, no un deployment exclusivo de #148. Frente al HEAD de #148, Staging conserva texto enriquecido y el código histórico de voz. La consulta de opciones de pedidos vive en `lib/orders/options-load.ts`; se comprobó que conserva el filtro R6. Las rutas de equipo y presupuestos y las migraciones R5/R6 son idénticas al HEAD solicitado. La app exacta de #148 se comprobó separadamente sobre la BD local de 84 migraciones.

## Los diez escenarios solicitados

| # | Escenario | Resultado y evidencia |
| --- | --- | --- |
| 1 | Crear pedido con responsable activo habilitado | PASS: POST 201, lectura persistida y responsable correcto |
| 2 | Excluir inactivos y personas sin permiso | PASS: `/api/orders/options` y `/api/team?assignable=true`; phase59 cubre las cuatro combinaciones y otro tenant |
| 3 | Responsable histórico visible y conservado | PASS: «(no disponible)», atributo y propiedad nativa `disabled=true`; reemplazo elegible seleccionable; captura conservada |
| 4 | Editar otros campos conservando responsable | PASS: descripción editada por la ruta real; asignación y posterior lectura conservadas; no-op del responsable permitido |
| 5 | Crear/modificar presupuesto y convertir | PASS: borrador reconocido, asignación modificada y limpiada; preparación con versión del documento, PDF oficial real en R2, marcado manual enviado/aceptado y conversión con responsable elegible |
| 6 | Rechazar asignaciones inválidas | PASS: pedidos POST/PATCH 400; borrador y conversión 422; PATCH de presupuesto 400; conversión rechazada sin crear pedido; phase58/59 con rollback |
| 7 | Aislamiento y ausencia de filtraciones | PASS: presupuesto de otro tenant GET 404, PATCH 409 genérico sin fila y conversión 404; pedido ajeno y PDF denegados en regresión; RLS, grants y funciones comprobados |
| 8 | Regresión de pedidos y presupuestos | PASS: pedidos, cliente, búsqueda, R2 y SHA-256, justificante privado, cobro parcial y estados; ciclo de presupuesto, PDF sin notas internas y conversión; pie PDF y texto enriquecido |
| 9 | App R6 con 84 migraciones, sin R5/R6 | PASS: ocho comprobaciones sobre el HEAD exacto: autenticación/tenant, ambos catálogos, pedido con responsable, edición, creación/modificación de presupuesto, selector renderizado y esquema aún en 84 |
| 10 | Correspondencia código/deployment/esquema | PASS: consulta de Vercel antes/después de cada suite, SHA y alias fijados; 86 versiones y cuerpos R5/R6 verificados; prueba local fija HEAD exacto y ausencia de guardianes nuevos |

Ejecución R6 completa: `20261027T195912Z-5e88`. Se usó exclusivamente el usuario sintético owner de `e2e`. Los miembros creados por cada intento quedan inactivos al terminar, sin borrar registros ni cambiar personas preexistentes. Todo presupuesto creado por API se reconoce para no bloquear `/quotes/new`.

## Regresión y CI

- Lote 1: [Release Gate 40571607626](https://github.com/Tecnokaizen/copyflow/actions/runs/40571607626), aplicación, seguridad/aislamiento de BD y recuperación de copias: SUCCESS.
- Lote 2: [Release Gate 40572970459](https://github.com/Tecnokaizen/copyflow/actions/runs/40572970459), los tres trabajos: SUCCESS.
- Combinación final: 1.431 pruebas PASS, seis omitidas, cero fallos; TypeScript y lint sin errores; cuatro avisos previos en `quote-situation.test.ts`. Guardas de seguridad y staging: 28/28.
- En la BD Staging: invariantes de seguridad, phase58 (escrituras directas e integridad RPC), phase59, `pedido_v2`, `tamara_operational_access`, phase33/34, phase44 creación/recuperación, phase49 conversión y phase35 privacidad de archivos: PASS. Los fixtures SQL se ejecutaron en transacciones terminadas en ROLLBACK.
- Los cuerpos de los tres guardianes coinciden con los ficheros de migración. No fue necesario aplicar migraciones durante este ciclo.

## Incidencias y correcciones

No se confirmó ningún defecto de aplicación en #148 ni se cambió esa PR. Se corrigieron el entorno y la nueva batería:

1. Faltaba `pdftotext`: se instaló Poppler 26.10.0 y la suite completa de presupuestos pasó al repetirla.
2. Playwright 1.58.2 devuelve `false` en `isDisabled()` para la opción nativa comprobada, aunque el DOM tiene `disabled=true`. El test comprueba atributo/propiedad y selección del reemplazo. Se corrigieron también el localizador del diálogo y una tecla dependiente del sistema operativo.
3. La nueva prueba usaba la versión de cabecera para preparar el documento. El 409 protegió correctamente la concurrencia; ahora usa la versión del documento. También se incorporó la generación obligatoria del PDF antes del marcado enviado.
4. Next/Turbopack no admite el enlace a dependencias fuera de su raíz en la copia local exacta. La prueba de compatibilidad pasó usando `next dev --webpack`, sin modificar el código de #148.

## Automatización, datos y límites

La batería se ejecutó con Playwright y el guard/harness de `e2e/staging`, con HTTP, autenticación y BD reales, sin respuestas de API simuladas. Las evidencias locales incluyen informes, estados HTTP, capturas y PDFs sintéticos, redactados y sin trazas de sesión. Versiones: Node 22.23.2, Next 16.3.4, Playwright 1.58.2, Supabase CLI 2.117.0.

El workflow existente `e2e-staging.yml` incorpora pie PDF, texto enriquecido y R6, conservando ejecución manual, entorno `staging`, token de lectura y los dos secretos ya existentes. El entorno de Actions solo admitía `main`; se añadió exclusivamente la rama exacta `gestcopy-staging`. No se modificaron secretos, revisores ni el entorno Production.

Las huellas y recuentos de pedidos, presupuestos, clientes, equipo y ajustes fuera de `e2e` permanecen idénticos. No existe tenant SUR4 en esta BD. No se escribió en DEMO ni en producción. Voz conserva el interruptor global apagado y cero concesiones; no se añadió kiosko visual ni se activaron funciones experimentales.

La BD local desechable de compatibilidad se eliminó tras guardar la evidencia. La compatibilidad con 84 migraciones demuestra que la app puede funcionar antes de R5/R6; los rechazos nuevos se validaron con 86, donde sí existen los triggers. La decisión D.2 y cualquier operación posterior de producción quedan fuera de este ciclo.
