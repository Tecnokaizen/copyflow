# ADR — Gestcopy Pro · Acceso anticipado V1

Fecha: 15 de octubre de 2026. Estado: **propuesto, previo a implementación**.

Base: `03fa094e11c0b2e583381c5630cf96acf35631e2`.
Evidencia: [auditoría de planes, flags y permisos](../PRO-EARLY-ACCESS-AUDIT.md).

## Contexto y objetivo

SUR4/Tamara debe descubrir el programa de acceso anticipado Pro sin cambios
en el compromiso Basic de 39 €/mes. Se prepara la presentación de
«Gestcopy AI — Pedidos por voz» como funcionalidad futura. La confianza depende
de distinguir lo que está disponible de lo que está en preparación.

Se mantiene un codebase, un proyecto Vercel y un deployment de producción;
un proyecto Supabase/PostgreSQL compartido para N tenants con `tenant_id`,
memberships, autorización y RLS. El entorno de staging ya existente está
aislado de Production; no representa infraestructura por copistería.

## Decisión propuesta

Reutilizar `features` + `tenant_feature_overrides` + `tenant_has_feature`.
El programa es una concesión por tenant independiente de su suscripción.
No insertar un plan `pro`, una segunda suscripción, un Price/Product Stripe
ni un cambio en Checkout, Portal, webhook o cuota de almacenamiento.

| Concepto | Representación V1 | Efecto |
| --- | --- | --- |
| Plan contratado | Modelo de billing existente, intacto | Fuente para presentar el plan y precio reales en su pantalla actual. |
| Participación en el programa | Nuevo feature `pro_early_access`, sin `plan_features` | Su override habilita la etiqueta y la página informativa del programa. |
| Pedidos por voz | Código reservado `ai_voice_orders` en catálogo, sin `plan_features` y sin concesiones | Continúa «En preparación», sin grabación ni llamadas a proveedores. |
| Presupuestos | Feature `quotes` existente | Sigue dependiendo de su concesión y rol actuales; no se modifica. |

En V1 ninguna de estas dos features nuevas hereda acceso de Basic/MVP ni de
una suscripción Stripe Test/Live. La pertenencia al programa no es una
concesión global de todas las funciones presentes o futuras de Pro.

La disponibilidad de voz permanecerá fijada a `planned` en esta entrega,
incluso si alguien activa su flag por error. El booleano de permiso no debe
anunciar una capacidad que todavía no existe. La implementación futura
exigirá además disponibilidad técnica y autorización de cada operación.

El programa no tiene fecha de vencimiento automática en V1; no se anuncia
como prueba de X días ni como gratuito para siempre. Una futura transición
de pago tendrá su propia decisión y comunicación.

## Experiencia propuesta

Etiqueta discreta «Pro · Acceso anticipado» junto a la identidad de la
organización, solo con `pro_early_access=true`. En móvil, una versión breve
«Pro · Anticipado», con nombre accesible completo. Sin modal al entrar,
confeti, urgencia comercial, rediseño del panel diario ni CTA de contratación.

La etiqueta enlaza a `/pro`, página informativa autenticada que usa el shell
actual. Puede verla cualquier membership activa del tenant enrolado, incluido
viewer; informar no concede permiso para crear pedidos. Acceso directo sin
enrolamiento devuelve la página de no encontrado y no detalles del programa.

Copy propuesto:

> **Gestcopy Pro · Acceso anticipado**
>
> Tu copistería participa en el acceso anticipado a nuevas funcionalidades Pro.
> Tu plan y tu cuota no cambian. Este acceso no genera cargos adicionales.
>
> **Gestcopy AI — Pedidos por voz** · En preparación
>
> Estamos preparando una forma de dictar un pedido y revisar sus datos antes de
> guardarlo. Todavía no está disponible.

El precio se mantiene en la pantalla de billing actual, accesible por owner.
No añadir un «Basic 39 €» fijo al contexto de todos los tenants ni renombrar
el plan actual como Pro. Si el snapshot de SUR4 muestra un plan interno o
legacy, registrar la discrepancia y mantener los datos: el programa no es una
migración comercial encubierta.

## Cambios mínimos previstos

| Pieza | Cambio previsto |
| --- | --- |
| Nueva migración aditiva | Insertar los códigos `pro_early_access` y `ai_voice_orders`, con nombres/descripciones. Sin filas de `plan_features` ni concesiones a tenants. No reescribir migraciones aplicadas. |
| `lib/features/early-access.ts` y helper servidor correspondiente | Centralizar códigos y política de presentación. Resolver programa con cliente Supabase de sesión y RPC existente. Voz siempre `planned` en V1. |
| `app/api/context/route.ts` | Añadir `early_access.pro: boolean` y, solo para enrolados, `early_access.voice_orders.status: "planned"`. Conservar `features.quotes`; respuesta `Cache-Control: private, no-store`. Sin datos comerciales nuevos ni cliente admin. |
| `components/app-nav.tsx` | Leer el campo nuevo y mostrar etiqueta/enlace accesibles sin rehacer la navegación. Desconocido/error implica ocultar. |
| `components/pro/early-access-info.tsx` y `app/pro/page.tsx` | Tarjeta compartida y página informativa con guard servidor de contexto activo + feature. Sin cargar billing para miembros no owner. |
| Nueva suite SQL Pro | Fixtures sintéticos de dos tenants; resolución, aislamiento, ausencia de herencia del plan y prohibición de autoconcesión. |
| `.github/workflows/release-gate.yml` | Incorporar esa suite a la lista permanente de pruebas SQL locales. |
| Documentación operativa | Registrar validación visual/staging, preflight, concesión/revocación y evidencia mínima. |

