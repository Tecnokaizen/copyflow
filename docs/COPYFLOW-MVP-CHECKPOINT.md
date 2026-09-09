```
# COPYFLOW — MVP CHECKPOINT

**Estado:** Núcleo funcional MVP cerrado y desplegado  
**Fecha:** 7 de septiembre de 2026  
**Repositorio:** `Tecnokaizen/copyflow`  
**Rama principal:** `main`  
**Supabase project:** `copyflow-mvp`  
**Project ref:** `wsclqvlzjdgwkxbolhoy`

---

# 1. Propósito de este documento

Este documento fija el estado técnico y funcional de COPYFLOW al cierre del núcleo del MVP.

Debe utilizarse como referencia operativa para continuar el desarrollo sin reinterpretar decisiones ya cerradas.

No sustituye las fuentes maestras del proyecto.

Orden de prioridad:

1. `Arquitectura inmutable de Copyflow.md`
2. Fuentes oficiales de Vercel y Supabase documentadas en el proyecto
3. Este checkpoint del MVP
4. Código y migraciones actuales del repositorio
5. SUR4 como referencia funcional de negocio

SUR4 sirve como modelo funcional de una copistería, pero no define la arquitectura SaaS de COPYFLOW.

---

# 2. Arquitectura oficial e inmutable

COPYFLOW es una plataforma SaaS multi-tenant con infraestructura compartida.

La arquitectura oficial es:

```text
GitHub
   │
   ▼
1 CODEBASE
   │
   ▼
VERCEL
1 Project
1 Production Deployment
   │
   ├── sur4.copyflow.com
   ├── demo.copyflow.com
   ├── tenant-x.copyflow.com
   └── ...
          │
          ▼
      COPYFLOW
          │
          ▼
      SUPABASE
      1 Project
      1 PostgreSQL
          │
          ├── tenant SUR4
          ├── tenant DEMO
          ├── tenant X
          └── ...
```

No existe infraestructura independiente por tenant.

No crear:

```
Vercel Project por tenant
Supabase Project por tenant
PostgreSQL por tenant
Repositorio por tenant
Deployment por tenant
DATABASE_URL por tenant
Fork de código por tenant
```

La arquitectura acordada es:

```
Codebase                1
Repositorio             1
Proyecto Vercel         1
Production Deployment   1
Proyecto Supabase       1
PostgreSQL              1

Tenants                 N
Usuarios                N
Memberships             N
Subdominios             N
```

El aislamiento lógico se basa en:

```
hostname / tenant resolver
        +
membership
        +
tenant_id
        +
autorización
        +
PostgreSQL RLS
```

Esta arquitectura no es provisional ni exclusiva del MVP. Es la arquitectura objetivo del producto.

------

# 3. Resolución del tenant

El tenant se deriva en servidor.

Conceptualmente:

```
hostname
   ↓
sur4.copyflow.com
   ↓
slug = sur4
   ↓
tenants.slug
   ↓
tenant_id
   ↓
membership del usuario
   ↓
contexto de la petición
   ↓
consultas / RPC / RLS
```

El navegador no decide el `tenant_id`.

Las APIs no deben aceptar un `tenant_id` del frontend como fuente de autoridad.

El patrón actual de COPYFLOW deriva el tenant desde el contexto server-side y utiliza después ese `tenant_id` para las operaciones contra Supabase.

------

# 4. Seguridad multi-tenant

La seguridad no depende únicamente de Next.js.

COPYFLOW aplica defensa en varias capas:

```
Next.js tenant resolver
        ↓
sesión Supabase Auth
        ↓
membership activa
        ↓
tenant_id
        ↓
RLS
        ↓
RPC tenant-aware
```

La auditoría realizada sobre la BD confirmó:

- RLS activo en las 24 tablas del esquema `public`.
- Las policies utilizan `is_tenant_member(tenant_id)` para lectura.
- Las escrituras utilizan `has_tenant_role(...)`.
- El rol `anon` no dispone de grants sobre las tablas de negocio.
- Las RPC operativas críticas utilizan `SECURITY INVOKER`.
- Las RPC validan explícitamente el `tenant_id`.
- Las relaciones utilizadas en escrituras se validan contra el mismo tenant.
- Las policies de `memberships` impiden escaladas indebidas de privilegios.

La amenaza principal a proteger es:

```
usuario autenticado Tenant A
        ↓
