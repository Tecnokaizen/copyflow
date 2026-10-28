# Correo de Auth con Brevo (SMTP transaccional) para Staging y Production — propuesta V2

**Estado:** propuesta. No hay nada configurado en Supabase, en el DNS ni en Brevo. La ronda C del alta pública sigue pendiente hasta tener correo funcional.

**Motivo:** el 28/10/2026, en la ronda C, el límite del correo integrado de Supabase bloqueó un alta en Staging (`429 over_email_send_rate_limit`). Sin correo propio no se puede comercializar Gestcopy: el alta y la recuperación de contraseña dependen del correo. Ver «Repetición del alta pública» en `docs/BILLING-PRO-OFFERS-V1.md`.

**Cambio respecto a la V1:** el proveedor pasa a ser Brevo, que ya usamos, y los subdominios de envío pasan a `auth.gestcopy.com` y `auth-staging.gestcopy.com` (ver 3.3).

## 0. Decisiones del propietario

| # | Decisión | Propuesta |
| --- | --- | --- |
| D1 | Brevo como proveedor de Auth | Sí, si pasa la prueba de enlaces de la etapa E4 (ver 8.1) |
| D2 | Cuentas de Brevo | Una cuenta por entorno (ver 3.1). Alternativa: una cuenta con dos claves |
| D3 | Cuenta de Production | Cuenta solo para el correo de Auth de Gestcopy, sin campañas |
| D4 | Subdominios | `auth.gestcopy.com` (Production) y `auth-staging.gestcopy.com` (Staging) |
| D5 | Plan de Production | Starter, y Standard si el pie «Sent with Brevo» sale también en los transaccionales (ver 9) |
| D6 | Buzón de informes DMARC (`rua`) | Por ejemplo `dmarc@gestcopy.com` en Hostinger |
| D7 | Identidades de prueba | Una nueva identidad sintética para Staging, del tipo `tecnokaizen+authfix4@gmail.com`, además de `+authfix3` para la ronda C |

## 1. Auditoría de Production (solo lectura, 28/10 hasta las 21:07Z)

### 1.1 Lo que no se ha podido leer

**Pendiente de leer:** proveedor SMTP, remitente, límites y plantillas.

**Por qué no se ha podido leer:**
- **Panel:** el panel de Supabase pidió iniciar sesión, y no se inició.
- **Herramientas:** no hay ninguna herramienta que lea la configuración de Auth.
- **API de gestión:** pide un token. No se buscó ninguno (buscar claves cuenta como explorar credenciales).

### 1.2 Lo que se ha leído

| Señal | Resultado |
| --- | --- |
| Confirmaciones de alta enviadas | 9 en total: 8 a direcciones que no son alias del propietario y 1 a un alias. Del 05/09 22:09Z al 10/09 18:47:48Z |
| Confirmadas tras el envío | 7: la del alias y 6 de las otras 8. Esas 6 se confirmaron entre 20 y 87 s después del envío, como un clic real, y son de 4 dominios: gmail.com y tres dominios de empresa |
| Pendientes | 2, enviadas en septiembre y nunca confirmadas |
| Desde el 10/09 | Ninguna confirmación enviada. Los 6 usuarios creados en los últimos 30 días no recibieron correo de Supabase |
| Recuperaciones e invitaciones de Supabase | Nunca (`recovery_sent_at` e `invited_at` vacíos) |
| `auth.audit_log_entries` | Vacía |
| `auth_logs`, últimas 24 h | Sin eventos de correo |

**Indicio:** el correo integrado solo entrega a los miembros del equipo de la organización. Así que hay dos posibilidades:
- Production ya tenía un SMTP propio en septiembre, quizá Brevo;
- o esas direcciones eran miembros del equipo.

**No se puede distinguir sin el panel.**

### 1.3 DNS de `gestcopy.com` (público)

| Registro | Valor |
| --- | --- |
| NS | Cloudflare (`aiden`, `braelyn`) |
| MX | `mx1`/`mx2.hostinger.com` |
| SPF de la raíz | `v=spf1 include:_spf.mail.hostinger.com ~all` |
| DMARC de la raíz | `v=DMARC1; p=none`, sin `rua` |
| Brevo | Ningún registro |
| `auth.*` y `auth-staging.*` | Libres, sin comodín |

