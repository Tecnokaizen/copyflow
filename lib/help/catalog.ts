export const HELP_DOCS_URL = "https://app.gestcopy.com/docs";

/** Future contextual help. V1 only links the global center from the header. */
export const HELP_CONTEXT_HREFS = {
  dashboard: "/docs/panel-diario",
  orders: "/docs/pedidos",
  clients: "/docs/clientes",
  quotes: "/docs/presupuestos",
  settings: "/docs/configuracion",
} as const;

export type HelpArticleRef = {
  slug: string;
  title: string;
  description: string;
  file: string;
};

export type HelpSection = {
  id: string;
  title: string;
  articles: HelpArticleRef[];
};

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "primeros-pasos",
    title: "Primeros pasos",
    articles: [
      article("primeros-pasos", "Primeros pasos", "Cómo empezar a trabajar con Gestcopy.", "primeros-pasos.md"),
      article("primeros-pasos/que-es-gestcopy", "Qué es Gestcopy", "El trabajo de la copistería en un solo lugar.", "primeros-pasos/que-es-gestcopy.md"),
      article("primeros-pasos/acceso", "Acceso", "Entra con el usuario de tu organización.", "primeros-pasos/acceso.md"),
      article("primeros-pasos/navegacion", "Navegación", "Dónde está cada área de la aplicación.", "primeros-pasos/navegacion.md"),
      article("primeros-pasos/conceptos-basicos", "Conceptos básicos", "Pedido, cliente, presupuesto y equipo.", "primeros-pasos/conceptos-basicos.md"),
    ],
  },
  {
    id: "trabajo-diario",
    title: "Trabajo diario",
    articles: [
      article("panel-diario", "Panel diario", "Lo que necesita atención hoy.", "panel-diario.md"),
      article("pedidos", "Pedidos", "El trabajo confirmado de la organización.", "pedidos.md"),
      article("pedidos/crear-pedido", "Crear un pedido", "Alta de un trabajo con cliente, servicio y entrega.", "pedidos/crear-pedido.md"),
      article("pedidos/pedido-rapido", "Pedido rápido", "Creación abreviada para el mostrador.", "pedidos/pedido-rapido.md"),
      article("pedidos/estados-y-prioridades", "Estados y prioridades", "Cómo avanza un pedido y cuándo es urgente.", "pedidos/estados-y-prioridades.md"),
      article("pedidos/entregas", "Entregas", "Fecha de entrega, hoy y retrasos.", "pedidos/entregas.md"),
      article("pedidos/archivos", "Archivos del pedido", "Documentos asociados a un trabajo.", "pedidos/archivos.md"),
    ],
  },
  {
    id: "clientes",
    title: "Clientes",
    articles: [
      article("clientes", "Clientes", "La ficha de cada cliente.", "clientes.md"),
      article("clientes/crear", "Crear un cliente", "Alta de un cliente nuevo.", "clientes/crear.md"),
      article("clientes/editar", "Editar un cliente", "Actualiza los datos de contacto.", "clientes/editar.md"),
      article("clientes/actividad", "Actividad y pedidos del cliente", "Historial visible desde la ficha.", "clientes/actividad.md"),
    ],
  },
  {
    id: "presupuestos",
    title: "Presupuestos",
    articles: [
      article("presupuestos", "Presupuestos", "Trabajo potencial, antes de confirmarlo.", "presupuestos.md"),
      article("presupuestos/crear", "Crear un presupuesto", "Registra una solicitud todavía no confirmada.", "presupuestos/crear.md"),
      article("presupuestos/estados", "Estados del presupuesto", "Borrador, revisión, enviado y aceptado.", "presupuestos/estados.md"),
      article("presupuestos/archivos", "Archivos del presupuesto", "PDF y documentos del presupuesto.", "presupuestos/archivos.md"),
      article("presupuestos/convertir", "Convertir en pedido", "El presupuesto aceptado pasa a ser trabajo.", "presupuestos/convertir.md"),
    ],
  },
  {
    id: "equipo",
    title: "Equipo",
    articles: [
      article("equipo", "Equipo", "Personas que trabajan los pedidos.", "equipo.md"),
      article("equipo/personal", "Personal", "Quién puede trabajar un pedido.", "equipo/personal.md"),
      article("equipo/responsables", "Responsables", "Asignación de un pedido a una persona.", "equipo/responsables.md"),
      article("equipo/carga-de-trabajo", "Carga de trabajo", "Pedidos activos por persona.", "equipo/carga-de-trabajo.md"),
    ],
  },
  {
    id: "configuracion",
    title: "Configuración",
    articles: [
      article("configuracion", "Configuración", "Ajustes de la organización.", "configuracion.md"),
      article("configuracion/identidad", "Identidad de empresa", "Nombre, logo y color de marca.", "configuracion/identidad.md"),
      article("configuracion/tiendas", "Tiendas", "Sedes donde se asignan los pedidos.", "configuracion/tiendas.md"),
      article("configuracion/servicios", "Servicios", "Lo que la organización ofrece.", "configuracion/servicios.md"),
      article("configuracion/estados-de-pedido", "Estados de pedido", "El flujo operativo del trabajo.", "configuracion/estados-de-pedido.md"),
      article("configuracion/catalogos", "Catálogos", "Opciones de cliente, canal, pago y entrega.", "configuracion/catalogos.md"),
      article("configuracion/archivos", "Archivos y almacenamiento", "Tamaño máximo y espacio del plan.", "configuracion/archivos.md"),
      article("configuracion/pedido-rapido", "Pedido rápido", "Campos visibles en la creación rápida.", "configuracion/pedido-rapido.md"),
    ],
  },
  {
    id: "usuarios",
    title: "Usuarios y permisos",
    articles: [
      article("usuarios-y-permisos", "Usuarios y permisos", "Qué puede hacer cada rol.", "usuarios-y-permisos.md"),
    ],
  },
  {
    id: "cuenta",
    title: "Cuenta",
    articles: [
      article("facturacion", "Plan, facturación y almacenamiento", "El plan de la organización.", "facturacion.md"),
    ],
  },
  {
    id: "preguntas-frecuentes",
    title: "Preguntas frecuentes",
    articles: [
      article("preguntas-frecuentes", "Preguntas frecuentes", "Respuestas cortas de uso diario.", "preguntas-frecuentes.md"),
    ],
  },
];

function article(
  slug: string,
  title: string,
  description: string,
  file: string
): HelpArticleRef {
  return { slug, title, description, file };
}

export function allHelpArticles() {
  return HELP_SECTIONS.flatMap((section) =>
    section.articles.map((item) => ({ ...item, section }))
  );
}

export function helpArticleBySlug(slug: string) {
  return allHelpArticles().find((item) => item.slug === slug) ?? null;
}

export function helpNeighbors(slug: string) {
  const articles = allHelpArticles();
  const index = articles.findIndex((item) => item.slug === slug);
  if (index < 0) return { previous: null, next: null };
  return {
    previous: articles[index - 1] ?? null,
    next: articles[index + 1] ?? null,
  };
}
