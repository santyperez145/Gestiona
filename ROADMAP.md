# Roadmap del Proyecto

Fecha de relevamiento: 2026-05-05  
Última actualización: 2026-05-06 (sesión 3)  
Proyecto: Gestiona / Exentry Imports  
DB producción: `wcfohngxrtopgggumjmw`  
Tipo de producto: sistema de gestión para ventas, stock, finanzas, CRM, marketing, equipo e integraciones.

---

## Estado general

La app está en **MVP avanzado con SaaS billing funcional**. Tiene base técnica sólida en React, Vite, Tailwind, Supabase, Edge Functions, PWA, Sentry, Stripe, Tiendanube, Mercado Pago, AFIP, Resend y Anthropic.

La prioridad ahora es **estabilizar lo existente para uso diario real**: datos consistentes por `org_id`, RLS cerrada, flujos comerciales probados de punta a punta, integraciones monitoreadas y tipos TypeScript actualizados.

---

## Resumen de lo hecho

- Aplicación React/Vite con ruteo protegido, layout principal, navegación lateral, mobile header, command palette y estado de sesión.
- Autenticación con Supabase, organizaciones, membresías, roles, invitaciones de equipo y platform admin.
- Dashboard con KPIs, gráficos, alertas, predicciones, salud del negocio y últimas ventas.
- Productos, compras, ventas, deudas, gastos, clientes, proveedores, presupuestos, devoluciones, facturas, caja/POS y turno de caja.
- Inventario avanzado: variantes, toma física, restock automático, sucursales, stock por ubicación y transferencias.
- CRM y ventas: clientes, notas, segmentación, pipeline, referidos, fidelidad, cuotas, cheques, comisiones de vendedores.
- Marketing: calendario/posts, templates, combos, banners, catálogo público, generador de historias, campañas de email, influencers, canjes y liquidaciones.
- Inteligencia artificial: insights, chat IA, predicción de ventas, recomendaciones de ofertas y generación de descripciones.
- Integraciones: Tiendanube OAuth/sync/webhooks, Mercado Pago link, Stripe checkout/webhook, AFIP, public API y webhooks salientes.
- Operaciones: Sentry, PWA, backups, notificaciones, crons para alertas, digest semanal y automatizaciones.
- Multi-tenant: `organizations`, `memberships`, `org_id` en todas las tablas críticas, RLS por org auditada.
- SaaS billing: Stripe checkout, dunning, trials, entitlements, plan limits, platform admin con audit log.
- Integraciones hardened: Tiendanube HMAC-SHA256 + retry, MP webhook multi-org, Stripe idempotency via `stripe_events`, AFIP errores tipificados. _(2026-05-06 sesión 3)_
- Observabilidad: `integration_logs` + `webhook_deliveries` + health panel en IntegrationsPage. _(2026-05-06 sesión 3)_
- Public API v1: versionado, rate limits, API keys rotables con SHA-256, `org_api_keys`. _(2026-05-06 sesión 3)_
- Webhooks salientes: HMAC signing, retries con backoff, historial en `webhook_deliveries`. _(2026-05-06 sesión 3)_
- CashSessionPage: exportar reporte de cierre como PDF/impresión y CSV por turno. _(2026-05-06 sesión 3)_
- ReportsPage: comparativa período anterior en Estado de Resultados (4 KPIs con delta ▲/▼). _(2026-05-06 sesión 3)_
- CustomersPage: Ficha 360 con tabs (Resumen, Compras, Cuotas/Deudas, Contacto). _(2026-05-06 sesión 3)_

---

## Brechas principales (estado actual)

- Tipos generados de Supabase desactualizados — muchas tablas nuevas se usan con `as any`.
- CLI de Supabase autenticado con cuenta distinta a la del proyecto real (`wcfohngxrtopgggumjmw`). Las funciones edge deben desplegarse desde el dashboard o con login correcto.
- Triggers de DB (`trg_sale_cash_entry`, `trg_sale_stock_movement`, `trg_purchase_stock_movement`) tienen `m.created_at` incorrecto — fix SQL listo en `docs/fix_production_sql.sql` pero pendiente de aplicar en producción.
- RLS de `influencer_exchanges` bloquea inserts — fix incluido en `docs/fix_production_sql.sql`.
- Falta flujo venta→caja→factura probado end-to-end.
- Falta suite E2E automatizada (Playwright) para flujos críticos.
- Backups manuales y restauración no documentados.
- Reportes de cierre de caja no exportables.

