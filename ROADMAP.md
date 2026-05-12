# Roadmap del Proyecto — Gestiona / Exentry Imports

Fecha de relevamiento: 2026-05-05
Última actualización: **2026-05-12 (sesión 6)**
DB producción: `hummeopatkniwkyrrhwc`
Tipo de producto: sistema de gestión SaaS para pymes argentinas — ventas, stock, finanzas, CRM, marketing, integraciones e inteligencia artificial.

---

## Estado general

**MVP avanzado con SaaS billing funcional. ~72% completo.**

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

### Finanzas y administración
- Gastos, deudas de clientes, cheques, proveedores, conciliación bancaria, flujo de caja.
- Gastos recurrentes con frecuencia configurable + auto-generación diaria + cron. _(sesión 3)_
- Pagos parciales a proveedores con historial. _(sesión 2)_
- Conciliación bancaria con ventas, gastos, pagos y MP. _(sesión 2)_
- Exportaciones CSV y PDF para ventas, compras, gastos, productos, deudas, equipo. _(sesión 2)_

### Reportes
- ReportsPage con tabs: Resumen, Estado de Resultados (P&L con comparativa período anterior), Inventario Valorado, Vendedores, Impuestos, Presupuesto, Auditoría.
- Comparativa período anterior en 4 KPIs con delta ▲/▼. _(sesión 3)_
- Exportación PDF profesional del Estado de Resultados.

### Facturación Argentina
- Pantalla de facturas, PDF, email, configuración AFIP.
- Edge Function de autorización AFIP con ambientes separados y errores tipificados. _(sesión 2)_
- Botón "Reintentar" en errores AFIP. _(sesión 2)_
- Factura ↔ venta: `sale_id` en invoices, `invoice_id` en sales, badge "Facturado". _(sesión 3)_

### Marketing y catálogo
- Posts, templates, catálogo público con QR/PDF, combos, banners, historias de Instagram.
- Campañas de email (`EmailCampaignsPage`), influencers, canjes, liquidaciones.
- `OfferRecommenderPanel` con IA para sugerencias de ofertas. _(sesión 4)_

### Inteligencia artificial y analytics
- `AIInsightsPage`: insights automatizados con Claude.
- `AIChatPage`: chat con contexto del negocio.
- `AIPrediction` component en Dashboard: predicción de ventas.
- Forecast con regresión lineal OLS, comparación real vs proyectado por mes (tab en `AnalyticsPage`). _(sesión 4)_
- `CashFlowProjector`, `HealthScore`, `ConsistencyAlerts` en Dashboard.

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
| Dashboard | Categorías de productos hardcodeadas (perfume/vaper) en lugar de dinámicas por org | Alto |
| Inventario | Sin métrica "días de stock" basada en velocidad de ventas real | Alto |
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

### Sprint 6 — Mayo 2026: Estabilidad + Quick wins _(en curso)_

**Objetivo:** infraestructura sólida + primeras mejoras de diferenciación.

| # | Item | Estado |
|---|------|--------|
| 1 | PWA auto-update (skipWaiting, clientsClaim, ChunkLoadError handler) | ✅ Hecho |
| 2 | Canales Realtime sin crash (safeChannel helper, 6 componentes) | ✅ Hecho |
| 3 | JWT anon key para auth correcta | ✅ Hecho |
| 4 | Categorías dinámicas en Dashboard (eliminar hardcoded perfumes/vapers) | ✅ Hecho |
| 5 | Columna "Días de stock" con velocidad de ventas en ProductsPage | ✅ Hecho |
| 6 | Widget de deudas vencidas con acción rápida en Dashboard | 🔵 En curso |
| 7 | Tipos Supabase regenerados + 191 `as any` eliminados | ✅ Hecho |
| 8 | Admin: export CSV, magic link, reset password, métricas growth | ✅ Hecho |
| 9 | Mobile: tablas, dialogs, selects, NotificationBell | ✅ Hecho |
| 10 | Products Excel import con cálculo de márgenes | ✅ Hecho |

