# Roadmap del Proyecto

Fecha de relevamiento: 2026-05-05  
Proyecto: Gestiona / Exentry Imports  
Tipo de producto: sistema de gestion para ventas, stock, finanzas, CRM, marketing, equipo e integraciones.

## Estado general

La app ya esta en una etapa de MVP avanzado. Tiene una base funcional amplia en React, Vite, Tailwind, Supabase, Edge Functions, PWA, Sentry, Stripe, Tiendanube, Mercado Pago, AFIP, Resend y Anthropic. El proyecto no esta empezando desde cero: ya existe una estructura importante de pantallas, modelo de datos, funciones serverless, migraciones y flujos de negocio.

La prioridad ahora no deberia ser sumar pantallas por sumar, sino convertir lo existente en un sistema confiable para uso diario: datos consistentes, permisos bien cerrados, flujos comerciales probados de punta a punta, integraciones monitoreadas, buena documentacion y pruebas automatizadas.

## Resumen de lo hecho

- Aplicacion React/Vite con ruteo protegido, layout principal, navegacion lateral, mobile header, command palette y estado de sesion.
- Autenticacion con Supabase, organizaciones, membresias, roles basicos, invitaciones de equipo y platform admin.
- Dashboard con KPIs, graficos, alertas, predicciones, salud del negocio y ultimas ventas.
- Productos, compras, ventas, deudas, gastos, clientes, proveedores, presupuestos, devoluciones, facturas, caja/POS y turno de caja.
- Inventario avanzado: variantes, toma fisica, restock automatico, sucursales, stock por ubicacion y transferencias.
- CRM y ventas: clientes, notas, segmentacion, pipeline, referidos, fidelidad, cuotas, cheques, comisiones de vendedores.
- Marketing: calendario/posts, templates, combos, banners, catalogo publico, generador de historias, campañas de email, influencers, canjes y liquidaciones.
- Inteligencia artificial: insights, chat IA, prediccion de ventas, recomendaciones de ofertas y generacion de descripciones.
- Integraciones: Tiendanube OAuth/sync/webhooks, Mercado Pago link, Stripe checkout/webhook, AFIP, public API y webhooks salientes.
- Operaciones: Sentry, PWA, backups, notificaciones, crons para alertas, digest semanal y automatizaciones.
- Base de datos con muchas migraciones y politicas RLS en varias tablas.

## Brechas principales

- El `README.md` todavia no documenta el proyecto.
- Hay solo un test placeholder en `src/test/example.test.ts`; falta cobertura real.
- Los tipos generados de Supabase parecen desactualizados respecto a migraciones nuevas. Muchas tablas recientes se usan con `as any`.
- Hay mucho uso de `any`, especialmente en pantallas y helpers de Supabase. Esto acelera prototipos, pero baja seguridad de cambios.
- Conviven consultas por `user_id` y por `org_id`. Para SaaS multi-organizacion, el estandar deberia ser `org_id`.
- Parte del onboarding se guarda en `localStorage`; conviene persistirlo en base de datos.
- Falta una estrategia explicita de auditoria, monitoreo y recuperacion para integraciones externas.
- Falta una suite de pruebas de flujos criticos: venta, compra, stock, deuda, devolucion, caja, factura, permisos y suscripcion.
- Falta confirmar enforcement real de limites por plan en acciones sensibles, no solo mostrar estados visuales.

## Hecho y faltante por area