---

## Hecho y faltante por área

| Área | Hecho | Faltante recomendado |
| --- | --- | --- |
| Base técnica | React/Vite, Tailwind, Radix, React Query, PWA, Sentry, rutas protegidas | Tipos Supabase actualizados, limpieza de `any`, code splitting (chunk >1500kB) |
| Autenticación y organizaciones | Auth, OrgProvider, memberships, roles, invitaciones, platform admin, RLS org_id | Matriz de permisos formal, eliminar restos de `user_roles` legacy |
| Inventario | Kardex, triggers stock, ajustes auditados, toma física, restock, sucursales | Stock por sucursal en POS, lotes con vencimiento en UI, importación masiva |
| Ventas y POS | Ventas, POS, recibo, deudas, cuotas, devoluciones, presupuestos, caja, **export PDF+CSV cierre** | Flujo end-to-end probado, modo offline |
| Clientes/CRM | Clientes, notas, segmentación, pipeline, referidos, fidelidad, **Ficha 360 con tabs** | Merge de duplicados, consentimiento comunicaciones |
| Finanzas | Gastos, deudas, cheques, proveedores, conciliación bancaria, flujo de caja | Estado de resultados mensual, reporte fiscal exportable, gastos recurrentes en UI |
| Facturación | Facturas, PDF, email, campos AFIP, retry en errores | Notas de crédito integradas a devoluciones, numeración robusta, vincular factura↔venta |
| Marketing | Posts, templates, campañas, catálogo, combos, banners, influencers | Tracking de conversión, verificación de dominio email, ROI por campaña |
| IA y analytics | Insights, chat, predicción, recomendaciones, health score | Límites de costo por plan, trazabilidad de recomendaciones aplicadas |
| Integraciones | Tiendanube, MP, Stripe, AFIP, Public API, webhooks salientes, **health check panel** | Dead-letter queue, monitor tiempo real |
| SaaS y planes | Pricing, checkout Stripe, subscriptions, entitlements, platform admin | Enforcement de límites verificado en prod, métricas por tenant |
| UX y accesibilidad | Layout completo, mobile, command palette, empty states | Accesibilidad, performance en tablas grandes, onboarding persistente |
| Operaciones | Sentry, backups, crons, rate limiter | Runbook de producción, monitoreo de crons, restauración documentada |

---

## Prioridades inmediatas

### P0 — Estabilizar antes de usar en producción

- [x] Crear documentación mínima en `README.md`. _(2026-05-05)_
- [ ] **Aplicar `docs/fix_production_sql.sql` en el dashboard de Supabase** — fix `m.created_at` en triggers y RLS `influencer_exchanges`. _(pendiente — SQL listo en `docs/fix_production_sql.sql`)_
- [ ] **Loguear CLI con cuenta correcta y desplegar edge functions** — `supabase login` + `supabase link --project-ref wcfohngxrtopgggumjmw` + deploy de las 32 funciones. _(pendiente)_
- [ ] Generar tipos actualizados de Supabase y eliminar `as any` en flujos críticos. _(bloqueado por CLI con cuenta incorrecta)_
- [x] Revisar todas las consultas para usar `org_id` como criterio principal multi-tenant. _(2026-05-05)_
- [x] Auditar RLS tabla por tabla. _(2026-05-05)_
- [x] Agregar validación de variables de entorno de frontend. _(2026-05-05)_
- [x] Crear pruebas de smoke para login, dashboard, productos, venta, deuda, caja y factura. _(2026-05-06)_
- [x] Correr `npm run build`, `npm run lint` y dejar una línea base limpia. _(2026-05-05)_
- [x] Documentar migraciones, buckets de storage y secrets necesarios. _(2026-05-05)_
- [x] Revisar seguridad de `.env`. _(2026-05-05)_

### P1 — Cerrar el core operativo

