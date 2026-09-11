# Gestcopy Dark Mode V1.1 — Spec corta

Fecha: 2026-09-11  
Base: `feature/gestcopy-design-system-v1` @ `37e636e` (DESIGN V1 **aún no mergeado** en `main`)  
Rama: `feature/gestcopy-dark-mode-v1`

## Diagnóstico

- Ya existe `next-themes` + `ThemeProvider` (`attribute="class"`, `defaultTheme="system"`, `enableSystem`) en `app/layout.tsx`.
- Tokens `.dark` ya definidos en `globals.css` (incl. `--gc-*`).
- `ThemeSwitcher` existe pero solo en `protected/layout` (starter), no en el shell operativo.
- Hardcodes light-only a corregir:
  - `priorityClassName` en Pedidos (`bg-red-100` / `bg-amber-100`)
  - `.gc-action-danger` (`border-red-200`, `hover:bg-red-50`, `text-red-700`)
  - algunos paneles Access con `bg-red-50` (ajustar a tokens)

## Mecanismo técnico

Reutilizar **next-themes** (ya instalado):

| Modo | Valor |
|---|---|
| Claro | `light` |
| Oscuro | `dark` → clase `.dark` en `<html>` |
| Sistema | `system` → `prefers-color-scheme` |

Persistencia: `localStorage` (default next-themes). Sin Supabase.

FOUC: mantener `suppressHydrationWarning` en `<html>`; ThemeProvider inyecta script; `disableTransitionOnChange` ya activo. Storage key explícita `gestcopy-theme`.

## Tokens

Ajustar `.dark` para profundidad Gestcopy (no negro puro):

- `--background` / `--card` / `--secondary` con separación clara
- `--border` / `--input` más visibles
- `--primary` ligeramente más luminoso (ya 67%)
- `--gc-*` ya aclarados; mantener

Light (`:root`) **no degradar**.

## Selector

En **AppNav** (área usuario, junto a Cerrar sesión): Claro / Oscuro / Sistema (ES).

## Archivos previstos

- `docs/superpowers/specs/2026-09-11-gestcopy-dark-mode-v1.md` (esta spec)
- `app/layout.tsx` — storageKey / polish provider
- `components/theme-switcher.tsx` — copy ES + a11y
- `components/app-nav.tsx` — montar selector
- `app/globals.css` — tokens dark + `gc-action-danger`
- `app/orders/page.tsx` — priority badges tokenizados
- Access error boxes si aparecen en smoke

## Fuera de alcance

API, Supabase, RLS, Auth, tenant, onboarding, Preview cookie, Settings completo, sidebar, branding por tenant.

## Criterio

1 DS · 2 apariencias · Light intacto · Dark = variante del Design System V1 (no el Dashboard dark previo).
