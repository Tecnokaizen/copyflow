# B1.3 · Recuperación completa con los esquemas privados (19/10/2026)

**Estado:**

- Corrección del código en la PR de B1.3, con Release Gate y simulacros locales en verde.
- **Pendiente de despliegue:** el runner de Coolify y un lote nuevo.
- Production no se ha modificado.
- #135 y #136 siguen bloqueadas hasta acreditar una recuperación completa con un lote nuevo.

## 1. Diagnóstico

**Simulacro real del 19/10:**

- El lote supera SHA-256 y se descifra.
- Con Supabase CLI 2.121.0 y Auth v2.197.0, la restauración llega a `application post-data` y falla con `ERROR: schema "imports_private" does not exist`.

**Reproducido en local** con los scripts de `main`, sobre una base con todas las migraciones y un destino Supabase vacío:

```
pg_restore: error: could not execute query: ERROR:  schema "imports_private" does not exist
Command was: CREATE TRIGGER clients_import_origin_guard BEFORE INSERT OR UPDATE OF source_system, source_record_id, import_batch_id ON public.clients FOR EACH ROW EXECUTE FUNCTION imports_private.guard_client_origin();
```

**Causa:** `infra/backup-runner/scripts/backup-database.sh` volcaba la aplicación con `--schema=public` y nada más. Las migraciones posteriores crearon esquemas propios que nunca entraron en el lote. `public` depende de ellos: el trigger anterior y la FK `public.clients → imports_private.client_import_batches`.

**Alcance:**

- Todos los lotes `version: "1"` de B2 tienen solo `public`.
- Les faltan los datos de las tablas privadas: lotes y filas de importación de clientes, la cola y los eventos de borrado de Storage, y los límites y permisos del kiosco.
- No permiten una recuperación completa.
- B2 conserva esos lotes sin cambios (Object Lock).

**Hallazgos adicionales** de la auditoría y del nuevo control:

1. `USAGE` sobre el esquema `public` para `PUBLIC` se perdía en cualquier restauración que borra y recrea `public`, también antes de este cambio. PostgreSQL 15+ guarda ese permiso como privilegio inicial (`pg_init_privs`) y `pg_dump` nunca lo emite. La huella de recuperación lo detectó.
2. Faltaba el requisito externo `kiosk_signing_secret` de Vault. Solo constaba `files_signing_secret`.
3. En `backup-runner.runtime.test.sh`, 30 aserciones negativas (`! grep …`, `! remote_has_manifest`) no comprobaban nada: bajo `set -e` un `! cmd` nunca detiene el script. Ahora usan `refute`, y una prueba de mutación confirma que fallan cuando deben.

## 2. Auditoría de esquemas

Esquemas del catálogo con todas las migraciones (`main` más D2 y D1):

| Esquema | Propietario | Tablas | Funciones | Dependencias |
| --- | --- | --- | --- | --- |
| `public` | `pg_database_owner` | 39 | 192 (140 SECURITY DEFINER) | FK a `auth.users`; trigger y FK hacia `imports_private` |
| `files_private` | `postgres` | 2 | 9 (2 SECURITY DEFINER) | `storage_deletion_events → storage_deletions` |
| `imports_private` | `postgres` | 2 | 11 | FK a `public.tenants`; `public.clients` depende de él |
| `kiosk_private` | `postgres` | 2 | 8 (5 SECURITY DEFINER) | FK a `public.tenants` |
| `billing_private` (D2/D1) | `postgres` | 2 | (D2/D1) | `internal_subscription_audit`, `subscription_holds`; se descubre sin tocar el runner |

**Esquemas de plataforma, fuera del artefacto de aplicación:**

- `auth`: tiene su propio artefacto, solo datos.
- `supabase_migrations`: tiene su propio artefacto.
- `storage`, `realtime`, `_realtime` (también es de `postgres`; por eso la clasificación no puede basarse en el propietario), `vault`, `extensions`, `graphql`, `graphql_public`, `pgbouncer`, `supabase_functions` y los de extensiones opcionales.

**Sin objetos de Gestcopy fuera de estos esquemas:**

- ningún trigger sobre `auth.users`;
- ninguna política ni bucket en `storage`;
- ningún `cron`;
- ninguna publicación.

**Requisitos externos:**

- secretos de Vault `files_signing_secret` y `kiosk_signing_secret`;
- trigger de eventos de RLS automático (`ensure_rls`);
- extensiones `pg_trgm` (en `extensions`) y `pgcrypto`;
- configuración de Auth y de la API.

## 3. Corrección

Detalle técnico en `infra/backup-runner/README.md` § Application schemas.

- **`scripts/recovery-contract.sh`** (nuevo; lo usan los dos scripts):
  - Descubre en el snapshot todos los esquemas que no son de PostgreSQL ni de Supabase. Un esquema nuevo entra solo, sin tocar el runner.
  - Exige la base `public`, `files_private`, `imports_private` y `kiosk_private`.
  - Calcula la **huella de recuperación** por esquema: filas exactas, RLS, políticas, funciones y SECURITY DEFINER, triggers, restricciones y FK, índices, vistas, tipos, secuencias y ACL de los roles no administrativos. Solo guarda recuentos y hashes, nunca datos.
- **`backup-database.sh`:**
  - Descubrimiento y huella se hacen dentro de la misma transacción del snapshot.
  - `pg_dump --strict-names` con todos los esquemas de aplicación.
  - El archivo debe contener exactamente esos esquemas y el mismo número de tablas que el catálogo. Si no, falla antes de cifrar, sin subir nada y sin manifiesto.
  - Manifiesto `version: "2"` con `application_schemas`, `recovery_contract` y `kiosk_signing_secret`.
