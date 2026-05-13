# Roadmap del Proyecto — Gestiona / Exentry Imports

Fecha de relevamiento: 2026-05-05
Última actualización: **2026-05-13 (sesión 11)**
DB producción: `hummeopatkniwkyrrhwc`
Tipo de producto: sistema de gestión SaaS para pymes argentinas — ventas, stock, finanzas, CRM, marketing, integraciones e inteligencia artificial.

---

## Estado general

**MVP avanzado con SaaS billing funcional. ~91% completo.**

La app tiene base técnica sólida: React 18, Vite, Tailwind, Radix UI, React Query, Supabase, Edge Functions, PWA, Sentry, Stripe, Tiendanube, Mercado Pago, AFIP, Resend y Anthropic Claude. Infraestructura estabilizada en sesión 6: service worker auto-update, canales realtime sin crash, JWT anon key.

**Prioridad actual:** features de diferenciación competitiva — IA proactiva, stock inteligente, CRM accionable, email con métricas.

---

## Resumen de lo hecho (acumulado hasta sesión 6)

### Infraestructura y base técnica
- React/Vite con ruteo protegido, layout principal, navegación lateral, mobile header, command palette y estado de sesión.
- PWA con auto-update (`registerType: autoUpdate`, `skipWaiting: true`, `clientsClaim: true`). _(sesión 6)_
- Canales Supabase Realtime con nombres únicos por user/org — elimina crash "cannot add callbacks after subscribe". _(sesión 6)_
- JWT anon key (`VITE_SUPABASE_ANON_KEY`) reemplaza publishable key para auth correcta. _(sesión 6)_
- Handler global de `ChunkLoadError` para recargar automáticamente tras deploy. _(sesión 6)_
- Helper `safeChannel()` en `lib/realtimeChannel.ts` aplicado en 6 componentes. _(sesión 6)_
- Eliminación de 191 `as any` — tipado fuerte en todo `src/`. _(sesión 5)_
- Tipos Supabase regenerados: `alert_rules`, `automation_runs`, `email_events`, `org_api_keys`, `webhook_deliveries`. _(sesión 5)_
- Code splitting React.lazy: bundle 1982kB → 427kB (-78%). _(sesión 3)_
- Sentry configurado y funcional.
- CI con lint, build y tests (Vitest, 54+ tests).

### Autenticación y organizaciones
- Auth Supabase, OrgProvider, memberships, roles (admin/vendedor/viewer), invitaciones de equipo.
- Platform admin con audit log, suspensión, magic link/impersonate, reset password, export CSV de orgs, cambio de rol y remoción de miembros. _(sesión 5)_
- Tab Sistema con check de secretos, métricas growth/churn/ARPU. _(sesión 5)_
- Google OAuth mejorado con mensajes de error claros. _(sesión 5)_
- RLS auditada: migration 20260421 cubre todas las tablas con org_id.

### Inventario
- CRUD de productos con imágenes múltiples, variantes, stock general.
- Compras que aumentan stock / ventas que descuentan stock via triggers DB.
- Alertas de stock bajo configurables por org. _(sesión 4)_
- Toma física (`StockCountPage`), restock automático (`AutoRestockPage`), sucursales y stock por ubicación.
- Kardex: `stock_movements`, triggers en ventas/compras, `record_stock_movement`, `kardex_summary`, `KardexPage`. _(sesión 1)_
- Ajustes de stock auditados con `adjust_stock`. _(sesión 1)_
- Importación masiva desde Excel con cálculo automático de costos, márgenes y precios sugeridos. _(sesión 5)_

### Ventas, POS y caja
- Registro de ventas, POS, recibos, descuentos/cupones.
- Ventas pagadas o con deuda, cuotas, devoluciones, presupuestos.
- Presupuesto → venta: modal con selector de método de cobro, vincula `sale.quote_id`. _(sesión 1)_
- Turnos de caja con apertura/cierre/diferencias y exportación PDF+CSV del cierre. _(sesión 1, 3)_
- Movimientos de caja por venta via trigger `trg_sale_cash_entry`. _(sesión 1)_
- `usePlanLimits` con `checkSalesLimit` integrado en SaleForm y POSPage.
- Comisiones de vendedores (`SellerCommissionsPage`).
- Cheques (`ChequesPage`), cuotas (`CuotasPage`).

