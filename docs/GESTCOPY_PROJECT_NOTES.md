# Gestcopy — Project Notes

Documento de estado operativo. No es una especificación. No autoriza escribir código de Lifecycle todavía.

Actualizado: 2026-09-16

---

```text
CURRENT_BLOCK:
Kiosk V1 — Release Candidate / smoke pendiente

OPEN_PR:
#10  https://github.com/Tecnokaizen/copyflow/pull/10
HEAD: 0c9d20a72ffe7bb0ccaf322ca62e17444ba5f08f
Estado: CODE FREEZE · MERGEABLE
No mergear hasta confirmación humana de smoke DEMO correcto.

ARCHITECT_REVIEW:
Aceptada en PR #11 (revisión Tecnokaizen).
Auditorías B–F = mapa técnico.
Antes de implementar: revalidar solo hotspots contra main post-#10.

PREPARED_NOT_STARTED:
Lifecycle V1 spec + plan (escritura gated a merge #10)
  docs/superpowers/specs/2026-09-16-gestcopy-lifecycle-v1-design.md
  docs/superpowers/plans/2026-09-16-gestcopy-lifecycle-v1.md
QUICK_ORDER_LAYOUT_V1 spec + plan (espera autorización arquitectónica)
  docs/superpowers/specs/2026-09-16-gestcopy-quick-order-layout-v1-design.md
  docs/superpowers/plans/2026-09-16-gestcopy-quick-order-layout-v1.md
  Paralelo a Lifecycle: SÍ (otra rama/PR, sin choque de archivos calientes)

OUT_OF_LIFECYCLE_BLOCK:
Settings (salvo el recorte Pedido rápido, si se autoriza aparte) · Storage/Files · Editing concurrency · create_organization seed

NEXT_GATE:
Smoke DEMO correcto → merge #10 → revalidar hotspots → implementar Lifecycle V1
en una sola rama/PR (cursor/order-lifecycle-v1-5d7f).
QUICK_ORDER_LAYOUT_V1 no arranca hasta el arquitecto.
```

## Decisiones del arquitecto (congeladas)

1. Viewer lee actividad de un pedido que ya puede consultar; `/activity` global sigue siendo gestión.
2. Bypass `status_id`/timestamps = deuda V1 a cerrar vía RPC; mecanismo mínimo; no romper otros PATCH ni Kiosk.
3. `is_ready` = activo preparado; `is_closed` / `is_cancelled` = terminales. `archived_at` no es estado de producción.
4. Mostrador, Mis pedidos y atención: mismo criterio operativo (`!closed && !cancelled && !archived`). `delivered_at` es auditoría.
5. Archivo V1: solo terminales; histórico consultable; no hard delete.
6. Cancelar, archivar y entregar/terminal: confirmación explícita.
7. Seed `create_organization`: otro bloque (no Lifecycle).
8. Settings estructural: owner+admin; manager opera. RLS se alinea cuando llegue Settings.
9. `file_status` manual; no acoplar Lifecycle a Storage/`requires_file`.
10. Concurrencia: banner en Editing V1, no `row_version` ahora.
11. Kiosk (#10) fuera de alcance salvo defecto de smoke.
12. Sin tabla capabilities ni rediseño de schema.

## Gate operativo Kiosk (humano)

- **A.** Supabase Vault: `kiosk_signing_secret` ≥ 32 caracteres
- **B.** Vercel: `KIOSK_SIGNING_SECRET` = exactamente el mismo secreto
- **C.** DEMO: canal activo `code = kiosk`
- **D.** Smoke casos 1–6

## Bloqueos explícitos

- PR #10 CODE FREEZE. No mergear sin smoke humano.
- No implementar Lifecycle hasta merge #10 + revalidación de hotspots.
- No mezclar Settings, Storage ni edición completa en el PR de Lifecycle.
- QUICK_ORDER_LAYOUT_V1: no implementar hasta autorización arquitectónica. Si se autoriza, PR distinto de Lifecycle.
