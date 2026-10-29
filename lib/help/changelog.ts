/**
 * Public product changelog served at /ayuda/novedades.
 *
 * One release per day with changes merged to main, newest first. Written for
 * shop staff: no tenant names, internal codes, routes or infrastructure
 * details. Add new releases at the top.
 */

export type ChangelogKind = "nuevo" | "mejora" | "correccion" | "seguridad";

export type ChangelogEntry = {
  kind: ChangelogKind;
  area: string;
  text: string;
};

export type ChangelogRelease = {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  title: string;
  entries: ChangelogEntry[];
};

export const CHANGELOG_KINDS: ChangelogKind[] = [
  "nuevo",
  "mejora",
  "correccion",
  "seguridad",
];

export const CHANGELOG_KIND_LABELS: Record<ChangelogKind, string> = {
  nuevo: "Nuevo",
  mejora: "Mejora",
  correccion: "Corrección",
  seguridad: "Seguridad",
};

export const CHANGELOG_KIND_PLURALS: Record<ChangelogKind, string> = {
  nuevo: "Funcionalidades nuevas",
  mejora: "Mejoras",
  correccion: "Correcciones",
  seguridad: "Seguridad y fiabilidad",
};

const nuevo = (area: string, text: string): ChangelogEntry => ({
  kind: "nuevo",
  area,
  text,
});
const mejora = (area: string, text: string): ChangelogEntry => ({
  kind: "mejora",
  area,
  text,
});
const correccion = (area: string, text: string): ChangelogEntry => ({
  kind: "correccion",
  area,
  text,
});
const seguridad = (area: string, text: string): ChangelogEntry => ({
  kind: "seguridad",
  area,
  text,
});