### 1.4 Lo que tiene que comprobar el propietario en el panel de Production (solo lectura)

No pegues usuarios, contraseñas ni claves en el chat.

| Pantalla | Qué anotar |
| --- | --- |
| Authentication → Emails → SMTP Settings | ¿SMTP propio activado? Host, puerto, remitente y nombre del remitente |
| Authentication → Emails → Templates | Asunto de «Confirm signup», «Reset password», «Invite user», «Magic link» y «Change email», y si usan `{{ .ConfirmationURL }}` |
| Authentication → Rate Limits | Correos por hora |
| Authentication → Sign In / Providers → Email | Confirm email, Secure email change, caducidad del OTP e intervalo mínimo por usuario |
| Authentication → URL Configuration | Site URL y Redirect URLs. Tienen que estar `/auth/confirm` y `/auth/update-password` en `app.gestcopy.com` y en `*.app.gestcopy.com` |

**Si Production ya usa Brevo:** E7 y E8 se convierten en revisar y ajustar (dominio, clave propia, límite y plantillas), no en crear desde cero.

## 2. Brevo: datos comprobados el 28/10

| Tema | Dato |
| --- | --- |
| Servidor | `smtp-relay.brevo.com`. Puerto 587 con STARTTLS (o 2525), o 465 con SSL |
| Usuario | El login SMTP que muestra la cuenta en SMTP & API → SMTP. Puede ser el correo de la cuenta o una dirección `@smtp-brevo.com`. No es el remitente |
| Contraseña | Una **clave SMTP**, no una clave de API. Se pueden generar varias y borrar cada una por separado |
| Remitente | Tiene que coincidir con un remitente o dominio autenticado. Si el dominio no está autenticado, Brevo cambia el dominio del remitente por `@brevosend.com` |
| Autenticación del dominio | Tres registros: código `brevo-code` (TXT), DKIM y DMARC (TXT). El DKIM puede ser un TXT `mail._domainkey` o dos CNAME `brevo1._domainkey` y `brevo2._domainkey`, según la cuenta. Los valores exactos salen del panel de Brevo. Según Brevo, el SPF no hace falta |
| IP autorizadas | Por defecto, las claves SMTP no se bloquean por IP. Si se activa «Activate for SMTP keys», Brevo bloquea cualquier IP no autorizada. Supabase no garantiza IP de salida fijas, así que hay que dejarlo **desactivado** para SMTP |
| Planes (precios públicos, EUR) | **Free:** 300 correos al día, una vez Brevo aprueba la cuenta. **Starter:** 7 €/mes (6,33 €/mes en anual) por 5.000 correos al mes, entre campañas y transaccionales, sin límite diario. Quitar la marca de Brevo cuesta 8,10 €/mes más. **Standard:** 15 €/mes, sin la marca. **Créditos prepago:** no caducan. **Enterprise:** multicuenta e IP dedicada. Todos los planes incluyen SMTP, webhooks y registros de envíos («unlimited log retention») |
| Seguimiento de enlaces | Los transaccionales registran aperturas y clics, y los enlaces pasan por un dominio de seguimiento de Brevo. Según el foro de Brevo (respuesta de su equipo del 10/07/2024), desactivarlo es posible «a petición» y solo para clientes Enterprise; existe una opción para anonimizarlo. Los usuarios lo seguían pidiendo en noviembre de 2025 y en febrero de 2026. **No está en la documentación oficial: hay que comprobarlo (8.1)** |
| Subcuentas | Solo en Enterprise. Para separar límites y reputación hacen falta cuentas distintas |
| Guía oficial de Brevo para Supabase | Host y puerto como arriba, remitente autenticado, 30 correos por hora al activar el SMTP propio e intervalo mínimo de 60 s por usuario |

**Lo que dice Supabase para el correo de Auth:**
- Desactivar el seguimiento de enlaces, porque puede deformar los enlaces de confirmación.
- Un dominio de envío solo para Auth (`auth.example.com`), sin mezclarlo con marketing.
- DKIM, DMARC y SPF.
- CAPTCHA contra altas de bots.
- Un segundo proveedor preparado por si falla el primero.

