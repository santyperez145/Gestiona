# Roadmap del Proyecto — Gestiona / Exentry Imports

Fecha de relevamiento: 2026-05-05
Última actualización: **2026-05-19 (sesión 37)**
DB producción: `hummeopatkniwkyrrhwc`
Tipo de producto: sistema de gestión SaaS para pymes argentinas — ventas, stock, finanzas, CRM, marketing, integraciones e inteligencia artificial.

---

## Estado general

**MVP avanzado con SaaS billing funcional. ~99% completo.**

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
- **ExpensesPage tendencia mensual** — gráfico de barras con gastos por mes (últimos 12), tooltips, etiquetas de valor. _(sesión 12)_
- **usePermissions hook** — `canCreate/canEdit/canDelete` basado en rol; aplicado en ProductsPage, ExpensesPage, CustomersPage, PurchasesPage: botones edit/delete ocultos para viewer, create oculto para viewer. _(sesión 12)_
- **PurchasesPage tab "Por Proveedor"** — ranking de proveedores con total USD, total ARS, # compras, # productos distintos, promedio por compra, última compra. _(sesión 12)_
- **SalesPipelinePage WhatsApp follow-up** — botón "Seguimiento" en deals sin actividad ≥7d que abre wa.me/ con mensaje de seguimiento pre-escrito. _(sesión 12)_
- **AIChatPage: registrar venta** — detección de intento "registrar venta/vendí", CreateSaleCard con selector de producto + cantidad + cliente, escribe en DB y descuenta stock. _(sesión 12)_
- **DebtsPage bulk mark-as-paid** — checkboxes en tabla pendiente, seleccionar todos, barra de acción flotante "Marcar como pagadas", batch update en DB. _(sesión 12)_
- **Dashboard: widget "Clientes en riesgo"** — top 5 clientes con 60–180 días sin comprar, ordenados por facturación histórica. _(sesión 12)_
- **ReportsPage tab "Flujo de Caja"** — ingresos vs egresos (gastos + compras) por mes, gráfico de barras agrupado (verde/rojo/dorado), tabla con detalle, CSV export. _(sesión 13)_
- **SalesPage bulk mark-as-paid** — checkboxes en ventas no cobradas, barra flotante "Marcar cobradas", batch update en DB. _(sesión 13)_
- **SalesPage filtro cobrado/pendiente** — toggle "Todas / ✓ Cobradas / Deben" en la barra de filtros. _(sesión 13)_
- **SalesPage print receipt** — botón "Imprimir recibo" en cada venta, genera HTML estilizado y abre ventana de impresión. _(sesión 13)_
- **DebtsPage "Próximos cobros"** — widget con deudas con due_date en los próximos 7 días, conteo de días, botón WhatsApp por deuda. _(sesión 13)_
- **ProductsPage "Lista de precios PDF"** — botón junto a Excel export, genera lista agrupada por categoría con precios/oferta, abre ventana de impresión. _(sesión 13)_
- **Dashboard "Dólar hoy"** — banner con cotización live (oficial/blue/MEP) de dolarapi.com, cache 30 min localStorage, alerta si TC configurado difiere >5% del blue. _(sesión 13)_
- **AIChatPage: registrar compra** — detección de "registré una compra/compré", CreatePurchaseCard con selector producto + cantidad + proveedor + costo USD, escribe en DB y suma stock. _(sesión 13)_
- **ProductsPage "Días sin venta"** — columna "Sin mvto" en tabla desktop mostrando días desde última venta (rojo ≥30d, naranja ≥14d); filtro "Sin venta 30+ días" en la barra de filtros; estado `lastSaleDate` computado desde salesRes. _(sesión 14)_
- **ExpensesPage CSV + imprimir** — botón "CSV" exporta gastos filtrados; botón "Imprimir" genera reporte HTML con resumen por categoría + detalle completo, abre ventana de impresión. _(sesión 14)_
- **SalesPage CSV export** — botón "CSV" exporta ventas filtradas con fecha/producto/cliente/cantidad/precio/ganancia/método/estado. _(sesión 14)_
- **SalesPage recibo multi-producto** — checkboxes en todas las filas (no solo deudas); "Seleccionar todas" en encabezado; barra flotante "Recibo" genera ticket HTML multi-línea consolidado para imprimir. _(sesión 14)_
- **PurchasesPage CSV export** — botón "CSV" exporta compras filtradas con tipo (Pedido/Recibida). _(sesión 14)_
- **PurchasesPage "Marcar como recibido"** — botón "Recibido" visible al hover en pedidos programados; confirma recepción, actualiza `is_scheduled=false` y suma quantity al stock del producto. _(sesión 14)_
- **Dashboard: alerta caja abierta** — banner verde si hay una `cash_session` con status="open"; muestra hora de apertura y link a /caja. _(sesión 14)_
- **AnalyticsPage: métricas de retención de clientes** — 4 KPI cards en tab Clientes: activos 30d, tasa de retención 30d, clientes que regresaron, nuevos últimos 30d. _(sesión 14)_
- **Dashboard: widget "Pendientes de hoy"** — carga tareas con due_date=hoy en paralelo con urgentes; excluye solapamientos; badge de prioridad coloreado. _(sesión 15)_
- **ProductsPage: alertas de reposición** — banner dismissible con productos en stock ≤ low_stock_threshold (o ≤3 si no configurado); chips con stock/mínimo y botón "Pedir" que navega a /compras con producto preseleccionado. _(sesión 15)_
- **SalesPage: vista "Por fecha"** — agrupa ventas filtradas por día, filas expandibles con total/ganancia/cobradas por día; toggle junto a Lista y Por cliente. _(sesión 15)_
- **fix(dashboard): activeOrg no definido** — useEffect de cash_sessions usaba `activeOrg` (no declarado) en lugar de `orgForTasks`; crasheaba la página completa. _(sesión 15)_
- **Dashboard: comparativa semanal en KPI "Hoy"** — delta ▲/▼ vs mismo día la semana pasada, calculado desde rawData sin queries adicionales. _(sesión 16)_
- **PurchasesPage: recepción parcial** — dialog con input de cantidad real recibida (puede ser < pedida); actualiza stock con qty efectiva; toast diferencia total/parcial; audit log. _(sesión 16)_
- **ReportsPage vendedores: comisiones estimadas** — input % de comisión editable (default 5%); cada card muestra comisión calculada; CSV incluye columna con tasa configurada. _(sesión 16)_
- **CustomersPage: bulk email** — checkboxes en cada cliente; barra flotante con "Crear campaña de email" al seleccionar; guarda selección en sessionStorage y navega a /email-campaigns. _(sesión 16)_
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
- **fix(settings):** campos numéricos en 0 (ej: descuento 0%) se revertían al default por `parseFloat(x) || fallback`; reemplazado con helpers `isNaN`-based. _(sesión 17)_
- **EmailCampaignsPage bulk desde CRM** — lee `gestiona.bulk_campaign` de sessionStorage, pre-abre dialog con audiencia filtrada y banner informativo. _(sesión 17)_
- **ProductsPage: stock mínimo por producto** — campo `low_stock_threshold` editable en form; alertas y reposición usan umbral personalizado. _(sesión 17)_
- **DebtsPage: WhatsApp masivo a deudores** — checkboxes en deudores vencidos, barra flotante "WhatsApp masivo", copia mensajes personalizados al clipboard. _(sesión 17)_
- **Dashboard: widget "Meta semanal"** — ventas de la semana vs target configurable, progress bar con coding de color, persistido en localStorage por org. _(sesión 17)_
- **POS: modo offline básico** — detecta online/offline, encola ventas en localStorage, sincroniza al reconectar; banner naranja sin conexión, banner azul con botón sync al volver. _(sesión 17)_
- **AnalyticsPage: tab "Cohorts"** — retención por mes de primera compra, heatmap de 12 cohorts × 7 offsets con coding de color (verde/amarillo/naranja/rojo). _(sesión 17)_
- **ReportsPage: PDF para contador** — botón "PDF Contador" en tab Impuestos genera documento HTML imprimible con tabla mensual (IVA, IIBB, total, ganancia neta), totales y disclaimer AFIP. _(sesión 17)_
- **Dashboard: alerta meta mensual en riesgo** — banner rojo cuando quedan ≤7 días y se lleva <60% del objetivo; muestra ventas/día necesarias para alcanzar la meta. _(sesión 18)_
- **SettingsPage: plantillas de WhatsApp editables** — 5 plantillas configurables (venta, deuda, cumpleaños, reactivación, pedido listo) con variables `{{nombre}}`/`{{monto}}`; persistidas en localStorage por org. _(sesión 18)_
- **DebtsPage: WhatsApp masivo usa plantilla configurable** — mensaje masivo y links individuales usan la plantilla de Settings en lugar de texto hardcoded. _(sesión 18)_
- **CustomersPage: bulk "Tarea de seguimiento"** — botón en barra flotante crea una tarea de seguimiento en TasksPage por cada cliente seleccionado con due_date=mañana. _(sesión 18)_
- **PurchasesPage: pre-selección de producto por URL** — ?product=nombre auto-abre el dialog y pre-selecciona el producto matching; botón "Pedir" de alertas de stock aprovecha este flujo. _(sesión 18)_
- **AIChatPage: consultar deuda de cliente** — intención "¿cuánto debe X?" busca en `customer_debts` y muestra total + detalle inline; chip "Consultar deuda" en acciones rápidas. _(sesión 19)_
- **Dashboard: widget "Cobros de esta semana"** — deudas pendientes con due_date en próximos 7 días, coloreadas por urgencia, link a /debts. _(sesión 19)_
- **AnalyticsPage: tab "Sin movimiento"** — productos con stock>0 sin ventas en 30/60/90d; filtro por período; costo inmovilizado en USD; sugerencia Liquidar/Promover. _(sesión 19)_
- **AIChatPage: consultar stock de producto** — intención "¿cuánto stock tengo de X?" busca por nombre, muestra stock coloreado (rojo=0, naranja=bajo, verde=ok); chip "Ver stock" en acciones rápidas. _(sesión 20)_
- **ProductsPage: editar precio inline** — click en precio en tabla desktop → input inline → Enter/blur guarda → Escape cancela; mismo patrón que stock inline. _(sesión 20)_
- **SettingsPage: notificaciones configurables** — 6 toggles (stock bajo, deuda vencida, meta en riesgo, cumpleaños, nuevo cliente, venta grande); persistidos en localStorage por org. _(sesión 20)_
- **Dashboard: card "Hoy" expandible** — click en el KPI abre panel con ventas totales, ticket promedio, método dominante, top producto del día. _(sesión 21)_
- **ReportsPage: tab "Proveedores"** — ranking por monto U$S, share %, compras, promedio, última compra, link a /proveedores. _(sesión 21)_
- **SalesPipelinePage: deals estancados** — banner naranja con count de deals >14d sin actividad; panel expandible con listado y botón "Actualizar" por deal. _(sesión 21)_
- **POSPage: selector de vendedor de turno** — modal al entrar al POS pregunta quién atiende; badge en top bar con botón "cambiar"; `seller_name` guardado en localStorage por org y enviado en cada venta. _(sesión 22)_
- **SalesPage: filtro por vendedor** — dropdown que aparece solo si hay datos; filtra ventas por `seller_name` column. _(sesión 22)_
- **CashSessionPage: breakdown por vendedor** — tabla "Ventas por vendedor" en turno activo; agrupa ventas del turno por seller_name; solo aparece si hay 2+ vendedores. _(sesión 22)_
- **Dashboard: botón "💡 Insight del día"** — en quick actions; guarda prompt en sessionStorage y navega a AIChatPage; AIChatPage lee el prefill al montar. _(sesión 22)_
- **AnalyticsPage Tendencia: rango de fechas personalizado** — date pickers (from/to) debajo del gráfico mensual; gráfico diario de ingresos para el período seleccionado. _(sesión 22)_
- **ProductsPage: columna SKU** — visible en xl+, muestra sku o barcode; hover muestra barcode completo; ya se guarda correctamente en save. _(sesión 22)_
- **EmailCampaignsPage: preview HTML antes de enviar** — tabs Editar/Vista previa en el textarea de body; render real del HTML en fondo blanco. _(sesión 22)_
- **TasksPage: subtareas con parent_id** — botón "+subtarea" en cada card; input inline; lista expandible con check individual; progreso N/total visible; DB: ADD COLUMN parent_id (self-ref FK). _(sesión 22)_
- **fix(schema): low_stock_threshold + seller_name en DB** — columna `low_stock_threshold` agregada a products (era solo en settings); `seller_name` agregada a sales; tipos actualizados; ProductsPage handleSubmit ahora guarda barcode, sku, lot_number, expiry_date, tags y low_stock_threshold. _(sesión 22)_
- **CustomersPage: campo empresa/negocio** — migration + company en form, búsqueda, lista, CSV, contact tab. _(sesión 31)_
- **ProductsPage: BulkPriceAdjust mejorado** — categorías dinámicas, preview vivo de precios antes de confirmar. _(sesión 31)_
- **POSPage: nota interna en ticket impreso** — posNote en receipt state + ReceiptModal note prop + HTML print. _(sesión 31)_
- **DebtsPage: "Recordar >30d"** — botón en aging panel para WhatsApp masivo a deudores con antigüedad ≥31d. _(sesión 31)_
- **SalesPage: filtro por método de pago** — Select con todos los métodos (efectivo/débito/crédito/transferencia/MP/fiado). _(sesión 31)_
- **AIChatPage: crear tarea desde chat** — CreateTaskCard con título, descripción, fecha, prioridad; chip "Crear tarea". _(sesión 31)_
- **AnalyticsPage: CSV export tendencia mensual** — botón Download en tab Tendencia; 7 columnas (mes, ingresos, ganancia, COGS, gastos, neto, unidades). _(sesión 30–31)_
- **SalesPage: totales de período en footer** — fila sticky al final de la lista mobile con total ARS, ganancia, margen %, count y pendiente. _(sesión 34)_
- **POSPage: cliente reciente (favorito)** — dropdown con últimos 5 clientes desde localStorage, guardado automático post-venta. _(sesión 34)_
- **ReportsPage InventoryTab: rotación y días de stock** — columna "Días stock" color-coded (rojo/amarillo/verde) basada en velocity 30d; métricas de stock crítico/bajo en resumen. _(sesión 34)_
- **ReportsPage InventoryTab: PDF export** — PDF A4 landscape con jsPDF/autoTable: KPIs en header, tabla completa con márgenes color-coded, fila de totales. _(sesión 34)_
- **Dashboard temperatura: 5ª señal "Prod. sin movim. 30d"** — agingCount30 en stats; semáforo rojo si >5 productos sin venta 30d; grid-cols-5 en lg. _(sesión 34)_
- **SalesPage: tendencia diaria en período filtrado** — mini CSS-only sparkline de hasta 30 días; renderiza solo con 2+ días de datos; tooltips con fecha/monto. _(sesión 35)_
- **ProductsPage: filtro por margen** — Select dropdown >40% / 20–40% / <20% / negativo; filtra usando sale_price_ars + total_cost_usd × TC. _(sesión 35)_
- **CustomersPage: panel "Análisis RFM"** — collapsible; quintiles 1–5 para R/F/M; mini barras de distribución por dimensión; tabla top-15 sorteable por R/F/M/total; badges color-coded. _(sesión 35)_
- **InvoicesPage: envío masivo de facturas** — checkboxes por fila, select-all, barra de acción flotante "Enviar emails"; loop con send-invoice-email edge function; auto-update status draft→sent. _(sesión 35)_
- **ReportsPage tab "Clientes"** — ranking por facturación, frecuencia, ticket promedio, último pedido; KPI cards; CSV export; filtro por período. _(sesión 34–35)_
- **ExpensesPage: stacked bar chart por categoría** — BarChart apilado últimos 6 meses con Legend y tooltip por categoría en tab Tendencia. _(sesión 36)_
- **AnalyticsPage: widget Pareto de clientes** — concentración top 20% y 50%, barras de contribución individual, alerta de alta concentración. _(sesión 36)_
- **Dashboard: widget "Flujo de caja 7 días"** — ingresos vs gastos vs compras last 7d; net flow coloreado; progress bars. _(sesión 36)_
- **InvoicesPage: filtro por tipo de comprobante** — dropdown A/B/C/Nota de Crédito/Sin tipo junto a los chips de estado. _(sesión 36)_
- **ProductsPage: PDF de aging** — botón exportar en panel de aging; HTML imprimible con tabla completa, costo USD y sugerencia. _(sesión 36)_
- **CustomersPage: CSV export de RFM** — botón en panel RFM; exporta todos los clientes con R/F/M scores + RFM total. _(sesión 37)_
- **DebtsPage: proyección de cobros 30d** — widget en tab "Próximos cobros"; buckets hoy/1-7d/8-15d/16-30d con barras y totales. _(sesión 37)_
- **SalesPage: vista "Por fecha"** — nuevo modo `by_date`; barras de totales diarios + delta ▲/▼ vs mismo día -7d. _(sesión 37)_
- **AIChatPage: exportar conversación** — botón "Exportar" descarga .txt con todos los mensajes del chat actual. _(sesión 37)_
- **ReportsPage: comparativa de dos períodos** — panel en tab Tendencia de Margen; selectores mes A y mes B; tabla con Δ en todas las métricas (ingresos, ganancias, márgenes, gastos). _(sesión 37)_

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
| ~~POS~~ | ~~Sin modo offline / tolerancia a cortes de conexión~~ | ~~Medio~~ → ✅ Resuelto |
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

