# Oferta de planes Commerce

**Estado:** contrato vigente. **Revisión:** 2026-10-08. **Owner:** Producto / Billing.
Define lo que se publica y habilita; la rentabilidad se evalúa en [Economics](ECONOMICS.md).
No equivale a paridad completa ni certificación de proveedores.

## Oferta vigente

| Plan | Mensual ARS | Anual ARS, pago total | Productos / ventas / usuarios | IA |
|---|---:|---:|---|---|
| Inicial (`trial`, identidad conservada) | 0 | 0 | Sin tope de plan | 100 acciones/mes sólo durante la prueba de extras de 14 días. |
| Starter | 19.900 | 179.100 | Sin tope de plan | 300 acciones/mes. |
| Pro | 34.900 | 314.100 | Sin tope de plan | 2.000 acciones/mes. |
| Business | 69.900 | 629.100 | Sin tope de plan | Sin tope mensual configurado; guardas del Gateway siguen vigentes. |

Catálogo medido el 2026-10-08; `plans` es la fuente viva, no esta tabla.
Anual equivale a 25% de ahorro en esta oferta; la UI recalcula desde importes
reales y nunca convierte un importe ausente en gratis. El mensual equivalente
no es una cuota: se identifica el total anual que se autoriza.

El Inicial conserva el alta actual y la identidad `trial`: no hay otro motor de
registro ni una suscripción recurrente de importe cero. Al vencer los extras,
el comercio continúa gratis. Un corte de plan pago también conserva Commerce;
no borra datos, suspende al equipo ni restringe el catálogo o las ventas.
Permisos, cuotas de API, límites de archivo y controles de abuso permanecen.

## Una autoridad

- `org_entitlements` decide vigencia, gracia, extras, cupos y límites efectivos.
  La expiración de la prueba se comprueba por request, sin esperar el cron;
  su estado `past_due` heredado no se presenta como una deuda de un plan pago.
- `organization_plan_limits`, `get_sales_plan_usage`, triggers e importación
  conservan esa autoridad; `usePlanLimits` usa los límites efectivos, no los
  límites crudos de una suscripción vencida.
- `planOffer.ts` comparte presentación de precio, ahorro, límites y IA entre
  `/precios` y `/mi-plan`. Platform edita el mismo catálogo y el cupo real de IA.
  Los planes estándar no permiten reintroducir topes de Commerce por accidente.
- `planes_contratables` sigue siendo la vista de contratación paga y ahora
  expone el cupo de IA. El Inicial no se envía a `mp-subscribe`.
- Platform valida importes, enteros, booleanos y textos antes de guardar;
  una escritura fallida o un plan inexistente no informa éxito ni genera auditoría exitosa.
- Contratar requiere titular/admin del comercio, también en servidor; el
  usuario visitante se registra por `/login?mode=register`, sin generar cobros.

Modificar precios de lista sólo afecta nuevas autorizaciones. No se actualizan
`subscriptions.precio_ars`, preapprovals ni facturas anteriores. Para cambiar
un contrato existente se conserva el circuito separado de aviso/aprobación.
No se activó una comisión ni se prometieron aranceles del procesador: proveedor,
dominio, mensajería y logística tienen contratos/costos independientes.

## Benchmark y brechas explícitas

Referencia verificada el 2026-10-08: [planes oficiales de Tiendanube Argentina](https://www.tiendanube.com/planes-y-precios)
y capturas provistas por el dueño. El benchmark no concede acceso a su producto privado.

| Capacidad comparada | Estado y próximo cierre de Nerqia |
|---|---|
| Comercio gratuito, productos/ventas/perfiles sin tope y ahorro anual | Habilitado en catálogo y servidor; UI, autoridad y roles comprobados internamente. |
| Gestión, import/export, búsqueda/filtros, acciones masivas y roles | Core existente, sin tope de plan. No se limita artificialmente la exportación por mes. Filtros guardados deben certificarse como flujo completo, no confundirse con filtros de pantalla. |
| Seguridad y verificación en dos pasos | Identidad/MFA existentes. No se vende seguridad como extra pago. |
| IA de productos/gestión | Cupo real mostrado y editable. Acciones no son conversaciones de WhatsApp; no afirmar equivalencia con Chat Nube ni SLA de atención automática. |
| Pagos y métodos personalizados | Conexiones/checkout existentes. Certificación por proveedor, refund y settlement siguen sus gates en [Pagos](PAGOS.md); cuenta conectada no demuestra cobro. No hay un Pago Nube propio. |
| Envíos, reglas y depósitos | Superficies existentes; certificar cotización, etiqueta, tracking y fulfillment por carrier. No afirmar equivalencia con más de treinta carriers o precios negociados. |
| Dominio, editor visual y páginas | Capacidades existentes y visibles. Sin prometer más de sesenta y cinco temas, edición arbitraria HTML/JS ni customización especializada contratada. |
| Descuentos, recuperación y SEO | Capacidades existentes; recuperación requiere canal habilitado y consentimiento. No se inventa envío de correo. |
| GA4, GTM, Meta Pixel/CAPI y Google Shopping | Revisar cada consumidor, consentimiento, eventos y atribución antes de certificar la fila completa. No confundir un campo de configuración con integración operativa. |
| Anuncios Meta dentro del panel | Pendiente del producto Ads gobernado; no habilitado ni vendido por cambiar de plan. |
| Venta mayorista online | Listas canónicas del mostrador no equivalen a B2B completo en checkout. Pendiente precios/identidad/condiciones online con autoridad compartida. |
| Venta por suscripción a compradores | Dominio existente, independiente del SaaS. Pendiente certificación completa de débito, fallo, cancelación y devolución por proveedor. |
| Idiomas/monedas, campos personalizados y videos | Auditar/completar sin duplicar producto. No se anuncian como incluidos sin consumidores y cierre funcional. Videos también están anunciados como futuros en el benchmark. |
| App móvil/desktop | Foundation Tauri existente; distribución, firma y dispositivos siguen [Apps nativas](APPS_NATIVAS.md). No se presenta una build debug como app publicada. |
| Email/WhatsApp, videollamada, especialista y migración dedicada | Tickets/centro de ayuda existentes. Canales, personal, horarios, capacidad y SLA requieren operación aprobada; se retiraron promesas de respuesta en veinticuatro horas no comprobadas. |
| Dropshipping, acuerdos/gateways exclusivos y tarifas especiales | Requieren integración y contrato con terceros; no se agregan como textos comerciales sin entregable. |

No se crea un quinto plan empresarial vacío para aparentar un especialista o
tarifas negociadas. La secuencia de cierre sigue [ROADMAP](../ROADMAP.md):
POS/Commerce operacional, certificación externa y luego expansión de módulos.

## Verificación

Pruebas puras de presentación y validación: `npm test -- src/test/planOffer.test.ts`.
Roles/aislamiento/vigencia/precio contratado con rollback:
`npx supabase db query --linked --file supabase/verificaciones/20261008_competitive_commerce_plans.sql`.
Resultado medido el 2026-10-08: assertions verdes y `zz_residue = 0`.
Navegador: `e2e/pricing.spec.ts`, comparación móvil, ahorro, registro sin pago,
recuperación de lectura y Axe claro/oscuro. No certifica un débito externo.