## 3. Separación entre Staging y Production

### 3.1 Configuración

| | Staging | Production |
| --- | --- | --- |
| Cuenta de Brevo | Propia («Gestcopy Staging»), plan Free | Propia («Gestcopy»), Starter o Standard. Solo correo de Auth |
| Subdominio de envío | `auth-staging.gestcopy.com` | `auth.gestcopy.com` |
| Remitente | `Gestcopy Staging <no-reply@auth-staging.gestcopy.com>` | `Gestcopy <no-reply@auth.gestcopy.com>` |
| Clave SMTP | `supabase-staging`. Solo en Supabase Staging y en el gestor de contraseñas del propietario | `supabase-production`. Solo en Supabase Production y en el gestor |
| Límite en Supabase | 30 por hora | 30 por hora al empezar. Se sube antes de abrir el alta comercial (ver 5) |
| Plantillas | «[Staging]» en el asunto | En español, sin prefijo |
| Acceso a Brevo | Propietario, con 2FA | Propietario, con 2FA. Nadie más sin necesidad, porque los registros de envíos guardan los enlaces (ver 8.2) |
| IP autorizadas para SMTP | Desactivado | Desactivado. El bloqueo de las claves de API se mantiene |

### 3.2 Por qué dos cuentas y no solo dos claves

- **Claves:** en Brevo, una clave SMTP puede enviar como cualquier remitente de la cuenta. No hemos encontrado forma de limitar una clave a un dominio. Con una sola cuenta, una clave de Staging filtrada podría enviar como `no-reply@auth.gestcopy.com`.
- **Cupo y estado:** con una sola cuenta, el cupo diario o mensual y una posible suspensión afectarían a los dos entornos.
- **Alternativa:** una sola cuenta con dos claves y dos subdominios. Es más rápida, pero aísla menos. Solo es aceptable si el propietario asume esos dos riesgos.

**Sobre la cuenta que ya usamos:**
- Si envía campañas, no conviene usarla para el Auth de Production: Supabase recomienda no mezclar Auth con marketing.
- Si solo envía transaccionales de Gestcopy y ya está aprobada, puede ser la cuenta de Production. Así se evita esperar la aprobación de una cuenta nueva.

### 3.3 Por qué `auth.*` y no `mail.*`

- Es la convención de Supabase: un subdominio solo para Auth.
- `mail.` suele ser el nombre del correo web o IMAP, aquí en Hostinger, y se presta a confusión.
- Los dos nombres están libres.

## 4. DNS en Cloudflare (zona `gestcopy.com`)

**Quién y cómo:**
- El propietario añade los registros a mano, con los valores que dé Brevo.
- No se usa la conexión automática de Brevo con Cloudflare, que pide acceso a toda la zona.
- Claude comprueba después con `dig`, en solo lectura.

**Registros por subdominio** (ejemplo con Staging; para Production, igual con `auth.gestcopy.com`):

| Registro | Nombre | Tipo | Valor | Nota |
| --- | --- | --- | --- | --- |
| Código de Brevo | `auth-staging.gestcopy.com` | TXT | `brevo-code:…`, del panel | Prueba que el dominio es nuestro. No se borra mientras se use Brevo |
| DKIM | `brevo1._domainkey.auth-staging` y `brevo2._domainkey.auth-staging`, o `mail._domainkey.auth-staging` | CNAME o TXT | Del panel | Los CNAME en **«DNS only»** (nube gris), nunca con proxy |
| DMARC | `_dmarc.auth-staging` | TXT | `v=DMARC1; p=none; rua=mailto:dmarc@gestcopy.com; adkim=r; aspf=r` | Política propia del subdominio |
| SPF | — | — | — | No hace falta. Brevo usa su propio Return-Path, así que la alineación DMARC llega por DKIM |

**El SPF de la raíz (Hostinger) no se toca.**

