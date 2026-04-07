

# Plan: Profesionalizar el Sistema Exentry Imports v6.0

## Resumen

Mejoras integrales en arquitectura, UX, seguridad y funcionalidad para llevar el sistema a nivel comercial/revendible.

---

## Fase 1 — Arquitectura y Calidad de Código

**Componentizar las páginas monolíticas.** Actualmente cada página (Dashboard 435 líneas, ProductsPage 276, SalesPage 231, etc.) tiene formularios inline y lógica mezclada. Extraer:
- Componentes de formulario reutilizables: `SaleForm`, `PurchaseForm`, `ProductForm`, `DebtPaymentForm`
- Componentes de tabla reutilizables: `DataTable` genérico con sorting, paginación y búsqueda integrada
- KPI cards como componente independiente: `KPICard`
- Dashboard charts como componentes separados: `SalesChart`, `CategoryPieChart`, `GaugeChart`, `MonthlyTrendChart`

**Custom hooks por dominio:** `useProducts`, `useSales`, `usePurchases`, `useDebts`, `useSettings` — encapsulan la lógica de carga, CRUD y estado, reemplazando los `useState`/`useEffect` repetitivos en cada página.

**Eliminar `any` types.** Reemplazar todos los `any` por interfaces tipadas (ya existen en `types.ts` pero no se usan en las páginas reales).

---

## Fase 2 — Funcionalidades Faltantes Críticas

1. **Edición de ventas y compras.** Actualmente solo se pueden crear y eliminar, no editar. Agregar modal de edición con recalculación de stock y ganancias.

2. **Confirmación antes de eliminar.** Ningún módulo tiene diálogo de confirmación al borrar registros. Agregar `AlertDialog` en todas las acciones destructivas.

3. **Paginación real en tablas.** Todas las tablas cargan todos los registros sin paginación. Implementar paginación client-side con 20-50 items por página.

4. **Filtros por fecha en ventas, compras y deudas.** Agregar date range picker para filtrar por período (hoy, esta semana, este mes, personalizado).

5. **Búsqueda global.** Agregar command palette (Ctrl+K) para buscar productos, clientes y ventas desde cualquier parte del sistema.

6. **Password reset.** El auth no tiene flujo de recuperación de contraseña. Crear página `/reset-password` y botón "Olvidé mi contraseña" en AuthPage.

---

## Fase 3 — Dashboard y Reportes Avanzados

1. **Filtros temporales en Dashboard.** Actualmente muestra todos los datos acumulados. Agregar selector de período (7d, 30d, 90d, YTD, personalizado).

2. **Comparativa de períodos.** "Este mes vs mes anterior" con indicadores de variación porcentual (flechas verde/rojo).

3. **Reporte de rentabilidad por producto.** Tabla con ranking de productos por margen, ROI individual y velocidad de rotación.

4. **Reporte impositivo detallado.** Cuando impuestos están activos, generar desglose mensual de IVA, IIBB y Monotributo para facilitar declaraciones.

---

## Fase 4 — UX y Pulido Visual

1. **Loading skeletons.** Reemplazar spinners genéricos por skeleton loaders que reflejen la estructura de cada página.

2. **Empty states con ilustración.** Reemplazar los textos planos "No hay ventas" por empty states con ícono, mensaje descriptivo y CTA.

3. **Breadcrumbs.** Agregar breadcrumbs en páginas internas para mejorar la navegación.

4. **Sidebar colapsable en desktop.** Permitir colapsar el sidebar a solo íconos para ganar espacio.

5. **Dark/Light mode toggle.** Agregar opción de tema claro en Ajustes (actualmente solo dark).

6. **Animaciones de transición.** Agregar transiciones suaves entre páginas y al abrir/cerrar modales.

---

## Fase 5 — Seguridad y Admin

1. **Ocultar Admin del sidebar para no-admins.** Actualmente todos ven el enlace Admin. Verificar rol antes de mostrar.

2. **Protección de ruta Admin.** Agregar guard en la ruta `/admin` que verifique `has_role` antes de renderizar.

3. **Audit log.** Tabla `audit_logs` que registre acciones críticas (eliminaciones, cambios de precio, modificaciones de settings) con timestamp y user_id.

4. **Validación de formularios.** Agregar validación con mensajes de error claros en todos los formularios (campos requeridos, rangos numéricos, formato de email).

---

## Detalles Técnicos

### Archivos nuevos principales
- `src/components/shared/DataTable.tsx` — tabla genérica con sort/paginación
- `src/components/shared/KPICard.tsx` — card de métricas
- `src/components/shared/ConfirmDialog.tsx` — diálogo de confirmación
- `src/components/shared/DateRangePicker.tsx` — selector de rango de fechas
- `src/components/shared/CommandPalette.tsx` — búsqueda global
- `src/components/shared/SkeletonLoaders.tsx` — skeletons por módulo
- `src/hooks/useProducts.ts`, `useSales.ts`, `usePurchases.ts`, etc.
- `src/pages/ResetPasswordPage.tsx`

### Migración de base de datos
- Tabla `audit_logs` (user_id, action, entity_type, entity_id, details JSONB, created_at)
- Habilitar realtime en `audit_logs` para el panel Admin

### Orden de implementación sugerido
1. Fase 2 (funcionalidades faltantes) — impacto inmediato en usabilidad
2. Fase 5 (seguridad) — proteger datos existentes
3. Fase 4 (UX) — mejorar experiencia
4. Fase 1 (refactor) — mejorar mantenibilidad
5. Fase 3 (reportes avanzados) — valor agregado