intenta acceder a Tenant B
        ↓
DEBE SER BLOQUEADO
```

No basta con proteger únicamente frente a usuarios anónimos.

------

# 5. Roles SaaS y Equipo operativo

COPYFLOW diferencia dos conceptos que nunca deben mezclarse.

## 5.1 Memberships

`memberships` controla acceso y autorización SaaS.

Conceptualmente:

```
membership
- tenant_id
- user_id
- role
- active
```

Roles actualmente utilizados:

```
owner
admin
manager
staff
viewer
```

Estos roles determinan permisos de aplicación.

------

## 5.2 Team members

`team_members` representa personas operativas de la copistería.

Campos relevantes:

```
id
tenant_id
user_id
name
email
phone
job_title
department
active
can_receive_orders
notes
metadata
```

Un `team_member` puede existir sin cuenta de acceso.

Actualmente en SUR4 existen miembros operativos sin relación con Auth:

```
Diseño
Mostrador
Tamara
```

Por tanto:

```
team_members != memberships
```

`job_title` es texto libre.

En interfaz debe mostrarse como:

```
Puesto / función
```

No como:

```
Rol
```

`department` se presenta como:

```
Área
```

No crear un catálogo de puestos mientras no exista una necesidad funcional confirmada.

------

# 6. Módulos funcionales cerrados

El núcleo funcional del MVP está completo.

```
Pedidos       ✅
Clientes      ✅
Servicios     ✅
Equipo        ✅
Actividad     ✅
```

------

# 7. Pedidos

Pedidos es el núcleo operativo del sistema.

Incluye:

- listado;
- creación;
- detalle;
- edición;
- estado;
- prioridad;
- servicio;
- canal de entrada;
- contexto;
- responsable;
- fecha prevista;
- cliente;
- contenido y notas;
- gestión;
- notificación al cliente.

Las escrituras relevantes se realizan mediante RPC tenant-aware.

La lógica de estado no debe hardcodear nombres en español.

Para determinar si un pedido está activo debe utilizarse la semántica de `order_statuses`:

```
is_closed = false
and is_cancelled = false
```

Ejemplo SUR4:

```
Pendiente      activo
En proceso     activo
Terminado      activo
Entregado      cerrado
Cancelado      cerrado/cancelado
```

`Terminado` significa preparado.

`Entregado` significa recibido por el cliente.

Esto debe seguir siendo configurable por tenant.

------

# 8. Pedido ↔ Cliente

La relación Pedido ↔ Cliente está cerrada.

Reglas:

- un pedido puede crearse sin cliente;
- el cliente nunca debe bloquear la creación del pedido;
- después puede asignarse, cambiarse o eliminarse;
- puede crearse un cliente nuevo desde el flujo de pedido;
- el selector de cliente es reutilizable;
- la búsqueda se realiza server-side;
- existe debounce en frontend;
- los resultados están limitados.

Duplicados fuertes por tenant:

```
email normalizado
teléfono normalizado
NIF/CIF normalizado
```

Los nombres pueden repetirse.

Normalizadores:

```
normalize_client_email
normalize_client_phone
normalize_client_tax_id
```

Los índices únicos normalizados están aplicados por tenant.

------

# 9. Clientes

El módulo Clientes está cerrado.

Incluye:

- listado;
- búsqueda;
- filtro por tipo;
- filtro activos/inactivos;
- paginación;
- alta;
- ficha;
- edición;
- número de pedidos;
- último pedido;
- navegación desde pedidos.

RPC principales:

```
search_clients
check_client_duplicates
create_client
create_client_and_assign_order
update_client
assign_order_client
list_clients
```

La fecha de “último pedido” se basa en:

```
orders.created_at
```

No en `due_at`.

------

# 10. Servicios

El módulo Servicios está cerrado.

Incluye:

- listado;
- búsqueda;
- filtro por categoría;
- activos/inactivos;
- alta;
- edición;
- plazo estándar;
- flags operativos;
- contador de pedidos;
- plazo medio.

RPC:

```
list_services
create_service
update_service
```

No existe actualmente CRUD de categorías desde la UI.

No se añadió una nueva FK a `services.category_id` durante el MVP.

Las RPC validan explícitamente que la categoría pertenezca al mismo tenant.

No existe regla de unicidad por nombre de servicio salvo futura decisión de producto.

------

# 11. Equipo

El módulo Equipo está cerrado.

Incluye:

- listado;
- búsqueda;
- filtro activos/inactivos;
- métricas;
- pedidos activos;
- pedidos históricos;
- edición de datos operativos;
- disponibilidad para recibir pedidos.

RPC:

```
list_team_members
update_team_member
```

No existe `create_team_member` en el MVP.

No se gestionan desde este módulo:

```
Auth
memberships
invites
user_id
provisioning
```

La reasignación de pedidos se mantiene dentro de Pedidos.

------

# 12. Registro de actividad

El módulo Actividad está cerrado.

Ruta:

```
/activity
```

Es exclusivamente de lectura.

RPC:

```
list_activity_log
```

Características:

- `SECURITY INVOKER`;
- tenant-aware;
- paginada;
- filtros por entidad, acción, usuario y fechas;
- actor resuelto mediante `profiles`;
- detalles anteriores/nuevos;
- navegación hacia pedido o cliente;
- acceso orientado a `owner/admin/manager`.

No existen:

```
POST /activity
PATCH /activity
DELETE /activity
```

La UI transforma los eventos en lenguaje humano.

No debe mostrar JSON bruto ni UUIDs cuando existe una representación legible.

Ejemplos:

```
Rubén cambió el estado de SUR4-0009
Pendiente → En proceso
Rubén cambió el servicio de SUR4-0011
Encuadernación → Diseño gráfico
Rubén actualizó a Tamara
Puesto / función:
Administración → ...
```

------

# 13. Auditoría automática

`activity_log` se alimenta mediante triggers.

Cobertura actual del núcleo MVP:

```
Pedidos       ✅
Clientes      ✅
Servicios     ✅
Equipo        ✅
```

Eventos actuales:

## Clientes

```
client.created
client.updated
```

## Pedidos

```
order.created
order.status_changed
order.client_changed
order.content_changed
order.details_changed
order.management_changed
order.notification_changed
```

## Servicios

```
service.created
service.updated
```

## Equipo

```
team_member.created
team_member.updated
```

Puede existir actividad histórica como:

```
seed.created
```

Los triggers de auditoría utilizan funciones específicas `SECURITY DEFINER` únicamente para poder insertar en `activity_log`.

El usuario normal no debe obtener permiso de escritura directa sobre `activity_log`.

------

# 14. Actor vs entidad auditada

No confundir:

```
user_id / team_member_id
```

con:

```
entity_id
```

Ejemplo:

Rubén modifica a Tamara.

Debe registrarse:

```
user_id        = Rubén
team_member_id = null

