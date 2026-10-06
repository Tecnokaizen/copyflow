# Presupuestos: transiciones comerciales

6 octubre 2026. Node 22.23.2. Base local aislada quotes-commercial-v1, 127.0.0.1:55422. Sin acceso a servicios cloud.

Bloque 1: 879 tests, 873 PASS, 0 FAIL, 6 SKIP del harness PostgREST previo. SQL 37/41 PASS: permanecen los cuatro fallos documentados previamente (phase11 min(uuid), phase2a GTI01, phase7 auth, quick_order fixture). Phase33/34 adaptan el contrato de cambio de estado a la RPC; phase40 simula estados legacy con trigger suspendido solo dentro de su transacción de fixtures.

Phase42 SQL PASS: envío prepared con PDF oficial ready, idempotencia con token anterior, aceptación exacta, rechazo, versiones históricas, draft tras rechazo, accepted estable, aislamiento, viewer y feature off. Concurrencia: ocho sends -> un cambio de estado y siete replays; accept vs reject -> un ganador y un conflicto, dos activities totales incluyendo send. Se conserva quote -> version -> file como orden de locks.

HTTP send/accept/reject requiere version_id y expected_row_version del quote. Replay solo para la misma current_version; nunca aplica una petición antigua a una nueva versión. PATCH rechaza status_id/accepted_version_id/converted_order_id/current_version_id. UPDATE(status_id) revocado de authenticated; RPC genérica solo draft/pending/expired desde estado editable. Trigger también bloquea INSERT de estados comerciales y mutación de accepted_version_id. Labels siguen siendo del catálogo tenant.

UI: 392 assertions PASS, tamaños 390/768/1280, light/dark, componentes y CSS reales con HTTP doubles. Capturas revisadas. Confirmación send aclara que no envía correo. Accepted muestra la versión exacta; no ofrece Nueva versión.

Lint, tsc --noEmit, build Webpack, git diff --check PASS. Migraciones desde cero PASS, incluyendo 20261006100000. No regresiones nuevas en suites SQL; deuda previa no resuelta en este alcance. La gate del bloque comercial está verde; no se interpreta como una afirmación de que la suite SQL histórica completa esté verde.
