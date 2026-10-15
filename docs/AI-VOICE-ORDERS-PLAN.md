# Gestcopy AI — Pedidos por voz: estado y plan de integración

Fecha: 15 de octubre de 2026. Relacionado con #76 y #78 a #82, la PR #90 y el ADR
de Pro (`docs/adr/2026-10-15-pro-early-access-v1.md`).

No confundir:
- **Gestcopy Pro V1 (#105)** solo **presenta** la voz como «En preparación».
- **Gestcopy AI V1 (#90)** es la implementación operativa.

## Estado real de la PR #90 (`bf18b26`, borrador)

Implementado, sin integrar:
- API `GET /api/ai/voice-orders/status`, `POST .../transcriptions` y
  `POST .../drafts`. El body no acepta `tenant_id`.
- Grabación con `getUserMedia`/`MediaRecorder` (`use-voice-recorder`), panel y
  revisión del borrador en `create-order-form`.
- Contrato `VoiceOrderDraft` y `apply-draft`: aplica campos al formulario sin
  guardar. La persistencia sigue siendo el `POST /api/orders` del usuario.
- Presupuesto interno: `ai_usage_limits` y `ai_usage_events`, con reserva
  atómica antes de cada llamada de pago. Valores piloto: 60 s/clip,
  2 USD/tenant/mes, 1 USD/usuario/mes y 10 USD/mes globales.
- Proveedor intercambiable (`fake` / `openai`). Las puertas están cerradas por
  defecto: `AI_VOICE_ORDERS_ENABLED`, override de tenant, `platform` desactivado
  y roles operativos.
- Privacidad: no se guardan ni audio ni transcripción, y el ledger no contiene texto.

## Bloqueos para integrar

1. **Código de feature.** #90 usa `voice_orders` (id `…0007`). El catálogo
   reservado por #105 es `ai_voice_orders` (id `…0009`). Hay que cambiar #90 a
   `ai_voice_orders` y quitar su inserción de catálogo.
2. **Migración** `20261012120000_ai_voice_orders_foundation_v1`: hay que
   renombrarla a una versión posterior a la última de `main` (no está aplicada
   en ningún entorno).
3. **Conflictos** en `create-order-form.tsx` (#94 lo reescribe) y en
   `kiosk-supabase.yml`. Hay que integrarla **después** de #94.
4. **Pro**: cuando la voz exista, `early_access.voice_orders.status` debe
   derivarse de feature + disponibilidad técnica + rol, no del enrolamiento Pro.
   Hoy es fijo `planned`.
5. **Modelos**: el documento de #90 cita `gpt-transcribe` y `gpt-6-luna`. Hay que
   confirmar nombres, precios y región de datos con el proveedor antes de
   activarlo.

## Gates antes de cualquier coste real

| Gate | Contenido | Issue |
| --- | --- | --- |
| G1 Coste | Ledger y reserva atómica validados en Staging, con `platform.enabled=false` por defecto y kill switch probado | #81 |
| G2 Legal | DPA y subencargado del proveedor, aviso de micrófono y de tratamiento, retención 0 | #82 |
| G3 Seguridad | Aislamiento entre tenants, rol, feature, límite por usuario y tenant, validación MIME y tamaño en servidor, sin `tenant_id` del cliente | #79 |
| G4 Calidad | Entre 20 y 30 escenarios reales (fechas relativas, homónimos, servicios inexistentes, A3/A4, dos caras), con el proveedor `fake` y después con piloto controlado | #80, #82 |
| G5 UX | Safari/iOS, permiso denegado, sin micrófono, corte de red y cancelación. Nunca se guarda un pedido sin confirmación | #79 |

## Backlog ordenado

1. Rebase funcional de #90 sobre `main` (merge, sin force push) después de #94:
   - renombrar la feature y la migración;
   - SQL del presupuesto en el Release Gate.
2. Validación en Staging con proveedor `fake`:
   - flujo completo de grabar → borrador → revisión → crear pedido;
   - límites y kill switch.
3. Gate legal y confirmación del proveedor.
4. Piloto en Staging con proveedor real y presupuesto mínimo, solo con un tenant
   sintético.
5. Activación por tenant con `set_tenant_feature('<slug>','ai_voice_orders',true)`,
   con autorización expresa. Pro (#105) no la activa.

## Lo que no se hace en este sprint

No se ha activado ningún proveedor, no se ha generado ningún coste y no se ha
desplegado código de voz. El micrófono no se solicita en ninguna pantalla de
`main` ni de #105.