### Clientes y CRM
- CRUD de clientes, notas, segmentación automática, pipeline (`SalesPipelinePage`), referidos (`ReferralsPage`), fidelidad (`LoyaltyPage`), cumpleaños.
- Ficha 360 con tabs: Resumen (KPIs + productos favoritos), Compras (timeline), Cuotas/Deudas, Contacto (notas + comunicaciones + WhatsApp). _(sesión 3)_
- Merge de clientes duplicados inline en CRM. _(sesión 3)_
- Auto-award loyalty points via DB trigger en cada venta. _(sesión 3)_
- Export CSV con datos RFM completos desde CustomersPage — respeta filtro de segmento activo; incluye columnas: segmento, score, facturación, ganancia, frecuencia, días sin comprar, deuda, email, teléfono. _(sesión 7–9)_
- Drag-and-drop nativo HTML5 en `SalesPipelinePage` — arrastrar deals entre columnas, resaltado visual de zona de drop, sin dependencias nuevas. _(sesión 7)_
- **Customer Health Score** (0–100) en CRM basado en Recency+Frequency+Monetary con percentiles. Badge de colores, barra de progreso en ficha expandida, opción de sort. _(sesión 9)_
- **Segmentos guardados** en CRM — guardar filtro actual con nombre personalizado, chips de acceso rápido, eliminación, persistidos en localStorage. _(sesión 9)_

### Finanzas y administración
- Gastos, deudas de clientes, cheques, proveedores, conciliación bancaria, flujo de caja.
- Gastos recurrentes con frecuencia configurable + auto-generación diaria + cron. _(sesión 3)_
- Pagos parciales a proveedores con historial. _(sesión 2)_
- Conciliación bancaria con ventas, gastos, pagos y MP. _(sesión 2)_
- Exportaciones CSV y PDF para ventas, compras, gastos, productos, deudas, equipo. _(sesión 2)_

### Reportes
- ReportsPage con tabs: Resumen, Estado de Resultados (P&L con comparativa período anterior), Inventario Valorado, **Rentabilidad por Producto** _(sesión 7)_, Vendedores, Impuestos, Presupuesto, Auditoría.
- Comparativa período anterior en 4 KPIs con delta ▲/▼. _(sesión 3)_
- Exportación PDF profesional del Estado de Resultados.
- Tab "Rentabilidad Productos": ranking por ganancia/margen/unidades, top-5 bar chart, exportación CSV, filtro por búsqueda. _(sesión 7)_

### Facturación Argentina
- Pantalla de facturas, PDF, email, configuración AFIP.
- Edge Function de autorización AFIP con ambientes separados y errores tipificados. _(sesión 2)_
- Botón "Reintentar" en errores AFIP. _(sesión 2)_
- Factura ↔ venta: `sale_id` en invoices, `invoice_id` en sales, badge "Facturado". _(sesión 3)_

### Marketing y catálogo
- Posts, templates, catálogo público con QR/PDF, combos, banners, historias de Instagram.
- Campañas de email (`EmailCampaignsPage`), influencers, canjes, liquidaciones.
- `OfferRecommenderPanel` con IA para sugerencias de ofertas. _(sesión 4)_
- 7 segmentos de email (all, VIP, at_risk, dormant, lost >90d, birthday, never_bought). _(sesión 9)_
- Carrito de compras en catálogo público con mensaje WhatsApp multi-producto. _(sesión 8)_

