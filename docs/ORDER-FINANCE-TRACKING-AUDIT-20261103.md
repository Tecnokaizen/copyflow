# Pedidos: auditoría e integración de importes y seguimiento

## Punto de partida (3 de noviembre de 2026)

Repositorio `Tecnokaizen/copyflow`, producto Gestcopy. Base auditada: `origin/main` `49ea7be`.
La copia local `copyflow/main` estaba en `7d4f3a9` y tenía cambios ajenos sin guardar;
se preservó íntegra. Trabajo en `feat/order-finance-tracking-20261103`, copia aislada.

Fuentes contrastadas, solo lectura: `Arquitectura inmutable de Copyflow.md`,
`FUENTES OFICIALES proyecto copyflow.md` y `prd site sur4.md` del proyecto.
SUR4 Sites/Airtable aporta referencia funcional histórica; no es el backend actual.
Se conserva una sola app/codebase, Vercel y Supabase compartidos, con `tenant_id`,
memberships, autorización y RLS. No hay infraestructura por tenant.

## Desarrollo previo localizado antes de editar

- PR #153: https://github.com/Tecnokaizen/copyflow/pull/153, borrador abierto,
  rama `feat/order-visual-tracking-v1`, head remoto `a9b5be9`.
  Implementación original `3be5eea`, revisión V1.1 `73513e1`, documentación `e775799`.
  No está fusionada en la base auditada y GitHub informa conflicto.
  El bloqueo anterior era aceptación funcional del propietario, no falta de desarrollo.
