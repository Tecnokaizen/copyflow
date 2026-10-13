# AUDITORIA-GESTCOPY-2026-10-13.md

**Alcance:** repo `Tecnokaizen/copyflow`. `main` está en `4dab5e0` (incluye la PR #92). Las PR #93, #94 y #95 están abiertas y sin mergear.
**Método:** auditoría solo de lectura. No se ha modificado el repo, ni Supabase, ni Vercel. Lo único consultado fuera del código es la lista de migraciones aplicadas en Supabase (vía API, sin ejecutar SQL). Se pasaron `tsc`, ESLint y los tests unitarios en una copia local, y se hizo una prueba de impresión en Chromium headless con el CSS real.
**Ubicación:** rama `audit/gestcopy-2026-10-13`, archivo `claude/auditoria-gestcopy-2026-10-13.md`. Solo documentación: no modifica código, migraciones ni configuración.
**No verificado:** variables de entorno de Vercel (lo dicho sobre ellas sale de las auditorías del 22-09 y del 06-10), comportamiento en Firefox y Safari, y logs de producción.

---

## 1. Resumen ejecutivo

1. **Lo más peligroso hoy es aplicar la migración de la PR #95.** Si se aplica `20261013150000_order_payment_methods_receipts.sql` con el código actual de `main` desplegado, **SUR4 deja de poder registrar entregas a cuenta** (HTTP 500). Y el código de la PR #95 contra la base de datos actual también da 500, que es exactamente el incidente C. La migración rompe el contrato por diseño, no tiene rollback y hay que dividirla en dos fases (primero ampliar el esquema, después retirar lo antiguo).
2. **Supabase coincide exactamente con `main`.** Hay 65/65 migraciones aplicadas; la última es `20261008193000`. No hay ninguna de la PR #95 (ni `20261013092854`). Las Preview de Vercel usan la misma base de datos que producción: todo lo que se prueba en una Preview toca datos reales de SUR4.
3. **Incidente A (fechas):** la PR #92 corrige la pérdida de `due_at`. Queda un **bug nuevo**: si se vuelve a pulsar el día ya seleccionado, la ficha se queda sin poder guardar, enseña una fecha válida y da un error que no tiene nada que ver ("Esta hora no existe por el cambio horario"). No se pierden datos.
4. **Incidente B (conflictos de versión):** la causa está confirmada en el código. El bloque de cobro solo carga `row_version` al montarse, así que cualquier cambio rápido en la ficha (estado, notas, etc.) la deja obsoleta. La PR #93 lo corrige, pero muestra el mensaje de conflicto también en errores 409 que no lo son.
5. **Incidente D (impresión):** no hay ningún error de CSS que explique por sí solo la diferencia. Hay un punto de corte a 720 px que cae justo entre el ancho útil del A4 (673 px) y el ancho total del A4 (794 px), así que el resultado depende de cada navegador. Lo más probable es que la diferencia venga de la configuración de impresión de cada equipo; hay que confirmarlo con datos de SUR4.
6. **Aislamiento entre tenants:** no se ha encontrado ninguna fuga de datos entre tenants por id o por clave. Sí hay **dos fallos P1 de seguridad** (borrado del PDF oficial de un presupuesto y toma de cuentas "huérfanas" mediante invitaciones) y varios privilegios de más en la base de datos.
7. **Calidad:** `tsc` da 0 errores y ESLint 0 errores con 4 avisos. Los tests unitarios dan 994 OK, 0 fallos y 6 omitidos. **La PR #95 rompe un test existente.** No hay ningún control de CI común sobre `main`, 18 suites SQL no se ejecutan nunca y Next 16.3.4 tiene una vulnerabilidad **crítica** publicada.

| | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| Hallazgos | 2 | 12 | 17 | 9 |

---

## 1 bis. Tipo de evidencia de cada hallazgo

Las clasificaciones (BUG CONFIRMADO, RIESGO POTENCIAL, HIPÓTESIS PENDIENTE, FUNCIONAMIENTO CORRECTO VERIFICADO) indican **qué** se afirma. Esta sección indica **cómo** se ha obtenido la evidencia. "BUG CONFIRMADO" por análisis estático significa que el código lo determina sin ambigüedad, no que se haya reproducido ejecutándolo.

### R · Reproducidos (ejecutados durante la auditoría)

| ID | Qué se ejecutó | Resultado observado |
|---|---|---|
| C-5 | `TZ=UTC node --import tsx --test` sobre la PR #95 (worktree aparte) | 1012 tests, 1 fallo: `.not is not a function` en `app/api/orders/[id]/files/route.ts:58` |
| QA-12 | Tests unitarios de `main` con `TZ=Europe/Madrid` | Falla `lib/kiosk/form-state.test.ts:57-79` (espera `10:30Z`, recibe `08:30Z`) |
| QA-13 | Tests unitarios de `main` | Los 6 tests de `list-search.postgrest-harness.test.ts` salen como `SKIP local PostgREST unavailable` |
| QA-10 | `npm audit --omit=dev` en `main` | 1 crítica (`next`), 2 altas (`sharp`, `source-map-js`) |
| Sección 6 | `tsc --noEmit`, `eslint .`, tests unitarios en `main`, #93, #94, #95 | `main`: 0 errores tsc, 0 errores y 4 avisos ESLint, 994/1000 OK, 6 omitidos |
| D-1 | Chromium headless (Playwright) con `print.css` real: PDF A4 con márgenes por defecto, sin márgenes, escala 0,9 y ventanas de 500-1280 px | Siempre se aplica la regla ancha (2 columnas). Firefox y Safari no probados |
| Estado de Supabase | `list_migrations` (API de metadatos, sin SQL) | 65/65 migraciones; última `20261008193000`; ninguna de la PR #95 ni `20261013092854` |
| Incidente C (500) | No reproducido por la auditoría | Evidencia externa aportada por el equipo: logs de la Preview y consultas SQL previas |

### E · Conclusiones por análisis estático (lectura de código y migraciones)

- **Incidentes:** A-0, A-1, A-2, A-3, B-1, B-2, B-3, C-1, C-3, C-4, C-6, C-7, C-8, D-3.
- **Multi-tenant:** MT-1, MT-2, MT-3, MT-4, MT-5, MT-6, DB-14 y todo el bloque "Verificado correcto" de la sección 3.
- **Funcional:** FN-1, FN-2, FN-3, FN-4, FN-5, FN-7, FN-8, FN-9, FN-10, FN-11 y el bloque "Verificado correcto" de la sección 4.
- **Supabase:** DB-15, DB-16 (análisis automático por expresiones regulares), DB-17, DB-18, matriz de compatibilidad RPC de la PR #95.
- **Calidad:** QA-1, QA-2, QA-4, QA-6, QA-7, QA-8, QA-9, QA-11, QA-15, QA-16.

Nota: A-1 y B-1 se han deducido siguiendo el flujo de estado de React y no se han reproducido en un navegador. MT-1, MT-2 y FN-1 se han deducido de rutas y funciones SQL sin ejecutarlas.

### S · Verificaciones que requieren staging (u otro entorno no productivo)

| ID | Qué hay que verificar | Dónde |
|---|---|---|
| C-1 | Que el build de `main` deja de cobrar con la migración actual, y que sigue cobrando con la migración A (fase de ampliación) | Supabase staging o branch + Preview aislada |
| C-3 | Código real de error (`42703` / `PGRST200` / `PGRST204`) del listado de archivos sin migración | Preview contra BD sin migrar (o logs de la Preview actual) |
| C-4 | Borrado de un justificante con el código de `main` tras haber registrado pagos con la PR #95 | Staging |
| C-6 | Recarga de esquema de PostgREST y duración de bloqueos al aplicar la migración | Staging con datos de volumen similar |
| C-2 | Variables de entorno de Preview en Vercel (`service_role`, R2, URL de Supabase) | Panel de Vercel (no requiere staging, pero no se ha verificado hoy) |
| A-1, B-1 | Reproducción en navegador de la ficha bloqueada y del 409 tras cambiar el estado | Staging o tenant DEMO aislado |
| A-2 | Desfase horario con un equipo en otra zona horaria | Staging + datos de los equipos de SUR4 |
| MT-2 | Explotabilidad real con una cuenta sin organización | Staging (nunca en producción) |
| MT-5 | Si R2 / AWS SDK normalizan `..` en las claves | Bucket de staging |
| FN-1, FN-3 | Archivar con pendiente; alta repetida tras timeout | Staging |
| QA-2 | Si las 18 suites SQL fuera de CI pasan hoy | Supabase local o staging |
| D-1, D-2 | Impresión en Firefox/Safari y con la configuración real de SUR4 | Equipos de SUR4 / navegadores reales |

---

## 2. Incidentes del 13/10/2026

### Incidente A: fechas de entrega

**A-0 · FUNCIONAMIENTO CORRECTO VERIFICADO (lo que corrige la PR #92)**
- **Selección parcial:** una fecha incompleta ya no llama a `onChange("")`. En `date-time-picker.tsx:49-57`, `publish()` solo avisa de que el valor no es válido. "Quitar fecha" solo funciona con el botón explícito (`:78-82`).
- **Hora por defecto:** al elegir una fecha nueva se pone 18:00 (`date-value.ts:74-76`). Si ya había hora, se respeta.
- **Horas que no existen por el cambio horario:** se rechazan. `fromDateTimeLocalValue` en `lib/orders/format.ts:51-58` comprueba que la hora sobreviva a la conversión de ida y vuelta. La hora repetida del 25-10-2026 (02:00–02:59) se resuelve a la primera ocurrencia, que es válido.
- **Guardado bloqueado si la fecha no es válida:** en la ficha (`order-workspace.tsx:707-710`) y en el alta (`create-order-form.tsx:361-368`).
- **Edición:** solo se envía `due_at` si ha cambiado (`lib/orders/draft.ts:178-193`). Lleva `expected_version` (`details/route.ts`) y la actualización automática no pisa la edición en curso.
- **Supabase:** la lista de migraciones remota coincide con `main`.

**A-1 · P2 · BUG CONFIRMADO · Fecha/ficha y alta de pedido · confianza alta**
- **Dónde:**
  - `components/gestcopy/date-picker.tsx:41-45`: si el `DayPicker` devuelve `undefined`, se llama a `onChange("")`.
  - `date-time-picker.tsx:37-43` y `:49-57`.
  - `order-workspace.tsx:707-710`.
  - `create-order-form.tsx:361-364`.
- **Defecto:**
  1. En modo `single`, `react-day-picker` deselecciona el día si se vuelve a pulsar el que ya está elegido.
  2. Entonces `publish("", "18:00")` marca el campo como no válido (`onValidityChange(true)`) pero no cambia el valor.
  3. Como `draftValue` queda vacío y `value` no, `showDraft` pasa a `false` y el selector **vuelve a enseñar la fecha anterior, sin ningún aviso**.
  4. Al guardar, la ficha responde "Esta hora no existe por el cambio horario" y el alta responde "Debes indicar una fecha y hora válidas", aunque lo que se ve en pantalla es correcto.
- **Cómo reproducirlo:** Editar → abrir el calendario → pulsar el día que ya estaba marcado → Guardar.
- **Impacto:** la ficha se queda bloqueada con un mensaje equivocado. Se sale de ahí eligiendo otra vez la fecha o cancelando. No se pierden datos. **Riesgo para otros tenants:** ninguno.
- **Corrección:** en ese caso, no marcar como no válido (o desmarcar si la fecha guardada sigue siendo válida), o bien usar `required` en el `DayPicker`. Separar el mensaje de "fecha incompleta" del de "hora inexistente".
- **Pruebas:** test de componente para deseleccionar un día con valor previo (debe permitir guardar o mostrar el mensaje correcto). Test de los mensajes.
- **PR:** ninguna la corrige.

**A-2 · P2 · RIESGO POTENCIAL · Zona horaria · confianza media**
- **Dónde:** la entrada y edición usan la zona horaria del navegador (`lib/orders/format.ts:33-58`, `getTimezoneOffset`). El calendario y los listados usan la del tenant (`app/orders/page.tsx:1111-1112` y `:1225-1229`, `formatZonedTime`).
- **Escenario:** un equipo de SUR4 con Windows en UTC u otra zona elige 18:00 y el pedido aparece a las 20:00 en el calendario. El test `lib/kiosk/form-state.test.ts:57-79` solo pasa con `TZ=UTC` (QA-12), así que nunca se prueba con Europe/Madrid.
- **Corrección:** convertir con la zona horaria del tenant (`Intl` + `zoned-day.ts`) en lugar de la del navegador, o avisar si no coinciden.
- **Pruebas:** ejecutar `lib/orders` y `lib/kiosk` con TZ en UTC, Europe/Madrid y Atlantic/Canary.
- **HIPÓTESIS PENDIENTE:** confirmar la zona horaria configurada en los equipos de SUR4.

**A-3 · P2 · RIESGO POTENCIAL · API · confianza alta**
- **Dónde:** `app/api/orders/[id]/details/route.ts:48-67` y `app/api/orders/route.ts:305-325`.
- **Defecto:**
  - El servidor interpreta `""` como "borrar `due_at`". Es el mismo patrón que causó el incidente; ahora solo lo evita el cliente.
  - Acepta fechas sin zona horaria (`"2026-10-20T18:00"`). En `details` se envía tal cual a Postgres, que la interpreta en UTC (2 h de diferencia).
- **Corrección:** exigir ISO-8601 con zona horaria y aceptar el borrado solo con `null` explícito (o un campo `clear: true`).
- **Pruebas:** tests de ruta para `""`, fecha sin zona y solo fecha.

---

### Incidente B: conflictos de versión al cambiar el total

**B-1 · P1 · BUG CONFIRMADO (en `main`; lo corrige la PR #93) · Cobros · confianza alta**
- **Dónde:**
  - `components/orders/detail/order-collection.tsx:44-72`: carga el cobro solo cuando cambia `[orderId]`.
  - `:128-130`: abre el diálogo con la versión cacheada.
  - `:205-209`: envía esa versión como `expected_version`.
  - `app/api/orders/[id]/total/route.ts:29-31` y `:45-49`.
- **Causa:**
  - `bump_row_version` incrementa la versión en **cualquier** UPDATE de `orders`.
  - El cambio de estado, las notas rápidas, el aviso al cliente, el estado del archivo o la edición desde otro equipo actualizan el pedido en la ficha, pero **no** la versión que guarda `OrderCollection`.
  - Al cambiar el total se envía una versión vieja y la respuesta es 409 "El pedido cambió…". Al recargar se monta de nuevo y funciona, que es justo lo que vio SUR4.
  - El otro sentido sí funciona: tras un cambio de cobro, `onCollectionChanged` recarga la ficha (`order-workspace.tsx:1364-1367`).
- **Integridad:** los importes no se corrompen. El SQL protege bien (DB-15).
- **Corrección (PR #93):** refrescar el cobro al abrir el diálogo y recargar los importes ante un 409, sin reintentar automáticamente.
- **Pruebas:** test de componente: con el estado cambiado entre medias, "Modificar total" debe guardar sin conflicto. No hay ninguna prueba de este flujo.

**B-2 · P3 · BUG CONFIRMADO (en la PR #93 y su copia en la #95) · confianza alta**
- **Dónde:** `pr/95: order-collection.tsx:131-139` y `:470`.
- **Defecto:** **cualquier** 409 de `submit()` muestra "El pedido ha cambiado… revisa el total". Pero `submit` también se usa para anular entregas, y los códigos `already_voided`, `order_archived` e `idempotency_mismatch` también son 409. El mensaje real se pierde.
- **Corrección:** tratar como conflicto solo `body.code === "conflict"` (o la ruta `/total`) y conservar `body.error` en el resto de casos.

**B-3 · FUNCIONAMIENTO CORRECTO VERIFICADO**
- **Entregas a cuenta:** clave de idempotencia por apertura del diálogo (`order-collection.tsx:103`), `UNIQUE (tenant_id, order_id, idempotency_key)`, y un reintento solo se acepta si el importe y la fecha coinciden.
- **Bloqueos e importes:** `FOR UPDATE` sobre el pedido y `payment_exceeds_total` / `total_below_paid`. `money.ts` rechaza negativos, NaN, más de 2 decimales y cero.
- **Doble envío:** el botón se desactiva mientras guarda.
- **Pendiente tras un fallo de red:** la PR #95 añade `sessionStorage` para guardar la confirmación pendiente.

---

### Incidente C: HTTP 500 en pagos y archivos (PR #95)

**Estado verificado:** la base de datos remota tiene las 65 migraciones de `main`. Ni `20261013092854` ni `20261013150000` están aplicadas. La causa de los 500 en la Preview está confirmada: el código de la PR #95 se ejecuta contra la base de datos de producción, que no tiene la migración.

| RPC / ruta | Lo que envía el código de `main` | BD actual | BD con la migración #95 | ¿`main` sigue funcionando? |
|---|---|---|---|---|
| `record_order_payment` | `{p_order_id, p_amount, p_paid_at, p_idempotency_key}` | Inserta | La versión de 4 argumentos **ya no inserta**: devuelve `invalid_payment_method` (líneas 80-147) y el trigger rechaza `payment_method` NULL (34-36) | **NO → 500** |
| `set_order_total_amount` | 3 argumentos | OK | Misma firma | Sí |
| `order_collection_v1` | `{p_order_id}` | OK | Snapshot ampliado; el parser ignora lo que no conoce | Sí |
| `void_order_payment` | 2 argumentos | OK | El trigger permite anular aunque el método sea NULL | Sí |
| `soft_delete_order_file` | 4 argumentos | OK | Bloquea el borrado de justificantes | Sí (ver C-4) |

| Código de la PR #95 contra la BD actual | Resultado |
|---|---|
| POST de pago (7 argumentos) | La función no existe → **500** |
| Listado de archivos (consulta a `receipt_file_id`) | 500 probable (C-3) |
| GET del cobro | OK |

**C-1 · P0 · BUG CONFIRMADO (latente: estallaría al aplicar la migración) · Cobros/BD · confianza alta**
- **Dónde:** `pr/95: supabase/migrations/20261013150000_order_payment_methods_receipts.sql:34-36` y `:80-147`. Del lado de `main`: `lib/orders/collection.ts` (`collectionError`) y `app/api/orders/[id]/payments/route.ts`.
- **Escenario:** se aplica la migración con `main` desplegado → SUR4 registra una entrega → `invalid_payment_method` → 500 "No se pudo actualizar el cobro.". El propio documento del PR lo reconoce ("Retirar la firma antigua deja sin capacidad…").
- **Impacto:** SUR4 no puede cobrar hasta que se despliegue la PR #95. No se corrompen datos. **Riesgo para otros tenants:** no hay fuga, pero el corte afecta a todos los tenants a la vez.
- **Corrección:** dividir la migración.
  - **Fase A (compatible con `main`):** columnas, CHECK, FK, UNIQUE, triggers de archivos, la función de 7 argumentos y la protección de justificantes. Sin tocar la versión de 4 argumentos y sin rechazar el NULL al insertar.
  - **Fase B (retirar lo antiguo):** después del despliegue.
- **Pruebas:** con la fase A aplicada, la batería `phase45` de `main` (4 argumentos) debe pasar; la `phase46` después de la fase B. Prueba de humo del build de `main` contra la base de datos migrada.
- **Dependencias:** C-4, C-6 y C-7.

**C-2 · P0 · RIESGO POTENCIAL (dato de auditorías anteriores, a reverificar) · Infraestructura · confianza media-alta**
- **Dónde:** Vercel. Según la auditoría del 22-09 (P0-2) y la del 06-10 (N4): `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` de producción, R2 y `FILES_SIGNING_SECRET` están configurados también para Preview. En código, `lib/tenant/preview-tenant.ts:13-23` permite elegir tenant con `?tenant=` en Preview (sigue exigiendo pertenencia al tenant).
- **Impacto:**
  - Código de ramas sin revisar escribe en los datos de SUR4 usando `service_role`.
  - Aplicar una migración "para probar la Preview" cambia producción.
  - Los 500 de la Preview se interpretan como fallos de código cuando lo que falta es la migración (es lo que ha pasado con el incidente C).
- **Corrección:**
  - **Hoy:** quitar de Preview las variables de `service_role` y de R2, activar Deployment Protection y no iniciar sesión en Preview con usuarios de SUR4.
  - **Después:** un proyecto Supabase de staging o Supabase Branching.
  - **En código:** que el cliente admin falle si `VERCEL_ENV==="preview"` y apunta a la referencia de producción.

**C-3 · P2 · HIPÓTESIS PENDIENTE · Archivos · confianza media**
- **Dónde:** `pr/95: lib/files/receipt-links.ts:2-4`, `app/api/orders/[id]/files/route.ts:~86`, `app/api/files/route.ts:~192`.
- **Defecto:** el plan alternativo solo se activa si el mensaje contiene "schema cache". Pero una columna que no existe en PostgREST suele devolver el código `42703` "column … does not exist", que no encaja con esa comprobación → el listado seguiría dando 500 en una Preview sin migración.
- **Cómo verificarlo:** mirar `error.code` en los logs de la Preview actual.
- **Corrección:** comprobar los códigos (`42703`, `PGRST200`, `PGRST204`) en lugar del texto del mensaje.

**C-4 · P1 · RIESGO POTENCIAL · Rollback · confianza alta**
- **Dónde:** `main: app/api/orders/[id]/files/[fileId]/route.ts` (~80-117): borra en R2 **antes** de llamar a `soft_delete_order_file`.
- **Escenario:** con la PR #95 en producción ya hay justificantes. Se hace rollback de la aplicación a `main` y alguien borra un justificante. El archivo se borra de R2, la base de datos responde `payment_receipt_protected` (500) y la ficha queda apuntando a un archivo que ya no existe.
- **Corrección:** antes de la PR #95, llevar a `main` un PR pequeño que cambie el orden (primero la base de datos, después R2) y que traduzca ese error.

**C-5 · P1 · BUG CONFIRMADO · CI de la PR #95 · confianza alta**
- **Dónde:** `lib/orders/pedido-v2-routes.test.ts:114`.
- **Evidencia:** `.not is not a function` en `app/api/orders/[id]/files/route.ts:58`. Resultado: 1012 tests, 1 fallo.
- **Impacto:** el test de aislamiento entre tenants en listado y alta de archivos deja de verificar nada mientras siga rojo.
- **Corrección:** añadir `.not()` al PostgREST simulado del test. No mergear la PR con este test fallando.

**C-6 · P2 · RIESGO POTENCIAL · Migración · confianza alta**
Problemas operativos de la migración de la PR #95:
- **Recarga de esquema:** no hace `notify pgrst, 'reload schema'` (sí hay precedente en `20261006130000:233`).
- **Bloqueos:** no fija `lock_timeout`. `ADD CONSTRAINT UNIQUE` y los triggers toman bloqueos ACCESS EXCLUSIVE sobre `order_files` y `order_payments` durante toda la transacción.
- **Rollback:** no hay script en `supabase/rollbacks/`; solo se puede recuperar hacia delante.
- **Corrección:** `set local lock_timeout='5s'` y `notify` dentro de la migración, y una migración de emergencia preparada que recree la versión original de 4 argumentos (`20261007190056:443-591`) y el trigger sin el rechazo del NULL.

**C-7 · P2 · RIESGO POTENCIAL · Coordinación entre PR · confianza alta**
- **Defecto:** `20261013092854_order_total_validation_p1.sql` está en la PR #91 y en la #95, con el mismo contenido, pero `phase46_order_total_validation.sql` es distinto en cada una → habrá conflicto. Si las dos versiones divergen, la CLI de Supabase no reaplica una versión que ya consta como aplicada, y la diferencia queda oculta.
- **Corrección:** mergear la #91 primero y rebasar la #95 encima, o quitar el archivo de la #95.
- **Lo que hace la migración:** ahora solo traduce `total_below_paid` y relanza el resto de errores. No añade restricciones, así que no puede romper datos existentes (DB-10, correcto).

**C-8 · FUNCIONAMIENTO CORRECTO VERIFICADO: justificantes y aislamiento en la PR #95**
- **No se puede enlazar un justificante de otro tenant o de otro pedido:** FK compuesta `(tenant_id, order_id, receipt_file_id) → order_files(tenant_id, order_id, id)` (líneas 6-16).
- **Trigger de guarda:** exige mismo tenant y pedido, estado `ready`, no borrado y `uploaded_by = auth.uid()`.
- **Unicidad:** `UNIQUE (tenant_id, receipt_file_id)`.
- **Inmutabilidad:** el método y el justificante no se pueden cambiar después.
- **Permisos:** `revoke` para `public`, `anon` y `service_role`.
- **Datos históricos:** los NULL existentes no incumplen ninguna restricción. Las firmas de 4 y 7 argumentos no son ambiguas para PostgREST.

---

### Incidente D: impresión

**D-1 · P3 · RIESGO POTENCIAL · Impresión · confianza media**
- **Dónde:** `components/print/print.css:156-177` (`@media (max-width:720px)` pone `.print-facts` a 1 columna) y `:179-182` (`@page { size:A4; margin:16mm }`).
- **Defecto:** el punto de corte de 720 px cae entre el ancho útil del A4 con esos márgenes (178 mm ≈ 673 px) y el ancho total del A4 (≈ 794 px). Según cómo calcule cada navegador el ancho al imprimir, los datos del pedido salen en 2 columnas o en 1 (más largo, con otros saltos de página).
- **Evidencia:** prueba en Chromium headless con el CSS real. Al imprimir se aplica siempre la regla de pantalla ancha (2 columnas), con márgenes por defecto, sin márgenes y con escala 0,9, y con ventanas de 500 a 1280 px. Firefox y Safari no se han podido probar.
- **Corrección:** no depender de `max-width` al imprimir. Añadir en `@media print` `.print-facts { grid-template-columns: repeat(2, minmax(0,1fr)) }`, y opcionalmente `print-color-adjust: exact`.
- **Pruebas:** PDF de referencia en Chromium y comparación visual en Firefox.

**D-2 · HIPÓTESIS PENDIENTE (lo más probable) · Navegador o impresora**
- **Situación:** que el mismo pedido salga bien en PDF desde otro equipo apunta a la configuración del equipo, no al CSS:
  - papel Letter en lugar de A4 en el driver;
  - "Ajustar al área imprimible" o una escala personalizada;
  - márgenes "Ninguno" o mínimos en el diálogo;
  - navegador distinto (Firefox o Safari, ver D-1).
- **No hay ningún PDF generado en el servidor para pedidos:** se imprime con el navegador (`window.print()`). El PDF del servidor existe solo para presupuestos.
- **Datos que hay que pedir a SUR4:** navegador y versión, captura del diálogo de impresión (papel, márgenes, escala), modelo de impresora, y el PDF que sale bien comparado con el papel que sale mal.

**D-3 · FUNCIONAMIENTO CORRECTO VERIFICADO**
- El `@media print` oculta la barra de herramientas y la navegación, quita la sombra y el fondo y pone a 0 el padding de la hoja.
- Hay `break-inside: avoid` en bloques y datos.
- Los colores de texto son explícitos, así que el modo oscuro no se cuela en la impresión.
- El test `lib/print/documents.test.ts:253-278` verifica `size: A4` y que se oculta la barra de herramientas.

---

## 3. Arquitectura multi-tenant

**Verificado correcto:**
- **Resolución de tenant:** solo por subdominio (`lib/tenant/hostname.ts:46-76`). La cookie o el parámetro de Preview se ignoran en producción (`preview-tenant.ts:13-15`).
- **Contexto:** exige tenant activo y pertenencia activa (`current-context.ts:21-34`).
- **RLS:** activado en las 38 tablas, con `WITH CHECK` en INSERT y UPDATE. FK compuestas con `tenant_id`.
- **Funciones `SECURITY DEFINER`:** las 116 tienen `search_path` fijado y ninguna tiene `EXECUTE` para `PUBLIC`. Para `anon` solo quedan las de Kiosk y la vista previa de invitaciones.
- **R2:** las claves se generan en la base de datos y no se pueden cambiar. Las descargas y modificaciones van firmadas con HMAC (usuario, tenant, recurso, 120 s), filtrando por `tenant_id`.
- **Kiosk:** firma HMAC, límite de peticiones y clave pública (nunca `service_role`).
- **Webhook de Stripe:** firma verificada.
- **`service_role`:** todos los usos están acotados al tenant correcto.

| ID | Sev | Tipo | Archivo:líneas | Defecto y evidencia | Reproducción e impacto | Riesgo para otros tenants | Corrección y pruebas | Conf. |
|---|---|---|---|---|---|---|---|---|
| **MT-1** | P1 | BUG CONFIRMADO | `app/api/quotes/[id]/files/[fileId]/route.ts:56-60` (borra en R2) antes de `:79` (RPC) | Borra en R2 antes de la RPC. El trigger `official_pdf_protected` (`20261005173000:77-100`) protege la fila, pero el archivo ya se ha borrado. La UI solo oculta el botón | Una llamada `DELETE` sobre el PDF oficial deja el presupuesto sin PDF (`PDF_UNAVAILABLE`) para siempre | No | Primero la RPC y después R2; rechazar si `pdf_version_id` no es nulo. Test HTTP que dé 409 sin borrar en R2 | Alta |
| **MT-2** | P1 | BUG CONFIRMADO (depende de que existan cuentas sin organización) | `20260914194305:181,191` (la RPC devuelve el token y tiene permiso para `authenticated`); `app/api/invitations/signup/route.ts:102-118`; `lib/invitations/complete-signup.ts:89-99` | El admin de cualquier tenant llama a la RPC directamente, obtiene el token y hace un signup que cambia la contraseña con `updateUserById` y confirma el email de una cuenta existente sin organización. `requires_login` solo salta si hay pertenencia a un tenant | Toma de la identidad de otra persona | **Sí** (un tenant actúa sobre un usuario ajeno) | No devolver el token desde la RPC; no reescribir contraseñas de cuentas existentes sin prueba de posesión del email (OTP o enlace mágico) | Media |
| MT-3 | P2 | RIESGO POTENCIAL | `remote_schema.sql:7441,7142`; `lib/onboarding/slug.ts:3,40` | Owner o admin pueden cambiar `tenants.slug` directamente por PostgREST, saltándose los slugs reservados | Rompe enlaces, Kiosk e invitaciones, o deja libre el slug para que otro lo ocupe (phishing) | Indirecto | `REVOKE UPDATE` (o permiso solo sobre `name`) y trigger que impida cambiar el slug. Test que dé `42501` | Alta |
| MT-4 | P3 | RIESGO POTENCIAL | `remote_schema.sql:434,7110,7120,7435` | `tenant_domains` es editable por el propio tenant, con `verified` autodeclarado y `hostname` único global. Hoy no se usa | Un tenant puede reservar el dominio de otro antes de que se activen los dominios propios | Futuro | Solo `service_role` más verificación DNS | Alta |
| MT-5 | P2 | HIPÓTESIS PENDIENTE | `lib/tenant/branding.ts:173-175`; `app/api/tenant/logo/route.ts:20-26`; `settings/organization/logo/route.ts:66-74` | La clave del logo solo se valida por prefijo; con `..` podría apuntar a otra ruta | Leer o borrar un objeto de otro tenant si R2 normaliza la ruta; requiere conocer 3 UUID | Posible | Regex `^branding/<t>/logo/<uuid>$` y CHECK en BD | Baja |
| MT-6 | P3 | RIESGO POTENCIAL | `main: app/api/orders/[id]/payments/route.ts` | No filtra el pedido por el tenant del host; solo comprueba la pertenencia en la RPC | Un usuario que pertenece a A y a B opera pedidos de A desde el host de B | No hay fuga | Lo corrige la PR #95; revisar `list_order_activity` | Alta |
| DB-14 | P2 | RIESGO POTENCIAL | `remote_schema.sql:6978-6992,7395` | Hay `GRANT INSERT, UPDATE ON orders` a `authenticated`: un PATCH directo cambia título, notas, `due_at`, etc. sin comprobar `row_version` | Sobrescritura silenciosa de cambios simultáneos | No | Retirar el permiso y dejar solo las RPC `*_v2` (comprobar antes Kiosk y el alta) | Media-alta |

---

## 4. Auditoría funcional

**Verificado correcto:**
- **Conversión de presupuesto a pedido:** idempotente, con bloqueo y versión.
- **Creación de presupuestos:** idempotente (`creation_id`).
- **Webhook de Stripe:** reclama el evento, ignora los antiguos y reintenta bien.
- **Onboarding de pago:** se puede reanudar.
- **Edición de la ficha:** un PATCH por campo con versión y aviso de guardado parcial.
- **Archivos:** subida en 3 pasos que comprueba el tamaño real.
- **Equipo e invitaciones:** sin actualizaciones optimistas.
- **Navegador:** no hay escrituras directas a Supabase desde el cliente.
- **Importación CSV/XLSX: no existe** en el código.

| ID | Sev | Tipo | Módulo | Archivo:líneas | Defecto y evidencia | Reproducción e impacto en SUR4 | Corrección y pruebas | PR | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| **FN-1** | P1 | BUG CONFIRMADO | Archivo/Cobros | `20260917180000:269-272`; `20261007190056:481-482,638-639` | `archive_order` solo comprueba que el estado sea terminal; cobrar y anular devuelven `order_archived`; no existe forma de desarchivar | Pedido de 50 € con 20 € entregados → Entregado → Archivar → el cliente paga los 30 € → no se puede registrar ni corregir. La caja queda mal y solo se arregla tocando la base de datos | Bloquear o avisar al archivar con pendiente; añadir `unarchive_order` auditado. Test SQL | — | Alta |
| **FN-2** | P1 | BUG CONFIRMADO | Sesión/Alta de pedido | `lib/tenant/current-context.ts:12-14,31-33`; `app/api/orders/route.ts:1091-1096`; `lib/orders/create.ts:58-59` | Una sesión caducada o un error momentáneo de la base de datos se convierten en 403 "No tienes permiso" | Pedido rápido abierto mucho rato → mensaje de falta de permiso → recargar y perder lo escrito | PR #94: distingue 401 de 403 y guarda el borrador. Ampliar a cobros, presupuestos y equipo | #94 | Alta |
| FN-3 | P2 | RIESGO POTENCIAL | Alta de pedido | `create-order-form.tsx:385-406`; `app/api/orders/route.ts:1251-1271` | El alta no lleva clave de idempotencia y lee el JSON antes de comprobar `ok` | Un 502/504 después de insertar → el usuario reintenta → pedido duplicado que puede imprimirse dos veces | `client_request_id` con UNIQUE. Test de alta repetida | — | Media |
| FN-4 | P2 | RIESGO POTENCIAL | Cobros/Impresión | `order-fulfillment.tsx:40,107`; `lib/print/order-document.ts:132` | El campo "Pago" es una etiqueta manual distinta de la situación de cobro calculada | La ficha dice "Cobrado" pero el ticket impreso dice "Pendiente" → se reclama un pago ya hecho | Imprimir total, entregado y pendiente; renombrar la etiqueta | — | Alta |
| FN-5 | P2 | RIESGO POTENCIAL | Clientes | `app/api/clients/[id]/route.ts:178-200`; `order-workspace.tsx:996-1000` | `update_client` sustituye la ficha entera sin versión; el formulario sale de una copia guardada dentro del pedido | Gana el último que guarda y se pierde un teléfono o email | Versión en clientes o PATCH solo de los campos cambiados | — | Alta |
| FN-7 | P3 | BUG CONFIRMADO | Presupuestos | `quote-commercial-editor.tsx:309` | La `key` del componente incluye `row_version`, así que se vuelve a montar | Las notas internas sin guardar se pierden | `key` solo con el id del presupuesto | — | Alta |
| FN-8 | P3 | BUG CONFIRMADO | Cobros | `20261007190056:581-584` | Todos los errores `23514` se muestran como "excede el total" | Mensaje engañoso | — | #95 | Alta |
| FN-9 | P3 | RIESGO POTENCIAL | Ajustes | `lib/tenant/organization.ts:54-75` | El JSON de marca se lee, se mezcla y se escribe entero sin control | Dos cambios simultáneos: se pierde una de las claves | `jsonb_set` atómico | — | Media |
| FN-10 | P3 | RIESGO POTENCIAL | Alta de pedido | `app/api/orders/route.ts:327-341` | `belongsToTenant` no filtra por `active` | Pedido creado con un servicio desactivado | Filtrar `.eq("active", true)` | — | Alta |
| FN-11 | P3 | RIESGO POTENCIAL | UI | `order-workspace.tsx:258-266,467,922`; `quote-commercial-editor.tsx:145-155` | Se lee la respuesta antes de comprobar `ok`; si la recarga tras un cobro falla, la ficha entera se sustituye por un error | Mensajes técnicos ("Unexpected token '<'") o un "No se pudo cargar" aunque el cobro sí se guardó | Un helper común de peticiones | — | Alta |

---

## 5. Supabase (además de lo de la PR #95)

- **DB-15 · FUNCIONAMIENTO CORRECTO VERIFICADO:** `amount > 0`, `total >= 0`, bloqueo `FOR UPDATE` en los triggers de dinero e idempotencia única por `(tenant, pedido, clave)`.
- **DB-16 · FUNCIONAMIENTO CORRECTO VERIFICADO:** todas las funciones `SECURITY DEFINER` tienen `search_path` fijado y no tienen `EXECUTE` para `PUBLIC`. Comprobado por análisis automático; no se ha leído el cuerpo de cada una.
- **DB-17 · P3 · RIESGO POTENCIAL:** exigir `uploaded_by = auth.uid()` impide que un manager adjunte un justificante subido por otra persona. Es una decisión de producto que hay que confirmar.
- **DB-18 · P3 · RIESGO POTENCIAL:** la FK de `quote_items` no tiene un índice exacto, aunque en la práctica la cubre un UNIQUE.

---

## 6. Calidad

| Comprobación | `main` | PR #95 |
|---|---|---|
| `tsc --noEmit` (modo `strict`) | 0 errores | 0 |
| ESLint | 0 errores, 4 avisos | 0 errores, 4 avisos |
| Tests unitarios (`TZ=UTC`) | 1000 tests: 994 OK, 0 fallos, 6 omitidos | **1 fallo** (C-5) |
| `npm audit --omit=dev` | 1 crítica, 2 altas | — |

| ID | Sev | Tipo | Dónde | Defecto | Corrección | Conf. |
|---|---|---|---|---|---|---|
| **QA-10** | P1 | BUG CONFIRMADO | `package.json` | `next 16.3.4`, dentro del rango con vulnerabilidad crítica (16.0.0-16.3.7). También `sharp` y `source-map-js` con nivel alto. Ya figuraba como N9 el 06-10 | Subir a ≥16.3.8 y añadir `npm audit` al CI | Alta |
| **QA-1** | P1 | RIESGO POTENCIAL | `.github/workflows/*.yml` | No hay CI sobre `main` ni uno común: los 3 workflows dependen de rutas concretas. Equipo, clientes, ajustes, autenticación o presupuestos no lanzan **ningún** job. No hay scripts `test` ni `typecheck` | `ci.yml` sin filtro de rutas (tests, `tsc`, lint, build) y protección de rama | Alta |
| **QA-2** | P1 | RIESGO POTENCIAL | `supabase/tests/*` | 18 suites SQL no se ejecutan nunca: `phase13-16` (ciclo de vida, archivado, concurrencia), `phase2a`, `phase7-11` (roles e invitaciones), `phase35`, `phase44`… | Job de base de datos que ejecute todas las suites | Alta |
| QA-4 | P2 | RIESGO POTENCIAL | `pedido-v2.yml:59` | Un cambio en el código de cobros no ejecuta `phase45`; la PR #95 dispara `phase46` pero no la ejecuta | Añadirlas al bucle de suites | Alta |
| QA-6 | P2 | BUG CONFIRMADO | 19 archivos `route.ts`, incluidos `payments`, `void`, `total` y 12 de presupuestos | Responden 500 sin `console.error`; no hay Sentry, `instrumentation.ts`, `error.tsx` ni identificador de petición | `logRouteError` con tenant, usuario y request-id, y Sentry | Alta |
| QA-13 | P2 | BUG CONFIRMADO | `lib/orders/list-search.postgrest-harness.test.ts:17-23` | Los 6 tests de búsqueda con aislamiento entre tenants se omiten siempre | Job con PostgREST y `REQUIRE_POSTGREST=1` | Alta |
| QA-8 | P2 | RIESGO POTENCIAL | `next.config.ts:9-46` | Sin CSP, HSTS, `X-Frame-Options` ni `nosniff` global (riesgo de clickjacking en anular cobro o transferir la propiedad) | Cabeceras globales; CSP primero en modo de solo informe | Alta |
| QA-9 | P2 | RIESGO POTENCIAL | — | Solo hay límite de peticiones en Kiosk y en el reenvío de invitaciones. Signup, onboarding o checkout, presign y PDF no tienen | Tabla de límites genérica o WAF | Media |
| QA-15 | P3 | RIESGO POTENCIAL | `app/api/orders/route.ts:391-530` | Calendario y vista de activos cargan todo en bloques de 500 con `count: exact` | Tope y conteo solo en el primer bloque | Media |
| QA-12 | P3 | BUG CONFIRMADO (test) | `lib/kiosk/form-state.test.ts:57-79` | Falla con `TZ=Europe/Madrid` | Matriz de CI con varias zonas horarias | Alta |
| QA-16 | P3 | RIESGO POTENCIAL | `lib/supabase/proxy.ts:61`; `tsconfig` | El proxy no comprueba la sesión si faltan variables de entorno; los scripts quedan fuera de `tsc` y del lint | Fallar en modo cerrado en producción | Media |
| QA-7 / QA-11 | — | FUNCIONAMIENTO CORRECTO VERIFICADO | — | Los 500 no devuelven mensajes internos al cliente. No hay secretos en el repo | — | Alta |

---

## 7. Matriz de riesgos ordenada por impacto en SUR4

| # | ID | Sev | Prob. | Impacto en SUR4 | Estado |
|---|---|---|---|---|---|
| 1 | C-1 | P0 | Alta si se aplica la migración tal cual | No puede cobrar | No aplicada: **no aplicar** |
| 2 | C-2 | P0 | Ya ocurrió | Preview escribe en datos reales | Abierto |
| 3 | B-1 | P1 | Diaria | 409 al cambiar el total | PR #93 |
| 4 | FN-2 | P1 | Diaria | Falso "sin permiso" y pérdida del borrador | PR #94 |
| 5 | FN-1 | P1 | Semanal | Caja que no se puede corregir | Sin PR |
| 6 | A-1 | P2 | Ocasional | Ficha bloqueada con un mensaje equivocado | Sin PR |
| 7 | FN-4 | P2 | Ocasional | Ticket que dice "Pendiente" estando cobrado | Sin PR |
| 8 | QA-10 | P1 | — | Vulnerabilidad crítica en Next | Sin PR |
| 9 | MT-1 / MT-2 | P1 | Baja | Pérdida del PDF oficial / toma de cuentas | Sin PR |
| 10 | C-3 / C-4 / C-5 / C-6 / C-7 | P1-P2 | Al desplegar la #95 | 500 o pérdida de justificantes | En la #95 |
| 11 | FN-3, FN-5, D-1/D-2 | P2-P3 | Ocasional | Duplicados, datos de cliente pisados, impresión | Sin PR |

## 8. Dependencias entre PR

- **#92:** mergeada. Su contenido también está dentro de la #95 (el commit `5631139` es el mismo cambio que `9c991fc`, sin diferencias).
- **#93:** solo toca la UI y no depende de la base de datos. Se puede mergear sola, idealmente con B-2 corregido. La #95 la incluye.
- **#94:** solo autenticación y contexto, sin base de datos. Es independiente; revisarla porque reescribe `getCurrentContext` (la semántica de fallar cerrado se mantiene).
- **#95:** incluye #92 y #93, y duplica la migración `20261013092854` de la #91 (C-7). Depende de:
  - test arreglado (C-5);
  - PR previo de orden de borrado en archivos (C-4);
  - migración dividida en dos fases (C-1);
  - entorno Preview aislado (C-2).
- **#91:** no revisada; solo se sabe que contiene la misma migración de validación del total. Debe mergearse antes que la #95 o quitarse de ella.

## 9. Plan de corrección

**Fase 0, hoy y sin código:**
- No aplicar ninguna migración de la #95 en Supabase.
- No usar Preview con usuarios de SUR4.
- Quitar `service_role` y las variables de R2 del entorno Preview y activar Deployment Protection.
- Indicar a SUR4 que no archive pedidos con saldo pendiente (FN-1).
- Pedir los datos de impresión de D-2.

**Fase 1, 24-48 h, sin base de datos (cada paso con rollback instantáneo en Vercel):**
1. Mergear la #93 con B-2 corregido.
2. Subir Next a ≥16.3.8 (QA-10), con build y prueba de humo.
3. Hotfix de A-1 y D-1 (CSS de impresión), cada uno con su test.
4. Mergear la #94 tras revisarla.

**Fase 2, PR #95 en dos fases (3-5 días):**
1. PR a `main`: orden de borrado en archivos (primero base de datos, después R2) y traducción de `payment_receipt_protected` (C-4).
2. Mergear la #91 y rebasar la #95 encima. Arreglar C-5 y C-3.
3. Dividir la migración en A (ampliar, compatible con `main`) y B (retirar lo antiguo). Añadir `lock_timeout`, `notify pgrst` y una migración de emergencia preparada (C-6).
4. Probar en Supabase de staging o branching: `phase45` con la migración A y el código de `main`; `phase46` con la A, la B y la #95.
5. Aplicar la migración A fuera del horario de SUR4. Comprobar que `main` sigue cobrando y gestionando archivos.
6. Desplegar la #95 con Skew Protection activa y probar en DEMO los 8 pasos del documento del PR.
7. Aplicar la migración B horas después, tras comprobar que no hay pagos nuevos con `payment_method` NULL.
8. **Recuperación:** si falla la migración A, la transacción se revierte entera. Si falla después, se aplica la migración de emergencia; las columnas no se borran nunca.

**Fase 3, 1-2 semanas, seguridad y datos:** MT-1, MT-2, FN-1 (desarchivar y aviso), FN-3 (idempotencia en el alta), DB-14, MT-3, FN-5 y FN-4.

**Fase 4, continuo:** CI común con protección de rama (QA-1, QA-2, QA-4, QA-13), observabilidad (QA-6), cabeceras y límite de peticiones (QA-8, QA-9), matriz de zonas horarias (QA-12, A-2), MT-4, MT-5 y P3 restantes.

**Pruebas de regresión obligatorias antes de cerrar cada fase:**
- Selector de fecha: deseleccionar, hora inexistente y fecha incompleta.
- Total después de cambiar el estado.
- Pago con la versión de 4 argumentos y la migración A.
- Pago con la versión de 7 argumentos, justificante y reintento.
- Borrado de un justificante protegido.
- Archivar con saldo pendiente.
- Alta de pedido repetida.
- PDF de impresión de referencia.