### Sprint 7 — Junio 2026: CRM real + Email con métricas

**Objetivo:** convertir el CRM y marketing en ventaja competitiva real.

| # | Item | Impacto |
|---|------|---------|
| 1 | Segmentos RFM guardados y reutilizables en CRM | Alto |
| 2 | Email campaigns con open rate / click rate (Resend webhooks) | Alto |
| 3 | Score de salud del cliente (compras, deudas, engagement) | Alto |
| 4 | Recordatorios automáticos de deuda vencida por WhatsApp/email | Alto |
| 5 | Sugerencias IA proactivas en Dashboard ("Llamar a estos 3 clientes hoy") | Alto |
| 6 | Notas de crédito integradas a devoluciones (AFIP) | Medio |
| 7 | Segmentos de clientes con exportación a CSV/email | Medio |

### Sprint 8 — Julio 2026: POS avanzado + Stock inteligente

**Objetivo:** POS de nivel enterprise y stock predictivo.

| # | Item | Impacto |
|---|------|---------|
| 1 | Split de pago en POS (efectivo + tarjeta + MP en una venta) | Crítico |
| 2 | Modo offline para POS (cache local con IndexedDB, sync al reconectar) | Alto |
| 3 | Alerta proactiva en POS si stock queda en <5 unidades tras la venta | Alto |
| 4 | Punto de reorden automático con sugerencia de cantidad de compra | Alto |
| 5 | Stock por sucursal visible en POS y en transferencias | Alto |
| 6 | Lotes con fecha de vencimiento en UI | Medio |
| 7 | Reporte de rentabilidad por producto (margen real vs histórico) | Medio |

### Sprint 9 — Agosto 2026: IA avanzada + Analytics enterprise

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

### Sprint 10 — Septiembre 2026: Mobile nativo + Expansión

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

### Sprint 11 — Octubre-Noviembre 2026: Escala y enterprise

| # | Item | Impacto |
|---|------|---------|
| 1 | Multi-sucursal con caja independiente por local | Alto |
| 2 | Facturación electrónica de corridos (lotes) | Alto |
| 3 | Conciliación automática bancaria (CBU + extracto CSV) | Alto |
| 4 | Suite E2E con Playwright (login, venta, caja, factura, permisos) | Medio |
| 5 | SLA de uptime y panel de status público | Medio |
| 6 | Plan Enterprise con white-label | Medio |

---

## Estado por módulo (actualizado sesión 6)

| Módulo | % | Próximo milestone |
|--------|---|-------------------|
| Infraestructura | 85% | E2E tests, staging env |
| Auth + orgs | 80% | Permisos granulares |
| Inventario | 78% | Días de stock, lotes en UI |
| Ventas + POS | 72% | Split pago, offline |
| Clientes + CRM | 70% | Segmentos RFM, score salud |
| Finanzas | 75% | Auditoría de cambios |
| Facturación AFIP | 65% | Notas de crédito |
| Marketing + Email | 55% | Open/click rate |
| IA + Analytics | 68% | IA proactiva, predicción demanda |
| Integraciones | 75% | Shopify, MeLi |
| SaaS + billing | 82% | Permisos por plan granulares |
| Mobile + UX | 70% | Capacitor, offline POS |
| Testing + calidad | 40% | E2E, mocks edge fns |
| **TOTAL** | **72%** | |

---

## Prioridades inmediatas (sesión 7)

| # | Acción | Por qué |
|---|--------|---------|
| 1 | Split de pago en POS (efectivo + tarjeta + MP) | Pedido frecuente, bloquea ventas reales |
| 2 | Email campaigns: open/click rate vía Resend webhooks | Diferenciación en marketing |
| 3 | Segmentos RFM guardados (últimos 30/60/90 días, monto, frecuencia) | CRM accionable |
| 4 | Sugerencias IA proactivas en Dashboard | Diferenciación vs competidores |
| 5 | Reporte de rentabilidad por producto | Datos para decisiones reales |
| 6 | Suite E2E básica con Playwright (login → venta → caja) | Calidad antes de escalar |

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
