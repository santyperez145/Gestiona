# Nerqia Growth

**Estado:** canónico; contrato aprobado, superficie dedicada pendiente.
**Revisión:** 2026-10-01. **Owner:** Producto / Growth.
Decisión: [ADR 004](ADR_004_GROWTH_PROFIT_SHARED_GRAPH.md).

## Propósito

Conseguir clientes, convertir oportunidades y retener compradores. Growth es
distinto de Finance: no es una bandeja de aprobación, gastos o bancos. Commerce
sigue siendo el producto principal y Profit se construye primero.

Referencias públicas consultadas 2026-10-01: [Clientify Marketing](https://clientify.com/marketing)
y [Clientify MCP](https://clientify.com/mcp). Describen campañas, segmentos,
automatización y herramientas de negocio para asistentes. Son benchmarks de
trabajo, no evidencia de aplicación autenticada ni permiso para copiar activos.

## Reutilizar antes de trasladar

| Trabajo | Entrada vigente | Cierre necesario |
|---|---|---|
| Identidad y Customer 360 | `/clientes`, misma autoridad de clientes. | Unificar roles/aliases; no fusionar identidades ambiguas. |
| Oportunidades/seguimiento/segmentos | Vistas de `/clientes`. | Auditar empresas, leads, etapas, owner, tareas y permisos. |
| Campañas/ofertas/planner | `/marketing`. | Outcomes conectados a pedidos reales. |
| Email | `/email-campaigns`. | Entrega certificada, editor/A-B y atribución pendiente. |
| WhatsApp | `/whatsapp-campaigns`. | Comercio conversacional y proveedor autorizado. |
| Fidelidad | `/fidelidad`. | Retención medible, no sólo puntos. |
| Creadores/colaboraciones | `/influencer-marketing`, portal autenticado. | Continuidad, seguridad y certificación externa; expansión pausada. |
| Unified Inbox | No omnicanal certificado. | Adaptadores reales, identidad, permisos y ciclo de mensajes. |
| Landings/formularios | Page/Theme Engine reutilizable. | Tipos de página, consentimiento y captura idempotente. |
| Entrada `/growth` / subdominio | Planeada, no anunciada como existente. | Shell, rutas, entitlements y regresión antes de mover consumidores. |

Trasladar propiedad de una página no cambia su autoridad de datos. Crear alias
con redirección sólo cuando la entrada canónica esté desplegada y todos los
consumidores probados. No clonar CustomersPage ni abrir cinco CRMs.

## Identidad y CRM

Una persona puede actuar como lead, contacto, comprador o miembro de empresa
mediante relaciones a una identidad canónica por tenant. No son cinco contactos
independientes, ni una identidad global compartida entre merchants sin permiso.
Teléfono compartido/nombre parecido no autorizan una fusión. Conservar origen,
external ID, auditoría, historial y consentimiento por propósito/canal.

Completar empresas, pipelines múltiples, etapas/probabilidades, oportunidades,
productos, presupuesto, owner/equipo, tareas, actividades, agenda, notas,
campos personalizados, tags, segmentos, vistas guardadas y scoring explicado.
Pipeline ganado prepara presupuesto/carrito/orden canónicos; no inventa cobro,
factura, contrato firmado ni reserva de stock por cambiar una etapa.

## Comunicaciones y WhatsApp Commerce

Inbox integra WhatsApp autorizado, email, Instagram/Messenger, live chat y
tienda con identidad, pedidos, carrito y productos del mismo Graph. Los roles
de agente, responsable y administrador tienen acceso explícito; no se expone
deuda, costo o PII fuera de su audiencia. Conector y conversaciones no se
duplican por producto. Voice queda detrás de proveedor y consentimiento.

Mensaje → identificar → consultar disponibilidad server-side → preparar carrito
→ checkout canónico → Pay confirma → tracking. El asistente no calcula stock
ni confirma pagos desde texto; envío/cobranza/campaña respetan políticas y baja.

## Marketing

Editor/plantillas, personalización segura, segmentos, programación, throttling,
A/B, formularios, landing, lead scoring, captura de UTM/click ID y atribución.
El motor revalida consentimiento/supresión justo antes del despacho y conserva
entrega/rebote/queja/baja; transaccional y marketing son propósitos separados.
El contrato vigente de correo está en [EMAIL_MARKETING](EMAIL_MARKETING.md).

Los A/B tienen asignación persistida, población, ventana y métrica fijadas;
un antes/después no es un experimento. Revenue y contribución de campaña
consumen [Profit](PROFIT.md), no otra calculadora de margen.

Landings, página de campaña, lanzamiento, coming soon y link-in-bio consumen
el Page/Theme Engine de Commerce; no un segundo builder. Los conectores Ads
importan gasto/campañas primero. Pausar o cambiar presupuesto sólo tras scopes,
permisos, límites, simulación, aprobación y evidencia del proveedor.

## Runtime común

Growth, Commerce, Finance y Profit consumen Automate: trigger → condición →
rama → acción → espera → verificación → outcome. Nodos por dominio, un runtime
con policies, idempotencia, outbox, retry, auditoría y kill switch. Se reutilizan
los motores existentes antes de crear otro. Ver [Intelligence](NERQIA_INTELLIGENCE.md).

MCP usa scopes, tenant y catálogo tipado de Developers, empezando read-only.
Crear carrito/oportunidad/borrador reutiliza contratos del producto; pagos,
refunds, fiscal, datos sensibles y cambios de permisos no reciben acceso libre.

## Secuencia

1. Profit foundation y venta Commerce certificada.
2. Growth CRM sobre identidad y oportunidades existentes.
3. Inbox y Marketing Suite con entrega real y consentimiento.
4. Runtime visual común: ramas, espera, retry y approvals.
5. Ads read-only y atribución conciliada; después acciones autorizadas.
6. Profit detecta → Growth propone → merchant aprueba → ejecuta → mide.

## Gates y modelo comercial

No declarar canal operativo por mostrar un botón/OAuth. Verificar recepción,
envío, retry, rate limits, webhook y baja con proveedor real. No copiar precios
del análisis: contactos, conversaciones, emails, ejecuciones y seats son
posibles unidades de consumo, pendientes de economics y validación comercial.
Servicios de migración/Growth/Profit generan templates reutilizables; no crean
una superficie técnica adicional por cada servicio de consultoría.
