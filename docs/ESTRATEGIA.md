# Estrategia de Nerqia

**Estado:** vigente. **Corte competitivo:** 2026-09-04.

## 1. Categoría y promesa

Nerqia es un **Commerce Operating System para Latinoamérica**:

> Creá tu tienda, vendé en cualquier canal y gestioná todo el negocio sin
> cambiar de plataforma.

La tienda es la puerta. El diferencial aparece después de la venta: producto,
stock, cliente, cobro, envío, costo histórico, impuesto y devolución forman una
sola operación. Nerqia debe explicar margen real por canal y convertirlo en una
acción controlada.

No se posiciona como “otro creador de tiendas”, un ERP con módulos sueltos ni un
asistente conversacional. La ventaja es el Business Graph compartido.

## 2. Cliente y entrada

Cliente inicial: comercio argentino que vende por tienda, local, redes o
marketplace y hoy reconcilia catálogo, stock, pedidos y dinero a mano.

Entrada comercial:

1. publicar o migrar una tienda;
2. recibir una orden y cobrarla;
3. operar el mismo stock en POS y canales;
4. mostrar margen explicado;
5. automatizar la siguiente decisión.

La activación real es una primera venta completa sin intervención SQL. La North
Star es **Active Transacting Merchants**: organizaciones con al menos una venta
POS u orden online confirmada en los últimos 30 días.

## 3. Portfolio

| Producto | Trabajo |
|---|---|
| Nerqia Commerce | Storefront, checkout, pedidos, canales, conversión y operación postventa. |
| Nerqia Business | Productos, inventario, POS, clientes, compras y gestión. |
| Nerqia Pay | Orquestación, comisión, conciliación y reintegros; no custodia de fondos. |
| Nerqia Finance | Gastos, documentos, políticas, aprobaciones, obligaciones y cierre. |
| Nerqia Automate | Señal → recomendación → aprobación → ejecución → resultado. |
| Nerqia Platform | Control interno de merchants, billing, soporte, riesgo e integraciones. |

Capital, emisión de tarjetas, movimiento de fondos y crédito requieren partner,
marco legal, riesgo y economics. No son promesas de software.

## 4. Evidencia

Convención:

- ✅ verificado en fuente oficial y fecha indicada;
- 📌 decisión propia de Nerqia;
- ❓ hipótesis por validar con usuarios o producción.

Las comparaciones se actualizan cuando afectan un slice. Una captura o recuerdo
no prueba una capacidad actual.

### Commerce y operación