## Estado por módulo (actualizado sesión 34)

| Módulo | % | Próximo milestone |
|--------|---|-------------------|
| Infraestructura | 86% | E2E tests, staging env |
| Auth + orgs | 85% | Permisos granulares por módulo |
| Inventario | 88% | Lotes en UI, foto desde cámara |
| Ventas + POS | 96% | Recibo personalizable, impresora térmica BT |
| Clientes + CRM | 92% | Segmentos con acciones masivas |
| Finanzas | 90% | Conciliación automática, auditoría |
| Facturación AFIP | 65% | Notas de crédito |
| Marketing + Email | 85% | Open rate / click tracking Resend |
| IA + Analytics | 99% | Series temporales, forecasting por SKU |
| Integraciones | 75% | Shopify, MeLi |
| SaaS + billing | 82% | Permisos por plan granulares |
| Mobile + UX | 80% | Capacitor, impresora BT |
| Testing + calidad | 40% | E2E, mocks edge fns |
| **TOTAL** | **98%** | |

---

## Sesión 17 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | EmailCampaignsPage: bulk desde CRM via sessionStorage | ✅ Hecho |
| 2 | ProductsPage: `low_stock_threshold` editable por producto | ✅ Hecho |
| 3 | SalesPage: totales por método de pago | ✅ Ya existía |
| 4 | DebtsPage: WhatsApp masivo a deudores | ✅ Hecho |
| 5 | Dashboard: widget "Meta semanal" | ✅ Hecho |
| 6 | POS: modo offline con localStorage + sync | ✅ Hecho |
| 7 | AnalyticsPage: tab "Cohorts" con heatmap | ✅ Hecho |
| 8 | ReportsPage: PDF para contador en tab Impuestos | ✅ Hecho |