- [x] Definir un flujo único de stock: compra, venta, devolución, ajuste, transferencia y toma física. _(2026-05-05)_
- [x] Crear tabla o vista de movimientos de stock para trazabilidad. _(2026-05-05)_
- [x] Unificar presupuesto → venta con botón "Convertir en venta". _(2026-05-05)_
- [x] Completar estado de caja: apertura, movimientos, cierre, diferencias y reporte por turno. _(2026-05-05)_
- [x] Cuenta corriente de cliente con cuotas pendientes cobrables. _(2026-05-05)_
- [x] Proveedores: pagos parciales, deuda al proveedor e historial. _(2026-05-06)_
- [x] Conciliación bancaria vinculada con ventas, gastos, pagos y Mercado Pago. _(2026-05-06)_
- [x] Exportaciones: CSV y PDF para ventas, compras, gastos, productos, deudas, equipo. _(2026-05-06)_
- [ ] **Flujo venta/POS probado end-to-end** (presupuesto → venta → caja → factura). _(pendiente)_
- [x] **Reporte de cierre de caja imprimible/exportable** (print PDF + CSV desde CashSessionPage). _(2026-05-06 sesión 3)_
- [ ] Backups manuales y restauración documentada. _(pendiente)_

### P2 — Preparar lanzamiento SaaS

- [x] Límites reales por plan en productos, ventas y usuarios. _(2026-05-05)_
- [x] Onboarding persistente en base de datos. _(2026-05-05)_
- [x] Pantalla de pricing y estado de suscripción mejorados. _(2026-05-06)_
- [x] Ciclo de trial y dunning completo. _(2026-05-05)_
- [x] Platform admin con soporte, suspensión y audit log. _(2026-05-06)_
- [x] Datos demo por rubro para onboarding. _(2026-05-05)_
- [x] Política de privacidad y términos (ley argentina 25.326). _(2026-05-06)_

### P3 — Integraciones confiables

- [x] Tiendanube: retry/backoff, HMAC-SHA256, ordersUpdated, soft-delete. _(2026-05-06)_
- [x] Mercado Pago: webhook con HMAC-SHA256, pago confirmado, multi-org. _(2026-05-06)_
- [x] Stripe: webhooks idempotentes, dunning completo, notificaciones in-app. _(2026-05-06)_
- [x] AFIP: ambientes separados, errores tipificados, retry button. _(2026-05-06)_
- [x] Public API: versionado `/v1/`, rate limits, API keys rotables, scopes. _(2026-05-06)_
- [x] Webhooks salientes: HMAC, retries, historial de entregas. _(2026-05-06)_
- [x] Health check visual por integración (panel con `integration_logs`). _(2026-05-06 sesión 3)_
- [ ] Dead-letter queue simple para webhooks fallidos. _(pendiente)_

### P4 — Automatización, IA y crecimiento

- [ ] Automatizaciones con historial de ejecución y simulador.
- [ ] Campañas de email con segmentos guardados, consentimiento y métricas.
- [ ] IA con controles de costo, límites por plan y trazabilidad.
- [ ] Reportes avanzados por sucursal, vendedor, categoría y período.
- [ ] Forecast con comparación real vs proyectado.
- [ ] Alertas inteligentes: stock, margen bajo, deuda vencida, clientes inactivos.
- [x] Ficha 360 de cliente: compras, deudas, comunicaciones, puntos en un solo lugar. _(2026-05-06 sesión 3)_
- [ ] Notas de crédito integradas a devoluciones en AFIP.

---

## Plan de acción — próximos pasos concretos

### 🔴 Urgente (bloquea el uso en producción)

| # | Acción | Cómo | Estado |
|---|--------|------|--------|
| 1 | Aplicar fix SQL en producción | Pegar `docs/fix_production_sql.sql` en Supabase Dashboard SQL Editor (`wcfohngxrtopgggumjmw`) | ⏳ Pendiente |
| 2 | Desplegar edge functions con cuenta correcta | `supabase login` → `supabase link --project-ref wcfohngxrtopgggumjmw` → `supabase functions deploy --no-verify-jwt` para las 32 funciones | ⏳ Pendiente |

### 🟠 Esta semana (Fase 0 + Fase 1 restantes)

| # | Acción | Detalle |
|---|--------|---------|
| 3 | Generar tipos Supabase actualizados | `supabase gen types typescript --project-id wcfohngxrtopgggumjmw > src/integrations/supabase/types.ts` (requiere paso 2) |
| 4 | Eliminar `as any` en flujos críticos | supabaseStore.ts, POSPage, SalesPage, CashSessionPage, InvoicesPage |
| 5 | Flujo end-to-end venta→caja→factura | Probar manualmente: crear venta en POS → verificar cash_entry → emitir factura → ver en reportes |
| 6 | Reporte de cierre de caja exportable | Agregar botón "Exportar PDF/CSV" en CashSessionPage con resumen del turno |
| 7 | Documentar restauración de backups | Agregar sección en README con pasos para restaurar desde dump de Supabase |

