# Correo transaccional de Auth (SMTP propio) para Staging y Production — propuesta

**Estado:** propuesta. No se ha configurado nada en Supabase, en el DNS ni en ningún proveedor de correo.

**Motivo:** el 28/10/2026, en la ronda C del alta pública en Staging, el límite de correo de Supabase bloqueó un alta: `429 over_email_send_rate_limit`. Ver «Repetición del alta pública» en `docs/BILLING-PRO-OFFERS-V1.md`.

## 1. Situación

| | Staging (`fmmfsbhcwxkaszrrarpw`) | Production (`wsclqvlzjdgwkxbolhoy`) |
| --- | --- | --- |
| Servicio de correo | El integrado de Supabase: el remitente es `noreply@mail.app.supabase.io` y el límite es el suyo | **Sin comprobar** |
| Límite | Común a todo el proyecto y a todos los correos de Auth. El 28/10 se bloqueó el tercer envío en una hora | — |

**Lo que dice la documentación de Supabase del servicio integrado:**
- solo entrega a las direcciones de los miembros del equipo de la organización; el resto falla con `email_address_not_authorized`;
- tiene un límite bajo de correos por hora que puede cambiar sin aviso, sin SLA;
- no está pensado para producción.

**Consecuencias:**
- **Staging:** como mucho, unas dos altas o recuperaciones por hora, y solo para el propietario. Las pruebas de alta se bloquean, como en la ronda C.
- **Production, si usa el integrado:**
  - un cliente real no recibiría el correo de confirmación del alta, así que el alta comercial no funcionaría;
  - tampoco recibiría la recuperación de contraseña (por ejemplo, el personal de SUR4).

  **Hay que comprobarlo antes del alta comercial:** en el Dashboard de Production, Authentication → Emails → SMTP Settings, solo lectura. Se puede hacer a la vez que la revisión de la plantilla «Confirm signup», que ya está pendiente.

**No es la solución:**
- desactivar «Confirm email": cualquiera podría darse de alta con un correo que no es suyo;
- crear usuarios por la API de administración: no prueba el flujo real.

## 2. Propuesta

Un proveedor de correo transaccional con **dos configuraciones aisladas**, una por entorno, cada una con sus credenciales y su límite.

| | Staging | Production |
| --- | --- | --- |
| Remitente | `Gestcopy Staging <no-reply@staging-mail.gestcopy.com>` | `Gestcopy <no-reply@mail.gestcopy.com>` |
| Dominio de envío | Subdominio propio, con SPF, DKIM y DMARC | Subdominio propio, con SPF, DKIM y DMARC |
| Cuenta o servidor del proveedor | Separado (servidor o stream propio) | Separado |
| Credenciales SMTP | Propias. Solo en Supabase Staging y en el gestor de contraseñas del propietario | Propias. Solo en Supabase Production y en el gestor de contraseñas |
| Límite de Auth (Authentication → Rate Limits) | 30 por hora, el valor inicial que pone Supabase con SMTP propio | Empezar en 30 por hora y subir según la previsión de altas antes del lanzamiento (por ejemplo, 100 por hora) |
| Plantillas | Las mismas, con «[Staging]» en el asunto | Las de Production, en español |

**Por qué separadas:**
- Una prueba de Staging nunca puede gastar el cupo de Production ni dañar su reputación de envío.
- Una credencial filtrada solo afecta a un entorno.
- Se puede rotar o desactivar cada una por separado.

**Reglas:**
- Las credenciales no van al repositorio ni a Vercel: Supabase Auth es quien envía.
- En el proveedor, el seguimiento de enlaces debe estar **desactivado**. Supabase avisa de que puede romper los enlaces de confirmación.
- En «Confirm signup» se mantiene `{{ .ConfirmationURL }}`. Con #161, `/auth/confirm` acepta tanto el `code` PKCE como `token_hash`.
- Se mantiene el intervalo mínimo por usuario entre envíos.

**Candidatos de proveedor** (hay que confirmar precio, condiciones y DPA actuales antes de elegir):

| Proveedor | A favor | En contra |
| --- | --- | --- |
| Postmark | Pensado para correo transaccional. «Servers» separados por entorno, cada uno con su credencial | Datos en EE. UU. (con DPA) |
| Amazon SES (región UE, p. ej. `eu-south-2` España o `eu-west-1`) | Datos en la UE, coste muy bajo. Su modo sandbox sirve para Staging (solo entrega a direcciones verificadas) | Más trabajo técnico; hay que pedir la salida del sandbox para Production |
| Brevo | Empresa de la UE, SMTP sencillo | Menos especializado en transaccional |

**Recomendación:**
- Postmark, si no hace falta que los datos estén en la UE.
- Si hace falta, Amazon SES en `eu-south-2`.

Lo decide el propietario.

## 3. Pasos (cada uno con autorización del propietario)

1. **Elegir proveedor** y crear las dos configuraciones aisladas. Lo hace el propietario, con su cuenta y su forma de pago.
2. **DNS de Staging:** registros SPF, DKIM, DMARC y de rebote para `staging-mail.gestcopy.com`, en el DNS de `gestcopy.com`.
3. **Supabase Staging:** SMTP propio (host, puerto 587 con STARTTLS, usuario, contraseña y remitente) y el límite de 30 por hora. Es un cambio de configuración de Staging; el propietario introduce las credenciales, Claude no las ve.
4. **Prueba en Staging:** repetir el alta C entre navegadores y una recuperación de contraseña. Revisión de solo lectura de los logs de Auth y del panel del proveedor (entregado, sin rebote).
5. **Production, antes del alta comercial:**
   - comprobar en solo lectura qué SMTP y qué plantilla usa;
   - después, DNS de `mail.gestcopy.com`, SMTP propio, límite y plantillas;
   - prueba con una recuperación de contraseña de una cuenta del propietario, sin crear usuarios.
6. **Vigilancia:**
   - en los logs de Auth, `over_email_send_rate_limit` y `email_address_not_authorized`;
   - en el proveedor, rebotes y quejas.

## 4. Vuelta atrás

Desactivar el SMTP propio en el proyecto afectado. Supabase vuelve al servicio integrado, con sus límites. No afecta a usuarios ni a sesiones.

## 5. Calendario

- **SUR4 (L0–L8):** no necesita alta pública. El Owner de SUR4 ya tiene cuenta en Production, así que esto no bloquea el pago de SUR4.
- **Recuperación de contraseña de SUR4 y alta comercial:** sí dependen de esto, si Production usa el servicio integrado.
