

## Plan: Edición Multi-Producto + Gestor de Gastos + Mejoras Profesionales

### 1. Edición Multi-Producto en Ventas

**`SalesPage.tsx`:** Reutilizar el sistema de `SaleLineItem` que ya existe para creación, ahora también al editar. Al abrir una venta histórica para editar:
- Cargar la venta como una línea inicial editable
- Permitir agregar más líneas (productos adicionales) que se registran como nuevas ventas vinculadas a la misma fecha/cliente
- Si se modifica una línea existente, ajustar stock con el delta correcto
- Si se agrega una línea nueva, crear nuevo registro de venta y descontar stock
- Si se elimina una línea, revertir stock y borrar la venta

### 2. Gestor de Gastos Operativos

**Nueva tabla SQL `expenses`:**
```
id, user_id, amount_ars, category (alquiler/servicios/marketing/sueldos/logistica/otros),
description, date, recurring (boolean), created_at
```

**Nueva página `ExpensesPage.tsx`** (ruta `/gastos`):
- CRUD de gastos con categorías predefinidas
- Filtros por mes y categoría
- Total mensual de gastos por categoría (gráfico)
- Marca de gasto recurrente (se replica automáticamente cada mes)

**Integración en Dashboard:**
- Nueva card "Ganancia Neta del Mes" = Ganancia bruta − Gastos del mes − Impuestos
- Card "Gastos del mes" con desglose por categoría
- Punto de equilibrio recalculado usando gastos reales (no estimados desde compras)
- Flujo de caja proyectado ajustado: ventas − compras − gastos

**Integración en Reports:**
- Reporte mensual con columnas: Ingresos, Costos, Gastos, Impuestos, Ganancia Neta

### 3. Scroll Mobile en Modales

Auditar todos los Dialog components y agregar `max-h-[90vh] overflow-y-auto` o `ScrollArea` en:
- ProductsPage (form de producto con variantes/decants)
- SalesPage (form multi-producto)
- PurchasesPage, DebtsPage, AdminPage, SettingsPage, InfluencerExchangesPage, MarketingPage
- Asegurar que el footer con botones de acción quede sticky al fondo en mobile

### 4. Mejoras Profesionales Adicionales

**a. Backup/Export de datos** (`SettingsPage`):
- Botón "Exportar todo a Excel" — genera .xlsx con hojas: productos, ventas, compras, deudas, gastos, clientes
- Botón "Backup JSON" — descarga snapshot completo

**b. Comparativa mes vs mes** en Dashboard:
- Card con % de crecimiento vs mes anterior (ventas, ganancia, clientes nuevos)
- Indicador visual ↑↓ con color

**c. Top 5 clientes del mes** en Dashboard:
- Ranking por monto facturado con avatar inicial

**d. Alertas inteligentes** en Dashboard (banner superior):
- "X productos con margen < 30%"
- "Y deudas vencen esta semana"
- "Stock crítico: Z productos sin stock"
- "Gastos superan X% de ingresos"

**e. Notas rápidas por cliente** (`CustomersPage`):
- Campo de texto libre por cliente para anotar preferencias, alergias, fechas importantes

### Archivos

| Archivo | Cambio |
|---|---|
| Migración SQL | Tabla `expenses` + columna `notes` en customers (vía sales aggregation) o nueva tabla `customer_notes` |
| `src/pages/SalesPage.tsx` | Edición multi-línea con ajuste de stock |
| `src/pages/ExpensesPage.tsx` | Nueva — CRUD gastos |
| `src/pages/Dashboard.tsx` | Ganancia neta, gastos, comparativa, top clientes, alertas |
| `src/pages/ReportsPage.tsx` | Columna gastos en reportes mensuales |
| `src/pages/SettingsPage.tsx` | Botones export Excel/JSON |
| `src/pages/CustomersPage.tsx` | Notas por cliente |
| `src/components/AppLayout.tsx` | Link "Gastos" en sidebar |
| `src/App.tsx` | Ruta `/gastos` |
| `src/lib/supabaseStore.ts` | Helpers `getExpensesDB`, `addExpenseDB`, etc + `getMonthlyExpenses` |
| Todos los modales | Scroll mobile con `max-h-[90vh] overflow-y-auto` |

### Orden de implementación
1. Migración SQL (`expenses` + `customer_notes`)
2. Scroll mobile en todos los modales
3. Edición multi-producto en ventas
4. Página de Gastos (CRUD + ruta + sidebar)
5. Integración de gastos en Dashboard (ganancia neta, alertas)
6. Top clientes y comparativa mes vs mes
7. Export Excel/JSON en Settings
8. Notas por cliente en CRM

