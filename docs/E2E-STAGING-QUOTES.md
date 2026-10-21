# Staging: presupuestos solicitados por SUR4/Tamara

Verificación real: 16/10/2026. Solo Staging y tenant sintético `e2e`.

## Estado e integración ejecutada

| Referencia | SHA | Resultado |
| --- | --- | --- |
| `main` validado | `65afb1073b5b5d55b992129055a2e5d3a1c457df` | Release Gate `38967160825`: App y Database en verde |
| Staging anterior | `484eff6e9693732c101533bb6f188b3bc16d205a` | Ya incluía multilínea, footer, conversión y herencia de notas. Faltaba duplicación |
| Staging desplegado | `7be5ef503c7d1e0abd66539685d742b49d5e7fa5` | Merge con árbol idéntico a `main`; Vercel `dpl_Cv8sAh2X3b3MfMX3tdGyD6zuDepM`, READY, target Preview |
| Preview SUR4/Kiosk | `fb360ed7a1b4c44c2e9cf772fe88bc5d3d79525a` | Preview antigua de `feat/kiosk-demo-ui-v1`; no contiene estas mejoras |
| Production al inicio y al cierre | `65afb1073b5b5d55b992129055a2e5d3a1c457df` | Deployment `dpl_J3ryLkcUJxWG9biFJdZoYUb84yGu`, sin cambios por este trabajo |

`demo.preview.app.gestcopy.com`, `audit.preview.app.gestcopy.com` y
`e2e.preview.app.gestcopy.com` comparten el deployment de Staging del mismo
proyecto Vercel `copyflow`. No se ha cambiado el alias `sur4.preview` ni se han
creado proyectos o infraestructura por tenant.

El entorno Vercel Preview tiene verificados Supabase Staging, bucket
`gestcopy-files-staging` y el dominio de tenants `preview.app.gestcopy.com`.
Las 77 migraciones de Staging coinciden con las de `main`; incluida
`20261016110000_quote_conversion_notes_v1.sql`. No fue necesaria ninguna
migración remota. RLS está activo en presupuestos, versiones, partidas,
pedidos y memberships. Las funciones mantienen `search_path` fijado.

PR de origen: multilínea #56, conversión #59, footer enriquecido #64,
recuento de líneas visibles del footer #106, herencia de notas #108 y
duplicación #125. Todas integradas en `main` antes de esta sesión.
La duplicación no añade dependencias ni migraciones. Las PR abiertas de
importaciones #123/#124/#126 y de líneas estructuradas de pedido #128 no
son requisitos de este recorrido y no se integraron.

## Evidencias funcionales

Ejecución final de presupuestos `20261016T214441Z-21d1`: **PASS**.
Presupuesto `E2E-P0005` → pedido `E2E-0029`.

- Alta de cliente y presupuesto desde la interfaz, con tres partidas y
  descripciones de varias líneas.
- Duplicación con contenido conservado e identidad nueva; cambiar la copia
  no cambia la original. Guardado y persistencia tras recargar.
- Totales calculados en servidor: base 55,00 €, IVA 11,00 €, total 66,00 €;
  IVA del 21 % y 10 % en el mismo presupuesto.
- Footer con cuatro líneas visibles, formato y saltos de línea HTML:
  guardado aceptado y contenido presente en el PDF real. Se restaura el
  footer previo de `e2e` al terminar, también en caso de fallo.
- Preparación bloquea el editor y elimina las acciones de duplicación.
- PDF comercial generado en R2 Staging; descarga y SHA-256 registrado;
  regeneración idempotente. Contiene partidas, condiciones y footer;
  excluye el marcador de las notas internas.
- Acceso anónimo al PDF: 401. Acceso desde E2E al presupuesto y PDF DEMO:
  404, sin exponer el documento ajeno.
- Marcar enviado y aceptado desde la interfaz, sin enviar correo.
- Conversión a un único pedido con total 66,00 € y notas públicas/internas
  trasladadas a `orders.notes`, con caracteres HTML escapados.
- Las notas internas no aparecen en `title`, `description`, PDF comercial
  ni hoja de impresión del presupuesto. Persisten en el pedido al recargar.
- Repetir la conversión devuelve el mismo pedido.
- La hoja A4 del pedido muestra las notas bajo «Notas internas»: es una
  hoja de trabajo interna, no el PDF comercial que se entrega al cliente.
- Cero peticiones a Production. Se bloquea el script de feedback de la
  barra de Vercel; no se relaja la lista de destinos permitidos.

El pedido V1 conserva descripción, importe y enlace al presupuesto origen.
Sus partidas siguen consultándose en el presupuesto/PDF; este trabajo no
añade las líneas estructuradas de pedido que desarrolla la PR #128.

La ejecución adicional del E2E existente
`20261016T213947Z-5509` pasa pedidos, R2 y cobro parcial (3/3). La ejecución
de GitHub `38970605207` falló antes por buscar el cliente recién creado en
la primera página del listado: el tenant acumula clientes y el listado es
paginado. `run.ts` ahora busca por el nombre único antes de comprobarlo.
La aplicación no necesitó cambios para superar ese recorrido.

## Cobertura repetible y gating

`e2e/staging/quotes.ts` reutiliza el guard, la sesión sintética y el harness
existentes. Solo admite `e2e` en Staging y conserva la redacción de secretos.
No usa service role para navegar ni crea respuestas falsas de API.

El workflow manual `e2e-staging.yml` añade este recorrido y Poppler para
extraer el texto del PDF. Conserva `environment: staging`, token de lectura,
los dos secretos existentes y la ejecución exclusivamente manual. No cambia
políticas de ramas, revisores, triggers o permisos.