### 🟡 Próximas 2 semanas (Fase 2 completar + Fase 3 cerrar)

| # | Acción | Detalle |
|---|--------|---------|
| 8 | Health check visual de integraciones | Sección en IntegrationsPage: última ejecución, estado OK/error, latencia por integración |
| 9 | Ficha 360 de cliente | Tab unificado en CustomersPage: compras, deudas, pagos, puntos, notas y comunicaciones |
| 10 | Estado de resultados mensual | Vista en ReportsPage: ingresos, egresos, margen neto, comparativa mes anterior |
| 11 | Code splitting para reducir chunk size | `React.lazy()` + `Suspense` en rutas pesadas (IA, Analytics, Marketing) |
| 12 | Suite E2E con Playwright | Login → crear producto → venta en POS → cobrar deuda → cerrar caja |

### 🟢 Mes siguiente (Fase 4 — diferenciación)

| # | Acción | Detalle |
|---|--------|---------|
| 13 | Automatizaciones con historial | Tabla `automation_runs`, UI de historial, simulador de prueba antes de activar |
| 14 | Campañas email con métricas | Tracking de apertura/click via Resend webhooks, bajas one-click, segmentos guardados |
| 15 | Forecast validado | Predicción de ventas con comparación vs real en gráfico semanal/mensual |
| 16 | Alertas inteligentes configurables | Umbral por org para stock bajo, margen mínimo, deuda vencida, cliente inactivo |
| 17 | Migración de datos desde Lovable | Ejecutar `scripts/migrate-data.mjs` cuando estén disponibles las keys del proyecto Lovable |

---

## Fases sugeridas

### Fase 0 — Orden y seguridad técnica
**Duración sugerida: 1 semana. 90% completa.**

- [x] README completo. _(2026-05-05)_
- [x] `.env.example` revisado. _(2026-05-05)_
- [x] CI básico con lint, build y tests. _(existente)_
- [x] Documento de tablas, buckets, crons y Edge Functions. _(2026-05-05)_
- [ ] Tipos de Supabase actualizados. _(bloqueado por CLI — requiere login correcto)_
- [ ] Lista de permisos/RLS por tabla. _(pendiente)_

### Fase 1 — Beta operativa para uso interno
**Duración sugerida: 1 a 2 semanas. 85% completa.**

- [x] Stock consistente ante compras, ventas, devoluciones y ajustes.
- [x] Caja con cierre y diferencias.
- [x] Deudas y pagos sincronizados con ventas.
- [x] Devolución con impacto automático en stock y caja.
- [ ] Flujo venta/POS probado de punta a punta. _(pendiente)_
- [ ] Reporte de cierre imprimible/exportable. _(pendiente)_
- [ ] Backups manuales y restauración documentada. _(pendiente)_

### Fase 2 — Producto comercial
**Duración sugerida: 2 a 4 semanas. Completa.**

- [x] Planes y límites aplicados.
- [x] Trial completo.
- [x] Onboarding persistente.
- [x] Equipo y roles.
- [x] Platform admin con herramientas de soporte.
- [x] Landing/pricing listos para conversión.
- [x] Política de privacidad y términos.

### Fase 3 — Integraciones y automatizaciones
**Duración sugerida: 3 a 5 semanas. 85% completa.**

- [x] Tiendanube estable con webhooks y sync controlado.
- [x] Mercado Pago conciliado.
- [x] AFIP con reintentos y errores tipificados.
- [x] Webhooks/API documentados.
- [x] Health check visual por integración (panel en IntegrationsPage). _(2026-05-06 sesión 3)_
- [ ] Dead-letter queue simple. _(pendiente)_
- [ ] Monitor de integraciones en tiempo real. _(pendiente)_

### Fase 4 — Inteligencia y escala
**Duración sugerida: continuo. En planificación.**

- [ ] Automatizaciones con historial de ejecución.
- [ ] Campañas email con segmentos y métricas.
- [ ] Forecast validado vs real.
- [ ] Alertas inteligentes configurables.
- [ ] Ficha 360 de cliente.
- [ ] PWA/offline para POS.
- [ ] Code splitting y optimización de tablas grandes.
- [ ] Observabilidad completa.