No añadir un endpoint público para cambiar flags, lógica `slug === "sur4"`,
variables de entorno por copistería, nuevas dependencias ni un motor paralelo
de entitlements. El enrolamiento se hace con datos por `tenant_id` mediante
la operación privilegiada ya existente.

No introducir caducidad e historial nuevos en esta entrega. Para el piloto,
registrar de forma operativa entorno, tenant, flag, operador, motivo, valor
previo y resultado. Si el programa escala o necesita expiración automática,
proponer entonces una ampliación específica y auditable.

## Base para la futura funcionalidad de voz

V1 reserva el nombre y el punto de concesión. No pide micrófono, recoge audio,
crea pedidos, aprovisiona credenciales ni llama a un proveedor de IA.

Antes de implementar voz, especificar un flujo que produzca un borrador para
revisión humana y reutilice la creación actual de pedidos. Su autorización
será la combinación de sesión, tenant activo, membership activa, rol que puede
crear pedidos, feature de voz y disponibilidad técnica. Ser participante Pro por sí solo
no basta. Ningún `tenant_id` del navegador podrá sustituir al contexto servidor.

El diseño de voz deberá resolver límites por tenant/usuario, validación del
audio, tratamiento y retención, costes, identificación de clientes/servicios,
datos ambiguos y errores antes de aceptar audio real. No inventar reglas del
negocio de Tamara ni guardar pedidos sin confirmación. Esta fase no decide
proveedor, modelo, tarifa futura ni fecha de disponibilidad.

## Secuencia y criterios de aceptación

1. **Auditoría y ADR (esta entrega).** Inventario de código confirmado,
   límites, puntos de extensión y diferencias entre evidencia y datos remotos.
2. **Implementación de base y UI.** Cambios mínimos de la tabla anterior;
   por defecto ningún tenant enrolado. Revisar el diff de seguridad antes de
   aplicar una migración o promover una versión.
3. **Validación local.** Unit tests de ausencia/error/override explícito,
   programa activado sin voz operativa, y roles; typecheck, lint, build en
   Node 22 y Release Gate completo. SQL: anon, miembro de A frente a B,
   contexto con membership/tenant inactivos, owner/admin/staff sin autoconcesión; verificar
   que program ON/OFF no modifica suscripciones, precios, cuotas ni `quotes`.
   Incluir estados `active/trialing/past_due/canceled` y ambos `livemode` para
   demostrar que el programa no interpreta ni altera facturación.
   Para tenant inactivo, comprobar la denegación en el contexto/página/API;
   la RPC de flags existente solo verifica la membership, como recoge la auditoría.
4. **Staging.** Usar solo el tenant sintético `e2e` y usuarios de prueba,
   Supabase/R2 Staging. No clonar datos SUR4. Guardas existentes activas;
   ejecutar E2E V0 de regresión y recorrido Pro ON/OFF, acceso directo y dos
   roles, escritorio/móvil y claro/oscuro. No iniciar Checkout ni Portal.
   Preparar el cambio de flag antes de lanzar el navegador; el runner y el
   workflow E2E siguen sin recibir service_role.
5. **Piloto SUR4 (fase posterior controlada).** Solo tras los gates, snapshot
   mínimo de solo lectura y plan exacto de activación/revocación. Cualquier
   promoción o escritura Production será una operación separada y concreta;
   esta entrega no activa SUR4 ni publica cambios.

Para staging y piloto, probar revocación en servidor y tras recarga. Una
etiqueta antigua en una pestaña no puede mantener acceso a futuras APIs.

## Preflight y revocación

Separar dos operaciones: desplegar código compartido con defaults apagados y
conceder el programa al tenant elegido. No introducir concesiones SUR4 en una
migración global.

El preflight debe verificar el destino mediante identidad inequívoca de
entorno, no solo el slug; coincidencia del tenant esperado, catálogo presente,
migraciones aplicadas y estado previo de ambos flags. Capturar únicamente los
campos necesarios y comparar billing, cuotas y `quotes` antes/después.

La operación prevista concede **solo** `pro_early_access=true` mediante el
setter existente, en transacción y bajo un operador de confianza. La ejecución
se aborta si no coincide exactamente el entorno o tenant esperado. El script
local no debe modificarse para saltar su restricción de host. Preparar primero
el ensayo en staging y su evidencia.

Para detener el programa, `pro_early_access=false` prevalece sobre el fallback
de plan. Si se pretende restaurar exactamente una situación previa sin fila de
override, será necesaria la restauración controlada de esa ausencia; una fila
`false` es un apagado explícito, no el mismo estado. Preservar overrides ajenos,
incluidos `quotes` y cualquier flag de voz previo. No borrar catálogo,
suscripciones, pedidos, archivos ni historial como rollback.

## Alternativas y consecuencias

Crear un plan Pro o una suscripción adicional afectaría billing, el índice de
suscripción vigente y potencialmente Stripe. Se descarta para esta misión.
Codificar SUR4 en frontend o guardar el derecho en preferencias editables
debilitaría la concesión por tenant. Se descarta. Un sistema nuevo de grants
con caducidad e historial sería más completo, pero añade una segunda autoridad
sin necesidad demostrada para este piloto.

La propuesta permite entrega pequeña y revocable, conserva el core compartido
y evita equiparar un anuncio con una funcionalidad disponible. Su límite
conocido es un programa gestionado manualmente, sin vencimiento automático ni
historial de concesiones en BD.