| Referente | Evidencia oficial | Traducción a Nerqia |
|---|---|---|
| Shopify | ✅ Inventario separado por ubicación, order routing y POS con stock de ubicación ([Locations](https://help.shopify.com/en/manual/fulfillment/setup/locations), [POS inventory](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/inventory-management/products)); sus catálogos incluyen todos los productos por defecto y permiten excluir productos y fijar precios contextuales ([Catalogs](https://help.shopify.com/en/manual/markets/customizations/catalogs)), consultado 2026-09-04. | Stock único por ubicación; surtido y precio como overlay del canal, no como copia del producto. |
| Tiendanube | ✅ Punto de Venta usa catálogo, clientes y el mismo stock ([Punto de Venta](https://ayuda.tiendanube.com/pdv/que-es-punto-de-venta-de-tiendanube)); permite ocultar productos individualmente o en lote ([visibilidad](https://ayuda.tiendanube.com/es_ES/122708-lista-de-productos/como-ocultar-productos)) y recuperar checkout ([carritos](https://ayuda.tiendanube.com/es_AR/123339-carritos-abandonados/como-recuperar-los-carritos-abandonados)), consultado 2026-09-04. | Paridad regional en operación, publicación y recuperación; ventaja en costo/margen conectado. |
| Empretienda | ✅ Producto público y ayuda describen catálogo, medios de pago/envío, importación y ventas manuales ([producto](https://www.empretienda.com/), [productos](https://empretienda.helpjuice.com/es_AR/productos), [venta](https://empretienda.helpjuice.com/es_AR/conociendo-agregar-)), consultado 2026-09-04. | Onboarding simple y lenguaje local; Nerqia agrega profundidad operacional. |
| Mercado Libre + Mercado Pago | ✅ Notificaciones, órdenes, QR y refunds tienen contratos oficiales ([notificaciones](https://developers.mercadolibre.com.ar/es_ar/notificaciones), [QR](https://www.mercadopago.com.ar/developers/es/docs/qr-code/payment-processing), [refunds](https://www.mercadopago.com.ar/developers/es/docs/sales-processing/cancellations-and-refunds)), consultado 2026-09-04. | Canal y rail sobre el Core; webhook, idempotencia y conciliación obligatorios. |

### Finance

| Referente | Evidencia oficial | Traducción a Nerqia |
|---|---|---|
| Mendel | ✅ Gestión de gastos, medios de pago, reglas, aprobaciones multinivel, categorías e integración ERP ([producto](https://mendel.com/ar/producto/)); tarjetas físicas/virtuales, límites y visibilidad en tiempo real ([tarjetas](https://mendel.com/ar/producto/tarjetas-mendel/)); integración contable sin duplicados vía API/WebServices/archivos ([integraciones](https://mendel.com/ar/producto/integraciones/)), consultado 2026-09-04. | Benchmark principal de trabajo. Nerqia reutiliza el Business Graph y empieza con tarjetas externas; emisión exige partner. |
| Rindegastos | ✅ Rendiciones, políticas, anticipos, aprobaciones e integraciones ([gestión](https://rindegastos.com/es-mx/gestion-de-gastos)), consultado 2026-09-04. | Captura móvil, fondos y excepciones forman parte de paridad. |
| Clara | ✅ Plataforma regional de gasto y tarjetas corporativas ([Clara Argentina](https://global.clara.com/es-AR)), consultado 2026-09-04. | Referencia para control preventivo y experiencia regional. |
| SAP Concur | ✅ Viajes, gastos y facturas empresariales ([Argentina](https://www.concur.com.ar/)), consultado 2026-09-04. | Referencia enterprise de segregación, cumplimiento e integración. |

### Gestión local

Contabilium, Xubio y Colppy verifican que el mercado espera continuidad entre
facturación, compras, stock, bancos y ecommerce:
[Contabilium](https://contabilium.com/ar/industrias/erp-ecommerce/),
[Xubio](https://xubio.com/ar/precios-empresas) y
[Colppy](https://colppy.com/sistema-de-gestion-para-pymes), consultados
2026-09-04. 📌 Nerqia no replica tres módulos contables: conecta esos trabajos a
la orden y al margen del mismo comercio.

## 5. Paridad Commerce

Commerce se considera first-level cuando resuelve:

- onboarding, dominio, tema, páginas, navegación y publicación;
- catálogo, variantes, imágenes, búsqueda, colecciones y surtido por tienda;
- precio/promoción, stock, impuestos y disponibilidad;
- carrito persistente, identidad, entrega, pago y orden idempotente;
- pagos aprobados/rechazados/pendientes, webhook, conciliación y refund;
- preparación, fulfillment, tracking, cancelación, devolución y arrepentimiento;
- emails, recuperación de checkout, reseñas, preguntas y postventa;
- SEO técnico, analytics first-party, atribución y performance mobile;
- migración con preview, mapeo, redirects, reconciliación y rollback;
- cola operativa, filtros, bulk, permisos, auditoría y soporte.

No basta con que exista una pantalla. Cada fila necesita flujo real, estados,
seguridad, evidencia y métrica.

## 6. Paridad Finance

Finance usa Mendel-class como benchmark de trabajos:

- Inbox multicanal y original inmutable;
- extracción con confianza y revisión humana;
- solicitud, política, presupuesto y aprobación;
- gasto, tarjeta externa, reembolso, anticipo y obligación;
- categorías, centros de costo, proyecto y responsable;
- controles preventivos, excepciones y segregación de funciones;
- conciliación, exportación contable y trazabilidad;
- inteligencia que detecta y propone, sin mover dinero por sí sola.

Nerqia no duplica proveedores, compras, gastos o ledger. Su ventaja es que un
gasto aprobado puede alimentar costo e inventario del mismo Core. Ver
[FINANCE.md](FINANCE.md).

## 7. Diferencial de margen

Hecho de margen por operación:

```text
ingreso neto
- costo histórico / landed cost
- comisión de pago
- subsidio y costo de envío
- descuentos/promociones
- impuestos atribuibles
- devoluciones y contracargos
= margen de contribución
```

Cada componente declara fuente, moneda, fecha y confianza. “Sin dato” no es
cero. El contrato está en [MARGIN_FACTS.md](MARGIN_FACTS.md).

El Business Copilot prioriza por impacto y confianza, genera una acción
revisable y mide adopción/resultado. Nunca sigue el camino usuario → texto
generado → mutación directa.

## 8. Modelo económico

Orden de monetización:

1. suscripción por Commerce/Business;
2. comisión de plataforma cuando Pay está certificado y el neto es positivo;
3. Finance por usuarios/volumen/capacidades;
4. servicios de migración y Growth productizados;
5. Capital sólo con socio y evidencia.

Las métricas mínimas son ATM, GMV pago y conciliado, retención, ingreso neto,
margen de contribución, costo de soporte, fraude/contracargo y concentración.
Ver [ECONOMICS.md](ECONOMICS.md).

## 9. Moats

1. Business Graph con historial operativo difícil de reconstruir.
2. Margen explicado por orden, producto y canal.
3. Migración y operación omnicanal sin reconciliación manual.
4. Workflows Finance conectados a compras, stock y costo.
5. Automatizaciones con acción, política, auditoría y outcome.
6. Integraciones y cumplimiento local.

La cantidad de páginas, temas o prompts no es un moat.

## 10. Secuencia

1. Comercio productivo completo y segundo merchant real.
2. Surtido multi-tienda y migración competitiva.
3. Checkout/fulfillment certificados y métricas de conversión.
4. Primer documento Finance real hasta efecto aprobado en Core.
5. Políticas, presupuestos, tarjetas externas y conciliación.
6. Acciones de margen con resultado medido.
7. Pay, regiones, apps y Capital sólo detrás de gates.

El orden ejecutable vive en [ROADMAP.md](../ROADMAP.md). Cualquier iniciativa
que no acerque una venta real, stock confiable, margen, control de gasto,
seguridad o adopción queda congelada.