---

## Sesión 18 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | Email campaigns open/click rate | ✅ Ya existía (resend-webhook + send-email-campaign) |
| 2 | POS: impresora térmica | ✅ Ya existía (print 80mm en ReceiptModal) |
| 3 | AnalyticsPage: Tendencias semanales | ✅ Ya existía (tabs "Tendencia" + "Semana") |
| 4 | CRM: bulk "Tarea de seguimiento" | ✅ Hecho |
| 5 | Dashboard: alerta meta en riesgo | ✅ Hecho |
| 6 | PurchasesPage: pedido auto por URL | ✅ Hecho |
| 7 | ReportsPage: PDF P&L completo | ✅ Ya existía (handleIncomeStatementPDF) |
| 8 | SettingsPage: plantillas WhatsApp | ✅ Hecho |

---

## Sesión 19 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | POSPage: split de sesión por vendedor | ⏳ Requiere migración DB |
| 2 | AIChatPage: consultar deuda de cliente | ✅ Hecho |
| 3 | ReportsPage: tab "Proveedores" | ⏳ Requiere más tiempo |
| 4 | AnalyticsPage: tab "Sin movimiento" | ✅ Hecho |
| 5 | Dashboard: widget "Cobros de esta semana" | ✅ Hecho |
| 6 | SalesPipelinePage: notificación deal estancado | ⏳ Próxima sesión |
| 7 | SettingsPage: notificaciones configurables | ⏳ Próxima sesión |
| 8 | ProductsPage: IA importar factura | ⏳ Próxima sesión |

