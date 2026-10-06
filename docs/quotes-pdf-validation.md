# Presupuestos V1 — PDF + R2 / Document Preparation

Worktree existente: gestcopy-quotes-commercial-v1. Rama feat/quotes-commercial-v1.
Base UI: eb44c64b07f53b8ecb1120aff2d2a2f1a92af5c9.
Commit PDF core: 10c800de3f155269e25ac433ea917386f4b2c86e.
Validación final con Node 22.23.2. Sin push, merge, despliegue, R2 Production ni cambios en sources. No send, accept/reject, URL pública ni conversión comercial.

## Implementación

Migración aditiva: `20261005173000_quote_pdf_documents.sql`. Las tres migraciones comerciales anteriores están intactas.

RPCs:
- `quote_pdf_source_v1`: lectura RLS/SECURITY INVOKER; importes de versión, partidas y tax_breakdown como texto exacto.
- `reserve_quote_pdf_v1`: exige prepared/sent y capability backend, bloquea quote/version, reserva mediante create_quote_file_upload y cuota compartida existente.
- `finish_quote_pdf_v1`: capability complete; confirma ready + enlace + quote.pdf_generated en la misma transacción.

Ruta `POST /api/quotes/:id/versions/:versionId/pdf`: genera/reutiliza documento; solo devuelve metadata pública y endpoints locales.
Ruta `GET` en ese mismo path: preview autenticado mediante redirect firmado temporal; `?download=1` fuerza descarga. Siempre valida quote/version/file/tenant/ready/PDF/no borrado.

UI `QuotePdfDocument`, integrada en `QuoteCommercialEditor`: no PDF en draft; generar en prepared/sent sin documento; preview/descarga e indicador Documento preparado; cada histórico apunta a su endpoint de versión. Metadata de PDFs se obtiene en una consulta compartida, sin N+1. Los adjuntos oficiales no ofrecen borrar y la BD también lo impide.

Modelo y plantilla en `lib/quotes/pdf/`. Solo snapshots/version/items; ninguna nota interna ni contenido de React. React PDF 4.9.0 genera Buffer en runtime Node predeterminado. Noto Sans 400/700 local con licencia OFL. pdf-lib 1.17.1 numera páginas ya renderizadas, sin modificar timestamps. Determinismo byte a byte comprobado, incluso después de renderizar otro documento. Webpack confirma fuentes en tracing: 437 archivos, 7.939.905 bytes en el trazado de la ruta, incluyendo ambas WOFF.

## Idempotencia y fallos parciales

1. Si ya hay PDF enlazado ready válido, HEAD verifica objeto y se devuelve sin render ni nuevo cargo.
2. Antes de reservar, render Buffer y validar cabecera PDF. Render fallido no reserva cuota.
3. Una relación única quote_files.pdf_version_id serializa reservas por versión; las RPC usan el mismo orden quote -> version -> file. Reservas concurrentes devuelven el mismo ID/key.
4. R2 PUT condicional If-None-Match:* con SHA256 en metadata; no sobrescribe. HEAD verifica tamaño real, MIME, ETag y digest antes de confirmar.
5. Confirmación completa archivo y enlaza PDF una sola vez. Row versions y estados comerciales/documentales permanecen intactos. Activity solo en la primera confirmación.
6. Fallos R2/DB/timeouts conservan pending para retry. Si R2 escribió y DB falló, retry reutiliza HEAD. Si el commit se confirmó pero se perdió respuesta, retry detecta enlace y no duplica Activity.
7. Sin compensación destructiva ante resultados ambiguos. Pending no se enlaza. Reserva dura una hora; no se inicia PUT si quedan menos de 120 segundos (maxDuration ruta 60 s). Expirada, debe pasar por cleanup existente; después se puede reservar otro file ID. Ready oficial no es candidato de limpieza.
8. Quota usa bytes reales de Buffer y el lock file-quota existente: orders + quotes, pending + ready. No cuota/bucket/almacenamiento aparte.

## Resultados exactos

