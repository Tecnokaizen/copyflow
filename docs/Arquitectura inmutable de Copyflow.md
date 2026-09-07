# COPYFLOW — ARQUITECTURA MULTI-TENANT OFICIAL

## Regla principal

La arquitectura de Copyflow es **multi-tenant con infraestructura compartida**.

Esto significa:

- **1 único repositorio / codebase**
- **1 único proyecto de Vercel**
- **1 único deployment de producción**
- **1 único proyecto de Supabase**
- **1 única base PostgreSQL compartida**
- **N tenants dentro de esa misma aplicación y base de datos**
- Aislamiento lógico mediante `tenant_id`, memberships, autorización y PostgreSQL Row Level Security (RLS)

Esta arquitectura es tanto la del **MVP** como la arquitectura objetivo del producto.

No debe reinterpretarse como una solución provisional.

---

# Arquitectura

```text
GitHub
  │
  ▼
COPYFLOW CODEBASE
  │
  ▼
VERCEL
1 Project
1 Production Deployment
  │
  ├── copyflow.com
  ├── app.copyflow.com
  ├── sur4.copyflow.com
  ├── pepe.copyflow.com
  ├── rioja.copyflow.com
  └── *.copyflow.com
           │
           ▼
       COPYFLOW APP
           │
           ▼
       SUPABASE
       1 Project
           │
           ├── Auth
           ├── PostgreSQL
           ├── Storage
           └── RLS
                 │
                 ▼
              tenants
```

Todos los tenants ejecutan exactamente el mismo código y utilizan la misma infraestructura.

---

# Regla crítica: NO existe un deployment por tenant

No se debe proponer, asumir ni implementar:

```text
Tenant A → Vercel Project A
Tenant B → Vercel Project B
Tenant C → Vercel Project C
```

Tampoco:

```text
Tenant A → Supabase Project A
Tenant B → Supabase Project B
Tenant C → Supabase Project C
```

Eso **NO es la arquitectura de Copyflow**.

La arquitectura correcta es:

```text
                    1 Vercel Project
                          │
                  1 Production Deploy
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
       ▼                  ▼                  ▼
 sur4.copyflow.com  pepe.copyflow.com  rioja.copyflow.com
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                          ▼
                   1 Supabase Project
                          │
                          ▼
                 PostgreSQL compartido
                          │
             ┌────────────┼────────────┐
             │            │            │
             ▼            ▼            ▼
          tenant A     tenant B     tenant C
```

---

# Identificación del tenant

Cada organización tiene un registro en `tenants`.

Ejemplo:

```text
tenants

id                                   slug
----------------------------------   ----------------
uuid-sur4                            sur4
uuid-pepe                            copisteria-pepe
uuid-rioja                           imprenta-rioja
```

Una petición:

```text
https://sur4.copyflow.com
```

debe resolverse conceptualmente así:

```text
hostname
   ↓
sur4.copyflow.com
   ↓
slug = sur4
   ↓
buscar tenants.slug
   ↓
tenant_id = uuid-sur4
   ↓
establecer contexto del tenant
   ↓
consultas + autorización + RLS
```

El subdominio determina el contexto organizativo, pero **no crea una instancia nueva de la aplicación**.

---

# Base de datos

Todos los tenants utilizan la misma conexión PostgreSQL/Supabase.

Ejemplo:

```env
DATABASE_URL=postgresql://...
```

La conexión es compartida por toda la aplicación.

No existe:

```text
DATABASE_URL_SUR4
DATABASE_URL_PEPE
DATABASE_URL_RIOJA
```

ni una base PostgreSQL independiente por cliente.

El aislamiento se realiza mediante los datos.

Las tablas pertenecientes a organizaciones deben incluir `tenant_id` o relacionarse inequívocamente con una entidad que pertenezca a un tenant.

Ejemplo:

```text
orders

id
tenant_id
client_id
service_id
status_id
created_by
created_at
...
```

```text
clients

id
tenant_id
name
email
phone
...
```

```text
services

id
tenant_id
name
active
...
```

---

# Tablas estructurales recomendadas

El núcleo multi-tenant debe incluir conceptos equivalentes a:

```text
tenants
profiles / users
memberships
roles / permissions
tenant_settings

clients
orders
services
order_statuses
entry_channels
customer_types
activity_log
```

La tabla `memberships` relaciona usuarios con organizaciones.

Ejemplo:

```text
memberships

id
tenant_id
user_id
role
active
```

Un usuario podría potencialmente pertenecer a más de un tenant sin duplicar la cuenta de autenticación.

---

# Seguridad e aislamiento

La separación entre clientes nunca debe depender únicamente del frontend.

Debe existir aislamiento en varios niveles:

```text
hostname / tenant resolver
        +
membership del usuario
        +
tenant_id en consultas
        +
PostgreSQL Row Level Security
```

RLS es una pieza obligatoria del diseño.

Conceptualmente:

```text
usuario autenticado
      ↓
membership
      ↓
tenant_id permitido
      ↓
RLS
      ↓
solo filas pertenecientes a ese tenant
```

Una petición realizada por un usuario de SUR4 nunca debe poder obtener filas pertenecientes a otro tenant aunque el frontend o una API tengan un fallo.

Las políticas RLS deben cubrir, según proceda:

```text
SELECT
INSERT
UPDATE
DELETE
```

y comprobar tanto acceso del usuario como pertenencia de la fila al tenant.

---

# Onboarding

Crear un nuevo cliente NO significa crear infraestructura.

El onboarding crea datos dentro de Copyflow.

Flujo oficial:

```text
Cliente se registra
      ↓
POST /api/onboarding
      ↓
1. Crear tenant
2. Crear usuario Owner o asociar usuario existente
3. Crear membership Owner
4. Crear tenant_settings
5. Crear servicios iniciales
6. Crear estados iniciales
7. Crear canales/opciones iniciales
8. Reservar slug
9. Tenant operativo
      ↓
slug.copyflow.com
```

Ejemplo:

```text
Copistería Pepe
      ↓
slug = pepe
      ↓
tenant creado
      ↓
pepe.copyflow.com
```

No existe durante este proceso:

```text
crear proyecto Vercel
crear deployment
crear proyecto Supabase
crear PostgreSQL
crear DATABASE_URL
```

---

# Subdominios

Copyflow utiliza subdominios dinámicos:

```text
*.copyflow.com
```

Ejemplos:

```text
sur4.copyflow.com
pepe.copyflow.com
rioja.copyflow.com
demo.copyflow.com
```

Todos resuelven al **mismo proyecto y deployment de Vercel**.

La aplicación detecta el hostname y resuelve el tenant correspondiente.

---

# Dominios personalizados

Copyflow podrá permitir opcionalmente que un tenant utilice su propio dominio o subdominio.

Ejemplos:

```text
app.sur4.es
gestion.copisteriapepe.es
pedidos.imprentarioja.es
```

Esto tampoco crea un deployment independiente.

El dominio se asocia al mismo proyecto Vercel de Copyflow.

Flujo:

```text
tenant introduce dominio
        ↓
backend de Copyflow
        ↓
API / SDK de Vercel
        ↓
añadir dominio al proyecto Copyflow
        ↓
obtener requisitos DNS
        ↓
mostrar configuración al cliente
        ↓
verificación
        ↓
SSL
        ↓
guardar asociación domain → tenant
```

Al recibir posteriormente:

```text
app.sur4.es
```

Copyflow resuelve:

```text
domain mapping
      ↓
tenant_id = SUR4
```

y ejecuta el mismo código que para:

```text
sur4.copyflow.com
```

---

# Actualizaciones

Una de las ventajas fundamentales de esta arquitectura es:

```text
git push
   ↓
Vercel build
   ↓
nuevo Production Deployment
   ↓
todos los tenants reciben la nueva versión
```

No existen despliegues individuales que haya que mantener sincronizados.

Ejemplo:

```text
Copyflow v1.7
   │
   ├── SUR4
   ├── Pepe
   ├── Rioja
   ├── Demo
   └── resto de tenants
```

todos ejecutan la misma versión.

---

# Configuración por tenant

Los clientes pueden tener comportamientos y opciones diferentes sin modificar el código base.

La personalización debe almacenarse en BD.

Ejemplos:

```text
tenant_settings
order_statuses
services
entry_channels
customer_types
features
branding
```

SUR4 podría tener:

```text
Pendiente
En proceso
Urgente
Entregado
```

y otro tenant:

```text
Recibido
Diseño
Producción
Listo
Recogido
```

sin crear tablas, deployments ni forks específicos.

---

# Qué significa "multi-tenant" en Copyflow

En este proyecto, cuando se hable de:

```text
tenant
instancia
cliente
organización
copistería
```

debe entenderse por defecto:

> Una organización lógica dentro de la plataforma Copyflow compartida.

La palabra **instancia** no debe interpretarse como:

- proyecto independiente de Vercel
- deployment independiente
- proyecto independiente de Supabase
- base de datos independiente
- copia independiente del repositorio

salvo que el usuario indique explícitamente que desea estudiar otra arquitectura.

---

# Regla de no contradicción

Ante cualquier conversación futura sobre arquitectura de Copyflow:

1. Tomar este documento como fuente de verdad.
2. No proponer proyectos Vercel por tenant.
3. No proponer proyectos Supabase por tenant.
4. No proponer bases PostgreSQL por tenant.
5. No proponer deployments por tenant.
6. No describir esta arquitectura compartida como una solución únicamente para el MVP.
7. No afirmar que posteriormente habrá que migrar necesariamente a infraestructura aislada.
8. Si se estudia una alternativa arquitectónica, identificarla explícitamente como alternativa y no confundirla con la arquitectura acordada.
9. Si existe contradicción con conversaciones anteriores, prevalece este documento.

---

# Resumen definitivo

```text
COPYFLOW

Codebase                   1
Repositorio                1
Proyecto Vercel            1
Production Deployment      1
Proyecto Supabase          1
PostgreSQL                 1
Conexión DATABASE_URL      1

Tenants                    N
Usuarios                   N
Memberships                N
Subdominios                N
Dominios personalizados    N
```

Aislamiento:

```text
tenant_id + memberships + autorización + RLS
```

Provisioning de cliente:

```text
crear registros y configuración
```

NO:

```text
crear infraestructura
```

Actualización:

```text
1 deploy → todos los tenants
```

Esta es la arquitectura oficial y objetivo de Copyflow.