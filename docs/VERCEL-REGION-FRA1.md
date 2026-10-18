# Funciones de Vercel en `fra1`

Fecha: 16/10/2026. Base: `main` `0877199`.

## Cambio

`vercel.json` → `"regions": ["fra1"]`. Las funciones pasan de `iad1` (Washington) a `fra1` (Fráncfort), la misma zona que la base de datos de Production (eu-central-1).

- Afecta a Production y a las Previews desde el siguiente despliegue.
- El cron (`/api/internal/files/cleanup`, 03:15 UTC) se ejecuta en la nueva región.
- No cambia el código ni las variables de entorno.
- Hobby ya permite elegir una región, así que el cambio no depende de pasar a Pro.

## Mediciones (16/10/2026)

**Método:**

- Dos Previews con el mismo código en ejecución: `iad1` (`ed81045`) frente a `fra1` (`975ab42`).
- Los mismos datos de Staging (tenant sintético `e2e`, usuario de solo lectura).
- Solo peticiones GET, 25 rondas intercaladas tras 3 de calentamiento, desde Madrid (borde de Vercel `cdg1`).
- La región se confirma con `x-vercel-id`. El navegador solo podía llegar a la Preview y al Supabase de Staging.

| Endpoint | p50 `iad1` | p50 `fra1` | p90 `iad1` | p90 `fra1` | Mejora p50 |
| --- | --- | --- | --- | --- | --- |
| `/api/context` | 1173 ms | 620 ms | 1546 ms | 780 ms | −47 % |
| `/api/dashboard` | 1306 ms | 691 ms | 1733 ms | 901 ms | −47 % |
| `/api/orders` | 1275 ms | 579 ms | 1757 ms | 714 ms | −55 % |
| `/api/clients` | 956 ms | 443 ms | 1244 ms | 568 ms | −54 % |

Todas las respuestas fueron 200. El HTML de `/orders` lo sirve la caché del borde (TTFB ~30 ms en ambos casos), así que no cambia.

**Production:** la base de datos de Staging está en Irlanda (eu-west-1). En Production, con la base de datos en Fráncfort, la mejora debería ser igual o mayor.

**Referencia anónima de Production antes del cambio (`iad1`), 15 muestras:**

| Ruta | p50 | p90 |
| --- | --- | --- |
| `/api/context` (401 sin sesión) | 317 ms | 374 ms |
| `/auth/login` | 216 ms | 278 ms |

## Procedimiento (requiere autorización)

1. **Antes del merge:**
   - revalidar el HEAD de la PR, el CI en verde y que `main` no haya cambiado;
   - anotar el despliegue de Production vigente, que es el punto de vuelta atrás.
2. Merge fijado al HEAD.
3. Esperar el Release Gate de `main` y el despliegue de Production (READY).
4. **Comprobaciones:**
   - `x-vercel-id` de `https://sur4.app.gestcopy.com/api/context` contiene `::fra1::`;
   - `/auth/login` responde 200 y `/api/context` sin sesión responde 401 `SESSION_EXPIRED`;
   - repetir la referencia anónima (15 muestras) y comparar;
   - logs de Supabase y de Vercel sin errores nuevos durante 30 minutos;
   - E2E de Staging desde `main`.
5. Al día siguiente, comprobar que el cron de las 03:15 UTC se ejecutó, en los logs de Vercel.

## Recuperación

| Situación | Acción |
| --- | --- |
| Problema inmediato | Instant Rollback en Vercel al despliegue anterior (disponible en Hobby para el inmediatamente previo). Vuelve a `iad1` sin redesplegar |
| Volver atrás de forma permanente | Revertir la PR (`git revert`) y esperar el nuevo despliegue de Production en `iad1` |

No hay datos ni esquema implicados: la vuelta atrás es completa.

## Riesgos

**Arranques en frío:** iguales en ambas regiones.

**Servicios externos:**

| Servicio | Efecto |
| --- | --- |
| Supabase | Más cerca |
| R2 | Global |
| Resend | Más cerca (eu-west-1) |
| Stripe | Sin cambio relevante |

**Staging:** las Previews también pasan a `fra1`. Con la base de datos de Staging en Irlanda siguen mejorando, como se ha medido.
