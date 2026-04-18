

# Plan: Profesionalización Total Fase 2 — Cash Flow + Sync Deudas + Eliminación Hardcodeos + Innovaciones

## Análisis previo

Revisé el codebase y detecté hardcodeos críticos a eliminar:
- `Dashboard.tsx`: thresholds fijos (margen <30%, gastos >40%, stock <=3)
- `supabaseStore.ts`: comisión pasero 15% en ciertos cálculos
- `notify_low_stock`: trigger SQL con umbral fijo `<=3`
- `notify_large_sale`: trigger SQL con `>=50000` ARS
- `check_overdue_debts`: ventana fija de 1 día
- `CashFlowProjector` (a crear): no debe hardcodear días, debe leer de settings
- `seedData.ts`: datos demo con valores fijos
- Categorías de gastos hardcodeadas en `ExpensesPage`
- WhatsApp number, decant margins en varios lugares

## 1. Fix crítico: Sincronización Deuda → Venta

En `addDebtPaymentDB` (`supabaseStore.ts`):
- Si el pago liquida la deuda (`status='paid'`) y existe `sale_id` → actualizar `sales.paid = true`
- Si se revierte (deuda vuelve a 'partial'/'pending') → `sales.paid = false`
- Notificación + audit log automáticos
- Migración SQL one-time para reparar deudas pagadas históricas que no marcaron la venta

## 2. Cash Flow Projector 30/60/90 días

**Componente:** `src/components/dashboard/CashFlowProjector.tsx`

Lógica dinámica (sin hardcodeos):
- **Entradas:** deudas con `due_date` en ventana + proyección ventas (promedio últimos 30d × días)
- **Salidas:** gastos recurrentes × meses + compras programadas (`scheduled_date`) + impuestos calculados
- **Caja inicial:** configurable en `settings.initial_cash_ars` (nueva columna)
- AreaChart con evolución diaria (recharts)
- Semáforo dinámico basado en `settings.cash_flow_warning_threshold`
- Detalle expandible de cada movimiento

## 3. Eliminación TOTAL de Hardcodeos

**Migración SQL:** Nuevas columnas en `settings`:
```
initial_cash_ars, low_stock_threshold (default 3), 
large_sale_threshold_ars (default 50000),
margin_alert_percent (default 30), 
expense_ratio_alert_percent (default 40),
overdue_check_window_hours (default 24),
cash_flow_warning_threshold_ars (default 0),
expense_categories (JSONB array configurable),
pasero_commission_percent (default 15)
```

**Refactor de triggers SQL:** `notify_low_stock`, `notify_large_sale`, `check_overdue_debts` leen umbrales de `settings` por user_id en vez de constantes.

**Refactor en código:**
- `Dashboard.tsx` → todas las alertas usan settings
- `ExpensesPage.tsx` → categorías desde `settings.expense_categories`
- `SettingsPage.tsx` → nueva sección "Umbrales y Alertas" + "Categorías de Gastos" (CRUD inline)
- Reemplazo de comisión pasero hardcoded por `settings.pasero_commission_percent`

## 4. Health Score Financiero

**Componente:** `src/components/dashboard/HealthScore.tsx`
- Anillo SVG 0-100 con 5 métricas ponderadas (margen, liquidez, rotación, crecimiento, morosidad)
- Pesos configurables en settings (sin hardcodeos)
- Tooltip con desglose y recomendaciones

## 5. Consistency Auditor (auto-reparación)

**Componente:** `src/components/dashboard/ConsistencyAlerts.tsx`
- Detecta: ventas sin descuento de stock, deudas pagadas con venta no marcada, costos desactualizados, stock variantes ≠ padre
- Botón "Reparar automáticamente" ejecuta fixes con audit log
- Banner dismissible

## 6. Estado de Resultados Profesional

**En `ReportsPage`:** Nuevo tab con formato contable estándar:
```
Ingresos por ventas
(-) Costo de mercadería vendida (COGS)
= Ganancia bruta
(-) Gastos operativos (desglose por categoría)
(-) Impuestos
= Ganancia neta
```
Export PDF con membrete + selector de período (mes/trimestre/año).