Requisitos: la flag `quotes` debe estar activa para `e2e` (se habilitó con la
RPC de operador existente, exclusivamente en Staging). DEMO sigue ON y AUDIT
sigue OFF. El runner se niega si no hay acceso; no activa flags por sí mismo.

Ejecución desde terminal de confianza con las variables E2E existentes:

```sh
PLAYWRIGHT_MODULE=/tmp/e2e-browser/node_modules/playwright/index.mjs \
  npx tsx e2e/staging/quotes.ts
```

Opcionales: `E2E_ARTIFACTS_DIR`, `E2E_DEPLOYMENT_SHA` (metadato de la versión
verificada por el operador), `PDFTOTEXT_BIN` (ejecutable compatible con
`pdftotext -layout archivo -`). En esta máquina se usó un adaptador local
con pypdf porque el runtime incluye renderizado Poppler pero no `pdftotext`;
CI instala `poppler-utils`.

### Pie de presupuestos (#144)

`e2e/staging/quote-footer.ts` comprueba que el PDF imprime el pie tal como lo
configura el tenant. Mismo guard, harness y variables; solo `e2e`. Recorre
pies de 1, 2, 3 y 4 líneas, líneas largas, pie vacío y un presupuesto de
varias páginas. Lee el PDF descargado de R2 Staging con
`lib/quotes/pdf/pdf-inspect.ts`, sin Poppler. Restaura el pie de `e2e` al
terminar, también si falla. No se ejecuta en el workflow manual.

```sh
PLAYWRIGHT_MODULE=/tmp/e2e-browser/node_modules/playwright/index.mjs \
  npx tsx e2e/staging/quote-footer.ts
```

Antes de cambiar nada guarda en los artefactos el pie original de `e2e` y su
hash, y al restaurarlo comprueba que el hash coincide.

Para validar el pie tal como lo guardó un tenant, `E2E_FOOTER_FILE` apunta a
un fichero local fuera de git con el HTML guardado. Se ejecuta solo ese caso;
las líneas esperadas salen del propio parser del servidor y el informe guarda
hashes de esas líneas, no su texto.

Ejecuciones: `20261021T142649Z-5a0a` contra `aceaefb` (7/7);
`20261021T162059Z-6f6a` (7/7) y `20261021T162207Z-af91` (pie de SUR4) contra
`ac5e372`. Detalle en [QUOTE-PDF-FOOTER-HOTFIX.md](QUOTE-PDF-FOOTER-HOTFIX.md).

### Aislamiento entre tenants (obligatorio)

Las dos negativas entre tenants se ejecutan siempre. Una ejecución solo
puede quedar como `passed` si ambas han corrido; si falta alguna, se marca
como `failed`. Esto lo garantiza `assertForeignControlsRan`, en
`e2e/staging/foreign-fixtures.ts`.

**Fixture por defecto:** el presupuesto sintético `DEMO-P0001` del tenant
`demo` de Staging (cliente «Cliente Prueba Staging 001», email `@example`).
Está fijado en `STAGING_FOREIGN_QUOTE`, con el presupuesto
`5233bc9f-b4c2-4409-868a-324dab41bed3` y la versión
`b606a8fe-f951-4690-9859-0978778d9928`. Su existencia se verificó por SQL de
solo lectura el 17/10/2026. Un 404 sobre un ID inexistente no demostraría
nada; por eso el fixture está fijado y verificado, en lugar de ser opcional.

**Qué se exige:**

- `GET /api/quotes/:id` del presupuesto ajeno: 404;
- `GET /api/quotes/:id/versions/:versionId/pdf`: 404;
- en ambos casos, sin la referencia ni el ID de la versión en el cuerpo.

Solo se consultan esos IDs a través del host E2E; no se abre una sesión del
otro tenant. El informe JSON registra `foreignFixture` (tenant, referencia y
origen).

**Cambiar el fixture:** hay que dar las cuatro variables a la vez:
`E2E_FOREIGN_QUOTE_ID`, `E2E_FOREIGN_VERSION_ID`,
`E2E_FOREIGN_QUOTE_REFERENCE` y `E2E_FOREIGN_TENANT_SLUG`, que no puede ser
`e2e`. Un override parcial o mal formado hace fallar la ejecución antes de
crear datos.

**Si se reinicia la base de Staging**, hay que volver a verificar el fixture
y actualizar `STAGING_FOREIGN_QUOTE`:

```sql
select t.slug, q.reference, v.id as version_id
from public.quotes q
join public.tenants t on t.id = q.tenant_id
join public.quote_versions v on v.quote_id = q.id
where q.id = '5233bc9f-b4c2-4409-868a-324dab41bed3';
```

Artefactos por ejecución: informe JSON, pasos, red redactada, bloqueos,
capturas, PDF sintético y texto extraído. Sin trazas, cookies o URLs firmadas
en los artefactos. Las ejecuciones no borran datos: los intentos fallidos
dejan únicamente fixtures sintéticos en `e2e`.

## Pendiente

La cobertura y el arreglo del test quedan en una PR separada. Integrarla en
`main` provocaría un deployment automático de Production, por lo que este
trabajo no la integra. La política actual del entorno GitHub `staging` solo
permite `main`: no se elude ni se amplía para ejecutar la rama de la PR.
El resultado E2E completo descrito arriba se ejecutó desde terminal de
confianza contra el deployment real de Staging, con los mismos cerrojos.

No quedan bloqueantes funcionales en los cinco flujos verificados. La
ejecución periódica tras cada deployment y su uso como condición de
promoción siguen pendientes; el workflow continúa siendo manual.