- Desde entonces la ficha pasó a `useOrderWorkspace` + módulos + cinco layouts
  (PR #170–#174). Todos reservaban `modules.tracking`, aún `null`.
  Se reutilizan SIN reescribir `OrderTracking`, `visual-tracking.ts` y sus pruebas;
  se integra en ese módulo común. Las mejoras de carga/aborto de #153 se adaptan
  al hook actual. No se incorpora la antigua ficha monolítica ni merges históricos.
- Rama `fix/initial-finance-create-forms-20261009`, head `4cebf29`:
  helper `1368496`, pruebas `dae1557`, formulario `c97a10f`, QA posterior.
  No integrada en main; se reutiliza como punto de partida. Era anterior a los
  métodos de pago obligatorios: el POST original no incluía `payment_method`.
  Se adapta a la API vigente, identidad de sesión y recuperación de cobros.
- Main ya dispone de `orders.total_amount`, `order_payments`, lectura agregada,
  APIs de total/pagos/anulación, idempotencia, versiones y RLS. `OrderCollection`
  permite modificar el total y corregir anticipos por anulación y nuevo registro.
  El alta rápida solo ofrecía ese bloque DESPUÉS de crear; no había campos de
  importes configurables en `quick_order_layout_v1`.

## Semántica y comportamiento

`quantity` en presupuestos/líneas significa unidades (por ejemplo `unit: ud`).
No se renombra ni reutiliza. Los campos nuevos son `total_amount` y
`advance_amount` en la configuración visual; este último NO es una columna nueva:
representa una primera entrega real en el registro de cobros existente.

- Ambos campos se pueden dejar vacíos y completar después desde la ficha.
- Total vacío = desconocido, nunca cero inventado. Total cero explícito se admite.
- Se mantiene la regla de BD existente: una entrega positiva requiere total definido,
  no puede superar el pendiente y exige método de pago. No se cambia esta regla
  financiera de forma incidental. Euros, coma o punto decimal, máximo dos decimales,
  sin negativos, exponentes ni separadores de miles en la entrada. Cálculo exacto
  en céntimos con BigInt; no se usa coma flotante.
- Anticipo vacío o cero no crea pagos. Estado operativo, estado manual de pago y
  presupuestos no se usan para inferir cobros históricos.
- Para corregir una entrega ya registrada se anula con motivo y se registra la
  correcta. Así sigue siendo editable sin borrar ni falsear el historial contable.
- Alta: primero pedido, después total con versión vigente, después entrega mediante
  las APIs existentes. NO es una transacción atómica: si falla, la pantalla conserva
  el pedido creado, identifica la confirmación pendiente y reintenta sobre su id.
  Nunca vuelve a crear el pedido al reintentar los importes.
- Una entrega de resultado incierto conserva solicitud, fecha, método y clave antes
  de enviarse, usando la misma clave de almacenamiento tenant/usuario/pedido que
  `OrderCollection`. Tras recargar se puede comprobar desde la ficha, registrando
  de nuevo exactamente esa confirmación. No se da por pagada por haber pulsado guardar.
- Total cambiado por otra persona: se detiene sin sobrescribirlo. Sesión cambiada:
  se detiene antes de escribir dinero. Al caducar sesión antes de crear se recuperan
  también los importes del borrador, solo para ese usuario y tenant.

## Configuración y compatibilidad

Se extiende `tenant_settings.preferences.quick_order_layout_v1`, sin nueva tabla.
Total y anticipo se colocan independientemente en Principal / Más opciones / Oculto.
Por defecto aparecen en Más opciones. Las configuraciones anteriores se normalizan
sumando esas dos claves y conservando TODOS los campos y placements previos.
Solo owner sigue configurando; no se amplían permisos de admin/staff.
Los campos ocultos no envían valores restaurados de un borrador.

No hay migraciones que aplicar: esquema, funciones, GRANT y políticas vigentes
ya cubren las operaciones. No se modifican migraciones históricas, pedidos existentes,
RLS, service_role ni datos remotos. Rollback: revertir este PR; los cobros registrados
continúan siendo cobros canónicos compatibles con la versión anterior.

## Publicación y pendientes

No fusionar ni desplegar sin autorización. `vercel.json` excluye únicamente esta
rama de auto-deploy mediante `git.deploymentEnabled`; no cambia main ni Staging.
Referencia oficial: https://vercel.com/docs/project-configuration/git-configuration

Esta integración incorpora la funcionalidad de #153; no fusionar después ambos
PR sin revisar el solapamiento. Tras aceptar este PR, el propietario puede cerrar
#153 como sustituido. No se ha cerrado ni cambiado su rama.

Pendiente de autorización: aceptación visual funcional, Preview/Staging si se desea,
y posterior publicación controlada. No se añaden novedades con una fecha de publicación
ficticia; añadirlas al autorizar el merge. Ninguna prueba escribe en producción.

## Validación

Resultados definitivos y enlace de CI: ver descripción del PR y sección final de
este documento. La CI usa Node 22 y TZ=UTC. El equipo local tiene Docker detenido;
las pruebas reales SQL/RLS se ejecutan en PostgreSQL local efímero de GitHub Actions,
con todas las migraciones del repositorio, nunca sobre Supabase remoto.

### Evidencia local

- Node 22.23.2, TZ=UTC: 1.815 tests; 1.809 PASS, 6 omitidos preexistentes, 0 fallos.
  Incluye pruebas ejecutables de rutas de pagos, validación de importes y permisos.
- TypeScript: PASS. ESLint: 0 errores, 4 avisos preexistentes en quote-situation.test.ts.
- `pedido-v2-ui-smoke.mjs`: PASS en 390/820/1280 px. Formularios completo y rápido,
  total 85 / entrega 30 / saldo 55, validación, método de pago, respuesta perdida,
  mismo id de pedido y clave al reintentar, y configuración Principal/Más/Oculto.
- `order-tracking-ui-smoke.mjs`: 59 escenarios PASS: los 49 originales de #153
  y diez de integración (cinco vistas × móvil/escritorio).
- `order-collection-ui-smoke.mjs`: 234 aserciones PASS (edición, concurrencia, roles).
- `payment-receipts-ui-smoke.mjs`: 85 aserciones PASS.
- La compilación Turbopack local se encontró con una restricción del sistema al
  abrir puertos. Se comprueba también con Webpack; la compilación estándar
  Turbopack queda exigida por la CI, sin modificar la configuración del producto.
- La CI de Pedido V2 ejecuta el navegador y además las suites SQL canónicas
  `phase45_commercial_operations`, `phase46_order_total_validation` y
  `phase46_payment_receipts`, junto al aislamiento y roles de `pedido_v2`.
  Release gate mantiene todas sus pruebas de BD/RLS y concurrencia.