| Area | Hecho | Faltante recomendado |
| --- | --- | --- |
| Base tecnica | React/Vite, Tailwind, Radix, React Query, PWA, Sentry, rutas protegidas | README, guia de instalacion, CI, pruebas reales, tipos Supabase actualizados, validacion de env vars, limpieza gradual de `any` |
| Autenticacion y organizaciones | Auth, OrgProvider, memberships, roles, invitaciones, platform admin | Unificar modelo de permisos, migrar dependencias legacy de `user_roles`, asegurar RLS por `org_id`, auditar rutas y acciones |
| Inventario | Productos, variantes, compras, stock, toma fisica, restock, sucursales, transferencias | Kardex/movimientos de stock, trazabilidad por lote, ajustes auditados, stock multi-sucursal integrado en ventas/POS |
| Ventas y POS | Ventas, POS, recibo, deudas automaticas, cuotas, devoluciones, presupuestos, caja | Flujo end-to-end probado, conciliacion de pagos, devoluciones con impacto contable, venta offline/PWA, cierre Z o resumen fiscal |
| Clientes/CRM | Clientes, notas, segmentacion, cumpleaños, pipeline, referidos, fidelidad | Timeline unico por cliente, merge de duplicados, consentimiento de comunicaciones, historial de compras/deudas/campañas |
| Finanzas | Gastos, deudas, cheques, proveedores, conciliacion bancaria, flujo de caja, reportes | Plan de cuentas simple, pagos a proveedores, gastos recurrentes completos, reportes contables mensuales, impuestos locales |
| Facturacion | Facturas, PDF, envio por email, campos AFIP, autorizacion AFIP | Homologacion/produccion clara, manejo de errores AFIP, vincular factura con venta/devolucion, notas de credito completas |
| Marketing | Posts, templates, campañas, catalogo publico, combos, banners, historias, influencers | Entregabilidad email, dominios verificados, tracking de conversion, UTM/referral attribution, programacion robusta |
| IA y analytics | Insights, chat, prediccion, recomendaciones, health score, alertas | Definiciones de metricas, validacion de predicciones, permisos por plan, explicabilidad de recomendaciones, costos IA monitoreados |
| Integraciones | Tiendanube, Mercado Pago, Stripe, AFIP, Public API, webhooks | Reintentos, idempotencia, firma de webhooks, health checks, logs por integracion, estrategia de conflictos de sync |
| SaaS y planes | Pricing, checkout Stripe, subscriptions, entitlements, platform admin | Enforcement de limites, dunning, trial lifecycle, suspensiones, metricas por tenant, panel de soporte |
| UX y accesibilidad | Layout completo, mobile, command palette, empty states parciales | Accesibilidad, estados de carga/error uniformes, performance en tablas grandes, textos revisados, onboarding persistente |
| Operaciones | Sentry, backups, crons, rate limiter en algunas functions | Runbook de produccion, monitoreo de crons, restauracion probada, logs centralizados, checklist de secretos |

## Prioridades inmediatas

### P0 - Estabilizar antes de usar en produccion

- [ ] Crear documentacion minima del proyecto en `README.md`.
- [ ] Generar tipos actualizados de Supabase y eliminar `as any` en flujos criticos.
- [ ] Revisar todas las consultas para usar `org_id` como criterio principal multi-tenant.
- [ ] Auditar RLS tabla por tabla: ventas, compras, productos, clientes, finanzas, equipo, settings e integraciones.
- [ ] Agregar validacion de variables de entorno de frontend y Edge Functions.
- [ ] Crear pruebas de smoke para login, dashboard, productos, venta, deuda, caja y factura.
- [ ] Correr `npm run build`, `npm run lint` y dejar una linea base limpia.
- [ ] Documentar migraciones, buckets de storage y secrets necesarios.
- [ ] Revisar seguridad de `.env` y confirmar que no haya secretos versionados.

### P1 - Cerrar el core operativo

- [ ] Definir un flujo unico de stock: compra, venta, devolucion, ajuste, transferencia y toma fisica.
- [ ] Crear tabla o vista de movimientos de stock para trazabilidad.
- [ ] Unificar venta/POS/factura/deuda para que no haya dobles cargas.
- [ ] Completar estado de caja: apertura, movimientos, cierre, diferencias y reporte por turno.
- [ ] Completar cuenta corriente de cliente: ventas, pagos, deudas, devoluciones, cuotas y notas.
- [ ] Mejorar proveedores: compras, deuda al proveedor, pagos y historial.
- [ ] Vincular conciliacion bancaria con ventas, gastos, pagos de deuda y Mercado Pago.
- [ ] Agregar exportaciones utiles: productos, ventas, clientes, caja, reportes y contabilidad.

