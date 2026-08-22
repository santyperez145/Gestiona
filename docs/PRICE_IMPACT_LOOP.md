# Price Change Proposals e impacto observado

Última verificación: 2026-08-22.

## Qué problema resuelve

Una recomendación no crea valor por existir. Para cerrar el Action Loop hay
que poder probar, en orden:

1. qué precio y evidencia existían antes;
2. quién aprobó el cambio;
3. qué escribió realmente el servidor;
4. si se pudo revertir sin pisar una edición posterior;
5. qué ocurrió durante una ventana comparable;
6. con qué cobertura se conoce la contribución.

`20260822000007_price_change_impact_loop.sql` convierte el recomendador de
ofertas existente en ese contrato. `ai_offer_recommendations` sigue siendo la
propuesta. `apply_ai_offer_recommendation` es la aprobación y aplicación
atómica. `price_change_impact_events` conserva baseline, medición y reversión.
La vista `price_change_proposal_outcomes` es la superficie tenant-safe.

## Invariantes

- La UI nunca escribe el precio para aplicar, medir o revertir una propuesta.
- La base recalcula costo y margen mínimo con `precio_pos_autoritativo`; el
  porcentaje producido por el modelo no tiene autoridad.
- Aplicar exige `marketing.edit` y congela precio previo, vencimiento, costo,
  ventana y métricas canónicas.
- La ventana previa tiene la misma duración que la oferta, entre 1 hora y 30
  días. Sin duración declarada usa 14 días.
- Revertir usa comparación optimista: si alguien cambió precio o vencimiento
  después de aplicar, falla y no pisa el trabajo humano.
- Baseline y observación leen `sale_margin_facts`. Contribución queda `NULL` si
  costo, cobro, envío o IVA no llegan al 100% en ambas ventanas.
- Todo antes/después lleva `interpretation = observed_not_causal`. Sirve para
  decidir y aprender; no equivale a un A/B test ni prueba causalidad.
- Aplicación, medición y reversión quedan auditadas. El cliente sólo puede leer
  eventos de su organización y no puede insertarlos.

## Benchmark oficial

La comparación evita dos errores: presentar descuentos/reportes como una
ventaja inexistente y copiar un producto enterprise que no corresponde al
comercio pequeño.

| Producto | Capacidad oficial verificada | Lectura para Gestiona |
|---|---|---|
| Tiendanube | Su reporte de cupones muestra uso, facturación y cancelaciones para evaluar campañas; sus promociones programan alcance y tiempo. | Medir promociones ya es paridad regional. Gestiona tiene que sumar costo/cobro/envío/IVA y procedencia, no sólo facturación. |
| Shopify | Profit reports contemplan descuentos y refunds, pero su propia ayuda advierte que `Cost per item` es estático. Sidekick nunca modifica la tienda sin aprobación. | Se conserva aprobación humana y se evita afirmar margen cuando la evidencia no alcanza. |
| Odoo | Pricelists automatizan reglas por producto, cliente, cantidad y período; el margen se recalcula con el precio aplicado. | Pricing estructurado y margen son paridad ERP. El loop de evidencia debe vivir en el mismo Core omnicanal. |
| Pricefx | Workflows permiten aprobar/rechazar y revocar listas; la plataforma simula efecto de cambios. | La trazabilidad y la reversión son estándar serio de pricing. Gestiona adopta el patrón mínimo útil, no su complejidad enterprise. |

Fuentes consultadas el 2026-08-22:

- [Tiendanube — reporte de cupones](https://ayuda.tiendanube.com/es_ES/123489-estadisticas/como-analizar-el-uso-de-cupones-en-estadisticas-de-tiendanube)
- [Tiendanube — promociones por porcentaje](https://ayuda.tiendanube.com/123465-cupones-y-promociones/como-crear-una-promocion-con-un-de-descuento)
- [Shopify — profit reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/profit-reports)
- [Shopify — aprobación en Sidekick](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/set-up)
- [Odoo 19 — pricelists](https://www.odoo.com/documentation/19.0/applications/sales/sales/products_prices/prices/pricing.html)
- [Pricefx — aprobación y revocación](https://knowledge.pricefx.com/pricefx-unity-documentation/pricefx-capabilities/price-setting/price-lists/how-to-approve-a-price-list)

## Evidencia real inicial

La verificación crea dentro de un rollback una venta previa de ARS 3.000, una
propuesta de ARS 2.700 y una venta posterior de ARS 2.700. Ambas ventanas llegan
a 100% de cobertura canónica. También prueba que:

- el outcome se etiqueta observacional y temprano;
- una edición concurrente a ARS 2.600 bloquea la reversión;
- al restaurar el estado aplicado, la reversión vuelve al precio anterior;
- owner puede operar, outsider ve cero y recibe `42501`;
- aplicación/reversión tienen auditoría;
- quedan cero productos, ventas, recomendaciones o eventos `ZZ`.

Producción conserva 25 recomendaciones históricas descartadas, 0 aplicadas y 0
outcomes. El fixture prueba el contrato técnico; todavía no existe evidencia de
que una decisión real haya creado margen.

## Próximo gate

1. Aplicar una propuesta a un producto real con consentimiento del merchant.
2. Esperar la ventana completa y actualizar el resultado.
3. Exigir cobertura 100% antes de publicar delta de contribución.
4. Registrar la decisión posterior: mantener, revertir o crear una propuesta
   distinta.
5. Sólo con volumen suficiente diseñar un experimento controlado; no llamar A/B
   a un antes/después.