- **`restore-database-local.sh`:**
  - `--manifest` obligatorio. Rechaza los lotes v1 y los incompletos.
  - Antes de tocar el destino, exige que el archivo coincida con los esquemas y tablas declarados.
  - Exige la misma versión mayor de PostgreSQL.
  - Reinicia todos los esquemas de aplicación y recrea `public` con su privilegio inicial.
  - Restaura por secciones en el orden de dependencias entre esquemas.
  - Compara la huella del destino con la del manifiesto. Cualquier diferencia impide el marcador de éxito.

**Se mantiene:**

- los tres artefactos lógicos;
- el snapshot compartido;
- `age` y el manifiesto subido en último lugar;
- SHA-256;
- `copyto` aditivo, sin `sync` ni borrados;
- los cerrojos contra Production;
- la exclusión de `auth.schema_migrations`;
- el filtro de `DEFAULT ACL` de `supabase_admin`;
- un único runner global, sin artefactos por tenant.

**Simulacro en el Release Gate:** job nuevo `Backup recovery (B1.3)` en cada PR.

- Pruebas de comportamiento con herramientas simuladas.
- Simulacro completo con `pg_dump` y `pg_restore` reales: dos pilas locales, clave `age` desechable y remoto `rclone` local.

## 4. Validación

| Prueba | Resultado |
| --- | --- |
| Reproducción con los scripts de `main` | Falla en post-data por `imports_private`, igual que el simulacro real |
| Simulacro completo con migraciones de `main` | **8/8.** Se descubren `files_private`, `imports_private`, `kiosk_private` y `public`; `RESTORE_DATABASE_ISOLATED_SUCCESS` con la huella coincidente |
| Simulacro completo con migraciones de D1 (incluye `billing_private`) | **9/9.** `billing_private` se descubre automáticamente y se restaura con sus filas de auditoría |
| Lote v1 (solo `public`) | Rechazado antes de tocar el destino |
| Archivo sin `imports_private`, con manifiesto v2 | Rechazado antes de tocar el destino |
| Manifiesto sin `imports_private` | Rechazado antes de tocar el destino |
| Comprobación independiente (huella del origen vivo frente al destino) | Idéntica en todos los esquemas: filas, RLS, políticas, ACL, SECURITY DEFINER, triggers, FK e índices |
| Datos y aislamiento | Filas privadas, trigger y FK entre esquemas y usuario de Auth restaurados; `anon` y `authenticated` sin `USAGE` en los esquemas privados, igual que en el origen |
| Comportamiento (`backup-runner.runtime.test.sh`) | 71/71 (antes 59), con las nuevas negativas: esquema requerido ausente, archivo sin un esquema, tablas distintas del catálogo, manifiesto v1 o incompleto, esquema no declarado, versión mayor distinta y huella distinta |
| Contrato estático (`backup-runner.test.ts`) | 10/10. Todo esquema creado por una migración se descubre; ninguno se trata como de plataforma |

## 5. Despliegue controlado (preparado, no ejecutado)

Lo ejecuta el propietario, porque requiere acceso a Coolify.

1. **Merge de la PR de B1.3.**
   - Vercel despliega Production, pero no cambia nada de la app.
   - No hay migraciones.
2. **Coolify:** redesplegar el recurso del backup runner desde `main` (Base Directory `/infra/backup-runner`).
   - No cambian las variables, las tareas programadas ni el horario.
   - `GESTCOPY_CATALOG_QUERY_TIMEOUT_SECONDS` es opcional; por defecto, 600.
3. **Lote nuevo:** ejecutar una vez la tarea «Gestcopy Database Backup» (`/app/scripts/backup-database.sh`), o esperar a la siguiente franja (`27 */6 * * *`). El log debe mostrar:
   - `application schemas files_private,imports_private,kiosk_private,public`;
   - `DATABASE_BACKUP_SUCCESS`.

   **No sobrescribe nada:**
   - cada lote va en `database/AAAA/MM/DD/<timestamp>/`;
   - la subida es aditiva (`copyto`);
   - B2 aplica Object Lock Compliance durante 30 días.
4. **Si falla:**
   - El error indica el motivo: un esquema requerido ausente, un archivo incompleto o un tiempo de espera del catálogo.
   - Vuelta atrás: redesplegar la imagen anterior en Coolify.
   - El runner anterior sigue produciendo lotes v1, incompletos.
5. **Comprobar el lote:** `~/copyflow-ops/restore-drill/run-drill.sh verify` debe mostrar `manifiesto v2 · esquemas: …`.
6. **Simulacro completo:** `AGE_IDENTITY=… ./run-drill.sh full`.
   - `run-drill.sh` ya está actualizado para manifiestos v2. La versión anterior se conserva como `run-drill.sh.v1-2026-10-16`.
   - Antes del merge, usar `REPO=<copia con la rama de B1.3>` para construir la imagen corregida.
   - Resultado esperado: `recovery fingerprint matches for …` y `RESTORE_DATABASE_ISOLATED_SUCCESS`.
7. **Con D2 en Production:** `billing_private` aparece solo en el siguiente lote. Comprobarlo en el manifiesto antes de dar por buena la secuencia de D2/D1.

**Riesgo hasta el primer lote v2:** los lotes de B2 no permiten una recuperación completa (§ 1). Conviene desplegar el runner corregido cuanto antes.