### P2 - Preparar lanzamiento SaaS

- [ ] Aplicar limites reales por plan: productos, usuarios, ventas mensuales, IA, backups y branding.
- [ ] Persistir onboarding en base de datos por organizacion.
- [ ] Mejorar pantalla de pricing y estado de suscripcion.
- [ ] Completar ciclo de trial: alta, dias restantes, vencimiento, upgrade, cancelacion y reactivacion.
- [ ] Agregar panel de soporte para platform admin: organizaciones, usuarios, estado, plan, actividad y acciones seguras.
- [ ] Crear datos demo por rubro para onboarding y testing.
- [ ] Preparar politica de privacidad, terminos, cookies y tratamiento de datos.

### P3 - Integraciones confiables

- [ ] Tiendanube: definir sincronizacion bidireccional, manejo de conflictos, logs y reintentos.
- [ ] Mercado Pago: confirmar pago, actualizar estado del link y conciliar movimientos.
- [ ] Stripe: webhooks idempotentes, dunning y estados de suscripcion completos.
- [ ] AFIP: separar homologacion/produccion, registrar errores y permitir reintentos controlados.
- [ ] Public API: versionado, rate limits, API keys rotables, scopes y documentacion.
- [ ] Webhooks salientes: firma HMAC, retries, historial de entregas y alertas.

### P4 - Automatizacion, IA y crecimiento

- [ ] Automatizaciones con historial de ejecucion, pruebas manuales y simulador antes de activar.
- [ ] Campañas de email con segmentos guardados, consentimiento, bajas y metricas.
- [ ] IA con controles de costo, limites por plan y trazabilidad de recomendaciones aplicadas.
- [ ] Reportes avanzados por sucursal, vendedor, categoria, cliente, canal y periodo.
- [ ] Forecast con comparacion real vs proyectado.
- [ ] Alertas inteligentes: stock, margen bajo, deuda vencida, clientes inactivos, ventas anormales.

## Fases sugeridas

### Fase 0 - Orden y seguridad tecnica

Duracion sugerida: 1 semana.

Objetivo: dejar el proyecto entendible, instalable y auditable.

Entregables:

- README completo.
- `.env.example` revisado y separado por frontend/functions.
- Tipos de Supabase actualizados.
- CI basico con lint, build y tests.
- Documento de tablas, buckets, crons y Edge Functions.
- Lista de permisos/RLS por tabla.

### Fase 1 - Beta operativa para uso interno

Duracion sugerida: 1 a 2 semanas.

Objetivo: que el negocio pueda operar ventas, stock, clientes, caja y reportes sin inconsistencias.

Entregables:

- Flujo venta/POS probado de punta a punta.
- Stock consistente ante compras, ventas, devoluciones y ajustes.
- Caja con cierre y diferencias.
- Deudas y pagos sincronizados con ventas.
- Reportes diarios y mensuales basicos.
- Backups manuales y restauracion documentada.

### Fase 2 - Producto comercial

Duracion sugerida: 2 a 4 semanas.

Objetivo: convertir la app en SaaS vendible.

Entregables:

- Planes y limites aplicados.
- Trial completo.
- Onboarding persistente.
- Equipo y roles robustos.
- Platform admin con herramientas de soporte.
- Landing/pricing listos para conversion.
- Documentacion para usuarios.

### Fase 3 - Integraciones y automatizaciones

Duracion sugerida: 3 a 5 semanas.

Objetivo: conectar canales externos sin romper datos internos.

Entregables:

- Tiendanube estable con webhooks y sync controlado.
- Mercado Pago conciliado.
- AFIP validado en homologacion y listo para produccion.
- Email marketing con bajas y metricas.
- Webhooks/API documentados.
- Monitor de integraciones.