### Inteligencia artificial y analytics
- `AIInsightsPage`: insights automatizados con Claude.
- `AIChatPage`: chat con contexto del negocio.
- `AIPrediction` component en Dashboard: predicción de ventas.
- Forecast con regresión lineal OLS, comparación real vs proyectado por mes (tab en `AnalyticsPage`). _(sesión 4)_
- `CashFlowProjector`, `HealthScore`, `ConsistencyAlerts` en Dashboard.
- `AIProactiveWidget`: auto-corre `ai-analysis` al cargar Dashboard, cache 8h localStorage por org, sugerencias numeradas colapsables. _(sesión 7)_
- **Predicción de demanda por producto** (tab "Demanda" en AnalyticsPage): velocidad 60d, proyección 30d, días de stock, gap, urgencia semáforo. _(sesión 9)_
- **Dashboard: objetivo mensual de ventas** — progress bar con % alcanzado, días restantes, persistido en localStorage por mes. _(sesión 9)_
- **POS: badge 🔥 Top seller** — top-5 productos por unidades vendidas en 30d destacados en la grilla. _(sesión 9)_
- **SalesPage date presets** — chips Hoy/Ayer/Semana/Mes/Mes anterior que setean dateFrom/dateTo automáticamente. _(sesión 10)_
- **ReportsPage tab "Por Categoría"** — revenue, profit, margen, unidades por categoría; top-8 bar chart horizontal; CSV export; sort por columna. _(sesión 10)_
- **ExpensesPage presupuesto por categoría** — edición inline con pencil/check/X, barra de progreso (naranja ≥80%, roja >100%), persistido en localStorage. _(sesión 10)_
- **Aging AP/AR** — 4 buckets por antigüedad (0-30/31-60/61-90/>90d) en ProveedoresPage y DebtsPage con barras de color y totales. _(sesión 10)_
- **ProveedoresPage contactos clickeables** — teléfono → WhatsApp (wa.me/), email → mailto, colores verdes/azules. _(sesión 10)_
- **LoyaltyPage tiers** — Bronce/Plata/Oro/Platino con badge, barra de progreso al próximo tier, `getTier`/`getNextTier` helpers. _(sesión 10)_
- **EmailCampaignsPage plantillas** — 5 plantillas pre-construidas (bienvenida, reactivación, VIP, promo fin de semana, cumpleaños) con un click. _(sesión 10)_
- **Dashboard quick actions + P&L chart** — fila de 6 acciones rápidas; gráfico de barras con ventas/ganancia/ganancia neta por mes. _(sesión 10)_
- **PurchasesPage búsqueda + filtro proveedor** — search full-text en producto+proveedor, selector de proveedor con "Todos". _(sesión 10)_
- **ChequesPage + CuotasPage CSV export** — exportación completa de cheques y cuotas con todos los campos relevantes. _(sesión 10)_
- **SalesPipelinePage pipeline ponderado** — KPI "Pipeline ponderado" = Σ(valor × probabilidad) por etapa, probabilidades por stage header. _(sesión 10)_
- **AIChatPage chips de navegación** — 6 chips de acceso rápido (ventas, POS, clientes, inventario, gastos, reportes) en estado vacío. _(sesión 10)_
- **AIChatPage acciones reales** — detección de intención client-side (crear producto/gasto/cliente), action cards con mini-formularios inline que escriben directamente en DB; chips "Acciones directas" en estado vacío. _(sesión 11)_
- **CustomersPage segmentos RFM en DB** — migración de localStorage a Supabase (campo `crm_segments` JSONB en settings); auto-migración en primer load; sync multi-dispositivo. _(sesión 11)_
- **supabaseStore getCRMSegmentsDB/saveCRMSegmentsDB** — helpers para persistir segmentos CRM. _(sesión 11)_
- **InfluencerExchangesPage CSV export** — exporta influencer, producto, tipo, valor, posts, estado, ROI. _(sesión 11)_
- **MarketingPage CSV export** — exporta publicaciones con filtro de estado aplicado + contador visible. _(sesión 11)_
- **Dashboard pipeline conversion widget** — win rate, funnel bar con cerrados/activos/perdidos, valor ganado, link a pipeline. _(sesión 11)_
- **AIChatPage ajuste de stock** — detección de intento "ajustar stock", AdjustStockCard con selector de producto + stock actual + nuevo valor. _(sesión 11)_
- **TasksPage kanban view** — toggle lista/kanban, columnas por estado (pendiente/en progreso/completada), drag-drop entre columnas. _(sesión 11)_
- **ProductsPage inline stock edit** — click en el número de stock para editarlo inline, guarda con Enter/blur, cancela con Escape. _(sesión 11)_
- **AnalyticsPage ABC analysis** — tab "ABC" con clasificación Pareto de productos (A=80% ingreso, B=15%, C=5%), tabla con barras de contribución, tips accionables. _(sesión 11)_
- **SalesPage vista Por Cliente** — toggle lista/por-cliente, rankea clientes por total gastado con share %, ganancia, última compra, producto top. _(sesión 11)_