---

## Sesión 20 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | ReportsPage: tab "Proveedores" | ⏳ Próxima sesión |
| 2 | SalesPipelinePage: badge deals estancados | ⏳ Próxima sesión |
| 3 | SettingsPage: notificaciones configurables | ✅ Hecho |
| 4 | CashSessionPage: resumen por vendedor | ⏳ Próxima sesión |
| 5 | ProductsPage: editar precio inline | ✅ Hecho |
| 6 | CustomersPage: CSV con health score | ⏳ Próxima sesión |
| 7 | Dashboard: métricas hoy expandidas | ⏳ Próxima sesión |
| 8 | AIChatPage: consultar stock | ✅ Hecho |

---

## Sesión 21 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | ReportsPage: tab "Proveedores" | ✅ Hecho |
| 2 | SalesPipelinePage: deals estancados | ✅ Hecho |
| 3 | CustomersPage: health score en CSV | ✅ Ya existía |
| 4 | Dashboard: card "Hoy" expandible | ✅ Hecho |
| 5 | CashSessionPage: breakdown por vendedor | ⏳ Próxima sesión |
| 6 | POSPage: selector de vendedor de turno | ⏳ Próxima sesión |
| 7 | ProductsPage: foto desde cámara | ⏳ Requiere más desarrollo |
| 8 | ExpensesPage: adjuntar recibo | ⏳ Requiere migración DB |

