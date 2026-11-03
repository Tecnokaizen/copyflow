# Gestcopy · comparación de fichas A/B/C/D con trabajo reagrupado
**Fecha:** 03/11/2026  
**Estado:** propuesta de evaluación UX. No desplegar Production.

## Motivo
La ficha se percibe fragmentada: Resumen, Trabajo y Archivos forman parte del mismo trabajo y deben consultarse como un bloque cohesionado, sin afectar a los cobros, notas, archivos ni seguimiento visual.

## Qué incluye esta rama
Deriva de la versión combinada de PR #181 y PR #182, sin modificar ninguna de las dos ramas. **La B (Pestañas) ya incluye el agrupamiento; no se retoca.** Se conserva la vista Clásica como referencia intacta y se reorganizan:

| Vista | Diferencia preservada | Bloque reagrupado |
|---|---|---|
| **A · Operativa** | Cabecera compacta; cobro a la derecha en escritorio | Resumen → Trabajo → Archivos en columna principal |
| **B · Pestañas** | Cuatro pestañas | Trabajo (incluye Resumen + Trabajo + Archivos), Cobro y entrega, Post-its, Secuencia |
| **C · Producción** | Secuencia y tablero primero; administración plegada | Resumen → Trabajo → Archivos juntos debajo del tablero |
| **D · Híbrida** | Tablero primero y secuencia/notas en paralelo en escritorio | Resumen → Trabajo → Archivos en columna principal, con cobro a la derecha |

El componente de presentación `WorkGroup` solo coloca los módulos ya construidos, una vez cada uno. Sin nuevos tabs internos, nuevas APIs, operaciones SQL ni cambios en permisos. Post-its y progreso visual se conservan y permanecen visibles o desplegables según la personalidad de cada vista.

## Pruebas de aceptación
- CI de PR (unitarias, tipos, lint, build, pruebas de módulos, pruebas E2E) debe estar verde.
- Comparar A/B/C/D en **el mismo pedido de prueba**, sin cambiar la vista activa del equipo, usando `/orders/<id>?vista=operational|tabs|production|hybrid` como Owner/Admin.
- Revisar a 390, 820 y 1280 px; claro y oscuro, sin scroll horizontal ni módulos duplicados.
- Probar carga de archivos y cambio de bloque, edición de campos, envío de nota, cobros y anulación, seguimiento visual de estados y actividad.
- Conservar la vista Clásica sin cambios.
- Registrar capturas de las cuatro alternativas y decidir cuáles mantener, simplificar o retirar. **No eliminar opciones ni alterar configuración por tenant antes de decidir.**
- No utilizar base ni secretos de Production. Si se autoriza un Preview manual, debe usar exclusivamente el entorno Supabase Staging, con acceso protegido; Git auto-deployment desactivado para esta rama.

## Trazabilidad
PR #181: seguimiento visual y gestión económica.  
PR #182: vista B reagrupada en cuatro pestañas.  
Esta rama: visualización conjunta del trabajo en A/C/D, B conservada.  
**No fusionar PRs ni desplegar Production hasta que se acepte la UX.**
