# Tamaño y color en texto enriquecido (V1)

Mejora del core reutilizable de Gestcopy, solicitada por SUR4 (Tamara) el
21/10/2026: cambiar el tamaño y el color de fragmentos de las instrucciones
y de las notas internas de los pedidos para destacar información durante la
producción.

Rama `feat/orders-rich-text-styles`, base `main` `9168c89`. Sin migraciones.

## Qué ve el usuario

En la barra del editor de texto, junto a negrita, cursiva, subrayado y
tachado, dos menús nuevos:

| Menú | Opciones |
| --- | --- |
| **Tamaño del texto** (icono «Aa») | Pequeño · Normal · Grande · Muy grande |
| **Color del texto** (icono «A» subrayada con el color actual) | Predeterminado · Rojo · Naranja · Verde · Azul · Morado |

- «Normal» y «Predeterminado» devuelven el fragmento al formato por defecto.
  «Quitar formato» quita también tamaño y color.
- Sin selección, la opción se aplica a lo que se escribe a continuación.
- Cada botón anuncia el valor actual («Color del texto: Rojo»). Los menús se
  usan con teclado (Intro, flechas, Escape); tras elegir, el foco vuelve al
  texto; con Escape, al botón.

Dónde está activo (pedidos):

| Superficie | Campo |
| --- | --- |
| Pedido completo (`/orders?create=1`) | Instrucciones y Notas internas |
| Pedido rápido (`/orders/quick`) | Descripción y Notas internas |
| Ficha del pedido, edición | Instrucciones y Notas internas |
| Ficha del pedido, «+ Añadir nota» | Nota (se añade a las notas internas) |
| Ficha del pedido, consulta | Instrucciones y Notas internas |
| Versión imprimible (`/orders/[id]/print`) | Instrucciones y Notas internas |

Fuera de alcance, sin cambios: presupuestos (formulario, PDF comercial e
impresión), editor del pie de página, clientes, servicios y kiosco público.
Las listas, el mostrador, las tarjetas y el registro de actividad usan texto
plano, como antes.

## Diseño

### Tokens, no CSS

Un fragmento con estilo se guarda como `<span>` con atributos de un
vocabulario cerrado (`lib/rich-text/text-styles.ts`):

```html
<p><span data-text-size="xlarge"><span data-text-color="red">NO CORTAR</span></span> sangrado 3 mm</p>
```

- Tamaños: `small` (0,875 em), `large` (1,25 em), `xlarge` (1,5 em). Relativos
  al texto que los rodea, así que escalan en cada superficie.
- Colores: `red`, `orange`, `green`, `blue`, `purple`. Cada superficie los
  traduce a su color: claro y oscuro en `app/globals.css`
  (`--gc-text-*`), papel en `components/print/print.css`.
- Ni `style`, ni clases, ni colores libres: no hay CSS que inyectar y el
  modo oscuro puede usar tonos distintos para el mismo token.

### Saneado con perfil opcional

`lib/rich-text/html.ts` acepta `RichTextOptions`:

```ts
sanitizeRichText(html, { textStyles: true });
normalizeRichText(html, { textStyles: true });
persistRichText(html, { textStyles: true });
appendRichText(existing, addition, { textStyles: true });
```

- Con `textStyles`, además del vocabulario básico se admite `<span>` con
  `data-text-size` y `data-text-color` de valores exactos (sin mayúsculas,
  espacios ni unidades). Un `<span>` sin token válido se desenvuelve y el
  texto se conserva. Estilos en línea, clases, eventos, `data-*` ajenos y
  colores de Word/Office pegados se descartan.
- Sin la opción (por defecto) el saneado es exactamente el de antes y además
  elimina los tokens: un valor con estilos leído por un campo que no los usa
  pierde solo el formato.
- Para cualquier valor sin tokens, la salida es idéntica con y sin la opción
  (prueba de equivalencia en `lib/rich-text/html.test.ts`, corpus fijo y 400
  casos generados). Por eso los pedidos existentes se ven igual.

### Editor

`components/rich-text/rich-text-editor.tsx` recibe `textStyles` (fijo al
montar). Activa dos marcas Tiptap independientes
(`components/rich-text/text-style-marks.ts`), `textSize` y `textColor`, cada
una con un único atributo que solo se interpreta si el valor es válido. El
pegado pasa por el mismo saneado: entre campos de pedido se conservan los
tokens; en un editor básico se quitan. `RichTextContent` y `PrintRichText`
reciben la misma opción para pintar.

### Pedidos

`lib/orders/rich-text.ts` define `ORDER_RICH_TEXT = { textStyles: true }`, la
única opción que usan:

- `POST /api/orders` (`description`, `notes`) y
  `PATCH /api/orders/[id]/content` (`description`, `notes`): el servidor
  decide qué llega a la base de datos, envíe lo que envíe el navegador.