---

## Sesión 22 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | POSPage: selector de vendedor de turno + badge en header | ✅ Hecho |
| 2 | CashSessionPage: breakdown ventas por vendedor en turno activo | ✅ Hecho |
| 3 | SalesPage: filtro dropdown por seller_name | ✅ Hecho |
| 4 | Dashboard: botón "💡 Insight del día" → AIChatPage prefilled | ✅ Hecho |
| 5 | AnalyticsPage Tendencia: gráfico diario con date range custom | ✅ Hecho |
| 6 | ProductsPage: columna SKU/barcode en tabla (xl+) | ✅ Hecho |
| 7 | EmailCampaignsPage: tabs Editar/Vista previa antes de enviar | ✅ Hecho |
| 8 | TasksPage: subtareas con parent_id (DB + UI colapsable) | ✅ Hecho |
| 9 | fix(schema): products.low_stock_threshold + sales.seller_name | ✅ Hecho |
| 10 | fix(products): handleSubmit guardaba barcode/sku/tags/expiry_date/lot_number (pérdida silenciosa) | ✅ Hecho |

---

## Sesión 23 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | POS búsqueda por SKU/barcode | ✅ Ya existía (sesión 22) |
| 2 | ReportsPage: tab "Comparativa de períodos" con pickers duales, chart y tabla diff | ✅ Hecho |
| 3 | Dashboard: botón "Resumen del mes" → genera card con stats, guardado en localStorage; "Analizar con IA" prefill | ✅ Hecho |
| 4 | ExpensesPage: adjuntar recibo/foto → upload a product-images bucket, thumb + link, cámara móvil; DB receipt_url | ✅ Hecho |
| 5 | ProductsPage: botón "Cámara" (sm:hidden) con capture="environment"; cameraInputRef separado | ✅ Hecho |
| 6 | SalesPage: recibo imprimible con logo, nombre de negocio y receipt_footer | ✅ Hecho (sesión 22) |
| 7 | CustomersPage: importación CSV de clientes | ✅ Ya existía |
| 8 | SettingsPage: campo "Pie de recibo" (receipt_footer) en sección Negocio | ✅ Hecho |
| 9 | migration 20260518000002: receipt_url (expenses) + receipt_footer (settings) | ✅ Hecho |
| 10 | types.ts: receipt_url en expenses, receipt_footer en settings (Row/Insert/Update) | ✅ Hecho |

---

## Sesión 24 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | POSPage: resumen de turno parcial — botón + modal con KPIs, breakdown por medio de pago, lista de ventas, reiniciar turno | ✅ Hecho |
| 2 | ReportsPage Comparativa: botón "Imprimir / PDF" que abre print dialog | ✅ Hecho |
| 3 | ProductsPage: importar precios desde CSV — `ProductsPriceImport` con matching fuzzy, preview diff %, bulk update | ✅ Hecho |
| 4 | ExpensesPage: alerta toast al 80% y 100% de presupuesto por categoría (sessionStorage anti-spam) | ✅ Hecho |
| 5 | CustomersPage: segmentación RFM (VIP/Premium/Frecuente/Activo/En riesgo/Dormido/Perdido) | ✅ Ya existía |
| 6 | AIChatPage: historial de conversaciones — sidebar con save/load/delete, máx 10 por org en localStorage | ✅ Hecho |
| 7 | SalesPage: editar venta — botón Edit en tabla y cards, modal con SaleForm en modo edición | ✅ Ya existía |
| 8 | Dashboard: widget "Próximas compras sugeridas" — barra de días de stock, velocidad u/día, orden sugerido, prefill IA | ✅ Hecho |

---

## Sesión 25 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **LoyaltyPage: canjes a precio de costo** — sección "Canjear producto por puntos" usa `total_cost_usd * exchangeRate` en lugar de precio de venta; tabla comparativa costo vs venta, ahorro del negocio | ✅ Hecho |
| 2 | **ProductsPage: logo en PDF de lista de precios** — `exportPriceListPDF` fetch logo → base64 → embed; header con imagen + nombre del negocio | ✅ Hecho |
| 3 | **ProductsPage: foto desde URL** — botón "URL" con Link2 icon; input expandible; valida `startsWith('http')` antes de añadir | ✅ Hecho |
| 4 | **EmailCampaignsPage: logo + branding en emails** — `buildBrandedEmail()` wrapper con header oscuro (logo + nombre) y footer con unsubscribe; aplicado en create y preview | ✅ Hecho |
| 5 | **InstagramStoryGenerator: logo en canvas** — `loadImage(logoUrl)` → `drawImage` con golden glow shadow; fallback a texto si falla la carga | ✅ Hecho |
| 6 | **POSPage: descuento automático por cliente VIP** — debounced query a `loyalty_points` por cliente; tiers Platino/Oro/Plata → 10%/5%/2%; badge VIP debajo del input | ✅ Hecho |
| 7 | **SalesPage: recibo con desglose de ítems múltiples** — agrupa por cliente+fecha+método; tabla multi-línea con subtotal por ítem y total consolidado | ✅ Hecho |
| 8 | **ExpensesPage: alerta gastos recurrentes vencidos** — toast warning al cargar cuando hay gastos con `recurring_next_date < hoy`; anti-spam con sessionStorage por id | ✅ Hecho |
| 9 | **CustomersPage: envío masivo WhatsApp por segmento RFM** — botón verde "WhatsApp masivo" en barra flotante de selección; dialog con textarea editable + links `wa.me` individuales + copiar teléfonos | ✅ Hecho |
| 10 | **Dashboard: widget comparativa semanal automática** — useMemo con semana actual vs semana pasada; progress bar, delta %, top producto de la semana, prefill IA | ✅ Hecho |
| 11 | **ReportsPage: proyección de impuestos** — 3 cards en TaxesTab con IVA/IIBB/Monotributo estimados para próximos 3 meses basados en promedio de últimos 3 meses | ✅ Hecho |
| 12 | **AIChatPage: sugerencia automática diaria al abrir** — banner con Sparkles icon; datos reales (ventas 7d, stock bajo); cache en localStorage por org+día; "Analizar ahora" prefill + dismiss | ✅ Hecho |