## 7. Innovaciones Tecnológicas

### 7a. Predictor de ventas con IA
- Edge function `predict-sales` usando `google/gemini-2.5-flash` (Lovable AI, sin API key extra)
- Recibe historial 90d → devuelve proyección 30d con intervalo de confianza
- Card en Dashboard: "Proyección IA: $X (±%)"

### 7b. Auto-replicar gastos recurrentes
- Edge function `auto-recurring-expenses` programada con `pg_cron` día 1 de cada mes
- Replica todos los `expenses` con `recurring=true`
- Notificación al admin

### 7c. Atajos de teclado profesionales (CommandPalette)
- `Ctrl+N` → nueva venta, `Ctrl+P` → producto, `Ctrl+G` → gasto, `Ctrl+D` → deuda
- `Ctrl+/` → modal con lista de atajos

### 7d. Cotización USD en tiempo real
- Edge function `fetch-usd-rate` consulta API pública (dolarapi.com — sin key)
- Botón en `SettingsPage` "Actualizar TC desde mercado" + opción auto-update diario vía cron
- Muestra blue/oficial/MEP, usuario elige cuál aplicar

### 7e. Backup automático semanal
- Edge function `weekly-backup` exporta JSON completo a Storage bucket `backups/`
- Cron domingo 23:59
- Sección en Settings con historial de backups descargables

### 7f. Compras programadas
- Nueva columna `purchases.scheduled_date` (nullable) + flag `is_scheduled`
- Si `scheduled_date > now()` → no descuenta stock, aparece en cash flow projector
- Vista "Próximas compras" en `PurchasesPage`

## Archivos

| Archivo | Cambio |
|---|---|
| Migración SQL | Columnas en `settings`, `purchases.scheduled_date`, refactor triggers, fix legacy debts→sales, cron jobs |
| `src/components/dashboard/CashFlowProjector.tsx` | NUEVO |
| `src/components/dashboard/HealthScore.tsx` | NUEVO |
| `src/components/dashboard/ConsistencyAlerts.tsx` | NUEVO |
| `src/components/dashboard/AIPrediction.tsx` | NUEVO |
| `src/lib/supabaseStore.ts` | Fix sync deuda↔venta, helpers cash flow/health/consistency, eliminar hardcodeos comisión |
| `src/pages/Dashboard.tsx` | Integra componentes nuevos, alertas desde settings |
| `src/pages/SettingsPage.tsx` | Sección "Umbrales y Alertas", "Categorías Gastos", "Cotización USD", "Backups" |
| `src/pages/ExpensesPage.tsx` | Categorías dinámicas desde settings |
| `src/pages/ReportsPage.tsx` | Tab "Estado de Resultados" + export PDF |
| `src/pages/PurchasesPage.tsx` | Soporte compras programadas |
| `src/components/shared/CommandPalette.tsx` | Atajos Ctrl+N/P/G/D/? |
| `supabase/functions/predict-sales/index.ts` | NUEVO (Lovable AI) |
| `supabase/functions/auto-recurring-expenses/index.ts` | NUEVO + cron |
| `supabase/functions/fetch-usd-rate/index.ts` | NUEVO |
| `supabase/functions/weekly-backup/index.ts` | NUEVO + cron |

## Orden de implementación
1. Migración SQL (settings ampliado, scheduled_date, refactor triggers, fix legacy)
2. Sync deuda↔venta + reparación histórica
3. Eliminación hardcodeos en código (Dashboard, supabaseStore, ExpensesPage)
4. SettingsPage: nuevas secciones de configuración
5. CashFlowProjector + HealthScore + ConsistencyAlerts
6. Compras programadas
7. Estado de Resultados en Reports + PDF
8. Edge functions: USD rate, predict-sales, auto-recurring, weekly-backup
9. Cron jobs (pg_cron)
10. CommandPalette atajos

