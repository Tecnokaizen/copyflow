# Gestcopy Design System V1 — Spec corta

Fecha: 2026-09-11  
Rama: `feature/gestcopy-design-system-v1`  
Alcance: DESIGN / UX / UI únicamente.

## Decisiones fijadas

| Tema | Decisión |
|---|---|
| Tema visual | **Light unificado** en todo el SaaS. Dashboard abandona `dark` forzado. |
| `.dark` | Tokens preparados; sin theme switcher; sin pantallas duales. |
| Navegación | **Top-nav pulido** (no sidebar). |
| Identidad | Gestcopy (indigo / tokens actuales / Dashboard semilla). SUR4 = referencia operativa, no branding. |
| Multi-tenant | Un solo design system; datos de tenant desde contexto; cero `if (tenant === "sur4")`. |

## Semilla visual

Fuente de verdad: Dashboard actual + `globals.css` (`gc-*`, `--primary`, `--gc-*`) + `components/gestcopy/*`.

Landing (`gestcopy.com`) = continuidad de marca. App = densidad operativa (no clonar landing).

## Tokens / utilidades

Mantener y usar:

- Superficie: `--background`, `--card`, `--border`, `--muted`
- Marca: `--primary`
- Semántica: `--gc-success|warning|danger|info|urgent`
- Layout: `.gc-page`, `.gc-page-inner`, `.gc-card`, `.gc-table`, `.gc-cta`, `.gc-action`, `.gc-kpi*`, `.gc-list-row`

No crear un segundo sistema paralelo.

## Componentes del sistema (V1)

| Componente | Rol |
|---|---|
| `AppShell` | `main.gc-page` + `gc-page-inner` + children |
| `AppNav` | Top-nav: links + activo + tenant (contexto) + logout |
| `PageHeader` | título / descripción / actions |
| `SectionCard` | bloques de contenido |
| `StatusBadge` | flags-first (`status=`) |
| `EmptyState` / `LoadingState` / `ErrorState` | estados |
| Filter pattern | barra visual unificada (sin cambiar params) |
| Buttons | primario `gc-cta` / `Button`; secundario `gc-action` / outline |

Opcional V1 si reduce duplicación: helper de prioridad (no PriorityBadge complejo).

## Shell / top-nav

- Enlace activo: contraste claro (fondo muted o primary suave + texto foreground).
- Tenant: nombre (o slug) desde `/api/context`, sin hardcode.
- Logout: área derecha, estilo secundario.
- Responsive: wrap; sin colapsar a sidebar.

## Cabeceras

Patrón obligatorio en módulos:

```
título
contexto opcional
acciones (derecha en desktop)
```

Usar `PageHeader`.

## Pedidos

Solo visual:

- misma densidad que Dashboard (filas compactas, jerarquía cliente/trabajo > ids);
- tabs de vista coherentes;
- filtros agrupados visualmente;
- `StatusBadge status=`;
- prioridad ≠ estado;
- sort con iconos SVG locales (no Unicode);
- sin tocar API, filtros, URL semantics, timezone.

## Dashboard

- Quitar `dark` del shell.
- Conservar KPIs, layout, jerarquía.
- Alinear badges de estado a `StatusBadge status=` cuando el payload lo permita.

## Resto de módulos

Clientes, Equipo, Servicios, Actividad, ficha pedido: adoptar `AppShell` + `PageHeader` + patrones `gc-*`. Sin cambios funcionales.

## Iconografía

SVG/componentes en bundle (p.ej. Lucide ya en repo). No emojis ni Unicode como iconos críticos.

## Fuera de alcance

API, Supabase, RLS, Auth, tenant resolution, onboarding, polling/caché, lógica, sidebar, Settings funcional, theme switcher, branding por tenant UI.

## Criterio de éxito

Misma sensación Gestcopy de login → dashboard → pedidos → ficha → clientes → equipo, light, un solo sistema, DEMO + SUR4 con el mismo código.

## Validación

tsc, lint, build. Smoke visual DEMO + SUR4. **No merge a main** hasta OK explícito.