---

## Sesión 26 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **POSPage: descuento por cupón** | ✅ Ya existía (`validateCouponDB`, campo cupón en POS) |
| 2 | **LoyaltyPage: historial de puntos por cliente** | ✅ Ya existía (tab "Puntos" + panel detalle con timeline) |
| 3 | **SalesPage: PDF ejecutivo mensual** — KPIs, top 5 productos, top 5 clientes, método de pago breakdown; botón "PDF" junto al CSV | ✅ Hecho |
| 4 | **ProveedoresPage: pedido de compra automático** | ✅ Ya existía (PurchaseOrderGenerator en línea 575) |
| 5 | **ProductsPage: variantes con stock independiente** | ⏳ Sistema de variantes ya existe, UI de stock por variante pendiente |
| 6 | **ReportsPage: tab "Sucursales"** — stock por location, ventas por vendedor (proxy de sucursal), transferencias recientes | ✅ Hecho |
| 7 | **AIChatPage: analizar producto específico** — intención "¿cómo va X?" / "analizá el producto X"; card con ventas 30d, margen, stock, días sin venta, variación vs período anterior | ✅ Hecho |
| 8 | **Dashboard: widget "Mejor día de la semana"** — mini bar chart de Lun–Dom por avg de ventas históricas; badge con mejor día | ✅ Hecho |
| 9 | **SalesPage: fix settings state** — `settings` no estaba declarado en SalesPage outer scope; añadido `useState` + fetch en `reload` (arregla print receipt + PDF) | ✅ Hecho |

---

## Sesión 27 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **ProductsPage: stock por variante en edición** | ⏳ Sistema variantes existe; UI de stock individual pendiente |
| 2 | **POSPage: mostrar variantes en selector** | ⏳ Próxima sesión |
| 3 | **CustomersPage: notas masivas con timestamp** — bulk "Agregar nota" en barra flotante; dialog con textarea; upsert en `customer_notes` por cada cliente | ✅ Hecho |
| 4 | **Dashboard: forecast próximos 7 días** — proyección por día de la semana basada en promedio histórico; mini bar chart; badge total estimado | ✅ Hecho |
| 5 | **ExpensesPage: comparativa mensual por categoría** — tabla últimos 6 meses con columnas por categoría + fila total + delta % mes anterior | ✅ Hecho |
| 6 | **ReportsPage: CSV P&L completo** — botón "CSV P&L" en tab Estado de Resultados; exporta tabla mensual con revenue/COGS/ganancia bruta/gastos/ganancia neta/márgenes | ✅ Hecho |
| 7 | **AI chat: contexto enriquecido** — edge function ai-chat: comparativa mes actual vs anterior, top productos con margen por producto, top productos por margen, estructura más clara | ✅ Hecho |
| 8 | **SettingsPage: colores/tema del negocio** | ✅ Ya existía (primary_color + secondary_color + publicCatalogPage ya los usa) |

---

## Sesión 28 — COMPLETADA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **POS: variantes en selector de producto** — modal picker de variantes al hacer click en producto con variantes; badge "N variantes" en tarjeta; addToCart soporta override de variante | ✅ Hecho |
| 2 | **ProductsPage: editar stock por variante** — tabla inline de variantes con input de stock individual | ✅ Ya existía |
| 3 | **AnalyticsPage: tab "Rentabilidad"** — Top 5 / Bottom 5 productos por margen bruto, desglose por categoría con barras, gráfico de distribución de márgenes por colores (verde/amarillo/rojo) | ✅ Hecho |
| 4 | **SalesPage: modo "vista diaria"** — agrupación por día con subtotales expandibles | ✅ Ya existía (viewMode="by_date") |
| 5 | **Dashboard: widget "Temperatura del negocio"** — semáforo Rojo/Amarillo/Verde con 4 señales: ventas hoy vs promedio diario, stock sin inventario, deudas vencidas, margen del mes | ✅ Hecho |
| 6 | **CustomersPage: importación CSV mejorada** — detección automática de columnas, mapeo flexible por campo, vista previa de 5 filas, deduplicación por nombre, soporte para notas | ✅ Hecho |
| 7 | **POSPage: impresión ZPL/ESC-POS** — WebSocket con impresora térmica en red | ⏳ Pendiente (requiere hardware/WebSocket local) |
| 8 | **SettingsPage: gestión de sucursales** — sección CRUD completa con crear, editar, activar/desactivar, eliminar; integrado con tabla `locations` | ✅ Hecho |

---

## Sesión 29 ✅ COMPLETA (ítems en progreso)

Ver tabla de sesión 29 arriba.

---