**Plan de DMARC:**
1. **Subdominios:** `p=none` con `rua` durante 2–4 semanas. Después `p=quarantine`, si los informes muestran que todo lo que envía Brevo sale con DKIM alineado, y más adelante `p=reject`. Staging puede adelantarse.
2. **Raíz:** hoy `p=none` sin `rua`. Se propone añadir solo el `rua`, sin cambiar la política, como paso aparte. También afecta al correo de Hostinger, pero solo a los informes.
3. **Buzón:** si `rua` apunta a un buzón de `gestcopy.com`, no hace falta ningún registro de autorización externa.

**Requisitos de Gmail y Yahoo:** piden SPF o DKIM, DMARC publicado (vale `p=none`) y TLS. Se cumplen.

## 5. Límites

| Límite | Staging | Production |
| --- | --- | --- |
| Supabase: correos de Auth por hora, para todo el proyecto | 30 | 30 al empezar. Antes del alta comercial, según la previsión (por ejemplo, 100) |
| Supabase: intervalo mínimo por usuario | 60 s | 60 s |
| Supabase: caducidad del enlace | Comprobar. Propuesta: 3600 s como máximo | Ídem |
| Brevo | 300 al día (Free) | 5.000 al mes (Starter), sin límite diario. Si se supera, el siguiente tramo o créditos |
| CAPTCHA | — | Recomendado antes de abrir el alta pública (propuesta aparte) |

**Previsión:** el SUR4 y los primeros clientes suponen decenas de correos al mes. Starter va sobrado.

**Los límites de Supabase protegen a Brevo:** un ataque de altas agota primero el cupo por hora de Supabase (los usuarios legítimos reciben 429), no la reputación de la cuenta. Por eso el CAPTCHA es el paso siguiente.

## 6. Entregabilidad

**Contenido** (guía de Supabase):
- asunto corto;
- sin promoción, eslóganes, firmas ni imágenes;
- un solo enlace;
- plantilla HTML distinta de la de marketing;
- en español;
- sin datos del usuario en el texto;
- cambios de plantilla poco frecuentes.

**Volumen:** bajo y progresivo. El relé SMTP no es para envíos en lote.

**Remitente:** el mismo nombre y la misma dirección siempre. `no-reply` no recibe respuestas, así que el texto de la plantilla indica el contacto de soporte.

**Comprobación en cada prueba** (Gmail → «Mostrar original»):
- SPF PASS (dominio de Brevo);
- DKIM PASS con `d=auth-staging.gestcopy.com`;
- DMARC PASS;
- y dónde apunta el enlace (ver 8.1).

**Otros buzones:** si se puede, también Outlook.com y un buzón corporativo de Microsoft 365. Los analizadores de enlaces de algunos buzones corporativos (Safe Links) abren los enlaces antes que el usuario (ver 8.3).

## 7. Monitorización

| Dónde | Qué |
| --- | --- |
| Supabase `auth_logs` y `edge_logs` | `429 over_email_send_rate_limit`, `email_address_not_authorized`, 5xx en `/auth/v1/signup` y `/auth/v1/recover`, errores SMTP |
| Base de datos (solo lectura) | `confirmation_sent_at` frente a `email_confirmed_at`: altas que no se confirman |
| Brevo → Transactional → Logs y estadísticas | Entregados, diferidos, rebotes blandos y duros, bloqueados, spam |
| Brevo (aviso por correo) | IP bloqueada, si alguien activa el bloqueo por IP |
| Informes DMARC (`rua`) | Alineación DKIM y fuentes que no son nuestras |
| Google Postmaster Tools (opcional) | Reputación de `auth.gestcopy.com` en Gmail |

**Ritmo y umbrales:**
- revisión semanal el primer mes;
- umbrales de alerta: rebotes por encima del 2 %, quejas por encima del 0,1 %, cualquier `5xx` de envío.

**Fuera de V1:** webhooks de Brevo hacia la app.

## 8. Riesgos y limitaciones

### 8.1 Seguimiento de enlaces (el riesgo principal de Brevo)

**El problema:** Supabase recomienda desactivarlo, y en Brevo seguramente no se puede sin Enterprise.

