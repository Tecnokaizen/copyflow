# Vistas de pedido: solo B y C (03/11/2026)

Decisión del propietario tras comparar A/B/C/D (#183): se mantienen **B · Pestañas** (gestión) y **C · Producción** (taller).

## Qué cambia

- `IMPLEMENTED_ORDER_DETAIL_VIEWS = ["tabs", "production"]`. Solo B y C se pueden previsualizar (`?vista=`), aplicar (`PATCH /api/settings/order-detail-view`) y usar.
- **A · Operativa** y **D · Híbrida** pasan a `RETIRED_ORDER_DETAIL_VIEWS`. Su código se conserva; no se borra nada.
- La **Ficha actual** (classic) deja de ofrecerse, pero sigue siendo el respaldo técnico para cualquier valor no disponible.
- Las preferencias guardadas **no se modifican**. Un tenant con A o D guardada ve la Ficha actual y, en Configuración › Vista de pedidos, un aviso que nombra la vista retirada (`retiredView`).
- Vista B en móvil (< 768 px): las cuatro pestañas en cuadrícula 2×2 (Trabajo | Cobro y entrega / Post-its | Secuencia de trabajo), sin scroll horizontal. Desde 768 px: una fila con subrayado. Teclado (←/→/Inicio/Fin), ARIA y táctil sin cambios.
- No hay migraciones, ni cambios de RLS ni de lógica financiera.

## Bloqueo antes de Production

Antes de publicar en Production hay que saber qué tenants tienen A o D guardadas, para avisarles: si no, verían la Ficha actual sin haberlo pedido. Consulta de solo lectura:

```sql
select coalesce(preferences->'order_detail_view_v1'->>'view','(ninguna)') as vista, count(*)
from tenant_settings group by 1;
```

Staging (03/11): 13 tenants sin vista guardada, `demo` con B. **Production: pendiente.** Mientras no se compruebe, la publicación queda bloqueada.