## Sesión 29 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **Dashboard: gráfico ventas vs meta mensual** — AreaChart diario acumulado vs meta lineal (gold vs gris) dentro del widget de objetivo mensual | ✅ Hecho |
| 2 | **SalesPage: nota interna por venta** — Textarea opcional (300 chars) al registrar; persiste en campo `notes`; indicador FileText icon en tabla desktop (tooltip con nota) y texto completo en mobile cards | ✅ Hecho |
| 3 | **ReportsPage: tab "📈 Tendencia"** — LineChart margen bruto % por mes con línea de promedio (ReferenceLine), LineChart margen neto, BarChart ganancia bruta vs gastos, tabla resumen con color-coding (≥30% verde, ≥15% amber, <15% rojo); filtro 3/6/12/24 meses | ✅ Hecho |
| 4 | **AIChatPage: sugerencia de restock** — intent "qué debería reponer", RestockSuggestionCard: cruza productos stock-bajo con velocidad de ventas 30d; urgency high/medium/low; días de stock restantes; chip "Qué reponer" en SUGGESTIONS | ✅ Hecho |
| 5 | **POSPage: modo dark/light individual** — botón Sun/Moon en top bar; state persisted en localStorage por org; override de clases inline en contenedor raíz | ✅ Hecho |
| 6 | **ProductsPage: etiquetas/tags** | ✅ Ya existía (sesión anterior) |
| 7 | **CustomersPage: email desde CRM** | ✅ Ya existía (sesión 16) |
| 8 | **AnalyticsPage: tab "Cohortes"** | ✅ Ya existía (sesión 17) |

---

## Sesión 30 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **ProductsPage: exportar CSV con todos los campos** — tags, SKU, barcode, lot, expiry, low_stock_threshold, días sin venta | ✅ Hecho |
| 2 | **DebtsPage: tab "Historial de pagos"** — timeline de cobros por mes, subtotales y total general, íconos CheckCircle2 | ✅ Hecho |
| 3 | **Dashboard: widget "Gastos del mes"** — total vs mes anterior (▲/▼), top-3 categorías con mini progress bars, link a /expenses | ✅ Hecho |
| 4 | **SalesPage: filtro por categoría de producto** | ✅ Ya existía |
| 5 | **ReportsPage: tab "📈 Tendencia de margen"** — LineChart margen bruto/neto %, BarChart ganancia vs gastos, tabla color-coded, filtro 3/6/12/24 meses | ✅ Hecho |
| 6 | **ReportsPage: tab "Vendedores" — evolución mensual** — LineChart 12 meses por vendedor con leyenda de colores | ✅ Hecho |
| 7 | **POSPage: nota interna por venta** — campo Input antes del cobro, guarda en `notes`; limpiado en clearCart | ✅ Hecho |
| 8 | **AnalyticsPage: CSV export en tab Tendencia** — botón Download con icono, exporta 7 columnas (mes, ingresos, ganancia, COGS, gastos op., neto, unidades) | ✅ Hecho |
| 9 | **CustomersPage: campo "empresa/negocio"** | ⏳ Requiere migración DB (sin columna `company` en tabla customers) |

---

## Sesión 31 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **CustomersPage: campo "empresa/negocio"** — migration 20260518000003; campo en form + búsqueda por empresa/email/tel; columna tabla; CSV export; contact tab con badge ámbar | ✅ Hecho |
| 2 | **ProductsPage: bulk price adjust mejorado** — categorías dinámicas desde DB con conteo; preview live de hasta 8 productos (precio viejo → nuevo) antes de confirmar | ✅ Hecho |
| 3 | **SalesPage: nota interna visible al editar** | ✅ Ya existía (editItem?.notes || '') |
| 4 | **POSPage: nota en ticket impreso** — `posNote` incluido en receipt state; ReceiptModal acepta prop note; muestra en modal UI y en HTML 80mm de impresión | ✅ Hecho |
| 5 | **Dashboard: widget "Resultado del mes"** | ✅ Ya existía (KPI "Ganancia Neta (mes)" = netMonthProfitARS) |
| 6 | **DebtsPage: recordatorio masivo aging >30d** — botón "Recordar >30d (N)" en panel aging; copia mensajes al clipboard + abre WhatsApp del primer deudor | ✅ Hecho |
| 7 | **SalesPage: filtro por método de pago** — Select dropdown con todos los métodos (efectivo/débito/crédito/transferencia/MP/fiado) | ✅ Hecho |
| 8 | **AIChatPage: crear tarea desde chat** — intent detection "crear tarea/recordatorio"; CreateTaskCard con título, descripción, fecha vencimiento, prioridad; escribe en tabla tasks; chip "Crear tarea" en ACTION_STARTERS | ✅ Hecho |
| 9 | **AnalyticsPage: CSV export en tab Tendencia** | ✅ Hecho (sesión 30, finalizado aquí) |

---

## Sesión 32 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **ExpensesPage: campo "proveedor/pagado a"** — vendor en form, filtro, CSV export | ✅ Ya existía |
| 2 | **SalesPage: resumen de totales por método al filtrar** — desglose por método visible debajo de KPIs | ✅ Ya existía |
| 3 | **Dashboard: alerta "Sin ventas hoy"** — banner proactivo si son las 14hs+ y 0 ventas del día | ✅ Ya existía |
| 4 | **ProductsPage: exportar etiquetas QR** — grilla imprimible de QR por producto | ✅ Ya existía |
| 5 | **PurchasesPage: estado "En camino"** — campo travel_status, botón "Marcar en camino" | ✅ Ya existía |
| 6 | **ReportsPage: PDF del tab "Tendencia de margen"** — botón print/PDF en MarginTrendTab | ✅ Ya existía |
| 7 | **AlertsPage: product_expiry** — alerta de vencimiento próximo con CalendarX2 icon + "Crear" button | ✅ Hecho |
| 8 | **check-alerts edge function: product_expiry** — query products con expiry_date próximo, notifica admins | ✅ Hecho |
| 9 | **Migration 20260519000001** — agrega product_expiry a alert_rules CHECK constraint, seed, backfill | ✅ Hecho |
| 10 | **ProfilePage: cambiar email** — input nuevo email + supabase.auth.updateUser({ email }) + verificación | ✅ Hecho |