| Comprobación | Resultado |
| --- | --- |
| Tests completos | 870 total: 864 PASS, 0 FAIL, 6 SKIP |
| Quotes focalizados | 85/85 PASS |
| Nuevas pruebas de PDF/HTTP | 22/22 PASS, incluidas en las anteriores |
| Lint | PASS, 0 avisos/errores |
| TypeScript noEmit | PASS |
| Build Webpack | PASS |
| Build normal/Turbopack | No completado: EPERM al crear proceso/puerto de PostCSS; también tras solicitar ejecución ampliada |
| Migraciones desde cero | PASS en PostgreSQL Docker aislado 127.0.0.1:55422 |
| Suites SQL completas | 36/40 PASS; 4 fallos idénticos a baseline previo |
| SQL comercial phase40 | PASS; se actualizó la antigua expectativa que permitía PDF pending en draft, ahora prohibida |
| SQL PDF phase41 | PASS: auth, snapshots, decimales exactos, cuota, enlace, borrado, cleanup/retry y Activity |
| Concurrencia SQL phase35 | PASS cuota compartida quote/order; limpieza de fixtures correcta |
| Concurrencia SQL phase40 | PASS: 8 ensures, 2 saves en conflicto, 24 clones |
| Concurrencia SQL phase41 | PASS: 8 reservas + 8 confirmaciones, 1 archivo ready, 100 bytes reservados, 1 Activity |
| Smoke adaptador R2 | 7/7 PASS contra S3 HTTP double local; 1 PUT final; ninguna escritura cloud |
| Smoke UI | 278 comprobaciones PASS, 390/768/1280, claro/oscuro, componentes y CSS reales con HTTP doubles |
| PDF ANFRE | 1 página; base 520,66 + IVA 109,34 = 630,00 EUR |
| PDF extenso | 160 partidas en 17 páginas, total 25.200,00 EUR |
| Visual PDF | Logo, tipografía embebida, márgenes, tabla, totales, saltos y numeración revisados; ninguna nota/ID interno/key |
| Git diff --check | PASS |

Los 6 SKIP corresponden al harness de búsquedas que requiere PostgREST local. También se intentó contra 127.0.0.1:55421; servicio no disponible. No son pruebas PDF/Quotes.

Las cuatro suites SQL preexistentes, contrastadas con `/private/tmp/quotes-resume-sql.json`, fallan por:
- phase11_invitation_team_member_bootstrap: min(uuid) inexistente.
- phase2a_users_permissions: espera 42501 y recibe GTI01.
- phase7_team_roles_operative: not authenticated.
- quick_order_layout_v1: fixture requerida ausente.

## Evidencia

Directorio externo al worktree: `../output/quotes-pdf-20261006/`.
- PDF fixtures, PNGs de páginas y verification.json en `pdf/`.
- Screenshots y results.json del smoke en `quotes-pdf-ui/`.
- Logs de pruebas, lint, builds, reset, SQL/concurrencia, R2 y auditoría de dependencias.
- `sql-baseline-comparison.json` y `bundle-trace.json`.

Los ejemplos ANFRE/GC son únicamente fixtures. No hay datos de ejemplo hardcodeados en el producto.

## Limitaciones y siguiente bloque

- No hay smoke contra un bucket cloud de test configurado; el adaptador R2 sí se ejercitó por HTTP contra un proveedor simulado local.
- Los snapshots ya preparados no se enriquecen con configuración fiscal actual. Snapshot con logo retirado o WebP produce error explícito. El soporte PNG/JPEG evita fetch externo y mantiene la identidad congelada.
- npm audit detecta 10 avisos (9 high, 1 critical) en dependencias preexistentes. Todas sus versiones coinciden con eb44c64; ninguno corresponde a React PDF/pdf-lib. Conviene tratar esa deuda antes de publicación.
- Turbopack y las limitaciones de harness/SQL legacy siguen pendientes de su entorno/deuda previa. Webpack y los checks documentales pasan.
- Próximo bloque: transición Send + Accept/Reject, con autorización, estados y eventos explícitos por versión.
