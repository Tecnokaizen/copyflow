# Preparación operativa post-sprint — 16/10/2026

Informe de ejecución de las prioridades post-sprint. **No se ha comprado nada, no se
ha cambiado la facturación y no se ha modificado Production.** Todas las consultas a
Production han sido de solo lectura (agregados y metadatos, sin datos personales).

Base: `main` `893f366`; actualizado el mismo día tras integrar #115 y #116. Documento hermano: [SUR4-FIN-PRUEBA-OCT-2026.md](SUR4-FIN-PRUEBA-OCT-2026.md).

## Resumen

| Prioridad | Estado | Evidencia |
| --- | --- | --- |
| P0 Planes y costes reales | Verificado. Procedimiento listo, sin ejecutar | §1 y §2 |
| P0 Aislar el desarrollo local | Hecho. Guarda integrada (#115, `cfd3673`) y desplegada en Production; copias antiguas reenlazadas a Staging | §3 |
| P0 Staging = `main` | Hecho: `d00d515` (árbol de `893f366`), Release Gate y E2E en verde | §4 |
| P0 Gate operativo SUR4 y fin de la prueba | Preparado. **La prueba vence el 19/10 a las 13:53 UTC** | SUR4-FIN-PRUEBA |
| P1 Migration V1 (clientes) | Dependencias evaluadas, plan detallado y generador de ficheros sintéticos | #116 integrada (`75cbd99`) |
| Contract de #95 | No iniciado, por instrucción | — |

## 1. Infraestructura: configuración y costes reales

### Supabase

- La organización de Supabase está en plan **Free**.
- La misma organización contiene los dos proyectos:

| Proyecto | Uso | Región | Postgres | Tamaño |
| --- | --- | --- | --- | --- |
| `copyflow-mvp` | Production | eu-central-1 (Fráncfort) | 17.6 | ~20 MB |
| `gestcopy-staging` | Staging (creado el 13/10) | eu-west-1 (Irlanda) | 17.11 | — |

**Limitaciones del plan Free** (documentación oficial de Supabase, consultada el 16/10):

| Limitación | Detalle |
| --- | --- |
| Copias de seguridad | Sin copias diarias gestionadas. Pro ofrece 7 días de copias diarias restaurables desde el panel |
| Contraseñas filtradas (HaveIBeenPwned) | Protección disponible solo en Pro o superior. Coincide con el aviso de los advisors |
| SMTP por defecto de Auth | «No pensado para producción». Envía solo a direcciones preautorizadas (miembros del equipo de la organización), con un límite bajo por hora y sin garantía de entrega |

**Riesgo por el SMTP de Auth:** si Production no tiene SMTP propio, la recuperación de contraseña (`resetPasswordForEmail`) y el alta pública (`signUp`) no llegan a usuarios reales como Tamara. Las invitaciones no se ven afectadas: van por Resend desde la app y crean el usuario con `admin.createUser`. En las últimas 24 h no hay intentos de recuperación en los logs de Auth, así que **no se ha podido comprobar**. Hay que mirarlo en el panel (ver §2).

**Copias externas (verificadas el 16/10 en el bucket de B2, en solo lectura):** `infra/backup-runner` (Coolify → Backblaze B2, cifrado con `age`, Object Lock de 30 días) está funcionando.

- **Base de datos:** 4 volcados completos al día, cada 6 horas, del 10/10 al 16/10, sin huecos.
  - El último es del 16/10 a las 10:27 UTC.
  - Su manifiesto indica `status: complete`, Postgres 17.6, snapshot consistente y tres artefactos (aplicación, auth y migraciones) con su tamaño y SHA-256.
- **Files:**
  - R2 tiene 127 objetos (0,93 GB) y B2, 132 (B2 conserva los borrados).
  - Coinciden 126.
  - Falta 1, subido a las 10:29 UTC, después de la copia horaria de las 10:17; entra en la de las 11:17 UTC.
- **Pendiente:** la prueba de restauración aislada. Requiere la identidad privada de `age`, que solo tiene el propietario.

### Vercel

**Cuenta y uso comercial:**

- Equipo `tecnokaizen` en plan **Hobby**.
- La documentación oficial lo restringe a «non-commercial, personal use only». Operar con un cliente de pago exige Pro.

**Proyecto:**

- Next.js, Node 22.x, `autoExposeSystemEnvs: true`.
- **Región de funciones `iad1` (Washington)** con la base de datos en Fráncfort: cada consulta a Supabase cruza el Atlántico.
- Cron diario a las 03:15 UTC: `/api/internal/files/cleanup`.

**Variables de entorno:**

- Production tiene su propio juego: Supabase, Resend, Stripe, R2, `CRON_SECRET`, `FILES_SIGNING_SECRET`, `APP_BASE_URL`.
- Preview comparte las de Staging.
- `KIOSK_SIGNING_SECRET` existe solo en Preview, como pide #35. No hay `EMAIL_TRANSPORT`, pero no hace falta porque el valor por defecto es `resend`.

### Otros servicios

| Servicio | Estado |
| --- | --- |
| Resend | Registros DNS de `gestcopy.com` publicados: DKIM `resend._domainkey`, SPF y MX de `send.gestcopy.com` (región eu-west-1). DMARC está en `p=none`. Que en SUR4 haya 6 invitaciones aceptadas confirma que el envío funciona. El plan de Resend no se ha podido ver |
| Cloudflare R2 | ~0,8 GB de Files |
| Stripe | Variables presentes en Production. No se ha leído el valor de `STRIPE_MODE` |

### Costes mensuales (USD, sin impuestos)

| Concepto | Hoy | Propuesto | Coste |
| --- | --- | --- | --- |
| Supabase | Free (0) | Pro | 25 de plan + cómputo (ver tabla siguiente) |
| Vercel | Hobby (0) | Pro | 20 de plataforma (1 asiento con despliegue y 20 de crédito de uso). Asientos de despliegue adicionales a 20; los de solo lectura son gratis |
| Resend | Sin verificar | Plan actual | Revisar el plan en el panel de Resend |
| Cloudflare R2 | Dentro del nivel gratuito | — | 0 |

**Cómputo de Supabase en Pro:**

- Cada proyecto se factura por horas; Micro cuesta unos 10 al mes.
- El plan incluye 10 de crédito de cómputo, que cubre un proyecto.
- En una organización de pago, un proyecto Nano se factura como Micro.

| Opción | Coste de Supabase |
| --- | --- |
| Production y Staging en la misma organización | 25 + 20 − 10 ≈ **35** al mes |
| Staging trasladado a otra organización Free | ≈ **25** al mes |

**Total estimado: 45–55 USD/mes más IVA.** Con el uso actual no se prevé consumo por encima de lo incluido.

Fuentes oficiales, consultadas el 16/10/2026:

- Supabase: [Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq), [Compute](https://supabase.com/docs/guides/platform/manage-your-usage/compute), [Backups](https://supabase.com/docs/guides/platform/backups), [Password security](https://supabase.com/docs/guides/auth/password-security), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
- Vercel: [Hobby](https://vercel.com/docs/plans/hobby), [Pro](https://vercel.com/docs/plans/pro-plan).

## 2. Procedimiento de paso a planes comerciales (no ejecutado)

Cada paso lo hace el propietario en el panel, o requiere su autorización expresa. El orden propuesto va de más a menos urgente.

### 2.1 SMTP propio para Supabase Auth (sin coste, válido también en Free)

1. En Resend, crear una clave dedicada con permiso solo de envío y limitada al dominio `gestcopy.com`.
2. Supabase → Authentication → Emails → SMTP Settings → activar «Custom SMTP» con:
   - host `smtp.resend.com`, puerto `465`, usuario `resend`;
   - contraseña: la clave del paso 1;
   - remitente: `no-reply@gestcopy.com`, nombre «Gestcopy».
3. Authentication → Rate Limits: subir el límite de correos por hora a un valor razonable (p. ej. 30).
4. Comprobación: recuperación de contraseña con un usuario del tenant de verificación (ver SUR4-FIN-PRUEBA, §5).
5. Vuelta atrás: desactivar «Custom SMTP».

### 2.2 Supabase Pro

1. Organización → Billing → Change plan → Pro. Añadir la tarjeta. El límite de gasto queda **activado por defecto**; dejarlo así.
2. El cambio de plan no reinicia los proyectos.
3. Authentication → Policies (o Providers → Email) → activar «Prevent use of leaked passwords».
4. En una ventana de poco uso (p. ej. 22:00, hora de Madrid), Project settings → Compute and Disk → pasar Production de Nano a **Micro**.
   - Se factura igual, pero el cambio reinicia la base de datos durante unos minutos y Supabase no lo hace automáticamente.
5. Comprobación:
   - Database → Backups muestra copias diarias al día siguiente;
   - el advisor de contraseñas filtradas desaparece;
   - `get_advisors` sin errores nuevos.
6. Decidir qué hacer con Staging: dejarlo en la organización (≈ +10/mes) o trasladarlo a una organización Free («project transfer»).
7. Vuelta atrás: bajar a Free devuelve créditos por el tiempo no usado, pero se pierden las copias diarias.

### 2.3 Vercel Pro

1. Equipo `tecnokaizen` → Settings → Billing → Upgrade → un asiento de despliegue → tarjeta → «Confirm and Upgrade».
   - Los proyectos, dominios y despliegues se conservan y no hace falta redesplegar.
2. Spend Management: aviso en 40 USD.
   - No activar la pausa automática de Production.
3. Comprobación:
   - el plan aparece como Pro;
   - el siguiente despliegue de `main` termina en verde;
   - los dominios responden.

### 2.4 Región de funciones `iad1` → `fra1` (cambio en Production; requiere autorización)

Hobby ya permite elegir una región, así que este paso no depende de Pro. Hay dos formas:

| Forma | Cómo |
| --- | --- |
| PR (recomendada: queda auditada y se revierte con git) | `vercel.json` → `"regions": ["fra1"]` |
| Panel | Settings → Functions → Function Region |

**Aplicación:** el cambio entra con el siguiente despliegue, en Production y en las Previews. Staging (Irlanda) también gana frente a `iad1`.

**Efecto esperado:**

- Cada viaje a Supabase pasa de ~90 ms a pocos ms.
- Las páginas que hacen varias consultas seguidas deberían ahorrar varios cientos de ms.
- Es una estimación: hay que medirlo.

**Comprobación:**

- la cabecera `x-vercel-id` contiene `fra1`;
- comparar la latencia de `/api/context` y de las páginas principales antes y después;
- E2E de Staging.

**Vuelta atrás:** revertir la PR o volver a `iad1` y redesplegar.

## 3. Desarrollo local aislado de Production

**Hecho (fuera del repositorio):**

- **Local apunta a Staging:**
  - `.env.local` de la copia principal → Staging. Hay copia de la versión anterior fuera del repo, con permisos 600.
  - El `next dev` en marcha recargó y ya usa Staging.
- **Enlace de la CLI con Production:**
  - Queda solo en `~/copyflow-ops/production-link`, con un README de uso.
  - `supabase/.temp` de la copia principal se ha reenlazado a Staging.
- **Origen de los errores del 15/10:** fue un `next dev` local contra Production:
  - el `42703` de `order_payments.receipt_file_id`;
  - los `permission denied for table tenants`.

**PR #115 (integrada en `cfd3673` y desplegada en Production el 16/10):**

- `next.config.ts` impide `next dev`, `next build` y `next start` contra la BD de Production salvo en un despliegue de Vercel Production.
- La excepción explícita es `GESTCOPY_ALLOW_PRODUCTION_DATABASE=1`.
- Probado con `.env.local` y con variables de entorno: los tres comandos salen con código 1.
- **Riesgo para Production:** si en el build faltara `VERCEL_ENV`, el build fallaría y Vercel mantendría el despliegue anterior. No hay corte de servicio.

**Copias antiguas:** `copyflow-release` y `copyflow-pr57-deploy` no tenían trabajo pendiente (HEAD en ramas remotas, sin cambios ni commits sin subir). Se han reenlazado a Staging, con copia del enlace anterior en `~/copyflow-ops/env-backups`. El único enlace con Production es `~/copyflow-ops/production-link`, y ningún `.env` local apunta a Production.

## 4. Staging sincronizado con `main`

**Rama:**

- `gestcopy-staging` avanzó por fast-forward de `0677f3e` a `d00d515`, sin force push.
- `d00d515` es un commit de merge con el árbol exacto de `main` `893f366` (solo documentación nueva).
- El aislamiento de Staging sigue en las variables de Preview de Vercel.

**Comprobaciones en verde:**

- Release Gate sobre la rama: run `38885593461` (App y Database);
- despliegue de Vercel: OK;
- E2E de Staging desde `main`: run `38886487514` (pedidos, archivos R2 y cobro parcial).

## 5. Bloqueos reales

| # | Bloqueo | Impacto | Quién lo desbloquea |
| --- | --- | --- | --- |
| B1 | La prueba interna de SUR4 vence el **19/10 a las 13:53 UTC** | No corta el acceso, pero Facturación mostrará un periodo vencido y no hay condición comercial registrada | Propietario: elegir opción en SUR4-FIN-PRUEBA |
| B2 | SMTP de Auth sin verificar | Si es el de por defecto, Tamara y su equipo no reciben correos de recuperación de contraseña | Propietario: revisar el panel; §2.1 |
| B3 | Supabase Free | Sin copias gestionadas por Supabase ni protección de contraseñas filtradas. Las copias externas cada 6 h funcionan | Propietario: §2.2 |
| B4 | Vercel Hobby | Uso comercial no permitido por las condiciones | Propietario: §2.3 |
| B5 | Stripe Live (#35) | Sin cuenta Live, catálogo ni webhook: no se puede cobrar por la app | Propietario: decisión comercial y fiscal |

No bloquean pero conviene resolver:

- región de funciones (§2.4);
- tenants de prueba en Production (SUR4-FIN-PRUEBA, §6).

## 6. Decisiones del propietario

1. **Fin de la prueba de SUR4** (antes del 19/10, 13:53 UTC): prorrogar, piloto activo o Stripe Live. Los borradores SQL están en SUR4-FIN-PRUEBA. La recomendación es prorrogar hasta una fecha fija mientras se prepara Live.
2. **Supabase Pro**: sí o no, y si Staging sigue en la misma organización (≈ 35 frente a 25 USD/mes).
3. **Vercel Pro**: sí o no, y el umbral de aviso de gasto.
4. **Región `fra1`**: autorizar la PR de `vercel.json` y su despliegue.
5. **SMTP de Auth con Resend**: revisar el estado y autorizar la configuración (§2.1).
6. **Prueba de restauración aislada** de las copias externas (requiere la identidad privada de `age`).
7. **Tenant de verificación en Production** y **limpieza de los tenants de prueba** (SUR4-FIN-PRUEBA, §5 y §6).
8. **Decisiones abiertas del ADR de importación de clientes** (roles, duplicados, actividad, retención) y la RPC de confirmación `SECURITY DEFINER` propuesta en la PR #116. Las dependencias ya tienen recomendación.
9. **Contract de #95**: momento de ejecución. Técnicamente es posible desde el 16/10 a las 22:34 UTC; no se ha iniciado.