### Fase 4 - Inteligencia y escala

Duracion sugerida: continuo.

Objetivo: diferenciar el producto con analitica, IA, velocidad y confiabilidad.

Entregables:

- Dashboards por rol.
- Forecast validado.
- Recomendaciones accionables.
- PWA/offline para POS.
- Optimizacion de tablas grandes.
- Observabilidad completa.

## Roadmap por modulos

### 1. Productos e inventario

Hecho:

- CRUD de productos.
- Imagenes de producto.
- Variantes.
- Stock general.
- Compras que aumentan stock.
- Ventas que descuentan stock.
- Alertas de stock bajo.
- Toma fisica.
- Restock automatico.
- Sucursales y stock por ubicacion en base de datos.

Faltante:

- Kardex o historial de movimientos por producto.
- Ajustes de stock con motivo, usuario y auditoria.
- Integrar stock por sucursal en POS y ventas.
- Manejar lotes, vencimientos o partidas si aplica.
- Validar importacion masiva y exportacion.
- Alertar margen bajo o precio desactualizado por producto.

### 2. Ventas, POS y caja

Hecho:

- Registro de ventas.
- POS.
- Recibos.
- Ventas pagadas o con deuda.
- Descuento/cupones.
- Cuotas.
- Devoluciones.
- Presupuestos.
- Turnos de caja.
- Comisiones de vendedores.

Faltante:

- Flujo unico: presupuesto -> venta -> pago -> factura -> caja.
- Devolucion con impacto automatico en stock, deuda, caja y factura.
- Conciliacion entre caja, banco y Mercado Pago.
- Cierre de turno con reporte imprimible/exportable.
- Modo offline o tolerancia a cortes de conexion para POS.
- Pruebas automatizadas de venta y devolucion.

### 3. Clientes y CRM

Hecho:

- CRUD de clientes.
- Notas.
- Segmentacion automatica.
- Pipeline.
- Referidos.
- Fidelidad.
- Cumpleaños y alertas de reactivacion.

Faltante:

- Ficha 360 de cliente: compras, deudas, pagos, comunicaciones, notas y puntos.
- Merge de clientes duplicados.
- Historial de comunicaciones centralizado.
- Consentimiento para email/WhatsApp.
- Segmentos guardados reutilizables.
- Automatizaciones desde eventos de cliente.

### 4. Finanzas y administracion

Hecho:

- Gastos.
- Deudas de clientes.
- Cheques.
- Proveedores.
- Conciliacion bancaria.
- Flujo de caja.
- Reportes.
- Backups.

Faltante:

- Cuenta corriente de proveedores.
- Pagos parciales a proveedores.
- Gastos recurrentes visibles y editables desde UI.
- Estado de resultados mensual.
- Reporte fiscal/contable exportable.
- Reglas de conciliacion bancaria.
- Auditoria de cambios financieros.

### 5. Facturacion Argentina

Hecho:

- Pantalla de facturas.
- Generacion de PDF.
- Envio por email.
- Configuracion AFIP.
- Edge Function de autorizacion AFIP.

Faltante:

- Validacion completa por tipo de comprobante.
- Notas de credito/debito integradas a devoluciones.
- Reintentos y estado de error AFIP.
- Separar claramente homologacion y produccion.
- Numeracion y punto de venta robustos.
- Vincular factura con venta y cliente.

### 6. Marketing, catalogo e influencers

Hecho:

- Marketing posts.
- Templates.
- Catalogo publico.
- QR/PDF.
- Combos y banners.
- Generador de historias.
- Campañas de email.
- Influencers, canjes y liquidaciones.
- Recomendaciones IA de ofertas.

Faltante:

- Tracking de conversion por campaña.
- Atribucion por influencer/referral/cupon.
- Verificacion de dominios para email.
- Gestion de bajas y preferencias.
- Programacion de campañas con monitoreo.
- Vista de ROI de marketing.

### 7. Integraciones

