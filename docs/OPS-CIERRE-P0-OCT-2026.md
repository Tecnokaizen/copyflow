# Cierre operativo P0 — 16/10/2026

Continúa [POST-SPRINT-OPS-OCT-2026.md](POST-SPRINT-OPS-OCT-2026.md).

**No se ha comprado nada, no se ha tocado Stripe y no se ha iniciado el contract de #95.** En Production solo se han hecho tres cosas, todas autorizadas: integrar #115–#118 y prorrogar la prueba interna de SUR4 (§6). Se mantienen un único core multi-tenant y una única base de datos compartida.

## 1. Integraciones (#115, #116, #117)

Cada una se integró con la misma secuencia:

1. revalidar HEAD, conflictos y CI;
2. merge squash fijado al HEAD;
3. Release Gate de `main`;
4. despliegue de Production;
5. comprobaciones HTTP anónimas.

| PR | Commit en `main` | Release Gate | Production |
| --- | --- | --- | --- |
| #115 Guarda contra la BD de Production | `cfd3673` | OK | `dpl_2ePwmWZ7epBFcvxK2yTBdbxSagyS` READY |
| #116 Preparación de Migration V1 | `75cbd99` | OK | Despliegue OK |
| #117 Informe post-sprint y fin de la prueba | `0877199` | OK | `dpl_12GFKXYWjcRRSQwsSBszoCXdz5QJ` READY |

**Efecto de la guarda en Production:** el build de Production pasó con #115 sin incidencias (`VERCEL=1`, `VERCEL_ENV=production`).

**Comprobaciones HTTP tras cada despliegue:**

- `/auth/login` en `app` y `sur4`: 200;
- `/api/context` sin sesión: 401 `SESSION_EXPIRED` con caché privada;
- `/ayuda/novedades`: 200.

**Punto de vuelta atrás previo:** `dpl_AZTQtCMhBV9Gi4VXCieLr6WoccTY` (`893f366`).

## 2. Protección contra conexiones accidentales a Production