entity_type     = team_member
entity_id       = Tamara
```

El `team_member_id` de `activity_log` representa potencialmente al actor operativo, no la entidad modificada.

------

# 15. Baseline de Supabase

La base de datos de producción ha sido consolidada en Git.

Supabase CLI inicializado:

```
supabase/
```

Baseline:

```
supabase/migrations/20260907171432_remote_schema.sql
```

La baseline fue generada mediante:

```
npx supabase db pull
```

y marcada como aplicada en el historial remoto.

Validaciones realizadas:

```
npx supabase db reset --local
```

Resultado:

```
Finished supabase db reset
```

Por tanto, una base local limpia puede reconstruirse a partir de la migración.

También se verificó:

```
npx supabase migration list
```

con:

```
LOCAL             REMOTE
20260907171432    20260907171432
```

Y:

```
npx supabase db diff --linked --schema public
```

Resultado:

```
No schema changes found
```

Esto confirma:

```
Git schema == Supabase remoto
```

en el momento del checkpoint.

------

# 16. Nueva regla para cambios de BD

A partir de este checkpoint:

**NO realizar cambios permanentes de esquema únicamente desde SQL Editor sin versionarlos.**

Todo cambio estructural debe terminar representado en:

```
supabase/migrations/
```

Patrón:

```
20260907171432_remote_schema.sql
20260908xxxxxx_nombre_cambio.sql
20260909xxxxxx_otro_cambio.sql
...
```

Flujo recomendado:

```
1. Diseñar cambio
2. Crear migración
3. Probar localmente
4. Revisar diff
5. Aplicar al entorno correspondiente
6. Validar RLS/tenant
7. Commit
```

Si durante una investigación se ejecuta SQL manual en Supabase, antes de cerrar la tarea debe consolidarse en una migración.

------

# 17. Reglas para RPC

Las RPC que operen sobre datos tenant deben seguir por defecto:

```
SECURITY INVOKER
SET search_path = ''
```

y comprobar:

```
auth.uid()
membership / has_tenant_role
p_tenant_id
entity.id + tenant_id
relaciones auxiliares + tenant_id
```

No confiar en que el frontend haya enviado IDs correctos.

Ejemplo conceptual:

```
where id = p_entity_id
  and tenant_id = p_tenant_id
