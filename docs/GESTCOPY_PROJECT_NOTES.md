# Gestcopy — Project Notes

Documento de estado operativo. No es una especificación. No autoriza implementación.

Actualizado: 2026-09-16

---

```text
CURRENT_BLOCK:
Kiosk V1 — Release Candidate / smoke pendiente

OPEN_PR:
#10  https://github.com/Tecnokaizen/copyflow/pull/10
HEAD: 0c9d20a72ffe7bb0ccaf322ca62e17444ba5f08f
Estado: CODE FREEZE · MERGEABLE · 259/259 · lint/typecheck/build OK · CI 3/3
No mergear hasta confirmación humana de smoke DEMO correcto.

PARALLEL_RESEARCH:
Lifecycle   AUDIT_ORDER_LIFECYCLE_V1   (completo, solo lectura)
Editing     AUDIT_ORDER_EDITING_V1     (completo, solo lectura)
Files       AUDIT_FILES_V1             (completo, solo lectura)
Settings    AUDIT_SETTINGS_V1          (completo, solo lectura)
Permissions AUDIT_PERMISSIONS_V1       (completo, solo lectura)

Cruce:
docs/GESTCOPY_V1_AUDIT_SUMMARY.md

NEXT_GATE:
Smoke DEMO correcto → merge #10 → revisión arquitectónica de auditorías.
```

## Gate operativo Kiosk (humano)

Pendiente. No es trabajo de agente.

- **A.** Supabase Vault: `kiosk_signing_secret` ≥ 32 caracteres
- **B.** Vercel: `KIOSK_SIGNING_SECRET` = exactamente el mismo secreto
- **C.** DEMO: canal activo `code = kiosk`
- **D.** Smoke casos 1–6 (opt-in, hostname desconocido, DEMO, replay, aislamiento, móvil)

## Bloqueos explícitos

- PR #10 permanece en CODE FREEZE. No modificar código, migraciones, RLS ni tests de Kiosk salvo defecto real detectado en smoke.
- No mergear #10 sin confirmación humana.
- No iniciar implementación del bloque 1 (Lifecycle / Editing / Files / Settings / Permissions).
- Esperar revisión del arquitecto sobre `docs/GESTCOPY_V1_AUDIT_SUMMARY.md`.