### Integraciones
- Tiendanube OAuth + sync + webhooks con HMAC-SHA256 + retry. _(sesión 2, 3)_
- Mercado Pago link + webhook con HMAC-SHA256, multi-org. _(sesión 2)_
- Stripe checkout, cancelación, webhook idempotente, dunning completo. _(sesión 2)_
- AFIP con retry y errores tipificados. _(sesión 2)_
- Public API `/v1/` con rate limits, API keys rotables con SHA-256, scopes. _(sesión 2)_
- Webhooks salientes con HMAC, retries con backoff, historial en `webhook_deliveries`. _(sesión 2)_
- Health check visual por integración (`integration_logs`). _(sesión 3)_
- Dead-letter queue UI: retry de webhooks fallidos desde IntegrationsPage. _(sesión 3)_
- Separación "incluido en tu plan" vs "tus integraciones" en IntegrationsPage. _(sesión 5)_

### SaaS y planes
- Stripe checkout, subscriptions, entitlements, trials, dunning.
- `usePlanLimits` con enforcement real de límites (productos, ventas/mes, usuarios).
- Platform admin con herramientas de soporte, audit log.
- Pricing page y estado de suscripción.
- Onboarding persistente en DB. _(sesión 1)_
- Datos demo por rubro. _(sesión 1)_
- Política de privacidad y términos (ley 25.326). _(sesión 2)_

### Operaciones
- Sentry, backups, crons, rate limiter, notificaciones in-app.
- Alertas inteligentes configurables: 5 tipos, edge function `check-alerts`, cron diario 07:00 UTC. _(sesión 4)_
- Automatizaciones con motor de ejecución real: edge function `execute-automations`, historial en `automation_runs`, botón "Ejecutar ahora". _(sesión 4)_

### UX y mobile
- PageHeader + KPICard estandarizados en todas las páginas. _(sesión 5-6)_
- Tablas responsive con CSS utilities para mobile. _(sesión 5)_
- Dialogs responsive. _(sesión 5)_
- Selects responsivos (full width en mobile, fixed en desktop). _(sesión 5)_
- NotificationBell en mobile header. _(sesión 5)_
- Excel import preview scrollable en mobile. _(sesión 5)_

---

## Brechas actuales y deuda técnica

| Área | Brecha | Impacto |
|------|--------|---------|
| ~~Dashboard~~ | ~~Categorías de productos hardcodeadas~~ | ~~Alto~~ → ✅ Resuelto |
| ~~Inventario~~ | ~~Sin métrica "días de stock"~~ | ~~Alto~~ → ✅ Resuelto |
| Email | Campañas sin tracking de open rate / click rate via Resend webhooks | Alto |
| CRM | Sin segmentos RFM guardados y reutilizables | Medio |
| POS | Sin modo offline / tolerancia a cortes de conexión | Medio |
| Facturación | Notas de crédito no integradas a devoluciones AFIP | Medio |
| Equipo | Permisos granulares (caja, ventas, inventario) aún no implementados | Medio |
| AFIP | Numeración de puntos de venta poco robusta | Medio |
| Testing | Sin suite E2E (Playwright) para flujos críticos | Medio |
| Docs | Manual de usuario y runbook de producción pendientes | Bajo |