- `buildCreateOrderPayload` (pedido rápido y completo) y `appendOrderNote`
  («Añadir nota» conserva el formato de las notas anteriores).

Sin cambios en permisos, tenant, RPC (`change_order_content_v2`), RLS ni
esquema. Los roles que podían editar instrucciones y notas son los mismos.

### Reutilizar en otro campo

1. Pasar `textStyles` al `RichTextEditor` y al `RichTextContent` del campo.
2. Guardar con `persistRichText(value, { textStyles: true })` en el servidor.
3. Añadir el fichero a la lista permitida de
   `lib/rich-text/text-styles.test.ts` (la prueba falla si un campo activa
   los estilos sin pasar por ella).
4. Si el campo se imprime o se exporta, decidir allí cómo se ven los tokens.

## Accesibilidad y modo oscuro

- Contraste ≥ 4,5:1 (WCAG AA) de cada color sobre `background`, `card`,
  `popover`, `accent` y `muted`, en claro y oscuro, y sobre blanco en la
  impresión. La prueba lee los valores reales de los CSS.
- El color nunca es la única pista en la interfaz del editor: cada opción
  lleva su nombre.
- Menús Radix (`menuitemradio` con `aria-checked`), objetivos táctiles de
  40 px y contenido en portal, sin recortes dentro de diálogos ni de la barra
  desplazable en móvil.
- La impresión fija la paleta clara aunque la app esté en modo oscuro.

## Datos históricos

- Sin migraciones ni reescrituras: se reutilizan `orders.description` y
  `orders.notes`.
- Consulta de solo lectura, 21/10/2026 18:21 UTC, solo agregados:
  - Production: 340 pedidos (330 con instrucciones, 52 con notas); 0 con
    `<span>` o tokens.
  - Staging: 61 pedidos; 0 con `<span>` o tokens. Huella de contenido
    `8823086f0b2e5194ab1a54d22b96a288` antes del despliegue.
- Con 0 tokens almacenados y la prueba de equivalencia, todo pedido existente
  se pinta igual que antes.
- Marcha atrás: revertir el código basta. El código anterior lee un valor con
  tokens como texto sin formato (descarta el `<span>`), sin perder texto.

## Pruebas

| Prueba | Qué comprueba |
| --- | --- |
| `lib/rich-text/html.test.ts` | Tokens válidos, orden canónico, valores inválidos, CSS/clases/eventos, pegado de Office, scripts e imágenes dentro de un span, ciclo guardar → recargar → editar, campos sin la opción, texto plano y vacíos, equivalencia histórica |
| `lib/rich-text/text-styles.test.ts` | Vocabulario, reglas CSS y contraste en claro, oscuro e impresión; solo los campos de pedido activan la opción; el pie de presupuestos y el kiosco ignoran los tokens |
| `lib/orders/rich-text-routes.test.ts` | Rutas reales: POST y PATCH guardan HTML saneado bajo el tenant de la sesión; sin sesión o con rol de lectura no escriben |
| `lib/orders/notes.test.ts`, `lib/orders/create-form.test.ts` | «Añadir nota» y el payload de creación conservan los estilos saneados |
| `components/rich-text/rich-text-editor.test.ts` | Render con y sin la opción; impresión de pedido frente a presupuesto; controles en la barra |
| `scripts/order-rich-text-ui-smoke.mjs` (workflow Pedido V2) | Navegador real a 1280 y 390 px: ratón y teclado, guardar, recargar, editar, «Quitar formato», pegado, editor bloqueado, modo oscuro, impresión |
| `e2e/staging/order-rich-text.ts` | Staging real (tenant `e2e`), ver más abajo |

## Validación en Staging

`e2e/staging/order-rich-text.ts`, mismo interlock que el resto de E2E
(host `e2e.preview.app.gestcopy.com`, Supabase y R2 de Staging, sin tráfico a
Production, artefactos redactados):

```bash
set -a; source .env.e2e.local; set +a
PLAYWRIGHT_MODULE=/tmp/e2e-browser/node_modules/playwright/index.mjs npx tsx e2e/staging/order-rich-text.ts
```

1. Todos los pedidos de `e2e` con instrucciones o notas se pintan igual que
   con el código anterior.
2. Pedido completo y pedido rápido con estilos elegidos en la barra.
3. Ficha (claro y oscuro), edición tras recargar, «Añadir nota», impresión
   (también con la app en oscuro) y 390 px.
4. HTML manipulado enviado con la sesión: el servidor lo sanea. Lectura y
   escritura sobre `DEMO-0001` (tenant `demo`) denegadas. Un presupuesto con
   tokens se guarda sin ellos.

Resultado de la ejecución: ver la sección «Ejecución en Staging» al final.
