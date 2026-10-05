# Presupuestos V1: auditoría Files/R2 previa

Base: eb44c64, rama feat/quotes-commercial-v1. Infraestructura compartida según sources/Arquitectura inmutable de Copyflow.md; SUR4 es referencia funcional.

- `quote_files` y `order_files` guardan metadata; un bucket R2 privado compartido (`lib/storage/r2.ts`). No blobs ni buckets adicionales.
- INIT autentica/autoriza y firma capability HMAC (secret de backend/Vault, vigencia 120s). RPC create reserva tamaño declarado en estado pending; URL PUT firmada temporal. COMPLETE verifica HEAD (tamaño/MIME/ETag), capability complete y cambia a ready. Descarga/preview autentican, filtran tenant/parent/file/ready/deleted y firman GET temporal. DELETE usa capability y soft delete antes del borrado de R2.
- Keys: `quotes/{tenant}/{quote}/{file}` y `orders/{tenant}/{order}/{file}`. Las respuestas públicas excluyen key.
- Cuota: `tenant_storage_usage` suma pending + ready de ambas tablas. INIT serializa bajo `file-quota:{tenant}` y aplica límite de archivo, límite de plan/tenant y techo de plataforma 100 MiB.
- Triggers restringen mutaciones e identidad; activity registra upload y delete. RLS permite únicamente roles operativos con feature quotes. Nuevas versiones solo SELECT para authenticated, mutaciones RPC.
- Cleanup cron protegido por CRON_SECRET usa createAdminClient/service_role exclusivamente para mantenimiento existente. Lee pending expirados, valida key, borra objeto y después purga metadata. Un fallo de R2 conserva fila para retry.
- Actualmente pdf_file_id tiene FK compuesta tenant/quote/file, pero no valida ready/MIME y el guard de versiones bloquea cualquier UPDATE prepared. No existe protección documental frente al soft delete de adjuntos.
- Branding seguro existente: `branding.logo.storage_key`, prefijo `branding/{tenant}/logo/`, validación de tamaño y formato. `logo_url` legacy no autoriza fetch externo. PDF solo puede embeber PNG/JPEG del branding snapshot, nunca descargar URLs arbitrarias.

## Diseño adoptado

Render desde versión bloqueada e items + snapshots, antes de reservar. Reserva RPC bajo quote/version y cuota existente, con relación única file -> version. Reutiliza create_quote_file_upload y COMPLETE dentro de una transacción que completa/enlaza/activity. Escritura condicional R2 If-None-Match evita sobrescribir en concurrencia; retries usan HEAD y SHA256 del objeto. No se devuelve capability PUT de PDFs al navegador. Sin nuevos usos de service_role.

La reserva pending dura una hora. Fallos de proveedor o confirmación conservan reserva/objeto para retry. No se borra a ciegas después de un error de confirmación ambiguo. Expirada, no se renueva: el cleanup existente elimina el temporal y un intento posterior reserva otro ID. El archivo oficial ready nunca es candidato de cleanup ni borrable manualmente.

Configuración fiscal mínima: `tenant_settings.preferences.quote_document` admite tax_id, billing_address, email y phone; se captura al preparar en seller_snapshot. Versiones ya preparadas conservan su snapshot anterior, sin rellenarlo con datos vivos. Plantilla fija `commercial-v1`. Sin settings UI adicional.

## Detalles finales de implementación

- `quote_pdf_source_v1` es SECURITY INVOKER y conserva numeric como texto en cabecera, partidas y tax_breakdown, evitando conversión IEEE-754 de PostgREST. Host/tenant se comprueba además en HTTP; RPC solo lee filas autorizadas por RLS.
- Noto Sans Latin 400/700 se incluye como WOFF local con licencia OFL y trazado explícito de archivos para Vercel. El renderer solo se importa en servidor. Se mantiene React PDF 4.9.0; la prueba con 4.3.1 reprodujo el fallo del contador dinámico y perdió determinismo. La paginación principal sigue en React PDF. `pdf-lib` 1.17.1 añade únicamente los números a páginas ya renderizadas (`updateMetadata:false`), conservando el PDF determinista. Se reprodujeron coordenadas inválidas y contadores vacíos antes del cambio; fixtures finales 1 y 17 páginas revisadas.
- Una operación no inicia PUT si quedan menos de 120 segundos de reserva; la ruta tiene maxDuration 60 s. Esto evita completar/escribir reservas próximas al cleanup. No se renuevan reservas expiradas.
- La confirmación no incrementa row_version comercial ni operativo. Nunca cambia estados a sent.
- Los PDFs oficiales aparecen protegidos en el DTO de adjuntos y la UI no ofrece borrado. El trigger lo rechaza también si se llama directamente al flujo manual.
- Los snapshots anteriores pueden carecer de NIF/dirección del emisor; no se rellenan desde configuración viva. Si un logo snapshot fue retirado del almacenamiento antes de generar el documento, se devuelve error explícito; no se sustituye por otro logo. WebP requiere una mejora posterior de normalización.
- R2 real de test no está configurado: smoke del adaptador AWS contra servidor S3 HTTP local con credenciales ficticias. No se utilizó R2 Production.
