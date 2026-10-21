# Hotfix — Pie configurable en el PDF de presupuestos

PR #144 (`fix/quote-footer-render`). Base: `origin/main` `50e2c20`.
Fecha: 21 de octubre de 2026. Validado en Staging; Production sin cambios.

## Incidencia

- El PDF alteraba la distribución del pie configurado por el tenant: las
  líneas salían partidas por sitios que el tenant no había elegido.
- Debajo del pie aparecía una línea `SUR4-P0029 · EUR` que no forma parte
  de la configuración.

## Auditoría: guardado, lectura y render

- **Guardado.** Ajustes → Identidad guarda `branding.quote_footer` como HTML
  saneado (`<p>`, `<br>`, negrita, cursiva, subrayado, tachado, listas y
  enlaces seguros) o como texto heredado con `\n`. `parseQuoteFooter` admite
  4 líneas visibles y 400 caracteres (#100). Sin cambios.
- **Lectura.** Al preparar un presupuesto, la versión congela
  `seller_snapshot.branding`. `quoteDocumentModel` lee el pie de esa
  instantánea; cambiar Ajustes después no altera presupuestos preparados.
- **Líneas.** `richTextLines` convierte el HTML en líneas: cada párrafo o
  `<br>` es una línea, la línea en blanco entre textos se conserva y las del
  principio y el final se descartan. El HTML guardado conserva los espacios
  repetidos que escribe el tenant (p. ej. `Ciudad   -   Tel.:  900…`).
- **Documento.** El PDF se genera una sola vez y se guarda en R2; los
  reintentos devuelven ese objeto (`generateQuotePdf`, `replayed`).

Guardado y lectura eran correctos. El fallo estaba en el render.

## Causa raíz (`lib/quotes/pdf/render.tsx`)

1. **Corte fijo a 60 caracteres.** `wrapFooterLine` partía cualquier línea de
   más de 60 caracteres, aproximadamente la mitad del ancho útil (515 pt a
   8 pt). Una línea que cabía entera salía en dos, cortada donde caían los
   60 caracteres: un pie de 2 líneas se imprimía en 4.
2. **Línea `referencia · moneda`.** El render pintaba en todas las páginas
   `{reference}{revision} · {currency}` justo debajo del pie, con el mismo
   gris y tamaño, y parecía parte de él.
3. **Espacios colapsados.** `richTextLines` reduce cualquier secuencia de
   espacios a uno. Un pie que separa los campos con varios espacios perdía
   esa separación en el PDF.

Confirmado con el pie real de SUR4 (ver «Validación con el pie de SUR4»): con
el código de `main`, sus 2 líneas salen en 4, una de ellas cortada en mitad
de un teléfono, sin la separación entre campos y con `SUR4-P0029 · EUR`.

## Corrección

- `lib/quotes/pdf/footer.ts`: cada línea configurada se imprime tal cual y en
  su orden. Solo se parte si no cabe en el ancho real, por un espacio; una
  palabra más ancha que la línea (una URL) se parte sin recortarse. Las
  marcas y enlaces se conservan a ambos lados del corte.
- Las líneas se miden con las mismas fuentes Noto Sans con las que dibuja
  react-pdf (`Font.getFont` de su almacén, sin dependencias nuevas), con 4 pt
  de margen para el kerning entre tramos. La página reserva exactamente la
  altura de las líneas impresas.
- Se elimina la línea `referencia · moneda`. La referencia sigue en la
  cabecera de cada página y la numeración `n / N` no cambia.
- El pie conserva los espacios escritos dentro de cada línea
  (`richTextLines(…, { preserveSpaces: true })`). Saltos y tabuladores del
  código HTML cuentan como un espacio. Los contadores y límites de Ajustes
  siguen colapsando espacios, así que ningún pie guardado pasa a ser inválido.
- El render no fija textos, direcciones ni número de líneas. Solo parte una
  línea cuando no cabe en el ancho físico de la página.

## Pruebas

`lib/quotes/pdf/footer.test.ts` comprueba el PDF real con
`lib/quotes/pdf/pdf-inspect.ts` (solo pruebas), que lee el texto dibujado, su
posición y su borde derecho, y decodifica ligaduras como «fi».

- Pies de 1, 2, 3 y 4 líneas: párrafos, `<br>`, texto heredado con `\n`,
  línea en blanco, negrita, cursiva y enlace. Mismo texto, mismo orden y el
  mismo interlineado.
- Línea de 94 caracteres que cabe: una sola línea (antes, dos).
- Líneas largas y URL sin espacios: se parten dentro del margen, sin perder
  ni añadir caracteres; react-pdf dibuja exactamente las líneas medidas.
- Pie vacío (`""`, párrafos vacíos, espacios): nada en la zona del pie salvo
  la numeración.
- 6 líneas en el render: sin límite fijo.
- Más de dos páginas: sin `referencia · moneda`, referencia en la cabecera,
  `n / N` y el mismo pie en cada página.
- PDF idéntico byte a byte entre reintentos.
- Varios tenants a la vez: cuatro pies distintos (dos líneas, una línea
  larga, vacío, formato con línea en blanco) generados en paralelo dan los
  mismos bytes que por separado, y cada PDF lleva solo su pie.
- Pie congelado: cambiar Ajustes después de preparar no altera el pie del
  presupuesto (prueba existente en `pdf.test.ts`).
- Espacios: un pie con campos separados por 2 y 3 espacios se imprime con esa
  separación; `richTextLines` solo los conserva con `preserveSpaces` y los
  contadores de Ajustes cuentan igual que antes (`lines.test.ts`).
- Unidad de `wrapFooterLine`: corte por espacio, palabra larga, marcas a
  ambos lados del corte, línea en blanco y pares sustitutos.

Validación local: `tsc --noEmit`, `eslint`, `TZ=UTC npx tsx --test`
(1338/1338) y `next build`.

## CI: fallo intermitente de Kiosk (#145)

`kiosk-database` falló una vez en esta PR (run `39615315427`, commit
`14951ac`, que solo tocaba pruebas TypeScript del PDF) con «direct write
succeeded on a fresh session» en `phase51_order_lines_concurrency.sh`. El
mismo job pasó antes, en el re-run y en el commit siguiente.

La causa está diagnosticada en `bf81f6f` (#136, aún no en `main`): si la
carrera la gana el job 1, `set items_total=1` no cambia nada y el guard no
salta. No está relacionado con este hotfix y **no se da por resuelto** por
pasar el re-run. Seguimiento en #145.

## Validación en Staging

`gestcopy-staging` avanzó por fast-forward `392eebc..aceaefb` (merge de la
rama, sin force push). Vercel `dpl_AXujTrEggJo4fCrkLrKkkBggCq7j`, READY,
target Preview, alias `e2e`, `demo` y `audit` de `preview.app.gestcopy.com`.

`e2e/staging/quote-footer.ts`, ejecución `20261021T142649Z-5a0a`, tenant
sintético `e2e`: **7/7**. Cada caso guarda el pie en Ajustes, prepara un
presupuesto, genera el PDF en R2 Staging, lo descarga y lee lo que dibuja.

| Caso | Presupuesto | Páginas | Pie impreso |
| --- | --- | --- | --- |
| 1 línea (87 caracteres) | E2E-P0020 | 1 | 1 línea, igual a la configurada |
| 2 líneas (94 y 71 caracteres) | E2E-P0021 | 1 | 2 líneas (antes salían 4) |
| 3 líneas con `<br>` | E2E-P0022 | 1 | 3 líneas |
| 4 líneas con formato y línea en blanco | E2E-P0023 | 1 | 4 líneas, línea en blanco conservada |
| Líneas largas y URL sin espacios | E2E-P0024 | 1 | Partidas al ancho real, sin perder caracteres |
| Vacío | E2E-P0025 | 1 | Nada; solo `1 / 1` |
| 2 líneas con 40 partidas | E2E-P0026 | 4 | El mismo pie en las 4 páginas |

Todos sin `referencia · EUR`, con la referencia en la cabecera de cada página
y numeración `n / N`. Revisados también visualmente. El pie de `e2e` estaba
vacío y se dejó vacío (comprobado por hash). Sin tráfico a Production.

Tras conservar los espacios (`6de90b8`), `gestcopy-staging` avanzó por
fast-forward `aceaefb..ac5e372` (Vercel `dpl_4X4UNKtVU2ZpovBQxkL3uiEZeG3S`,
READY, mismos alias). Los 7 casos se repitieron sobre ese deployment: 7/7
(`20261021T162059Z-6f6a`, E2E-P0027…E2E-P0033), con el mismo resultado.

## Validación con el pie de SUR4

- **Lectura.** Una única consulta de solo lectura en Production, autorizada
  por el owner el 21/10/2026 y limitada al tenant SUR4: el pie guardado en
  `tenant_settings.branding` y el congelado en `seller_snapshot` de
  SUR4-P0029 (versión 1, enviada). Coinciden. Sin escrituras. El contenido
  no se copia al repositorio, a la PR ni a los informes de la ejecución.
- **Estructura.** Dos líneas unidas por un salto de línea (`<br>`), con los
  campos separados por secuencias de 2 y 3 espacios. Cada línea cabe en el
  ancho de la página.
- **Antes (código de `main`).** 4 líneas, una cortada en mitad de un
  teléfono, espacios colapsados y `SUR4-P0029 · EUR` debajo.
- **Después, en Staging.** `E2E_FOOTER_FILE` con el pie guardado, tenant
  `e2e`, ejecución `20261021T162207Z-af91`: E2E-P0034, 1 página, las 2 líneas
  impresas tal como están configuradas, con sus espacios y sin líneas
  añadidas por el ancho; sin `referencia · EUR`. El pie de `e2e` se guardó en
  disco con su hash antes del cambio, se restauró y el hash coincide.
- **Referencia de SUR4.** Con el código del PR y la referencia SUR4-P0029
  (render local), la referencia sigue en la cabecera y desaparece la línea
  inferior.

La evidencia visual con los datos reales queda fuera de git, en
`e2e-artifacts/pie-presupuestos-20261021/sur4/`.

## Despliegue y vuelta atrás

- Sin migraciones, variables de entorno ni dependencias nuevas.
- Integrar en `main` despliega Production automáticamente: solo con
  autorización del owner.
- Afecta solo a los PDF que se generen después del despliegue. Los PDF ya
  guardados en R2 no cambian, tampoco el de `SUR4-P0029`. Para obtener ese
  PDF con el pie corregido haría falta una nueva revisión del presupuesto
  (decisión comercial).
- Caso límite: una generación que quedó a medias justo antes del despliegue
  (reserva `pending` en `quote_files`, válida una hora) fallará al
  reintentar con `document_size_mismatch` o `PDF_OBJECT_MISMATCH`, porque el
  render nuevo no produce los mismos bytes. No enlaza ningún PDF erróneo; se
  resuelve al caducar la reserva y pasar la limpieza de archivos temporales.
  Le ocurre igual a cualquier cambio del render.
- Vuelta atrás: revertir el merge. Los PDF generados mientras tanto
  permanecen tal cual, como cualquier PDF oficial.

## Fuera de alcance

- Límite de 4 líneas y 400 caracteres de Ajustes.
- **Editor de Ajustes y espacios repetidos.** El editor (TipTap) carga el
  contenido guardado con el análisis por defecto de ProseMirror, que colapsa
  los espacios repetidos. El valor guardado no cambia, pero Ajustes lo
  muestra con un solo espacio y, si el tenant vuelve a guardar, la separación
  se pierde. El editor es compartido por otros campos; se tratará aparte.
- Título largo del presupuesto: al ocupar dos líneas se solapan (estilo
  `title`). Ya existía; se tratará aparte.