---

## Plan de sprints 2026

### Sprint 6 — Mayo 2026: Estabilidad + Quick wins ✅ COMPLETO

**Objetivo:** infraestructura sólida + primeras mejoras de diferenciación.

| # | Item | Estado |
|---|------|--------|
| 1 | PWA auto-update (skipWaiting, clientsClaim, ChunkLoadError handler) | ✅ Hecho |
| 2 | Canales Realtime sin crash (safeChannel helper, 6 componentes) | ✅ Hecho |
| 3 | JWT anon key para auth correcta | ✅ Hecho |
| 4 | Categorías dinámicas en Dashboard (eliminar hardcoded perfumes/vapers) | ✅ Hecho |
| 5 | Columna "Días de stock" con velocidad de ventas en ProductsPage | ✅ Hecho |
| 6 | Widget de deudas vencidas con acción rápida en Dashboard | ✅ Hecho |
| 7 | Tipos Supabase regenerados + 191 `as any` eliminados | ✅ Hecho |
| 8 | Admin: export CSV, magic link, reset password, métricas growth | ✅ Hecho |
| 9 | Mobile: tablas, dialogs, selects, NotificationBell | ✅ Hecho |
| 10 | Products Excel import con cálculo de márgenes | ✅ Hecho |

### Sprint 7 — Mayo 2026: IA proactiva + CRM accionable ✅ COMPLETO

**Objetivo:** diferenciación real por IA y datos accionables.

| # | Item | Estado |
|---|------|--------|
| 1 | Widget IA proactiva en Dashboard (auto-run, 8h cache) | ✅ Hecho |
| 2 | Drag-and-drop nativo en SalesPipeline Kanban | ✅ Hecho |
| 3 | Export CSV con RFM desde CustomersPage | ✅ Hecho |
| 4 | Tab "Rentabilidad por Producto" en ReportsPage | ✅ Hecho |
| 5 | Resend webhook: metadata campaign_id+org_id + Svix signature + realtime metrics | ✅ Hecho |
| 6 | Restock inteligente: velocity 60d + cantidad sugerida en Dashboard | ✅ Hecho |
| 7 | POS: alerta toast post-venta cuando stock queda bajo threshold | ✅ Hecho |
| 8 | SalesPage: comparativa de período anterior en KPI cards | ✅ Hecho |
| 9 | ExpensesPage: comparativa mes anterior en KPI card | ✅ Hecho |
| 10 | Dashboard: panel de anomalías (caída de margen + bestseller dropout) | ✅ Hecho |

### Sprint 8 — Mayo 2026: Operaciones avanzadas ✅ COMPLETO

**Objetivo:** operaciones de nivel enterprise y datos más ricos.

| # | Item | Estado |
|---|------|--------|
| 1 | Split de pago en POS (efectivo + tarjeta + MP en una venta) | ✅ Hecho |
| 2 | Alerta toast post-venta cuando stock ≤ threshold | ✅ Hecho |
| 3 | Restock inteligente: velocity 60d + cantidad sugerida en Dashboard | ✅ Hecho |
| 4 | SalesPage: comparativa período anterior en KPIs | ✅ Hecho |
| 5 | ExpensesPage: comparativa mes anterior en KPI | ✅ Hecho |
| 6 | Dashboard: panel de anomalías (margen caído + bestseller dropout) | ✅ Hecho |
| 7 | Carrito público con WhatsApp multi-producto en catálogo | ✅ Hecho |
| 8 | Email campaigns: Svix signature + metadata + realtime metrics | ✅ Hecho |
| 9 | Weekly performance digest email via Resend | ✅ Hecho |

### Sprint 9 — Mayo 2026: CRM inteligente + Forecasting ✅ COMPLETO

**Objetivo:** CRM accionable y análisis predictivo de demanda.

