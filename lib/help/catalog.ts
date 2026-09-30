export const HELP_DOCS_URL = "https://app.gestcopy.com/ayuda";

/**
 * Header target for Ayuda. Production opens the canonical host.
 * Preview and development stay on the current deployment (`/ayuda`).
 * Client components read NEXT_PUBLIC_VERCEL_ENV, which Vercel sets to the
 * same value as VERCEL_ENV and inlines into the browser bundle.
 */
export function helpDocsUrl(
  vercelEnv: string | undefined = process.env.NEXT_PUBLIC_VERCEL_ENV
) {
  return vercelEnv === "production" ? HELP_DOCS_URL : "/ayuda";
}

/** Future contextual help. V1 only links the global center from the header. */
export const HELP_CONTEXT_HREFS = {
  dashboard: "/ayuda/panel-diario",
  orders: "/ayuda/pedidos",
  clients: "/ayuda/clientes",
  quotes: "/ayuda/presupuestos",
  settings: "/ayuda/configuracion",
  team: "/ayuda/equipo",
  access: "/ayuda/usuarios-y-permisos",
  billing: "/ayuda/facturacion",
  guides: "/ayuda/guias",
} as const;

export type HelpArticleRef = {
  slug: string;
  title: string;
  description: string;
  file: string;
  keywords: string[];
  related: string[];
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
      article(
        "primeros-pasos",
        "Primeros pasos",
        "Cómo empezar a trabajar con Gestcopy en tu copistería.",
        "primeros-pasos.md",
        ["empezar", "inicio", "primera vez", "orientación"],
        ["primeros-pasos/conceptos-basicos", "panel-diario", "guias"]
      ),
      article(
        "primeros-pasos/que-es-gestcopy",
        "Qué es Gestcopy",
        "El trabajo de la copistería en un solo lugar, por organización.",
        "primeros-pasos/que-es-gestcopy.md",
        ["gestcopy", "plataforma", "organización", "copistería"],
        ["primeros-pasos/conceptos-basicos", "primeros-pasos/navegacion"]
      ),
      article(
        "primeros-pasos/acceso",
        "Acceso",
        "Entrar con tu usuario, aceptar invitaciones y abrir el centro de ayuda.",
        "primeros-pasos/acceso.md",
        ["login", "iniciar sesión", "invitación", "contraseña", "entrar"],
        ["usuarios-y-permisos", "guias/dar-acceso"]
      ),
      article(
        "primeros-pasos/navegacion",
        "Navegación",
        "Dónde está cada área según tu rol.",
        "primeros-pasos/navegacion.md",
        ["menú", "inicio", "mostrador", "mis pedidos", "cabecera"],
        ["primeros-pasos/conceptos-basicos", "usuarios-y-permisos"]
      ),
      article(
        "primeros-pasos/conceptos-basicos",
        "Conceptos básicos",
        "Pedido, cliente, presupuesto, equipo y acceso.",
        "primeros-pasos/conceptos-basicos.md",
        ["pedido", "cliente", "presupuesto", "equipo", "estado", "prioridad"],
        ["guias/equipo-vs-usuarios", "pedidos", "presupuestos"]
      ),
    ],
  },
  {
    id: "trabajo-diario",
    title: "Trabajo diario",
    articles: [
      article(
        "panel-diario",
        "Panel diario",
        "Lo que necesita atención hoy: urgentes, retrasos, entregas y carga.",
        "panel-diario.md",
        ["dashboard", "inicio", "urgentes", "retrasados", "hoy", "atención"],
        ["pedidos", "pedidos/entregas", "equipo/carga-de-trabajo"]
      ),
      article(
        "pedidos",
        "Pedidos",
        "Lista y ficha del trabajo confirmado.",
        "pedidos.md",
        ["lista de pedidos", "ficha", "buscar pedido", "archivar", "mostrador"],
        ["pedidos/crear-pedido", "guias/encontrar-editar-pedido", "guias/pedido-entrada-entrega"]
      ),
      article(
        "pedidos/crear-pedido",
        "Crear un pedido",
        "Alta completa de un trabajo con cliente, servicio y entrega.",
        "pedidos/crear-pedido.md",
        ["nuevo pedido", "alta pedido", "crear trabajo"],
        ["guias/crear-pedido", "pedidos/pedido-rapido", "clientes/crear"]
      ),
      article(
        "pedidos/pedido-rapido",
        "Pedido rápido",
        "Creación abreviada para el mostrador.",
        "pedidos/pedido-rapido.md",
        ["mostrador", "rápido", "entrada rápida", "quick order"],
        ["guias/pedido-rapido", "configuracion/pedido-rapido", "pedidos/crear-pedido"]
      ),
      article(
        "pedidos/estados-y-prioridades",
        "Estados y prioridades",
        "Cómo avanza un pedido y cuándo marcarlo como urgente.",
        "pedidos/estados-y-prioridades.md",
        ["cambiar estado", "prioridad", "urgente", "entregado", "cancelar"],
        ["guias/cambiar-estado", "guias/cambiar-prioridad", "configuracion/estados-de-pedido"]
      ),
      article(
        "pedidos/entregas",
        "Entregas",
        "Fecha de entrega, hoy, próximas y retrasos.",
        "pedidos/entregas.md",
        ["fecha de entrega", "entrega prevista", "retraso", "entregar"],
        ["guias/fecha-entrega", "panel-diario"]
      ),
      article(
        "pedidos/archivos",
        "Archivos del pedido",
        "Subir, descargar y borrar documentos del trabajo.",
        "pedidos/archivos.md",
        ["subir archivo", "adjunto", "pdf", "descargar", "borrar archivo"],
        ["guias/archivos-pedido", "configuracion/archivos"]
      ),
    ],
  },
  {
    id: "clientes",
    title: "Clientes",
    articles: [
      article(
        "clientes",
        "Clientes",
        "Fichas de contacto de quien encarga el trabajo.",
        "clientes.md",
        ["listado clientes", "ficha cliente", "contacto"],
        ["clientes/crear", "clientes/actividad", "guias/historial-cliente"]
      ),
      article(
        "clientes/crear",
        "Crear un cliente",
        "Alta de un cliente nuevo desde Clientes o desde un pedido.",
        "clientes/crear.md",
        ["nuevo cliente", "alta cliente", "crear cliente"],
        ["guias/crear-cliente-en-pedido", "clientes/editar"]
      ),
      article(
        "clientes/editar",
        "Editar un cliente",
        "Actualizar datos de contacto sin perder el historial.",
        "clientes/editar.md",
        ["modificar cliente", "cambiar datos", "notas cliente"],
        ["clientes", "clientes/actividad"]
      ),
      article(
        "clientes/actividad",
        "Actividad y pedidos del cliente",
        "Historial visible desde la ficha del cliente.",
        "clientes/actividad.md",
        ["historial cliente", "pedidos del cliente", "actividad"],
        ["guias/historial-cliente", "pedidos"]
      ),
    ],
  },
  {
    id: "presupuestos",
    title: "Presupuestos",
    articles: [
      article(
        "presupuestos",
        "Presupuestos",
        "Trabajo potencial antes de confirmarlo (si tu organización lo tiene activo).",
        "presupuestos.md",
        ["quotes", "módulo presupuestos", "feature presupuestos"],
        ["presupuestos/crear", "presupuestos/convertir", "guias/crear-presupuesto"]
      ),
      article(
        "presupuestos/crear",
        "Crear un presupuesto",
        "Registrar una solicitud todavía no confirmada.",
        "presupuestos/crear.md",
        ["nuevo presupuesto", "alta presupuesto"],
        ["guias/crear-presupuesto", "presupuestos/estados"]
      ),
      article(
        "presupuestos/estados",
        "Estados del presupuesto",
        "Borrador, revisión, enviado, aceptado y rechazado.",
        "presupuestos/estados.md",
        ["estado presupuesto", "enviado", "aceptado", "rechazado"],
        ["presupuestos/convertir", "configuracion/catalogos"]
      ),
      article(
        "presupuestos/archivos",
        "Archivos del presupuesto",
        "PDF y documentos del presupuesto.",
        "presupuestos/archivos.md",
        ["pdf presupuesto", "adjuntos presupuesto"],
        ["presupuestos/convertir", "configuracion/archivos"]
      ),
      article(
        "presupuestos/convertir",
        "Convertir en pedido",
        "Pasar un presupuesto a trabajo confirmado.",
        "presupuestos/convertir.md",
        ["convertir presupuesto", "aceptado a pedido", "crear pedido desde presupuesto"],
        ["guias/convertir-presupuesto", "pedidos"]
      ),
    ],
  },
  {
    id: "equipo",
    title: "Equipo",
    articles: [
      article(
        "equipo",
        "Equipo",
        "Personas operativas que pueden encargarse de pedidos.",
        "equipo.md",
        ["personal", "trabajadores", "añadir trabajador", "equipo operativo"],
        ["guias/equipo-vs-usuarios", "equipo/personal", "usuarios-y-permisos"]
      ),
      article(
        "equipo/personal",
        "Personal",
        "Alta, edición y desactivación de personas del equipo.",
        "equipo/personal.md",
        ["añadir trabajador", "dar de alta persona", "desactivar persona", "ficha personal"],
        ["guias/anadir-persona-equipo", "equipo/responsables"]
      ),
      article(
        "equipo/responsables",
        "Responsables",
        "Asignar o cambiar quién lleva un pedido.",
        "equipo/responsables.md",
        ["reasignar", "reasignar pedido", "cambiar responsable", "asignar pedido"],
        ["guias/reasignar", "equipo/carga-de-trabajo"]
      ),
      article(
        "equipo/carga-de-trabajo",
        "Carga de trabajo",
        "Pedidos activos por persona en el panel diario.",
        "equipo/carga-de-trabajo.md",
        ["carga", "reparto", "pedidos por persona"],
        ["panel-diario", "equipo/responsables"]
      ),
    ],
  },
  {
    id: "configuracion",
    title: "Configuración",
    articles: [
      article(
        "configuracion",
        "Configuración",
        "Ajustes de la organización: identidad, tiendas, servicios y catálogos.",
        "configuracion.md",
        ["ajustes", "settings", "organización"],
        ["configuracion/tiendas", "configuracion/servicios", "usuarios-y-permisos"]
      ),
      article(
        "configuracion/identidad",
        "Identidad de empresa",
        "Nombre visible, logo y color de marca.",
        "configuracion/identidad.md",
        ["logo", "marca", "nombre visible", "color"],
        ["configuracion", "facturacion"]
      ),
      article(
        "configuracion/tiendas",
        "Tiendas",
        "Sedes donde se asignan los pedidos.",
        "configuracion/tiendas.md",
        ["sede", "local", "configurar tienda", "desactivar tienda"],
        ["guias/configurar-tienda", "pedidos/crear-pedido"]
      ),
      article(
        "configuracion/servicios",
        "Servicios",
        "Lo que ofrece la organización y se asocia a pedidos.",
        "configuracion/servicios.md",
        ["catálogo servicios", "activar servicio", "categoría servicio"],
        ["guias/configurar-servicios", "pedidos/crear-pedido"]
      ),
      article(
        "configuracion/estados-de-pedido",
        "Estados de pedido",
        "Flujo operativo: inicial, intermedios, listo, cerrado y cancelado.",
        "configuracion/estados-de-pedido.md",
        ["flujo", "estado inicial", "configurar estados"],
        ["guias/configurar-estados", "pedidos/estados-y-prioridades"]
      ),
      article(
        "configuracion/catalogos",
        "Catálogos",
        "Tipos de cliente, canales, pago, entrega y opciones relacionadas.",
        "configuracion/catalogos.md",
        ["canal de entrada", "tipo de cliente", "pago", "entrega", "contexto"],
        ["configuracion", "presupuestos/estados"]
      ),
      article(
        "configuracion/archivos",
        "Archivos y almacenamiento",
        "Espacio usado y tamaño máximo por archivo.",
        "configuracion/archivos.md",
        ["almacenamiento", "cuota", "espacio", "tamaño máximo", "consultar almacenamiento"],
        ["guias/consultar-almacenamiento", "facturacion", "pedidos/archivos"]
      ),
      article(
        "configuracion/pedido-rapido",
        "Pedido rápido (configuración)",
        "Qué campos se muestran al crear un pedido rápido.",
        "configuracion/pedido-rapido.md",
        ["campos pedido rápido", "layout mostrador", "configurar pedido rápido"],
        ["guias/configurar-pedido-rapido", "pedidos/pedido-rapido"]
      ),
    ],
  },
  {
    id: "usuarios",
    title: "Usuarios y permisos",
    articles: [
      article(
        "usuarios-y-permisos",
        "Usuarios y permisos",
        "Invitar usuarios, roles de acceso y diferencia con el equipo operativo.",
        "usuarios-y-permisos.md",
        [
          "invitar usuario",
          "dar acceso",
          "rol",
          "propietario",
          "administrador",
          "responsable",
          "personal",
          "solo lectura",
          "permisos",
        ],
        ["guias/dar-acceso", "guias/equipo-vs-usuarios", "equipo"]
      ),
    ],
  },
  {
    id: "cuenta",
    title: "Cuenta",
    articles: [
      article(
        "facturacion",
        "Plan, facturación y almacenamiento",
        "Consultar el plan, el portal de pago y el espacio incluido.",
        "facturacion.md",
        ["plan", "stripe", "suscripción", "portal de pago", "gestcopy basic", "facturación"],
        ["configuracion/archivos", "guias/consultar-almacenamiento"]
      ),
    ],
  },
  {
    id: "guias",
    title: "Guías paso a paso",
    articles: [
      article(
        "guias",
        "Guías paso a paso",
        "Flujos habituales del día a día en la copistería.",
        "guias.md",
        ["flujos", "procedimientos", "cómo hacer", "paso a paso"],
        ["guias/pedido-entrada-entrega", "guias/equipo-vs-usuarios"]
      ),
      article(
        "guias/pedido-entrada-entrega",
        "De la entrada a la entrega",
        "Recorrido completo de un pedido desde que entra hasta que se entrega.",
        "guias/pedido-entrada-entrega.md",
        ["flujo pedido", "ciclo de vida", "entrada a entrega", "entregar pedido"],
        ["pedidos", "pedidos/estados-y-prioridades", "pedidos/entregas"]
      ),
      article(
        "guias/crear-pedido",
        "Cómo crear un pedido",
        "Pasos para dar de alta un trabajo confirmado.",
        "guias/crear-pedido.md",
        ["crear pedido", "nuevo pedido"],
        ["pedidos/crear-pedido", "guias/pedido-rapido"]
      ),
      article(
        "guias/pedido-rapido",
        "Cómo usar el pedido rápido",
        "Alta rápida en mostrador con los campos configurados.",
        "guias/pedido-rapido.md",
        ["pedido rápido", "mostrador"],
        ["pedidos/pedido-rapido", "configuracion/pedido-rapido"]
      ),
      article(
        "guias/encontrar-editar-pedido",
        "Cómo encontrar y editar un pedido",
        "Buscar, abrir la ficha y guardar cambios.",
        "guias/encontrar-editar-pedido.md",
        ["buscar pedido", "editar pedido", "encontrar pedido"],
        ["pedidos", "guias/cambiar-estado"]
      ),
      article(
        "guias/cambiar-estado",
        "Cómo cambiar el estado",
        "Avanzar, cerrar o cancelar un pedido.",
        "guias/cambiar-estado.md",
        ["cambiar estado", "marcar entregado", "cancelar pedido"],
        ["pedidos/estados-y-prioridades", "configuracion/estados-de-pedido"]
      ),
      article(
        "guias/cambiar-prioridad",
        "Cómo cambiar la prioridad",
        "Marcar o quitar la urgencia de un pedido.",
        "guias/cambiar-prioridad.md",
        ["cambiar prioridad", "urgente", "prioridad"],
        ["pedidos/estados-y-prioridades", "panel-diario"]
      ),
      article(
        "guias/reasignar",
        "Cómo reasignar un pedido",
        "Cambiar el responsable de un trabajo.",
        "guias/reasignar.md",
        ["reasignar", "reasignar pedido", "cambiar responsable", "asignar responsable"],
        ["equipo/responsables", "equipo/personal"]
      ),
      article(
        "guias/fecha-entrega",
        "Cómo poner o cambiar la fecha de entrega",
        "Definir entrega prevista y entender hoy y retrasos.",
        "guias/fecha-entrega.md",
        ["fecha de entrega", "entrega prevista", "cambiar entrega"],
        ["pedidos/entregas", "panel-diario"]
      ),
      article(
        "guias/archivos-pedido",
        "Cómo gestionar archivos del pedido",
        "Subir, descargar, reintentar o borrar adjuntos.",
        "guias/archivos-pedido.md",
        ["subir archivo", "adjuntar", "borrar archivo", "descargar"],
        ["pedidos/archivos", "configuracion/archivos"]
      ),
      article(
        "guias/crear-cliente-en-pedido",
        "Cómo crear un cliente durante el pedido",
        "Alta de cliente sin salir del flujo de pedido.",
        "guias/crear-cliente-en-pedido.md",
        ["crear cliente", "cliente en pedido", "nuevo cliente mostrador"],
        ["clientes/crear", "pedidos/crear-pedido"]
      ),
      article(
        "guias/historial-cliente",
        "Cómo ver el historial de un cliente",
        "Consultar pedidos y actividad desde la ficha.",
        "guias/historial-cliente.md",
        ["historial cliente", "pedidos del cliente"],
        ["clientes/actividad", "clientes"]
      ),
      article(
        "guias/crear-presupuesto",
        "Cómo crear un presupuesto",
        "Registrar trabajo potencial cuando el módulo está activo.",
        "guias/crear-presupuesto.md",
        ["crear presupuesto", "nuevo presupuesto"],
        ["presupuestos/crear", "guias/convertir-presupuesto"]
      ),
      article(
        "guias/convertir-presupuesto",
        "Cómo convertir un presupuesto en pedido",
        "Pasar de solicitud aceptada a trabajo confirmado.",
        "guias/convertir-presupuesto.md",
        ["convertir presupuesto", "presupuesto a pedido"],
        ["presupuestos/convertir", "pedidos"]
      ),
      article(
        "guias/anadir-persona-equipo",
        "Cómo añadir una persona al equipo",
        "Dar de alta a alguien que pueda recibir pedidos.",
        "guias/anadir-persona-equipo.md",
        ["añadir trabajador", "alta personal", "nuevo miembro equipo"],
        ["equipo/personal", "guias/dar-acceso"]
      ),
      article(
        "guias/dar-acceso",
        "Cómo dar acceso a Gestcopy",
        "Invitar a un usuario para que entre en la aplicación.",
        "guias/dar-acceso.md",
        ["invitar usuario", "dar acceso", "invitación", "crear usuario"],
        ["usuarios-y-permisos", "guias/equipo-vs-usuarios"]
      ),
      article(
        "guias/equipo-vs-usuarios",
        "Equipo frente a Usuarios y permisos",
        "Personas operativas frente a quién puede entrar en Gestcopy.",
        "guias/equipo-vs-usuarios.md",
        [
          "diferencia equipo usuarios",
          "sin acceso",
          "con acceso",
          "personal vs permisos",
          "añadir trabajador",
          "invitar usuario",
        ],
        ["equipo", "usuarios-y-permisos"]
      ),
      article(
        "guias/configurar-tienda",
        "Cómo configurar una tienda",
        "Crear o desactivar sedes de la organización.",
        "guias/configurar-tienda.md",
        ["configurar tienda", "nueva sede"],
        ["configuracion/tiendas"]
      ),
      article(
        "guias/configurar-servicios",
        "Cómo configurar servicios",
        "Definir lo que ofrece la organización.",
        "guias/configurar-servicios.md",
        ["configurar servicios", "nuevo servicio"],
        ["configuracion/servicios"]
      ),
      article(
        "guias/configurar-estados",
        "Cómo configurar estados de pedido",
        "Definir el flujo operativo del trabajo.",
        "guias/configurar-estados.md",
        ["configurar estados", "estado inicial"],
        ["configuracion/estados-de-pedido"]
      ),
      article(
        "guias/configurar-pedido-rapido",
        "Cómo configurar el pedido rápido",
        "Elegir qué campos se ven en la creación rápida.",
        "guias/configurar-pedido-rapido.md",
        ["configurar pedido rápido", "campos mostrador"],
        ["configuracion/pedido-rapido", "pedidos/pedido-rapido"]
      ),
      article(
        "guias/consultar-almacenamiento",
        "Cómo consultar el almacenamiento",
        "Ver espacio usado y límite del plan.",
        "guias/consultar-almacenamiento.md",
        ["almacenamiento", "espacio", "cuota", "consultar almacenamiento"],
        ["configuracion/archivos", "facturacion"]
      ),
    ],
  },
  {
    id: "preguntas-frecuentes",
    title: "Preguntas frecuentes",
    articles: [
      article(
        "preguntas-frecuentes",
        "Preguntas frecuentes",
        "Respuestas cortas de uso diario.",
        "preguntas-frecuentes.md",
        ["faq", "problemas", "no veo presupuestos", "archivo no aparece", "archivado"],
        ["guias", "usuarios-y-permisos"]
      ),
    ],
  },
];

function article(
  slug: string,
  title: string,
  description: string,
  file: string,
  keywords: string[] = [],
  related: string[] = []
): HelpArticleRef {
  return { slug, title, description, file, keywords, related };
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