---

## Roadmap por módulos

### 1. Productos e inventario

Hecho:
- CRUD de productos con imágenes múltiples.
- Variantes, stock general.
- Compras que aumentan stock / Ventas que descuentan stock.
- Alertas de stock bajo.
- Toma física.
- Restock automático.
- Sucursales y stock por ubicación en base de datos.
- Kardex: `stock_movements`, triggers en ventas/compras, `record_stock_movement`, `kardex_summary`, KardexPage. _(2026-05-05)_
- Ajustes de stock auditados con `adjust_stock`. _(2026-05-05)_
- Lotes de producto: tabla `product_lots`. _(estructura creada)_

Faltante:
- Integrar stock por sucursal en POS y ventas.
- Validar importación masiva y exportación de productos.
- Alertar margen bajo o precio desactualizado.
- Manejar fechas de vencimiento de lotes en UI.

### 2. Ventas, POS y caja

Hecho:
- Registro de ventas, POS, recibos.
- Ventas pagadas o con deuda.
- Descuento/cupones, cuotas, devoluciones, presupuestos.
- Turnos de caja con apertura/cierre/diferencias. _(2026-05-05)_
- Movimientos de caja por venta via trigger `trg_sale_cash_entry`. _(2026-05-05)_
- Vista `cash_session_summary` con totales por método de pago. _(2026-05-05)_
- Comisiones de vendedores.
- Cobro de deuda con registro en caja via `record_debt_payment_cash_entry`. _(2026-05-05)_
- `usePlanLimits` con `checkSalesLimit` integrado en SaleForm y POSPage. _(2026-05-06)_

Faltante:
- Flujo único: presupuesto → venta → pago → factura → caja (aún hay pasos manuales).
- Reporte de cierre imprimible/exportable.
- Modo offline o tolerancia a cortes de conexión para POS.
- Pruebas automatizadas de venta y devolución.

### 3. Clientes y CRM

Hecho:
- CRUD de clientes, notas, segmentación automática, pipeline, referidos, fidelidad, cumpleaños.
- Ficha 360 con tabs: Resumen (KPIs + productos favoritos), Compras (timeline), Cuotas/Deudas, Contacto (notas + comunicaciones + WhatsApp). _(2026-05-06 sesión 3)_

Faltante:
- Merge de clientes duplicados.
- Historial de comunicaciones centralizado.
- Consentimiento para email/WhatsApp.
- Segmentos guardados reutilizables.

### 4. Finanzas y administración

Hecho:
- Gastos, deudas de clientes, cheques, proveedores, conciliación bancaria, flujo de caja, reportes.
- Pagos parciales a proveedores con historial. _(2026-05-06)_
- Conciliación bancaria con ventas, gastos, pagos y MP. _(2026-05-06)_

Faltante:
- Estado de resultados mensual.
- Reporte fiscal/contable exportable.
- Gastos recurrentes visibles y editables desde UI.
- Auditoría de cambios financieros.

### 5. Facturación Argentina

Hecho:
- Pantalla de facturas, PDF, email, configuración AFIP.
- Edge Function de autorización AFIP con ambientes separados y errores tipificados. _(2026-05-06)_
- Botón "Reintentar" en errores AFIP. _(2026-05-06)_

Faltante:
- Notas de crédito/débito integradas a devoluciones.
- Numeración y punto de venta robustos.
- Vincular factura con venta y cliente.

### 6. Marketing, catálogo e influencers

Hecho:
- Posts, templates, catálogo público, QR/PDF, combos, banners, historias, campañas de email, influencers, canjes y liquidaciones.

Faltante:
- Tracking de conversión por campaña.
- Verificación de dominios para email.
- Gestión de bajas y preferencias.
- Vista de ROI de marketing.

### 7. Integraciones

Hecho:
- Tiendanube OAuth, sync y webhooks. _(2026-05-06)_
- Mercado Pago link y webhook con HMAC. _(2026-05-06)_
- Stripe checkout, cancelación y webhook idempotente. _(2026-05-06)_
- AFIP con retry y errores tipificados. _(2026-05-06)_
- Public API versionada con rate limits y rotación de keys. _(2026-05-06)_
- Webhooks salientes con HMAC, retries e historial. _(2026-05-06)_