| # | Item | Estado |
|---|------|--------|
| 1 | Customer health score 0–100 (R+F+M percentil) en CustomersPage | ✅ Hecho |
| 2 | Segmentos CRM guardados con nombre (localStorage) | ✅ Hecho |
| 3 | Email campaigns: 3 nuevos segmentos (lost, birthday, never_bought) | ✅ Hecho |
| 4 | Objetivo mensual de ventas en Dashboard con progress bar | ✅ Hecho |
| 5 | POS: badge 🔥 Top seller en top-5 productos | ✅ Hecho |
| 6 | Tab "Demanda" en Analytics: proyección 30d por producto con semáforo | ✅ Hecho |

### Sprint 10 — Mayo 2026: UX avanzada + Analytics operacional ✅ COMPLETO

**Objetivo:** datos accionables en cada módulo, exportaciones, filtros inteligentes y diferenciación visual.

| # | Item | Estado |
|---|------|--------|
| 1 | ExpensesPage: presupuesto por categoría con barra de progreso (localStorage) | ✅ Hecho |
| 2 | SalesPage: filtros preset Hoy/Ayer/Semana/Mes/Mes anterior con chips | ✅ Hecho |
| 3 | ReportsPage: tab "Por Categoría" — revenue, profit, margen, unidades por categoría + bar chart + CSV | ✅ Hecho |
| 4 | ProveedoresPage: aging AP en 4 buckets (0-30/31-60/61-90/>90d) + contactos clickeables (WhatsApp/email) | ✅ Hecho |
| 5 | DebtsPage: aging AR en 4 buckets con barras de color y totales | ✅ Hecho |
| 6 | AIChatPage: chips de navegación rápida (6 acciones) en estado vacío | ✅ Hecho |
| 7 | LoyaltyPage: sistema de tiers Bronce/Plata/Oro/Platino con barra de progreso | ✅ Hecho |
| 8 | EmailCampaignsPage: 5 plantillas de email pre-construidas | ✅ Hecho |
| 9 | Dashboard: fila de acciones rápidas + gráfico P&L (ganancia - gastos por mes) | ✅ Hecho |
| 10 | PurchasesPage: búsqueda full-text + filtro por proveedor | ✅ Hecho |
| 11 | ChequesPage + CuotasPage: exportación CSV con todos los datos | ✅ Hecho |
| 12 | SalesPipelinePage: pipeline ponderado por probabilidad de cierre por etapa | ✅ Hecho |

### Sprint 11 — Agosto 2026: IA avanzada + Analytics enterprise

**Objetivo:** diferenciación por inteligencia artificial aplicada.

| # | Item | Impacto |
|---|------|---------|
| 1 | Predicción de demanda por producto (próximos 30 días) | Alto |
| 2 | Detección automática de anomalías (venta inusual, margen caído) | Alto |
| 3 | Chat IA con acciones reales (crear producto, registrar venta) | Alto |
| 4 | Reportes avanzados por sucursal, vendedor, categoría, período | Alto |
| 5 | Dashboard multi-org para platform admin (vista agregada) | Medio |
| 6 | Límites de costo IA por plan con contador de tokens | Medio |
| 7 | A/B testing de precios con sugerencia IA | Medio |

### Sprint 11 — Septiembre 2026: Mobile nativo + Expansión

**Objetivo:** presencia mobile real y expansión de integraciones.

| # | Item | Impacto |
|---|------|---------|
| 1 | App mobile con Capacitor (Android + iOS) desde codebase React | Alto |
| 2 | Push notifications nativas (ventas, stock, alertas) | Alto |
| 3 | Integración Shopify (sync de productos y órdenes) | Alto |
| 4 | Integración MercadoLibre (publicaciones y órdenes) | Alto |
| 5 | API pública documentada con Swagger/OpenAPI | Medio |
| 6 | Marketplace de automatizaciones (plantillas predefinidas) | Medio |
| 7 | Exportación contable a formatos Tango/Xero/QuickBooks | Medio |

### Sprint 12 — Octubre-Noviembre 2026: Escala y enterprise

