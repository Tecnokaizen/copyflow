# Gestcopy AI — Pedidos por voz: estado y plan de integración

Fecha: 18 de octubre de 2026 (antes: 15/10). Relacionado con #76 y #78 a #82, la PR #90 y el ADR
de Pro (`docs/adr/2026-10-15-pro-early-access-v1.md`).

No confundir:
- **Gestcopy Pro V1 (#105)** solo **presenta** la voz como «En preparación».
- **Gestcopy AI V1 (#90)** es la implementación operativa (solo borradores).

## Estado real de la PR #90 (borrador, recuperada sobre `main` el 18/10)

Implementado, sin integrar ni aplicar:
- API `GET /api/ai/voice-orders/status`, `POST .../transcriptions` y
  `POST .../drafts`, protegidas por `requireVoiceOrdersAccess` sobre
  `requireCurrentAccess` (#94). El body no acepta `tenant_id`. Ninguna crea pedidos.
- Grabación con `getUserMedia`/`MediaRecorder` (`use-voice-recorder`), panel y
  revisión del borrador en `create-order-form`, integrados con el borrador de
  sesión de #94 y con la validación de fecha incompleta.
- Contrato `VoiceOrderDraft` y `apply-draft`: aplica campos al formulario sin
  guardar. «Descartar» revierte lo aplicado; «Reemplazar» actúa sobre un solo
  campo. La persistencia sigue siendo el `POST /api/orders` del usuario.
- Presupuesto interno: `ai_usage_limits` y `ai_usage_events` (migración
  `20261018150000`), con reserva atómica antes de cada llamada de pago.
  Valores iniciales: 60 s/clip, 2 USD/tenant/mes, 1 USD/usuario/mes, 10 USD/mes
  globales y 60 peticiones/usuario/día; función de operador
  `ai_set_voice_usage_limit` (solo `service_role`).
- Proveedor intercambiable (`fake` / `openai`). Puertas cerradas por defecto:
  `AI_VOICE_ORDERS_ENABLED`, override `ai_voice_orders`, `platform` desactivado
  y roles operativos. `fake` nunca corre en Vercel Production y `openai` exige
  modelos explícitos.
- Privacidad: no se guardan ni audio ni transcripción, y el ledger no contiene texto.
- Pruebas: `phase53_ai_voice_budget` (Release Gate) y su script de concurrencia
  (kiosk-supabase); rollback en `supabase/rollbacks/20261018150000_…`.

## Bloqueos resueltos el 18/10

1. Código de feature: `ai_voice_orders` (`…0009`) de #105; sin inserción de catálogo.
2. Migración renumerada `20261012120000` → `20261018150000` (después de #128 `…130000`;
   A1 debe quedar entre ambas).
3. Conflictos con #94, #95, #96, #129, #130 resueltos por merge (sin force push).
4. `/api/context` sin `features.voice_orders`; las guardas de rutas y
   `early-access-http` vuelven a pasar.

## Bloqueos abiertos

- **G2 legal (#82)**: DPA, subencargado, aviso de micrófono y retención 0.
- **Modelos**: nombres, precios y región sin confirmar con el proveedor. Ya no hay
  modelos por defecto: sin `AI_TRANSCRIPTION_MODEL`/`AI_EXTRACTION_MODEL` la voz queda no disponible.
- **Staging**: faltan `AI_VOICE_ORDERS_ENABLED=true` y `AI_PROVIDER=fake` en Preview
  para B3; ninguna variable `AI_*` ni `OPENAI_API_KEY` en Production.
- **Pro**: `early_access.voice_orders.status` sigue fijo en `planned`.

## Gates antes de cualquier coste real

| Gate | Contenido | Issue |
| --- | --- | --- |
| G1 Coste | Ledger y reserva atómica validados en Staging, con `platform.enabled=false` por defecto y kill switch probado | #81 |
| G2 Legal | DPA y subencargado del proveedor, aviso de micrófono y de tratamiento, retención 0 | #82 |
| G3 Seguridad | Aislamiento entre tenants, rol, feature, límite por usuario y tenant, validación MIME y tamaño en servidor, sin `tenant_id` del cliente | #79 |
| G4 Calidad | Entre 20 y 30 escenarios reales (fechas relativas, homónimos, servicios inexistentes, A3/A4, dos caras), con el proveedor `fake` y después con piloto controlado | #80, #82 |
| G5 UX | Safari/iOS, permiso denegado, sin micrófono, corte de red y cancelación. Nunca se guarda un pedido sin confirmación | #79 |

## Backlog ordenado

1. ~~Rebase funcional de #90 sobre `main`~~ (B1, 18/10).
2. B2: asistencia contextual por campo (sugerencias aceptables una a una; nunca crea el pedido).
3. B3: `e2e/staging/voice-orders.ts` con proveedor `fake` (feature on/off, viewer,
   otro tenant, kill switch, presupuesto agotado, sin clic no hay pedido).
4. Gate legal y confirmación del proveedor.
5. Piloto en Staging con proveedor real y presupuesto mínimo, solo con un tenant sintético.
6. Activación por tenant con `set_tenant_feature('<slug>','ai_voice_orders',true)`,
   con autorización expresa. Pro (#105) no la activa.

## Lo que no se ha hecho

No se ha activado ningún proveedor, no se ha generado ningún coste, no se ha
aplicado la migración en ningún Supabase remoto y no se ha desplegado código de voz.
El micrófono no se solicita en ninguna pantalla de `main`.
