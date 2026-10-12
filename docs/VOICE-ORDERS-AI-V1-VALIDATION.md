# Voice Orders AI V1 — validación

Fecha: 2026-10-12 · Rama: `feature/ai-voice-orders-v1` · Base: `main@58525fb`

## Comandos ejecutados

```bash
TZ=UTC node --import tsx --test lib/ai/**/*.test.ts lib/ai/**/**/*.test.ts
npx tsc --noEmit
```

Resultado unitario: 16 tests OK (pricing, access, audio, apply-draft, resolve-due, security contracts).

## No ejecutado en este entorno

- `supabase db reset` + `phase46_ai_voice_budget.sql` / concurrency (requiere Postgres local).
- Smoke Playwright con micrófono real / iOS Safari / PWA.
- Compatibilidad en vivo de `gpt-6-luna` + `json_schema` strict (sin API key).
- Tope de gasto en el dashboard del proveedor (paso de operador).

## Limitaciones conocidas

- Feature y kill switch de plataforma arrancan desactivados.
- No hay variables ni keys en Production.
- Piloto solo con datos sintéticos hasta gate legal RGPD.
- El presupuesto es control interno / base de add-on; no hay precios Stripe.

## Rollback

Ver [VOICE-ORDERS-AI-V1.md](./VOICE-ORDERS-AI-V1.md).