| # | Item | Impacto |
|---|------|---------|
| 1 | Multi-sucursal con caja independiente por local | Alto |
| 2 | Facturación electrónica de corridos (lotes) | Alto |
| 3 | Conciliación automática bancaria (CBU + extracto CSV) | Alto |
| 4 | Suite E2E con Playwright (login, venta, caja, factura, permisos) | Medio |
| 5 | SLA de uptime y panel de status público | Medio |
| 6 | Plan Enterprise con white-label | Medio |

---

## Estado por módulo (actualizado sesión 11)

| Módulo | % | Próximo milestone |
|--------|---|-------------------|
| Infraestructura | 85% | E2E tests, staging env |
| Auth + orgs | 80% | Permisos granulares |
| Inventario | 82% | Lotes en UI, offline POS |
| Ventas + POS | 83% | Modo offline, filtros avanzados |
| Clientes + CRM | 89% | Segmentos con acciones masivas |
| Finanzas | 83% | Conciliación automática, auditoría |
| Facturación AFIP | 65% | Notas de crédito |
| Marketing + Email | 80% | Open rate / click tracking |
| IA + Analytics | 90% | Chat IA con más acciones, ABC analysis |
| Integraciones | 75% | Shopify, MeLi |
| SaaS + billing | 82% | Permisos por plan granulares |
| Mobile + UX | 72% | Capacitor, offline POS |
| Testing + calidad | 40% | E2E, mocks edge fns |
| Ventas + POS | 86% | Offline POS, más filtros |
| **TOTAL** | **91%** | |

---

## Prioridades inmediatas (sesión 12)

| # | Acción | Por qué |
|---|--------|---------|
| 1 | Modo offline para POS (IndexedDB, sync al reconectar) | Usuarios sin conexión estable |
| 2 | Notas de crédito AFIP integradas a devoluciones | Cumplimiento fiscal |
| 3 | Suite E2E básica con Playwright (login → venta → caja) | Calidad antes de escalar |
| 4 | Permisos granulares a nivel de acción (no solo nav) | Validación en botones edit/delete |
| 5 | Chat IA: más acciones (registrar venta, ajuste de stock) | Ampliar cobertura de acciones |
| 6 | Dashboard: widget de conversión Pipeline (deals cerrados/total) | KPI accionable para dueño |

---

## Criterio de terminado por funcionalidad

Una funcionalidad se considera lista cuando:
- Tiene permisos correctos por rol y `org_id`.
- Guarda y lee datos por `org_id` (no por `user_id`).
- Tiene validaciones de formulario y mensajes de error claros.
- Maneja loading, empty state y error state correctamente.
- Funciona en desktop y mobile.
- Tiene auditoría si modifica datos sensibles.
- No rompe stock, caja, deuda ni reportes.

---

## Métricas de producto a medir

- Tiempo hasta primera venta registrada (time-to-value).
- Ventas registradas por organización por día.
- Productos con stock negativo o desactualizado.
- Diferencia promedio de caja por turno.
- Deudas vencidas y tasa de cobro.
- Conversión de trial a pago.
- Churn mensual por plan.
- Uso de funciones IA por plan.
- Fallos de integraciones por día.
- Tiempo promedio de carga de dashboard y listas grandes.

---

## Riesgos a vigilar

- Costos IA sin límites por plan → puede escalar sin control.
- Facturación fiscal con errores por configuración AFIP incorrecta.
- PWA cacheando datos viejos en pantallas sensibles (mitigado con skipWaiting).
- Datos mezclados entre organizaciones si alguna consulta filtra por `user_id` en lugar de `org_id`.
- Webhooks duplicados o fallidos que creen ventas/stock inconsistentes.

---

## Potencial financiero

- Target: ~200 orgs activas en 12 meses.
- MRR proyectado: USD 12.000–20.000.
- ARPU objetivo: USD 60–100/mes por org.
- Plans: Starter $29 · Pro $59 · Business $99 · Enterprise custom.