export const CHANGELOG: ChangelogRelease[] = [
  {
    date: "2026-10-29",
    title: "Ficha del pedido, Hoja de trabajo, Resguardo y formato de texto",
    entries: [
      nuevo(
        "Pedidos",
        "Las instrucciones y las notas internas del pedido admiten tamaño de letra, color y alineación de párrafos, y al imprimir se respetan. Los demás textos no cambian."
      ),
      mejora(
        "Pedidos",
        "La ficha del pedido se reorganiza. Arriba quedan el cliente y su contacto, el estado, la prioridad y los avisos, junto a los importes y la fecha de entrega, sin tener que desplazarte. Debajo, en dos columnas: el trabajo, los archivos, las notas y la actividad a un lado, y el resumen, el cobro y la entrega al otro. En el móvil todo va en una sola columna."
      ),
      mejora(
        "Impresión",
        "La Hoja de trabajo ya no imprime las notas internas del pedido. Si el pedido las tiene, al abrir la impresión verás en pantalla el aviso «Este pedido tiene notas internas, que no se imprimen»."
      ),
      nuevo(
        "Impresión",
        "Resguardo en PDF para entregar al cliente, desde la ficha del pedido, junto a «Imprimir pedido». Incluye los datos del cliente, los importes, las fechas y la descripción del trabajo, sin las notas internas."
      ),
    ],
  },
  {
    date: "2026-10-28",
    title: "Búsquedas y estados de pedido",
    entries: [
      correccion(
        "Búsquedas",
        "Las listas de clientes, equipo, servicios y actividad muestran siempre el resultado de lo último que has buscado o filtrado, aunque una respuesta anterior llegue más tarde."
      ),
      correccion(
        "Pedidos",
        "Al cambiar el estado de un pedido ya no aparecen los estados desactivados. Si un pedido tiene un estado que se ha desactivado, se sigue viendo como «(desactivado)» hasta que le pongas otro."
      ),
    ],
  },
  {
    date: "2026-10-27",
    title: "Responsable de pedidos y presupuestos",
    entries: [
      mejora(
        "Pedidos",
        "Para elegir responsable de un pedido o de un presupuesto, también al convertir un presupuesto, solo aparecen las personas activas que pueden recibir pedidos. Quien deja de poder recibirlos conserva los pedidos que ya tenía hasta que los reasignes."
      ),
      seguridad(
        "Pedidos",
        "Cualquier cambio en un pedido pasa siempre por las mismas comprobaciones de permisos, estado y responsable que se aplican desde la ficha. La forma de trabajar no cambia."
      ),
    ],
  },
  {
    date: "2026-10-25",
    title: "Volver a contratar tras cancelar",
    entries: [
      correccion(
        "Facturación",
        "Si cancelas la suscripción, puedes volver a contratar el plan desde Facturación. Antes, en algunos casos, aparecía siempre «Estamos confirmando tu suscripción» y no dejaba continuar."
      ),
    ],
  },
  {
    date: "2026-10-21",
    title: "Pie del PDF de presupuestos y copias de seguridad",
    entries: [
      correccion(
        "Presupuestos",
        "El pie del PDF de presupuestos se imprime tal como lo escribes en Ajustes: cada línea en su sitio, sin cortes a mitad de un dato y respetando los espacios que separan la información. Ya no aparece debajo una línea con la referencia y la moneda; la referencia sigue en la cabecera de cada página."
      ),
      seguridad(
        "Plataforma",
        "Las copias de seguridad incluyen ahora toda la información necesaria para recuperar la plataforma, y se ha completado con éxito un simulacro de recuperación."
      ),
    ],
  },
  {
    date: "2026-10-16",
    title: "Métodos de pago, justificantes, dirección de clientes y partidas duplicadas",
    entries: [
      nuevo(
        "Presupuestos",
        "Botón «Duplicar» en cada partida del borrador de un presupuesto: crea una copia justo debajo, con el mismo concepto, descripción, precio, descuento e IVA, para cotizar la misma referencia con otra cantidad. La copia suma en los totales como cualquier otra partida y no se guarda hasta que pulses «Guardar borrador»."
      ),
      mejora(
        "Plataforma",
        "Gestcopy responde más rápido: la aplicación funciona ahora en Europa, junto a tus datos."
      ),
      seguridad(
        "Plataforma",
        "Cada copistería se abre solo desde su propia dirección. Si Gestcopy no reconoce la dirección desde la que se accede, no muestra ningún dato."
      ),
      seguridad(
        "Cobros",
        "El total de un pedido solo cambia con las acciones previstas para ello, como «Definir total», «Modificar total» o al convertir un presupuesto, que comprueban cada cambio."
      ),
      correccion(
        "Ajustes",
        "El logo de la copistería se muestra con su forma real en la cabecera, sea horizontal o vertical, y al cambiarlo o quitarlo se actualiza al momento, sin recargar la página."
      ),
      mejora(
        "Presupuestos",
        "Al convertir un presupuesto aceptado en pedido, sus condiciones y sus notas internas pasan a las notas internas del pedido, cada bloque con el número del presupuesto. Nada se copia a los campos que ve el cliente, y los pedidos ya convertidos no cambian."
      ),
      nuevo(
        "Clientes",
        "Dirección postal opcional al dar de alta un cliente (también desde un pedido o un presupuesto) y al editarlo desde su ficha, donde se muestra. Los clientes existentes no cambian."
      ),
      nuevo(
        "Cobros",
        "Al registrar una entrega a cuenta eliges el método de pago (efectivo, tarjeta, Bizum, transferencia u otro) y puedes adjuntar un justificante. El justificante queda guardado de forma privada y no se puede borrar, ni siquiera si anulas la entrega."
      ),
      mejora(
        "Cobros",
        "Las entregas registradas antes de este cambio aparecen como «Sin especificar (histórico)»: Gestcopy no deduce el método de los cobros antiguos."
      ),
      mejora(
        "Pedidos",
        "Si la sesión caduca mientras creas un pedido, Gestcopy guarda lo que llevas escrito y lo recupera cuando vuelves a iniciar sesión. Los archivos adjuntos hay que seleccionarlos de nuevo."
      ),
      correccion(
        "Pedidos",
        "Al crear un pedido, un fallo momentáneo al comprobar la sesión ya no aparece como falta de permisos: Gestcopy te pide que vuelvas a intentarlo."
      ),
    ],
  },
  {
    date: "2026-10-15",
    title: "Novedades en la ayuda, pie de presupuestos y pruebas de principio a fin",
    entries: [
      nuevo(
        "Ayuda",
        "Página de Novedades con todos los cambios desde el lanzamiento, filtrable por tipo y enlazada desde el centro de ayuda."
      ),
      mejora(
        "Ayuda",
        "El menú del centro de ayuda agrupa los artículos en secciones plegables y abre automáticamente la del artículo que estás leyendo."
      ),
      correccion(
        "Presupuestos",
        "El pie de presupuestos se guarda con cuatro líneas visibles aunque quede una línea vacía al final o el texto se haya pegado desde otro programa, y el contador indica también las líneas."
      ),
      seguridad(
        "Plataforma",
        "Nueva prueba automatizada del recorrido completo en un entorno de pruebas real: crear cliente y pedido, buscarlo, subir y descargar un archivo y registrar un cobro parcial hasta la entrega."
      ),
    ],
  },
  {
    date: "2026-10-14",
    title: "Archivos más seguros y control de calidad automático",
    entries: [
      correccion(
        "Archivos",
        "Eliminar un archivo ya no puede quedarse a medias: primero se registra la baja y después se borra del almacenamiento. Si algo falla, Gestcopy lo reintenta solo."
      ),
      correccion(
        "Archivos",
        "Subidas más fiables: corregida una incompatibilidad que podía hacer fallar el envío del archivo al almacenamiento."
      ),
      seguridad(
        "Presupuestos",
        "El PDF oficial de un presupuesto ya no se puede eliminar por error."
      ),
      seguridad(
        "Plataforma",
        "Cada cambio pasa una batería de comprobaciones automáticas (permisos, separación entre organizaciones, base de datos y compilación) antes de publicarse."
      ),
    ],
  },
  {
    date: "2026-10-13",
    title: "Fechas de entrega y cobros sin sorpresas",
    entries: [
      mejora(
        "Pedidos",
        "Al elegir una fecha de entrega sin hora se proponen las 18:00. Si el pedido ya tenía hora, se conserva."
      ),
      correccion(
        "Pedidos",
        "Una fecha de entrega a medio escribir ya no borra la fecha guardada: Gestcopy no deja guardar hasta completarla. «Quitar fecha» sigue siendo la forma de borrarla."
      ),
      correccion(
        "Pedidos",
        "El selector rechaza las horas que no existen por el cambio al horario de verano, en lugar de guardar otra hora."
      ),
      correccion(
        "Cobros",
        "Editar el total de un pedido usa siempre los datos más recientes. Si otra persona lo cambió a la vez, el aviso aparece dentro del propio diálogo."
      ),
    ],
  },
  {
    date: "2026-10-09",
    title: "Operativa de mostrador más ágil",
    entries: [
      nuevo(
        "Pedido rápido",
        "Después de crear un pedido rápido puedes indicar el total y registrar una entrega a cuenta sin abrir la ficha."
      ),
      mejora(
        "Presupuestos",
        "Un presupuesto con revisiones también se puede imprimir en hoja A4 desde su ficha."
      ),
      nuevo(
        "Pedidos",
        "Botones Lista y Cuadrícula para ver los mismos pedidos como tabla o como tarjetas, conservando filtros, búsqueda y orden."
      ),
      mejora("Pedidos", "Pedidos se abre en Cuadrícula por defecto."),
      mejora(
        "Pedido rápido",
        "Formulario más compacto, organizado en columnas y adaptado a móvil, tableta y ordenador."
      ),
      mejora(
        "Permisos",
        "El rol Personal ve Inicio y el Calendario de pedidos. Las cifras comerciales del panel siguen reservadas a propietario, administrador y responsable."
      ),
      mejora(
        "Calendario",
        "La semana se muestra de lunes a sábado sin desbordarse. Las entregas de domingo, si las hay, aparecen debajo en una lista."
      ),
      correccion(
        "Impresión",
        "La hoja A4 del presupuesto muestra su estado actual (por ejemplo, Preparado) en lugar de Borrador."
      ),
    ],
  },
  {
    date: "2026-10-08",
    title: "Cobros, entregas a cuenta y panel diario",
    entries: [
      nuevo(
        "Cobros",
        "Cada pedido tiene su bloque de cobro: total, entregado a cuenta y pendiente de cobro."
      ),
      nuevo(
        "Presupuestos",
        "Pie de página personalizado en los presupuestos, configurable en Identidad de empresa, con negrita, cursiva, listas y enlaces."
      ),
      nuevo(
        "Presupuestos",
        "Notas internas en los presupuestos, que no aparecen en los documentos del cliente."
      ),
      nuevo(
        "Clientes",
        "La ficha del cliente muestra sus presupuestos vinculados."
      ),
      nuevo(
        "Actividad",
        "La ficha del cliente muestra su historial de actividad."
      ),
      mejora(
        "Actividad",
        "El historial de pedidos, presupuestos y clientes se abre y se pliega, e indica cuántos cambios contiene."
      ),
      mejora(
        "Panel",
        "Panel diario reordenado: indicadores, presupuestos, carga del equipo y listas de trabajo."
      ),
      mejora(
        "Panel",
        "Las entregas de hoy destacan más y la revisión operativa coincide con la lista de pedidos que requieren atención."
      ),
      mejora(
        "Actividad",
        "El cambio de responsable aparece como un evento propio y el número de pedido abre su ficha."
      ),
      correccion(
        "Panel",
        "Los pedidos retrasados se calculan con la fecha y hora reales de entrega, en la zona horaria de la tienda."
      ),
      correccion(
        "Clientes",
        "Crear un cliente desde un presupuesto o un pedido vuelve a funcionar y lo deja seleccionado."
      ),
      correccion(
        "Pedidos",
        "El título se puede escribir al crear el pedido, tanto en Nuevo pedido como en Pedido rápido. Si se deja vacío, se genera solo."
      ),
      correccion(
        "Pedidos",
        "El estado de presupuesto de la ficha refleja el presupuesto de origen (por ejemplo, «Aceptado · Convertido en pedido») y enlaza a él."
      ),
    ],
  },
  {
    date: "2026-10-07",
    title: "Presupuestos más sencillos de crear",
    entries: [
      mejora(
        "Presupuestos",
        "Crear un presupuesto es una sola pantalla con el editor comercial completo."
      ),
      mejora(
        "Presupuestos",
        "Al elegir el cliente se rellenan contacto, email, teléfono, razón social y NIF/CIF."
      ),
      mejora(
        "Presupuestos",
        "Si se corta la conexión al guardar un borrador, Gestcopy lo recupera sin duplicarlo, también con varias pestañas abiertas."
      ),
      mejora(
        "Presupuestos",
        "Las revisiones se llaman «Revisión 2», «Revisión 3»… sin etiquetas técnicas."
      ),
      mejora(
        "Fechas",
        "Nuevo selector de fecha y hora, el mismo en pedidos y presupuestos."
      ),
      correccion(
        "Presupuestos",
        "Convertir un presupuesto aceptado en pedido vuelve a funcionar correctamente."
      ),
    ],
  },
  {
    date: "2026-10-06",
    title: "Presupuestos comerciales completos",
    entries: [
      nuevo(
        "Presupuestos",
        "Presupuestos con partidas, totales calculados y revisiones."
      ),
      nuevo(
        "Presupuestos",
        "PDF oficial de cada presupuesto, que queda guardado con él."
      ),
      nuevo(
        "Presupuestos",
        "Recorrido comercial completo: preparar, enviar, aceptar o rechazar, y convertir el presupuesto aceptado en pedido."
      ),
    ],
  },
  {
    date: "2026-10-01",
    title: "Impresión y vista previa de archivos",
    entries: [
      nuevo(
        "Impresión",
        "Hojas de impresión de pedidos y presupuestos, para el taller y para el cliente, desde el diálogo de impresión del navegador."
      ),
      nuevo(
        "Archivos",
        "Vista previa de PDF e imágenes sin salir de Gestcopy."
      ),
      mejora(
        "Diseño",
        "Modo oscuro más cómodo, con tonos azul marino y cian en lugar de casi negro."
      ),
      correccion(
        "Ayuda",
        "El centro de ayuda muestra bien las negritas, cursivas y enlaces."
      ),
      correccion(
        "Permisos",
        "Dos cambios de acceso hechos a la vez ya no pueden pisarse entre sí."
      ),
    ],
  },
  {
    date: "2026-09-30",
    title: "Texto con formato y centro de ayuda ampliado",
    entries: [
      nuevo(
        "Pedidos",
        "Descripción y notas con formato: negrita, cursiva, subrayado, listas y enlaces. Los textos anteriores se siguen viendo igual."
      ),
      nuevo(
        "Ayuda",
        "Centro de ayuda renovado: 10 secciones, 58 artículos, buscador y guías paso a paso."
      ),
      nuevo(
        "Permisos",
        "El propietario puede transferir la propiedad de la organización a otra persona del equipo. El cambio queda registrado en la actividad."
      ),
    ],
  },
  {
    date: "2026-09-25",
    title: "Tu marca en Gestcopy y ayuda pública",
    entries: [
      nuevo(
        "Configuración",
        "Identidad de empresa: nombre visible, logotipo y color de marca, que se muestran en la cabecera."
      ),
      nuevo(
        "Ayuda",
        "Centro de ayuda público, sin iniciar sesión y enlazado desde la cabecera."
      ),
      mejora(
        "Configuración",
        "Los catálogos ya no muestran códigos técnicos."
      ),
      mejora(
        "Panel",
        "Los presupuestos tienen el mismo protagonismo que los pedidos del día."
      ),
      correccion(
        "Facturación",
        "La pantalla de Facturación se ve bien también en suscripciones que no se gestionan online."
      ),
      correccion(
        "Configuración",
        "El logotipo guardado se conserva aunque falle la limpieza del anterior."
      ),
      correccion(
        "Diseño",
        "Icono y nombre de Gestcopy correctos en la pestaña del navegador y al compartir enlaces."
      ),
      seguridad(
        "Plataforma",
        "Refuerzos de seguridad en la base de datos."
      ),
    ],
  },
  {
    date: "2026-09-24",
    title: "Presupuestos como sección propia",
    entries: [
      nuevo(
        "Presupuestos",
        "Adjuntar archivos a los presupuestos, con el mismo espacio de almacenamiento que los pedidos."
      ),
      mejora(
        "Presupuestos",
        "Presupuestos pasa a ser una sección propia, con estado «Enviado», bloque en el panel y filtros."
      ),
      mejora(
        "Presupuestos",
        "Los presupuestos cuentan como trabajo potencial y no alteran los indicadores de pedidos."
      ),
      mejora(
        "Permisos",
        "Los roles operativos pueden trabajar con presupuestos dentro de sus permisos."
      ),
      mejora(
        "Fechas",
        "Pedidos y presupuestos usan los mismos selectores de fecha."
      ),
      correccion(
        "Presupuestos",
        "Las horas que no existen por el cambio de hora se rechazan en lugar de guardarse con otra hora."
      ),
    ],
  },
  {
    date: "2026-09-23",
    title: "Pedido rápido con archivos y primeros presupuestos",
    entries: [
      nuevo(
        "Presupuestos",
        "Primera versión de Presupuestos: listado, alta, ficha con referencia propia y conversión en pedido. Se activa por organización."
      ),
      nuevo(
        "Pedidos",
        "Adjuntar archivos al crear el pedido, completo o rápido, con progreso de subida y reintento si falla, sin duplicar el pedido."
      ),
      nuevo(
        "Pedidos",
        "Estado de archivos del pedido al crearlo y al editarlo."
      ),
      nuevo(
        "Pedido rápido",
        "Cada campo de Pedido rápido puede ir en Principal, Más opciones u Oculto."
      ),
      mejora(
        "Actividad",
        "El registro de actividad se puede ver como lista o como cuadrícula, y recuerda tu elección."
      ),
    ],
  },
  {
    date: "2026-09-22",
    title: "Suscripción y alta con pago",
    entries: [
      nuevo(
        "Facturación",
        "Suscripción a Gestcopy Basic con pago online, portal para gestionar la suscripción y 5 GiB de almacenamiento."
      ),
      nuevo(
        "Facturación",
        "Cancelación programada: la suscripción sigue activa hasta el final del periodo pagado."
      ),
      nuevo(
        "Alta",
        "Las organizaciones nuevas se activan solas al confirmarse el pago. Si el pago queda a medias, se puede retomar."
      ),
      correccion(
        "Alta",
        "Mensajes claros cuando el alta coincide con una organización existente."
      ),
      seguridad(
        "Facturación",
        "Un mismo pago no puede abrir dos suscripciones ni activar una organización por error."
      ),
    ],
  },
  {
    date: "2026-09-21",
    title: "Configuración de catálogos",
    entries: [
      nuevo(
        "Configuración",
        "Gestión de tiendas, estados de pedido y catálogos operativos desde Configuración."
      ),
      nuevo(
        "Configuración",
        "Límites de archivos y consulta del almacenamiento usado."
      ),
      mejora(
        "Configuración",
        "Siempre hay un único estado inicial activo: Gestcopy impide quitarlo o duplicarlo."
      ),
      seguridad(
        "Configuración",
        "Servicios y catálogos protegidos para que cada organización solo use los suyos."
      ),
    ],
  },
  {
    date: "2026-09-20",
    title: "Copias de seguridad",
    entries: [
      seguridad(
        "Plataforma",
        "Copias de seguridad de los archivos y copias cifradas de la base de datos, con un procedimiento de recuperación probado."
      ),
    ],
  },
  {
    date: "2026-09-19",
    title: "Archivos en pedidos y nueva navegación",
    entries: [
      nuevo(
        "Archivos",
        "Adjuntar archivos a los pedidos: subida con progreso, descarga y eliminación, en almacenamiento privado."
      ),
      nuevo(
        "Navegación",
        "Nueva barra superior y menú agrupado por áreas, con acceso a los pedidos archivados."
      ),
      nuevo(
        "Pedidos",
        "Buscador en Todos los pedidos por referencia, título o nombre del cliente."
      ),
      mejora(
        "Mostrador",
        "Controles del mostrador adaptados a pantallas pequeñas."
      ),
      correccion(
        "Pedidos",
        "La ficha carga todos los datos del cliente aunque se abra directamente desde un enlace."
      ),
      correccion(
        "Pedidos",
        "Se puede volver a editar el enlace a la carpeta externa del pedido."
      ),
    ],
  },
  {
    date: "2026-09-18",
    title: "Edición segura de pedidos",
    entries: [
      nuevo(
        "Pedidos",
        "Si dos personas editan el mismo pedido a la vez, Gestcopy avisa en lugar de sobrescribir los cambios del otro."
      ),
      seguridad("Pedidos", "Los pedidos archivados no se pueden modificar."),
    ],
  },
  {
    date: "2026-09-17",
    title: "Kiosko y archivado de pedidos",
    entries: [
      nuevo(
        "Kiosko",
        "Kiosko público: el cliente deja su encargo (contacto, servicio, descripción y fecha) desde una pantalla de la tienda y se crea el pedido. Opcional para cada organización."
      ),
      nuevo(
        "Pedidos",
        "Archivar pedidos cerrados o cancelados. Los archivados quedan en solo lectura."
      ),
      mejora(
        "Pedidos",
        "Confirmación antes de cerrar o cancelar un pedido."
      ),
      mejora(
        "Pedidos",
        "El mismo criterio de «pedido activo» en Pedidos, Mostrador, Mis pedidos y el panel."
      ),
      correccion(
        "Pedidos",
        "La ficha ya no falla justo después de archivar un pedido."
      ),
      seguridad(
        "Kiosko",
        "El kiosko limita los envíos repetidos y solo funciona en las organizaciones que lo activan."
      ),
    ],
  },
  {
    date: "2026-09-16",
    title: "Pedido rápido a tu medida",
    entries: [
      nuevo(
        "Configuración",
        "El propietario elige qué campos de Pedido rápido se ven siempre y cuáles quedan en Más opciones."
      ),
      correccion(
        "Configuración",
        "La distribución guardada se aplica al momento, sin mostrar datos anteriores."
      ),
    ],
  },
  {
    date: "2026-09-15",
    title: "Mostrador para el personal",
    entries: [
      nuevo(
        "Mostrador",
        "Tablero de trabajo con Urgente, Listos para entregar, Avisar al cliente, Próximas entregas, Retrasados y Otros activos, en lista o rejilla."
      ),
      nuevo(
        "Pedido rápido",
        "Pedido rápido tiene su propia página, a mano desde el menú."
      ),
      mejora(
        "Navegación",
        "Menú adaptado a cada rol y cabecera con tus iniciales, tu nombre y tu rol."
      ),
      mejora(
        "Permisos",
        "El rol de gestión se muestra como «Responsable» en toda la aplicación."
      ),
      mejora(
        "Pedidos",
        "Ficha más legible: etiquetas y valores bien separados en Resumen, Producción y Cobro."
      ),
      mejora(
        "Equipo",
        "Botones «Dar acceso» y «Cambiar acceso» en la ficha de Personal."
      ),
      correccion(
        "Permisos",
        "Aceptar una invitación activa directamente la cuenta nueva, sin esperar un segundo email."
      ),
    ],
  },
  {
    date: "2026-09-14",
    title: "Ficha de trabajo, Mis pedidos y varias tiendas",
    entries: [
      nuevo(
        "Pedido rápido",
        "Registrar un trabajo en 20–30 segundos con los campos justos, título automático y alta de cliente en el momento."
      ),
      nuevo(
        "Mis pedidos",
        "La cola de trabajo de cada persona del equipo."
      ),
      nuevo(
        "Tiendas",
        "Varias tiendas: cada pedido indica su tienda y el listado se puede filtrar por ella."
      ),
      mejora(
        "Pedidos",
        "Ficha de trabajo con acciones rápidas para estado, responsable y notas, y aviso de pedidos sin asignar."
      ),
      mejora(
        "Pedidos",
        "Las pantallas de pedidos se actualizan solas al volver a la pestaña o recuperar la conexión, sin perder filtros ni cambios a medias."
      ),
      mejora(
        "Equipo",
        "Equipo separa usuario, rol de acceso y ficha de Personal. Al invitar se puede crear también la ficha de Personal."
      ),
      seguridad(
        "Permisos",
        "La organización nunca se queda sin propietario: el último no se puede quitar."
      ),
    ],
  },
  {
    date: "2026-09-11",
    title: "Pedidos más potentes y nuevo diseño",
    entries: [
      nuevo(
        "Pedidos",
        "Filtro por estado y ordenación por columnas: ascendente, descendente o sin orden."
      ),
      nuevo("Diseño", "Nuevo diseño visual, el mismo en todas las secciones."),
      nuevo("Diseño", "Tema claro, oscuro o el del sistema."),
      mejora(
        "Calendario",
        "Semana de lunes a domingo en la zona horaria de la tienda, con filtro por responsable, recuento por día y tarjetas con responsable y prioridad."
      ),
      mejora(
        "Pedidos",
        "Lista, Calendario y Por servicio conservan filtros y vista al recargar la página."
      ),
      mejora(
        "Pedidos",
        "Por servicio muestra la carga de cada servicio y la lista de sus pedidos."
      ),
      mejora(
        "Pedidos",
        "Colores de estado coherentes: un pedido cancelado ya no parece terminado."
      ),
      correccion(
        "Pedidos",
        "Los filtros se aplican antes de paginar, así que totales y páginas cuadran."
      ),
      correccion(
        "Pedidos",
        "Cambiar el responsable ya no reinicia el filtro que venía del panel."
      ),
    ],
  },
  {
    date: "2026-09-10",
    title: "Ficha de pedido y acceso más fiables",
    entries: [
      mejora(
        "Pedidos",
        "La ficha del pedido se abre en modo lectura y los cambios se guardan de una vez."
      ),
      mejora(
        "Permisos",
        "Si abres una invitación con otra cuenta, Gestcopy te ofrece cerrar sesión y continuar con el email invitado."
      ),
      mejora(
        "Alta",
        "Crear una organización y unirse a una por invitación son caminos separados."
      ),
      mejora(
        "Diseño",
        "Mensajes de carga, vacío y error iguales en todos los módulos."
      ),
      correccion("Acceso", "Iniciar sesión funciona a la primera."),
      correccion(
        "Permisos",
        "Los enlaces de invitación llevan a la dirección de tu organización."
      ),
      correccion(
        "Pedidos",
        "Paginación y mensajes correctos cuando una página no tiene pedidos activos."
      ),
      correccion(
        "Navegación",
        "Actividad ya no aparece un instante a quien no tiene permiso para verla."
      ),
      correccion("Diseño", "Botones principales con el espaciado correcto."),
      seguridad(
        "Plataforma",
        "Los mensajes de error ya no muestran detalles técnicos internos."
      ),
    ],
  },
  {
    date: "2026-09-09",
    title: "Invitaciones y permisos",
    entries: [
      nuevo(
        "Permisos",
        "Invitar al equipo por email y aceptar la invitación de forma segura."
      ),
      nuevo(
        "Permisos",
        "Pantalla de usuarios y permisos para gestionar quién entra y con qué rol."
      ),
      mejora("Panel", "Panel de inicio rediseñado."),
      mejora(
        "Acceso",
        "Después de iniciar sesión vuelves a la página que querías abrir."
      ),
      correccion(
        "Acceso",
        "Si la sesión ya no es válida, las acciones muestran un aviso de error en lugar de llevarte de forma inesperada al inicio de sesión."
      ),
      seguridad(
        "Permisos",
        "Control de miembros reforzado y alta de organizaciones limitada."
      ),
    ],
  },
  {
    date: "2026-09-08",
    title: "Una dirección propia para cada organización",
    entries: [
      nuevo(
        "Plataforma",
        "Cada organización trabaja en su propia dirección de Gestcopy."
      ),
      nuevo("Acceso", "Botón para cerrar sesión."),
      seguridad(
        "Actividad",
        "El registro de actividad general solo lo ven los roles con permiso."
      ),
      seguridad(
        "Plataforma",
        "Refuerzos de seguridad y actualización de la plataforma."
      ),
    ],
  },
  {
    date: "2026-09-07",
    title: "Clientes, servicios, equipo y panel",
    entries: [
      nuevo("Clientes", "Sección de Clientes."),
      nuevo("Servicios", "Sección de Servicios."),
      nuevo("Equipo", "Sección de Equipo."),
      nuevo(
        "Actividad",
        "Registro de actividad de toda la organización, incluidos servicios y equipo."
      ),
      nuevo("Panel", "Panel de inicio con el estado del día."),
      nuevo(
        "Pedidos",
        "Paginación, calendario semanal y vista Por servicio."
      ),
      nuevo("Alta", "Alta de organizaciones nuevas."),
      mejora(
        "Pedidos",
        "Asignar o cambiar el cliente de un pedido desde la propia ficha."
      ),
      correccion("Calendario", "Fechas correctas en el calendario."),
    ],
  },
  {
    date: "2026-09-06",
    title: "Primeros pedidos",
    entries: [
      nuevo(
        "Pedidos",
        "Listado de pedidos con prioridad, estado y vencidos resaltados. Muestra los activos por defecto."
      ),
      nuevo(
        "Pedidos",
        "Ficha de pedido con historial: quién hizo cada cambio y cuándo."
      ),
      nuevo(
        "Pedidos",
        "Cambio de estado con los estados de tu organización. Las fechas de listo y entregado se anotan solas."
      ),
      nuevo(
        "Pedidos",
        "Crear pedidos con la numeración propia de cada organización."
      ),
      nuevo(
        "Pedidos",
        "Aviso al cliente: marca si el cliente ya está avisado."
      ),
      nuevo(
        "Pedidos",
        "Editar los datos y el contenido del pedido, y crear el cliente desde el propio pedido."
      ),
      correccion(
        "Pedidos",
        "Filtro y contador de pedidos activos corregidos."
      ),
      seguridad(
        "Plataforma",
        "Cada organización solo ve sus propios clientes y pedidos."
      ),
    ],
  },
  {
    date: "2026-09-05",
    title: "Nace Gestcopy",
    entries: [nuevo("Plataforma", "Primera versión publicada de Gestcopy.")],
  },
];

export function changelogCounts(
  releases: ChangelogRelease[] = CHANGELOG
): Record<ChangelogKind, number> {
  const counts: Record<ChangelogKind, number> = {
    nuevo: 0,
    mejora: 0,
    correccion: 0,
    seguridad: 0,
  };
  for (const release of releases) {
    for (const entry of release.entries) counts[entry.kind] += 1;
  }
  return counts;
}

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const monthFormatter = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function utcNoon(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

/** «15 de octubre de 2026». Fixed to UTC so server and browser agree. */
export function formatChangelogDate(date: string) {
  return dateFormatter.format(utcNoon(date));
}

/** «Octubre de 2026». */
export function formatChangelogMonth(date: string) {
  const label = monthFormatter.format(utcNoon(date));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