**Qué puede pasar:**
- que se deforme el enlace `…/auth/v1/verify?token=pkce_…&type=signup&redirect_to=…`;
- que el correo lleve un dominio ajeno (más aspecto de phishing);
- que lo bloqueen filtros corporativos.

**Qué hacer:**
1. En la etapa E1, mirar en el panel la opción de anonimizar el seguimiento y preguntar a soporte si se puede desactivar.
2. En E4, comprobar que el enlace llega intacto, que el alta se confirma y que la ronda C se comporta según #161.

**Criterio de parada:** si el enlace se rompe, o Gmail lo marca como spam con SPF, DKIM y DMARC en PASS, se deshace E3 y se elige otro proveedor sin seguimiento por defecto, como Postmark o Amazon SES.

### 8.2 Los enlaces quedan guardados en Brevo

Los registros de envíos guardan el contenido: enlaces de confirmación y de recuperación.

**Mitigación:**
- tokens de un solo uso con caducidad de 1 hora como máximo;
- acceso a Brevo restringido y con 2FA.

### 8.3 Analizadores de enlaces

Algunos buzones corporativos abren los enlaces antes que el usuario y pueden gastar el token de un solo uso. No depende del proveedor.

**Mitigación a futuro (fuera de V1):** la página intermedia con un botón que propone Supabase.

### 8.4 Sin IP fijas

La clave SMTP no se puede limitar por IP. Si se filtra, se puede enviar como Gestcopy.

**Mitigación:**
- la clave solo en Supabase y en el gestor de contraseñas;
- rotación;
- vigilancia de los registros de envíos;
- cuentas separadas, para que una filtración solo afecte a un entorno.

### 8.5 Aprobación de cuentas nuevas

Brevo aprueba cada cuenta antes de dejarla enviar, sin plazo publicado. Por eso la cuenta de Staging se crea primero.

### 8.6 IP compartidas

La IP dedicada solo existe en Enterprise. Parte de la reputación depende del grupo de IP de Brevo.

### 8.7 Límite por hora de todo el proyecto en Supabase

Un ataque de altas bloquea también a los usuarios legítimos.

**Mitigación:** CAPTCHA (propuesta aparte).

### 8.8 Dependencia del proveedor

Supabase recomienda un segundo SMTP preparado. Propuesta: dejar documentado Postmark o SES como reserva, sin activarlo.

### 8.9 Protección de datos

Brevo es una empresa francesa.
- Aceptar su DPA.
- Añadirlo al registro de encargados del tratamiento y a la política de privacidad.
- Comprobar dónde guarda los datos.

### 8.10 Hallazgos del código que afectan a la recuperación de contraseña

Los mismos en `main` y en Staging `97fbc59`. **No se han tocado.**

**Recuperación de contraseña:**
- **Enlace:** el correo vuelve a `/auth/update-password`. El cliente del navegador canjea el `code` PKCE automáticamente, así que debería funcionar **en el mismo navegador**. En otro navegador, `updateUser` fallará sin sesión y mostrará el error en crudo.
- **Después de cambiar la contraseña:** el formulario navega a `/protected`, la página de ejemplo de la plantilla de Next.js.
- **Textos:** están en inglés («Reset Your Password», «Check Your Email»).

**Propuesta:** un PR pequeño y aparte, antes del alta comercial:
- destino tras cambiar la contraseña;
- textos en español;
- mensaje claro si el enlace se abre en otro navegador.

## 9. Costes

| Concepto | Coste |
| --- | --- |
| Brevo Staging | 0 € (Free) |
| Brevo Production | Starter: 7 €/mes (6,33 €/mes en anual) por 5.000 correos al mes. Si el pie «Sent with Brevo» sale en los transaccionales: Standard (15 €/mes) o Starter con el extra de 8,10 €/mes. Se comprueba en E4 con la cuenta Free. Comprobar si los precios incluyen IVA |
| DNS | 0 € (Cloudflare) |
| Tiempo del propietario | Unas 1–2 horas por entorno, más la propagación del DNS (de minutos a 48 h) y la aprobación de Brevo |

## 10. Pruebas

Cada alta de prueba necesita una identidad sintética autorizada por el propietario. Ninguna prueba crea organizaciones ni pagos.

