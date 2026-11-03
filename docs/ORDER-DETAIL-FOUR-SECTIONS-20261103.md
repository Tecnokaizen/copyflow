# Reorganización de la ficha de pedidos — vista B · Pestañas

**Fecha:** 2026-11-03  
**Estado:** rama de revisión; PR en borrador. **No desplegar producción ni fusionar sin aceptación.**

## Alcance

Esta propuesta deriva de `feat/order-finance-tracking-20261103` (PR #181), que integra el seguimiento visual de #153 y los campos financieros. No modifica la arquitectura, las APIs, las migraciones, la contabilidad ni las otras cuatro vistas: `classic`, `operational`, `production`, `hybrid`.

Solo reorganiza `TabsOrderLayout` (vista B) de cinco pestañas a cuatro:

| Nueva sección | Módulos existentes |
| --- | --- |
| **Trabajo** | `sourceQuote`, `summary`, `production`, `files` |
| **Cobro y entrega** | `fulfillment` (cobros, importe total, anticipo, saldo, entrega) |
| **Post-its** | `pinnedNotes`, `stickyNotes`, `legacyNotes` |
| **Secuencia de trabajo** | `sequence`, `tracking`, `activity` |

Los módulos se crean una única vez y los paneles permanecen montados aunque ocultos: subir archivos, editar notas, modificar importes y consultar el seguimiento conservan estado. La cabecera, avisos y diálogos siguen fuera de la navegación. El botón de cabecera «Añadir nota» abre ahora Post-its para revelar el editor. La navegación por teclado conserva flechas, Inicio, Fin, foco y atributos ARIA.

## Compatibilidad y pruebas

- Sin migraciones ni cambios en `tenant_id`, RLS, roles, registros financieros ni lógica de negocio.
- Tests de contrato de vistas actualizados: cuatro paneles, uno visible, todos los módulos una vez, orden, acción «Añadir nota».
- Browser smoke del seguimiento ajustado para seleccionar «Secuencia de trabajo» cuando la vista es Pestañas, revisar visibilidad y producir captura 390/1280.
- Validar en CI `node --import tsx --test`, TypeScript, lint, build y browser smoke de Pedido V2. No declarar PASS hasta que la ejecución remota confirme resultado.
- Comprobar en Staging con datos de prueba: escritorio, móvil, claro/oscuro, carga de archivos activa, edición de pedido, anticipos, post-its (componer y fijar), secuencia y seguimiento.
- Configuración `vercel.json`: despliegue automático desactivado para esta rama, al igual que para la PR #181. El ensayo en Staging debe realizarse **manualmente y de forma controlada**, cuando exista el destino seguro.
- Las capturas estáticas antiguas de la vista Pestañas en Ajustes se ocultan porque no representan este rediseño. Sustituirlas por capturas validadas antes de aceptación.

## Decisión de publicación

Rama independiente y PR de revisión contra `feat/order-finance-tracking-20261103`, no contra `main`: permite evaluar el diseño junto al contenido financiero/seguimiento del PR #181 sin adelantar ni fusionar ninguno. Antes de integrarlo, obtener aprobación de la experiencia de usuario en Staging; después preparar una integración controlada en `main`.