**En el código** (#115, en `main`):

- `next dev`, `next build` y `next start` se niegan a usar la BD de Production fuera de Vercel Production.
- Excepción explícita: `GESTCOPY_ALLOW_PRODUCTION_DATABASE=1`.

**En el equipo:**

- Las copias antiguas `copyflow-release` y `copyflow-pr57-deploy` no tenían trabajo pendiente:
  - su HEAD está en ramas remotas (`release/files-v1.1` y `fix/quotes-ux-flow-v1`);
  - no tienen cambios, commits sin subir ni archivos fuera del control de versiones;
  - los stashes del repositorio son de otras ramas.
- Ambas se han reenlazado a Staging. El enlace anterior está guardado en `~/copyflow-ops/env-backups` (0700).
- Revisión final del equipo:
  - el único enlace de la CLI con Production es `~/copyflow-ops/production-link`;
  - ningún `.env` local contiene la URL de Production.

## 3. Copias cifradas (Coolify → Backblaze B2)

Verificado el 16/10, en solo lectura, con `rclone` sobre el bucket `gestcopy-backups-prod-eu`.

**Base de datos:**

- Volcados cada 6 horas: 4 completos al día del 10/10 al 16/10, sin huecos.
- Último volcado: 16/10 a las 10:27 UTC. Manifiesto con:
  - `status: complete` y Postgres 17.6;
  - snapshot exportado consistente;
  - tres artefactos `age`: aplicación (1,0 MB), auth (29 KB) y migraciones (145 KB).
- **Integridad:** los tres artefactos del último volcado coinciden en tamaño y SHA-256 con el manifiesto. Se descargaron a un directorio temporal que se borró al terminar.

**Files:**

- R2 tiene 127 objetos (0,93 GB) y B2, 132 (B2 conserva los borrados).
- 126 coinciden.
- El único pendiente se subió a las 10:29 UTC, después de la copia horaria de las 10:17.

### Simulacro de restauración aislada (preparado)

**Ubicación:** `~/copyflow-ops/restore-drill/`, fuera del repositorio. Contiene `run-drill.sh` y la configuración de una pila Supabase local desechable (`restore-drill`, base de datos en `127.0.0.1:56832`).

**Modos:**

| Modo | Qué hace | Estado |
| --- | --- | --- |
| `verify` | Descarga el último lote y comprueba tamaño y SHA-256 con el manifiesto. No necesita clave | Ejecutado: OK |
| `full` (`AGE_IDENTITY=… ./run-drill.sh full`) | `verify`, descifrado en un temporal 0700, pila aislada con `pg_trgm` en `extensions`, imagen del runner, restauración con `restore-database-local.sh` y validación | Pendiente de la identidad. Ya probado sin clave: la pila arranca con el esquema de Auth, la imagen se construye y el script se niega con el ref de Production y con artefactos ilegibles, sin tocar el destino |

**La restauración usa los cerrojos del propio runner:**

- `GESTCOPY_ALLOW_RESTORE=isolated-only`;
- se niega si el ref de destino es el de Production;
- se niega si los artefactos no son legibles.

**Requisito:** la identidad privada `age` solo la tiene el propietario y no se copia a ningún sitio.

**Validación:**

- El script imprime el recuento de migraciones, las tablas sin RLS (debe ser 0), las políticas, las funciones y las filas de las tablas principales.
- Se compara con esta consulta de solo lectura en Production. Las cifras de datos pueden variar por la actividad posterior al volcado:

```sql
select 'migrations', count(*) from supabase_migrations.schema_migrations
union all select 'policies', count(*) from pg_policies where schemaname = 'public'
union all select 'functions', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all select 'tenants', count(*) from public.tenants
union all select 'memberships', count(*) from public.memberships
union all select 'clients', count(*) from public.clients
union all select 'orders', count(*) from public.orders
union all select 'order_payments', count(*) from public.order_payments
union all select 'quotes', count(*) from public.quotes
union all select 'auth_users', count(*) from auth.users;
```

**Fuera del volcado** (documentado en `infra/backup-runner`):

- el secreto `files_signing_secret` de Vault;
- la configuración de Auth y de la API.

En una recuperación real hay que reinyectarlos desde su fuente segura. En el simulacro no es necesario.

**Al terminar:** `(cd ~/copyflow-ops/restore-drill/stack && npx -y supabase@2.117.0 stop --no-backup)`.

## 4. Configuración preparada (sin ejecutar): SMTP, Supabase Pro y Vercel Pro

### 4.1 SMTP de Supabase Auth con Resend (sin coste; propietario)

**Comprobar primero** en Authentication → Emails → SMTP Settings si ya hay SMTP propio. Si está desactivado, Supabase solo envía a miembros de la organización y la recuperación de contraseña no llega a los usuarios de los tenants.

**1. Resend:** crear una API key con permiso «Sending access», limitada al dominio `gestcopy.com`, con el nombre `supabase-auth-production`. El dominio ya tiene publicados DKIM, SPF y MX de retorno.

**2. Supabase → Authentication → Emails → SMTP Settings:**

| Campo | Valor |
| --- | --- |
| Enable custom SMTP | Activado |
| Sender email | `no-reply@gestcopy.com` |
| Sender name | `Gestcopy` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | La clave del paso 1. No guardarla en ningún otro sitio |
| Minimum interval between emails | 60 s (valor por defecto) |

**3. Authentication → Rate Limits → «Rate limit for sending emails»:** 30 por hora.

**4. Authentication → URL Configuration.** Es imprescindible, porque la recuperación redirige a `https://<tenant>.app.gestcopy.com/auth/update-password` (`window.location.origin`):

| Campo | Valor |
| --- | --- |
| Site URL | `https://app.gestcopy.com` |
| Redirect URLs | `https://app.gestcopy.com/**` y `https://*.app.gestcopy.com/**` |

Si falta el comodín, el enlace del correo cae en la Site URL, sin tenant, y el flujo se rompe.

**5. Plantillas en español** (Authentication → Emails → Templates):

- **Reset password.** Asunto: «Restablece tu contraseña de Gestcopy». Cuerpo:

```html
<p>Hola,</p>
<p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de Gestcopy.</p>
<p><a href="{{ .ConfirmationURL }}">Elegir una contraseña nueva</a></p>
<p>Si no la has pedido tú, ignora este mensaje: tu contraseña no cambiará.</p>
```

- **Confirm signup.** Asunto: «Confirma tu cuenta de Gestcopy». Cuerpo: el mismo esquema, con «Confirmar mi cuenta».

**6. Prueba:**

1. Con un usuario del tenant de verificación (buzón del propietario), pedir «He olvidado mi contraseña» en su subdominio.
2. Debe llegar el correo de `no-reply@gestcopy.com`.
3. El enlace debe abrir `/auth/update-password` en ese subdominio.
4. Fijar una contraseña nueva e iniciar sesión.
5. Ver la entrega en Resend → Emails.

**Vuelta atrás:** desactivar «Custom SMTP».

**Mejora posterior:** DMARC está en `p=none`. Tras unas semanas de informes sin fallos, pasar a `p=quarantine`.

### 4.2 Supabase Pro (propietario; tiene coste)

**Previo:**

- copias externas verificadas (§3);
- elegir la ventana para el cambio de cómputo (p. ej. 22:00, hora de Madrid);
- decidir si Staging se queda en la organización (≈ 35 USD/mes) o se traslada a una organización Free (≈ 25 USD/mes).

**Pasos:**

1. Organización → Billing → Change plan → Pro. Dejar activado el límite de gasto.
2. Authentication → Policies → activar «Prevent use of leaked passwords».
3. En la ventana: Project settings → Compute and Disk → Production de Nano a Micro. Reinicia unos minutos; se factura igual que Nano en un plan de pago.

**Comprobación:**

- `get_advisors` ya no muestra «leaked password protection»;
- Database → Backups muestra copias diarias al día siguiente;
- E2E de Staging y comprobaciones HTTP de Production.

**Vuelta atrás:** bajar a Free devuelve créditos por el tiempo no usado y quita las copias gestionadas. Las copias externas siguen.

### 4.3 Vercel Pro (propietario; tiene coste)

**Pasos:**

1. Equipo `tecnokaizen` → Settings → Billing → Upgrade.
   - Un asiento con despliegue (20 USD/mes, incluye 20 USD de uso). Los demás miembros, como Viewer gratuito.
2. Spend Management: aviso en 40 USD. Sin pausa automática de Production.

**Comprobación:**

- el plan aparece como Pro;
- el siguiente despliegue de `main` termina en verde;
- los dominios y el cron siguen igual.

**Vuelta atrás:** «Downgrade Plan». Antes hay que trasladar dominios y stores, como indica Vercel.

## 5. Región `fra1` (integrada el 16/10)

**Integración:** #118 integrada en `8cb913f` con autorización expresa.

- Release Gate `38893991991` en verde.
- Production `dpl_2jt2TUH4zKh94hLwtMwTgK3Wjqxc` READY, con `regions: ["fra1"]` y el cron registrado.
- Punto de vuelta atrás, sin usar: `dpl_12GFKXYWjcRRSQwsSBszoCXdz5QJ`.

**Resultado real en Production** (tiempo de origen que mide Supabase por petición):

| | Antes (`IAD`) | Después (`FRA`) |
| --- | --- | --- |
| p50 | 120 ms | 31 ms |
| p90 | 316 ms | 98 ms |

**Vigilancia de 30 minutos:** sin 4xx ni 5xx y sin errores de Postgres, Auth ni funciones. Cola de R2 a 0.

**E2E de Staging:** `38894442617` en verde, con Staging avanzado a `484eff6` (árbol de `main`).

**Cron:** se comprueba el 17/10 (03:15–04:15 UTC) que llega desde `FRA`.

**Antes de la integración:**

**Medición:** previews con el mismo código y los mismos datos de Staging. La latencia p50 de las APIs baja entre un 47 % y un 55 %. Por ejemplo, `/api/orders` pasa de 1275 a 579 ms.

El procedimiento, las comprobaciones y la recuperación están en `docs/VERCEL-REGION-FRA1.md`.

## 6. Prórroga de SUR4 hasta el 02/11/2026 (ejecutada el 16/10)

**Ubicación:** `~/copyflow-ops/sur4/`, fuera del repositorio:

1. `1-precheck.sql`
2. `2-prorroga-2026-11-02.sql`
3. `3-postcheck.sql`
4. `4-rollback.sql`
5. `README.md`

**Comprobación previa en Production (solo lectura, 16/10):**

- una única fila vigente, `internal`/`trialing`, que vence el 19/10 a las 13:53:09 UTC;
- sin cambios desde el 08/10.

**Validación en una transacción local desechable**, con una fila idéntica a la de Production:

- la prórroga deja el periodo 26/09 → 02/11/2026 13:53 UTC (14:53 en Madrid);
- 37 días de gracia, 14 de prórroga, e historial de la prórroga anterior;
- una segunda ejecución se niega sin cambiar nada;
- la vuelta atrás restaura la fila exactamente.

**Ejecutada en Production el 16/10/2026 a las 11:07 UTC**, con autorización expresa del propietario y con `execute_sql`:

- **Comprobación previa:** una fila; sin cambios desde el 08/10.
- **Foto previa:** guardada en `~/copyflow-ops/sur4`.
- **Prórroga:** una fila modificada.
- **Comprobación posterior:**
  - `trialing`, del 26/09 al **02/11/2026 a las 13:53 UTC**;
  - 37 días de gracia, 14 de prórroga, e historial;
  - `billing_activation` sin cambios.
- **Sin efectos colaterales:**
  - única suscripción modificada;
  - la otra fila de SUR4 y el tenant, sin cambios;
  - `/auth/login` responde 200 y `/api/context` 401.

**Vuelta atrás:** `4-rollback.sql`.

**Efecto:** Facturación muestra «En prueba» y «26/09/2026 → 02/11/2026». Acceso, presupuestos y cuota, sin cambios. La decisión comercial (piloto o Stripe Live, #35) pasa a tener como fecha límite el 02/11.

## 7. Migration V1

PR #119, sin fusionar: cierra el diseño del ADR.

- Decisiones cerradas.
- D9: la confirmación `DEFINER` delega en `create_client_v2`, que ya autoriza de forma explícita.
- Criterios de seguridad S1–S12.
- Especificación completa de la PR 2.

La implementación de la PR 2 no se ha empezado.

## 8. Pendiente de autorización o de acción del propietario

1. **Condiciones comerciales de SUR4** (#35) antes del 02/11, nuevo vencimiento tras la prórroga (§6).
2. **Cron del 17/10:** comprobar que se ejecuta desde `FRA` (`~/copyflow-ops/fra1/cron-check-2026-10-17.md`).
3. **Merge de #119** (cierre del diseño) y comienzo de la PR 2.
4. **SMTP con Resend** y URL Configuration de Auth (§4.1).
5. **Supabase Pro** y **Vercel Pro** (§4.2 y §4.3): decisión y compra.
6. **Simulacro de restauración completo** con la identidad `age` (§3).
7. **Contract de #95**: sigue sin iniciarse.