```

Las referencias relacionadas deben validarse contra ese mismo tenant.

------

# 18. SECURITY DEFINER

No utilizar `SECURITY DEFINER` para RPC normales de negocio salvo necesidad técnica plenamente justificada.

Uso aceptado actual:

```
triggers internos de auditoría
```

Su propósito es insertar automáticamente en `activity_log` después de una operación ya autorizada.

Estas funciones deben:

- fijar `search_path`;
- validar actor;
- validar tenant/rol;
- no exponerse como RPC pública;
- tener `EXECUTE` revocado a `public`, `anon` y `authenticated` cuando no necesiten invocación directa.

------

# 19. Personalización por tenant

Las diferencias entre copisterías deben residir en datos/configuración.

Ejemplos:

```
tenant_settings
order_statuses
services
entry_channels
customer_types
features
branding
```

No utilizar forks de código.

Ejemplo:

SUR4:

```
Pendiente
En proceso
Terminado
Entregado
```

Otro tenant podría usar:

```
Recibido
Diseño
Producción
Listo
Recogido
```

sin modificar el core.

------

# 20. Onboarding futuro

Crear un nuevo tenant significa crear datos, no infraestructura.

Flujo conceptual oficial:

```
Cliente contrata
      ↓
crear tenant
      ↓
crear/asociar owner
      ↓
crear membership
      ↓
crear tenant_settings
      ↓
crear configuración inicial
      ↓
reservar slug
      ↓
tenant operativo
```

Resultado:

```
nombre.copyflow.com
```

No implica:

```
crear Vercel
crear Supabase
crear PostgreSQL
crear deployment
```

------

# 21. SUR4 como referencia funcional

SUR4 sigue siendo una fuente valiosa para conocer cómo trabaja una copistería.

El PRD original contempla:

- pedidos;
- clientes;
- servicios;
- equipo;
- prioridades;
- estados;
- fechas;
- asignaciones;
- carga de trabajo;
- canales de entrada;
- calendario;
- notificación al cliente.

COPYFLOW reutiliza estos conceptos cuando son generalizables.

Sin embargo:

```
SUR4 architecture != COPYFLOW architecture
```

SUR4 originalmente utilizaba:

```
ChatGPT Sites
→ API interna
→ Airtable
```

COPYFLOW utiliza:

```
Next.js
→ Supabase
→ PostgreSQL compartido
→ RLS multi-tenant
```

No copiar dependencias específicas de Airtable al core SaaS.

------

# 22. Estado de seguridad pendiente

El aislamiento multi-tenant principal está validado.

Quedan mejoras de hardening que no bloquearon el MVP.

## Prioridad media

### Errores raw de BD

Algunas rutas históricas pueden devolver mensajes internos de Postgres/PostgREST.

Objetivo:

```
log detallado en servidor
+
mensaje genérico al frontend
```

### Dependencias

Se detectó uso de dependencias con `latest` y ausencia de lockfile en la auditoría inicial.

Antes de producción comercial:

```
fijar versiones exactas
generar lockfile
versionarlo
```

### Sign-up

Debe decidirse formalmente:

```
alta libre
vs
invitación / onboarding controlado
```

Actualmente un usuario sin membership no obtiene acceso a tenants, por lo que no existe fuga cross-tenant, pero debe cerrarse como decisión de producto.

------

## Prioridad baja

### GET /api/tenant

Revisar si debe exigir autenticación o dejar de devolver UUID interno.

### Leaked Password Protection

Activar en Supabase Auth antes de producción comercial.

### pg_trgm

La extensión está en `public`.

Moverla a un esquema dedicado es hardening informativo/post-MVP y no debe hacerse de forma precipitada si introduce riesgo.

### Navegación por roles

Actualmente algunas opciones pueden seguir visibles para usuarios que después reciben `403` del backend.

La seguridad es correcta porque el backend/RPC manda.

Más adelante puede implementarse una capa centralizada de capabilities para mejorar UX.

------

# 23. Principios de desarrollo a partir de ahora

Cada cambio debe respetar:

1. No romper el modelo multi-tenant.
2. No aceptar `tenant_id` del navegador como autoridad.
3. No confiar únicamente en frontend.
4. Mantener RLS.
5. Utilizar `SECURITY INVOKER` para negocio salvo excepción justificada.
6. Validar relaciones contra el mismo tenant.
7. No mezclar `memberships` con `team_members`.
8. No inventar reglas de negocio.
9. Mantener configuración tenant-specific en BD.
10. No crear infraestructura por cliente.
11. No modificar módulos estables sin necesidad.
12. Versionar cualquier cambio de BD.
13. Añadir auditoría cuando una nueva entidad operativa sea editable.
14. Probar siempre acceso cross-tenant en nuevas superficies sensibles.
15. Mantener código y esquema reproducibles desde Git.

------

# 24. Flujo de validación recomendado

Para una nueva funcionalidad:

```
1. Inspeccionar esquema real
2. Confirmar regla de negocio
3. Diseñar RPC / API
4. Validar tenant y rol
5. Probar funcionalmente en SUR4
6. Probar caso límite
7. Probar SUR4 → DEMO
8. Implementar UI
9. npm run build
10. lint / TypeScript
11. desplegar
12. validar producción
13. consolidar migración
14. commit
```

La prueba cross-tenant debe considerarse una prueba estándar.

------

# 25. Estado actual del MVP

```
ARQUITECTURA

