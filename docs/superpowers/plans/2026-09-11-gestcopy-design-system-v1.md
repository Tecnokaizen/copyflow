# Gestcopy Design System V1 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unificar el SaaS Gestcopy en light + top-nav + patrones Dashboard, sin tocar lógica/API/RLS.

**Architecture:** Extender `gc-*` + `components/gestcopy/*`; nuevo `AppShell`; pulir `AppNav`; adoptar `PageHeader` en módulos; pulido visual Pedidos y resto. Sin sidebar ni theme switcher.

**Tech Stack:** Next.js App Router, Tailwind, componentes gestcopy existentes, Lucide para iconos locales.

---

### Task 1: AppShell + AppNav + Dashboard light

**Files:**
- Create: `components/gestcopy/app-shell.tsx`
- Modify: `components/app-nav.tsx`
- Modify: `components/dashboard/tenant-dashboard.tsx`
- Modify: `docs/superpowers/specs/2026-09-11-gestcopy-design-system-v1.md` (already written)

**Steps:**
1. Crear `AppShell` con `main.gc-page` + `gc-page-inner`.
2. AppNav: pathname activo, tenant name/slug desde `/api/context`, logout a la derecha, estilos densos + focus.
3. Dashboard: quitar clase `dark`; usar `AppShell`.
4. Verificar visualmente coherencia light.

### Task 2: Cabeceras + shells de módulos

**Files:**
- Modify: `app/orders/page.tsx`, `app/clients/page.tsx`, `app/services/page.tsx`, `app/activity/page.tsx`, `components/team/team-shell.tsx`, ficha pedido shell.

**Steps:**
1. Sustituir layout ad-hoc por `AppShell` + `PageHeader`.
2. Mantener CTAs existentes (Nuevo pedido/cliente) como `actions`.

### Task 3: Pedidos visual polish

**Files:**
- Modify: `app/orders/page.tsx`
- Possibly small SVG/lucide sort indicators

**Steps:**
1. Tabs/filtros con patrón visual unificado.
2. Tabla densificada / `gc-table` donde encaje.
3. Sort icons Lucide ArrowUpDown / ArrowUp / ArrowDown.
4. No cambiar params ni fetches.

### Task 4: Resto + badges Dashboard + polish

**Files:**
- Clients/Team/Services/Activity tables/filters visual
- `tenant-dashboard.tsx` StatusBadge alignment
- Forms button hierarchy light touch

**Steps:**
1. Alinear listados a `gc-card` / densidades.
2. Dashboard status via flags cuando haya datos.
3. tsc/lint/build; push rama; no merge.