### 10.1 Staging

| # | Prueba | Cómo | Resultado esperado |
| --- | --- | --- | --- |
| T1 | Envío | Una alta con una identidad nueva | Llega en menos de 1 minuto, desde `no-reply@auth-staging.gestcopy.com`, con «[Staging]» en el asunto |
| T2 | Cabeceras | Gmail → «Mostrar original» | SPF, DKIM (`d=auth-staging.gestcopy.com`) y DMARC en PASS. Se anota el dominio del enlace (8.1) |
| T3 | Confirmación en el mismo navegador | Abrir el enlace en el navegador donde se hizo el alta | Sesión iniciada y paso a `/onboarding` (como las rondas A y B) |
| T4 | **Ronda C** (entre navegadores) | Alta `+authfix3` en Chrome de incógnito; el enlace, pegado en Safari privado | `/auth/confirmed` sin sesión; después, inicio de sesión y `/onboarding`. Sin sesiones de más |
| T5 | Enlace reutilizado | Abrir otra vez el enlace de T3 | 403 en `/verify` y página de error de la app, sin sesión |
| T6 | Recuperación de contraseña | `/auth/forgot-password` → correo → enlace en el mismo navegador → contraseña nueva → inicio de sesión | El correo llega. Se puede cambiar la contraseña e iniciar sesión con la nueva. Se anota a dónde lleva después (8.10) |
| T7 | Recuperación entre navegadores y enlace reutilizado | Enlace de T6 en otro navegador y otra vez en el mismo | Falla sin cambiar la contraseña. Se anota el mensaje que se muestra (8.10) |
| T8 | Invitación de la app | Invitar a una identidad sin cuenta → se da de alta (correo de Brevo) → acepta la invitación | La app no envía la invitación por Supabase. Se prueba que el invitado puede darse de alta y confirmar. El enlace de invitación apunta hoy al host de Production: anotarlo, no seguirlo en Production |
| T9 | Plantilla «Invite user» de Supabase (opcional) | Desde el panel de Staging, a un alias del propietario | Llega y el enlace funciona. La app no la usa; solo valida la plantilla y el seguimiento |
| T10 | Intervalo por usuario | Pedir dos recuperaciones seguidas para la misma dirección | La segunda se rechaza durante 60 s. Sin forzar el límite por hora |
| T11 | Registros de envíos | Brevo → Logs; Supabase `auth_logs` | Todo entregado, sin rebotes ni errores |
| T12 | Otros buzones (opcional) | Outlook.com o Microsoft 365 | Bandeja de entrada. El enlace sigue siendo válido después del análisis |

### 10.2 Production (después de E8, con autorización)

| # | Prueba | Resultado esperado |
| --- | --- | --- |
| P1 | Recuperación de contraseña de una cuenta del propietario, sin crear usuarios | Llega desde `no-reply@auth.gestcopy.com`, con cabeceras en PASS; el cambio funciona |
| P2 | Opcional: una alta con un alias autorizado | Confirmación correcta. Sin organización ni pago |
| P3 | Revisión de solo lectura | Logs de Supabase y de Brevo sin errores |

## 11. Activación por etapas

Cada etapa necesita la autorización del propietario. Claude no ve ninguna credencial: solo comprueba en lectura (DNS, logs, base de datos).