1 repo                       ✅
1 Vercel                     ✅
1 Supabase                   ✅
multi-tenant lógico          ✅
tenant resolver              ✅
memberships                  ✅
RLS                          ✅


FUNCIONAL

Pedidos                      ✅
Clientes                     ✅
Servicios                    ✅
Equipo                       ✅
Actividad                    ✅


SEGURIDAD

RLS 24 tablas                ✅
RPC tenant-aware             ✅
cross-tenant tests           ✅
auditoría                    ✅
anon sin grants negocio      ✅


BASE DE DATOS

baseline Git                 ✅
migration history alineado   ✅
db reset local               ✅
db diff remoto               ✅


DESPLIEGUE

GitHub main                  ✅
Vercel production            ✅
```

------

# 26. Próximas fases recomendadas

El siguiente trabajo ya no consiste en completar el CRUD principal.

Orden recomendado:

## Fase A — Hardening y consistencia

- fijar dependencias;
- añadir lockfile;
- normalizar errores de API;
- revisar `/api/tenant`;
- decidir sign-up/onboarding;
- activar protección de contraseñas filtradas;
- capabilities frontend.

## Fase B — Pulido UX

- dashboard operativo;
- navegación;
- estados vacíos;
- feedback de carga/error;
- responsive;
- consistencia visual;
- permisos visibles según rol.

## Fase C — Demo

- tenant DEMO;
- datos de ejemplo;
- flujo demostrable;
- landing;
- vídeos;
- recorrido comercial.

## Fase D — Onboarding SaaS

- alta de tenant;
- owner;
- membership;
- configuración inicial;
- slug;
- provisioning lógico;
- selección de plan.

## Fase E — Evolución

- branding por tenant;
- dominios personalizados;
- almacenamiento;
- notificaciones;
- automatizaciones;
- reporting;
- funcionalidades premium.

------

# 27. Regla final

Cuando exista duda sobre cómo debe evolucionar COPYFLOW, volver siempre a esta secuencia:

```
Arquitectura oficial
        ↓
tenant isolation
        ↓
regla de negocio
        ↓
modelo de datos
        ↓
backend / RLS
        ↓
frontend
```

Nunca al revés.

COPYFLOW debe seguir siendo:

```
1 core
1 deployment
1 Supabase
N tenants
```

con aislamiento:

```
tenant_id
+
memberships
+
autorización
+
RLS
```

y personalización basada en datos, no en infraestructura separada.
