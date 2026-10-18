# Auditoría operativa de Production para el lanzamiento de SUR4 — 16/10/2026

Auditoría **sin modificar datos y sin cuentas reales**: consultas de solo lectura a
Production (agregados y sí/no, sin datos personales), peticiones HTTP anónimas,
avisos de Supabase, logs de las últimas 24 h y pruebas completas en Staging con el
mismo código y el mismo esquema. Los volúmenes concretos del tenant se comunican
fuera del repositorio.

## Estado de partida

| Elemento | Estado |
| --- | --- |
| Código | `main` `c5eebbf` en Production; `gestcopy-staging` sincronizado con el mismo árbol (`0677f3e`) |
| Esquema | Production, Staging y `main`: las mismas 71 migraciones. Columnas, políticas RLS y triggers idénticos entre Production y Staging. Las 171 funciones coinciden en lógica: 11 difieren solo en comentarios y 1 en espacios (Production se aplicó sin ellos) |
| Aislamiento | Production usa su proyecto de Supabase; Staging y las previews de las PR usan el de Staging (comprobado en los bundles publicados) |
| Staging | Release Gate en verde sobre `gestcopy-staging` (run `38828455015`); E2E V0 3/3 (run `38828569166`); comprobaciones del sprint 6/6 (ayuda, pie de presupuestos, dirección de clientes, sesión, logos, Pro desactivado) |

## Resultado por área

| Área | Comprobado sin datos ni sesión | Resultado |
| --- | --- | --- |
| Autenticación | Login de `sur4.app.gestcopy.com` 200; APIs sin sesión → 401 `SESSION_EXPIRED` con caché privada; todas las cuentas del tenant confirmadas, sin bloqueos, sin MFA | OK. **Riesgo**: protección de contraseñas filtradas desactivada (aviso de Supabase) |
| Roles | Tenant activo y `ready`; owner, admin y staff presentes; sin accesos inactivos ni invitaciones pendientes; miembros del equipo vinculados a su usuario | OK |
| Pedidos | Estados configurados (un inicial, un «listo», cerrados y cancelado); catálogos de servicios, tiendas, canales, contextos y tipos de cliente con valores activos; actividad reciente | OK |
| Clientes | Cartera cargada; deduplicación activa (los dos `23505` de las últimas 24 h son duplicados detectados) | OK. La dirección (#107) aún no se usa |
| Presupuestos | Feature `quotes` activa; conversiones a pedido realizadas | OK |
| Cobros | Libro intacto tras la expand de #95; cobros históricos «Sin especificar» | OK. Pendiente: contract de #95 (no antes del 16/10, 22:34 UTC) |
| Archivos | Sin subidas a medias; cola de borrado en R2 sin pendientes ni fallos; uso muy por debajo del límite de 5 GiB del plan Basic | OK |
| Notificaciones | Invitaciones por Resend (`EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`); recuperación de contraseña por Supabase Auth; los avisos al cliente final son manuales (no se envía nada automáticamente) | **Sin verificar**: configuración de Resend y del SMTP de Auth (ver pendientes) |
| Rendimiento | API de Supabase, 24 h: 0 respuestas 5xx; p50 118–155 ms, p95 300–427 ms. Vercel: 150–380 ms en caliente, ~1,2 s en frío para `/api/context`. BD de ~20 MB | OK con el volumen actual. Avisos menores: 25 FK sin índice, 3 políticas de `profiles` que evalúan `auth.uid()` por fila, un índice duplicado en `orders` |
| Plan comercial | Suscripción interna de prueba (Basic, sin Stripe) que vence en unos días | **Decisión pendiente** (#35). Al vencer no se corta nada (el acceso depende del estado, no de la fecha), pero Facturación mostrará un periodo pasado |

## Riesgos para el lanzamiento (por prioridad)

1. **Supabase en plan Free.** Sin copias de seguridad diarias gestionadas y sin
   protección de contraseñas filtradas. Recomendación: pasar la organización a Pro
   (copias diarias) antes de operar con un cliente de pago o, como mínimo, programar
   un volcado diario cifrado fuera de Supabase.
2. **Vercel probablemente en Hobby.** La cuenta no pertenece a ningún equipo y Hobby
   no admite uso comercial. Confirmar en el panel y pasar a Pro.
3. **Copia local apuntando a Production.** El `.env.local` de la copia principal del
   repositorio usa el proyecto de Production (solo clave pública). El `42703` de las
   18:40 UTC del 15/10 (`order_payments.receipt_file_id`) fue código de #95
   consultando Production antes de su migración, compatible con un servidor local.
   Recomendación: desarrollo local contra Staging o Supabase local.
4. **Fin de la prueba interna de SUR4.** Decidir condiciones y Stripe Live (#35) antes
   de que venza, para que Facturación no muestre un periodo caducado.
5. **Correo.** Verificar en Resend el dominio de `EMAIL_FROM` (SPF/DKIM) y si Supabase
   Auth usa SMTP propio: el SMTP por defecto limita mucho los correos de
   recuperación de contraseña.
6. **Siete `permission denied for table tenants`** desde PostgREST (08:03–08:32 y
   16:51 UTC del 15/10). Sin impacto visible; origen sin identificar (no coincide con el
   tráfico anónimo normal). Vigilar.
7. **Mantenimiento de BD** (no bloqueante): índice duplicado en `orders`, políticas de
   `profiles` con `(select auth.uid())`, índices para las FK más usadas.

## Qué puede verificarse sin sesión real y qué no

| Tipo | Pruebas | Cómo |
| --- | --- | --- |
| **Hecho sin datos ni sesión** | Disponibilidad, guardas de API, caché, esquema, migraciones, configuración del tenant, roles, avisos, logs, latencia | Esta auditoría |
| **Hecho en Staging con datos sintéticos** | Todos los flujos con escritura del sprint: pedidos, archivos (R2), cobros con método y justificante, dirección de clientes, notas de presupuesto, sesión caducada, logos, Pro | E2E V0 y comprobaciones por PR; mismo código y esquema que Production |
| **Requiere sesión real, solo lectura** | Login y cierre de sesión en `sur4`; navegación por rol (owner, admin, staff); listados y fichas de pedidos, clientes y presupuestos; descarga de un archivo y de un PDF de presupuesto; panel de cobros; cabecera con el logo; móvil | Con la titular de SUR4, mirando sin modificar |
| **Requiere sesión real y escribe datos** | Crear pedido, subir archivo, fijar total, registrar y anular cobro con justificante, convertir un presupuesto aceptado, crear y editar cliente con dirección, generar PDF, invitar a alguien (correo real), recuperar contraseña (correo real) | Solo con autorización expresa. Alternativa recomendada: un tenant de verificación en Production con un usuario sintético, que ejercita la infraestructura real (R2, Resend, Auth) sin tocar datos de SUR4 |

## Siguiente paso propuesto

1. Decidir planes de Supabase y Vercel y las condiciones comerciales de SUR4 (#35).
2. Verificar Resend y el SMTP de Auth en sus paneles.
3. Sesión guiada de solo lectura con la titular de SUR4 (lista anterior).
4. Si se autoriza, tenant de verificación en Production para los flujos con escritura.