| Etapa | Qué | Quién | Para seguir |
| --- | --- | --- | --- |
| E0 | Decisiones D1–D7 | Propietario | Decididas |
| E1 | **Brevo Staging:** cuenta, subdominio `auth-staging.gestcopy.com`, remitente, clave `supabase-staging`, IP autorizadas para SMTP desactivado. Revisar la opción de seguimiento y preguntar a soporte | Propietario | Cuenta aprobada para enviar |
| E2 | **DNS de Staging** en Cloudflare: código de Brevo, DKIM y DMARC | Propietario. Claude comprueba con `dig` | Brevo muestra el dominio «Authenticated» |
| E3 | **Supabase Staging:** SMTP propio (`smtp-relay.brevo.com`, 587, usuario, clave, remitente y nombre), límite de 30 por hora y asuntos con «[Staging]». Antes, anotar los valores actuales | Propietario | Guardado sin errores |
| E4 | **Pruebas T1–T12**, ronda C incluida. Después, auditoría de solo lectura | Propietario y Claude | T1–T8 y T10–T11 en PASS, sin parar por 8.1 |
| E5 | **Observación de Staging, 24–72 h:** informes DMARC y registros de envíos | Claude, en lectura | Sin fallos de DKIM ni rebotes |
| E6 | **Lectura del panel de Production** (1.4) | Propietario | Configuración actual anotada |
| E7 | **Brevo Production y DNS de `auth.gestcopy.com`**, como E1–E2 | Propietario | «Authenticated» |
| E8 | **Supabase Production:** SMTP, límite y plantillas en español. Ventana anunciada y valores anteriores anotados | Propietario, con autorización explícita | Guardado sin errores |
| E9 | **Pruebas P1–P3** | Propietario y Claude | PASS |
| E10 | **Alta comercial abierta:** vigilancia durante 2 semanas y endurecimiento de DMARC a las 2–4 semanas | Propietario y Claude | Umbrales de 7 sin superar |

**Calendario:**
- El pago del SUR4 (L0–L8) no necesita esto: su Owner ya tiene cuenta en Production.
- La recuperación de contraseña del personal del SUR4 sí depende del correo de Production. Conviene hacer E6 pronto.

## 12. Vuelta atrás

| Qué | Cómo | Efecto |
| --- | --- | --- |
| Supabase, por proyecto | Volver a los valores anotados en E3 o E8, o desactivar el SMTP propio | Vuelve el correo integrado (2 por hora, solo para el equipo). Usuarios y sesiones no cambian |
| Clave SMTP | Borrarla en Brevo | El envío se corta al momento. Es la medida ante una filtración |
| Cuenta de Brevo | **No borrarla en seguida** | Los enlaces de los correos ya enviados pasan por su dominio de seguimiento: hay que esperar al menos la caducidad del enlace |
| DNS | Los registros pueden quedarse, porque no molestan. Si se quitan, que sea pasadas 48 h | Quitar el DKIM con correos en cola los haría fallar |
| DMARC | Volver a `p=none` | Inmediato, salvo la caché del TTL |

**Cuándo volver atrás en Production:**
- errores de envío en `/signup` o `/recover`;
- rebotes por encima del 2 %;
- enlaces que no funcionan.

Cada vuelta atrás se anota en el runbook con su hora.

## 13. Fuera de alcance

- Send Email Hook: más control, sin SMTP.
- CAPTCHA en el alta.
- Página intermedia contra los analizadores de enlaces.
- Dominio propio para la URL de Auth de Supabase (complemento de pago).
- Webhooks de Brevo hacia la app.
- Corrección de 8.10 (PR aparte).

## Fuentes (consultadas el 28/10/2026)

- Supabase, «Send emails with custom SMTP»: https://supabase.com/docs/guides/auth/auth-smtp
- Brevo, guía de SMTP para Supabase: https://developers.brevo.com/docs/supabase-smtp-integration
- Brevo, integración del relé SMTP: https://developers.brevo.com/docs/smtp-integration
- Brevo, autenticación de dominio (API): https://developers.brevo.com/docs/domain-authentication-and-verification
- Brevo, autenticar el dominio (código de Brevo, DKIM, DMARC): https://help.brevo.com/hc/en-us/articles/12163873383186
- Brevo, IP autorizadas: https://help.brevo.com/hc/en-us/articles/5740111683858
- Brevo, problemas con el SMTP: https://help.brevo.com/hc/en-us/articles/115000188150
- Brevo, precios: https://www.brevo.com/pricing/
- Foro de Brevo, seguimiento en transaccionales: https://community.brevo.com/t/no-way-to-disable-by-option-tracking-in-transactional-e-mail/201
- Foro de Brevo, petición de desactivar seguimiento y almacenamiento: https://community.brevo.com/t/feature-request-transactional-email-api-option-to-disable-url-tracking-and-email-content-storage-for-sensitive-emails-e-g-password-resets/6677