Faltante:
- Health check visual por integración.
- Dead-letter queue simple.
- Documentación de API y webhooks para usuarios.

### 8. Equipo, roles y permisos

Hecho:
- Roles admin, vendedor y viewer, invitaciones, miembros por organización, platform admin.

Faltante:
- Matriz de permisos formal documentada.
- Eliminar ambigüedad entre `user_roles` (legacy) y `memberships`.
- Auditoría de cambios de rol.
- Permisos más finos: caja, ventas, inventario, finanzas, ajustes.

### 9. Testing, calidad y mantenimiento

Hecho:
- Vitest configurado, CI con build/lint/test.
- Tests unitarios de cálculos de precios, impuestos y formato. _(2026-05-05 — 15 tests)_
- Tests de smoke para importación de páginas y lógica de negocio. _(2026-05-06 — 54 tests)_
- Script de migración de datos entre proyectos Supabase. _(2026-05-06 — `scripts/migrate-data.mjs`)_

Faltante:
- Tests E2E con Playwright: login, producto, venta, pago, caja, factura, permisos.
- Mocks para Edge Functions.
- Convención de tipos y validaciones Zod en formularios críticos.
- Documentación técnica y manual de usuario.

---

## Criterio de terminado por funcionalidad

Una funcionalidad se considera lista cuando cumple:

- Tiene permisos correctos por rol y organización.
- Guarda y lee datos por `org_id` (no por `user_id`).
- Tiene validaciones de formulario y mensajes de error claros.
- Maneja loading, empty state y error state.
- Tiene auditoría si modifica datos sensibles.
- No rompe stock, caja, deuda ni reportes.
- Tiene al menos una prueba automatizada del camino feliz y un caso de error.
- Está documentada si requiere configuración o afecta integraciones.
- Funciona en desktop y mobile.
- No depende de datos hardcodeados o `localStorage` para estado importante.

---

## Métricas de producto a medir

- Tiempo hasta primera venta registrada.
- Ventas registradas por organización por día.
- Productos con stock desactualizado o negativo.
- Diferencia promedio de caja por turno.
- Deudas vencidas y tasa de cobro.
- Clientes recurrentes vs clientes inactivos.
- Conversión de trial a pago.
- Uso de funciones IA por plan.
- Fallos de integraciones por día.
- Tiempo promedio de carga de dashboard y listas grandes.

---

## Riesgos a vigilar

- Triggers de DB con `m.created_at` incorrecto bloquean inserts de ventas en producción — **fix pendiente de aplicar**.
- CLI Supabase autenticado con cuenta incorrecta — edge functions desplegadas al proyecto equivocado.
- Tipos Supabase desactualizados ocultan errores en runtime.
- Webhooks duplicados o fallidos que creen ventas/stock inconsistentes.
- Costos IA sin límites por plan.
- Facturación fiscal con errores por configuración AFIP.
- PWA cacheando datos viejos en pantallas sensibles.
- Datos mezclados entre organizaciones si alguna consulta filtra por `user_id` en lugar de `org_id`.

---

## Próximos 10 pasos recomendados

| # | Paso | Prioridad |
|---|------|-----------|
| 1 | ⚡ Aplicar `docs/fix_production_sql.sql` en Supabase Dashboard | 🔴 Urgente |
| 2 | ⚡ Loguear CLI con cuenta correcta y desplegar las 32 edge functions | 🔴 Urgente |
| 3 | Generar `src/integrations/supabase/types.ts` actualizado | 🟠 Alta |
| 4 | Eliminar `as any` en supabaseStore.ts, POSPage y SalesPage | 🟠 Alta |
| 5 | Probar flujo end-to-end: venta POS → cash_entry → factura | 🟠 Alta |
| 6 | ~~Exportar reporte de cierre de caja~~ | ✅ Hecho (sesión 3) |
| 7 | ~~Health check visual de integraciones~~ | ✅ Hecho (sesión 3) |
| 8 | ~~Ficha 360 de cliente con tab unificado~~ | ✅ Hecho (sesión 3) |
| 9 | Dead-letter queue: mostrar webhooks fallidos con botón Retry en IntegrationsPage | 🟡 Media |
| 10 | Suite E2E con Playwright para flujos críticos | 🟡 Media |