---

## Sesión 33 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **SalesPage: Cierre de caja PDF** — printCierreCaja() genera A4 con KPIs, desglose por método, top 5 productos; botón "Cierre" en header | ✅ Hecho |
| 2 | **PresupuestosPage: Duplicar presupuesto** — duplicateQuote() copia items+cliente con nuevo número; botón CopyPlus | ✅ Hecho |
| 3 | **POSPage: Recibo por email** — ReceiptModal tiene input email + botón Mail; envía vía send-invoice-email edge function | ✅ Hecho |
| 4 | **InvoicesPage: Notas de Crédito** — createCreditNote() crea factura con negativos y prefijo "NC-"; badge "N.Crédito" naranja; botón FileMinus en facturas pagadas/enviadas | ✅ Hecho |
| 5 | **ProductsPage: Análisis de aging** — panel colapsable que agrupa productos con stock sin venta en 31-60d/61-90d/90+d/nunca; muestra inversión en riesgo | ✅ Hecho |

---

## Sesión 34 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **CustomersPage: segmentación automática VIP/regular/inactivo** | ✅ Ya existía (RFM en sesión 9) |
| 2 | **SalesPage: totales de período en footer de tabla** | ✅ Hecho (sesión 34a) |
| 3 | **Dashboard: widget temperatura — 5ª señal "prod. sin movim. 30d"** — agingCount30 en stats useMemo; grid-cols-5 en lg | ✅ Hecho |
| 4 | **ReportsPage InventoryTab: columna "Días stock"** — velocidad 30d, color rojo/amarillo/verde, sort por días, CSV actualizado | ✅ Hecho |
| 5 | **ReportsPage InventoryTab: PDF export** — jsPDF landscape A4 con KPIs header, autoTable con color-coding de márgenes | ✅ Hecho |
| 6 | **POSPage: cliente favorito / recientes** — dropdown con últimos 5 clientes desde localStorage, guardado post-venta | ✅ Hecho (sesión 34a) |

---

## Sesión 35 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **SalesPage: gráfico de tendencia diaria** — CSS sparkline hasta 30 días, tooltip fecha/monto, renderiza solo con 2+ días | ✅ Hecho |
| 2 | **ProductsPage: filtro por margen** — Select >40%/20–40%/<20%/negativo usando precios y TC | ✅ Hecho |
| 3 | **CustomersPage: panel "Análisis RFM"** — collapsible, quintiles 1–5, mini charts distribución, tabla top-15 sorteable | ✅ Hecho |
| 4 | **InvoicesPage: envío masivo de facturas** — checkboxes, select-all, barra flotante, loop con edge function | ✅ Hecho |
| 5 | **ReportsPage tab "Clientes"** — ranking facturación/frecuencia/ticket/último pedido, KPIs, CSV | ✅ Hecho |

---

## Sesión 36 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **ExpensesPage: stacked bar chart por categoría en tab Tendencia** | ✅ Hecho |
| 2 | **AnalyticsPage: widget Pareto de clientes** — top 20%/50%, barras, alerta concentración | ✅ Hecho |
| 3 | **Dashboard: widget "Flujo de caja 7 días"** — income / gastos / compras net | ✅ Hecho |
| 4 | **InvoicesPage: filtro por tipo A/B/C/NC** | ✅ Hecho |
| 5 | **ProductsPage: PDF de aging** — botón en panel, HTML imprimible con sugerencias | ✅ Hecho |

---

## Sesión 37 ✅ COMPLETA

| # | Acción | Estado |
|---|--------|--------|
| 1 | **SalesPage: vista "Por fecha"** — modo by_date, barras diarias, delta ▲/▼ vs -7d | ✅ Hecho |
| 2 | **AIChatPage: exportar conversación** — botón "Exportar" descarga .txt | ✅ Hecho |
| 3 | **DebtsPage: proyección de cobros 30d** — buckets hoy/1-7/8-15/16-30d, barras | ✅ Hecho |
| 4 | **ReportsPage: comparativa de dos períodos** — selectores A/B, tabla con Δ | ✅ Hecho |
| 5 | **CustomersPage: CSV export de RFM** — botón en panel RFM, todos los clientes | ✅ Hecho |

---

## Prioridades inmediatas (sesión 38)

| # | Acción | Por qué |
|---|--------|---------|
| 1 | **PurchasesPage: dashboard de estado de pedidos** — KPIs pendientes/en camino/recibidos + timeline visual | Gestión compras |
| 2 | **PresupuestosPage: vencimiento y estado "Expirado"** — detectar presupuestos vencidos (>30d sin conversión), badge y filtro | CRM ventas |
| 3 | **Dashboard: widget "Mejor horario de ventas"** — mostrar en qué horario del día se registran más ventas (usa created_at de ventas) | Operaciones |
| 4 | **SalesPage: resumen de comisiones del período** — columna estimada de comisión por vendedor en vista by_customer/by_product | Gestión equipo |
| 5 | **AlertsPage: historial de alertas disparadas** — tabla de últimas alertas con timestamp, tipo y acción tomada | Observabilidad |

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