Hecho:

- Tiendanube OAuth, sync y webhooks.
- Mercado Pago link.
- Stripe checkout, cancelacion y webhook.
- AFIP.
- Public API.
- Webhooks salientes.

Faltante:

- Idempotencia en todos los webhooks.
- Logs de ejecucion por integracion.
- Reintentos y dead-letter queue simple.
- Health check visual por integracion.
- Configuracion sandbox/live.
- Documentacion de API y webhooks.

### 8. Equipo, roles y permisos

Hecho:

- Roles admin, vendedor y viewer.
- Invitaciones.
- Miembros por organizacion.
- Panel admin.
- Platform admin.

Faltante:

- Matriz de permisos formal.
- Enforcement a nivel base de datos y Edge Functions.
- Eliminar ambiguedad entre `user_roles` y `memberships`.
- Auditoria de cambios de rol.
- Limites de usuarios por plan.
- Permisos mas finos: caja, ventas, inventario, finanzas, ajustes.

### 9. Testing, calidad y mantenimiento

Hecho:

- Configuracion Vitest.
- Configuracion Playwright/Lovable.
- Sentry.
- PWA.

Faltante:

- Tests unitarios de calculos: precios, margen, impuestos, stock, deudas, cuotas.
- Tests de integracion Supabase.
- Tests E2E: login, producto, venta, pago, caja, factura, permisos.
- Mocks para Edge Functions.
- CI con build/lint/test.
- Convencion de tipos y validaciones Zod en formularios criticos.
- Documentacion tecnica y manual de usuario.

## Criterio de terminado por funcionalidad

Una funcionalidad se considera lista cuando cumple:

- Tiene permisos correctos por rol y organizacion.
- Guarda y lee datos por `org_id`.
- Tiene validaciones de formulario y mensajes de error claros.
- Maneja loading, empty state y error state.
- Tiene auditoria si modifica datos sensibles.
- No rompe stock, caja, deuda ni reportes.
- Tiene al menos una prueba automatizada del camino feliz y un caso de error.
- Esta documentada si requiere configuracion o afecta integraciones.
- Funciona en desktop y mobile.
- No depende de datos hardcodeados o `localStorage` para estado importante.

## Metricas de producto a medir

- Tiempo hasta primera venta registrada.
- Ventas registradas por organizacion por dia.
- Productos con stock desactualizado o negativo.
- Diferencia promedio de caja por turno.
- Deudas vencidas y tasa de cobro.
- Clientes recurrentes y clientes inactivos.
- Conversion de trial a pago.
- Uso de funciones IA por plan.
- Fallos de integraciones por dia.
- Tiempo promedio de carga de dashboard y listas grandes.

## Riesgos a vigilar

- Datos mezclados entre usuarios/organizaciones si no se unifica `org_id`.
- Tipos Supabase desactualizados que oculten errores.
- Muchas funciones criticas sin pruebas.
- Webhooks duplicados o fallidos que creen ventas/stock inconsistentes.
- Integraciones externas sin reintentos ni monitoreo.
- Costos IA sin limites por plan.
- Facturacion fiscal con errores por configuracion AFIP.
- PWA cacheando datos viejos en pantallas sensibles.
- Falta de documentacion para levantar el entorno.

## Proximos 10 pasos recomendados

1. Completar `README.md` con instalacion, comandos, variables, Supabase y despliegue.
2. Regenerar `src/integrations/supabase/types.ts` desde la base actual.
3. Crear una matriz de permisos por modulo.
4. Auditar consultas `user_id` vs `org_id` y corregir flujos criticos.
5. Definir y crear movimientos de stock.
6. Agregar tests unitarios de calculos y tests E2E de venta/POS.
7. Probar build/lint y dejar CI minima.
8. Completar flujo venta -> deuda/pago -> caja -> factura -> reporte.
9. Agregar monitoreo/logs para Edge Functions e integraciones.
10. Persistir onboarding y limites de plan en base de datos.

