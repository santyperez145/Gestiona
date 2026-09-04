# Hechos canónicos de margen

**Estado:** vigente. **Corte técnico:** 2026-08-22.

**Autoridad:** `sale_margin_facts`

**Objetivo:** explicar rentabilidad sin convertir datos ausentes en cero.

## El contrato

Una línea sólo tiene `contribution_margin_ars` cuando existen cuatro hechos
persistidos:

~~~text
ingreso
− costo histórico de mercadería
− comisión real de cobro/canal
− costo real de envío
− IVA de la operación
= margen de contribución explicable
~~~

Cada componente tiene un importe y una fuente. Si falta cualquiera,
`contribution_margin_ars` queda `NULL`, `missing_components` explica el hueco y
`coverage_pct` vale 0, 25, 50, 75 o 100. Un cero sólo es válido cuando una fuente lo
respalda —por ejemplo, efectivo sin procesador o POS sin despacho—; `NULL`
nunca significa cero.

## Prioridad de fuentes

| Componente | Fuentes aceptadas | Lo que no se hace |
|---|---|---|
| Mercadería | Snapshot de la venta; residuo del asiento histórico asignado a la operación. | Leer el costo actual de `products` para reescribir una venta vieja. |
| Cobro | Liquidación de tienda, MercadoLibre o `payment_transactions`; efectivo sin procesador. | Aplicar hoy una tabla estimada de aranceles a una venta histórica. |
| Envío | Costo del transportista o costo informado por MercadoLibre; cero sólo para POS. | Confundir el envío cobrado al cliente con el costo del correo. |
| IVA | Snapshot de orden, factura o asiento de la operación. | Recalcular historia con la configuración fiscal actual. |

Los importes de una operación con varias líneas se asignan por ingreso y la
última línea conserva el residuo de redondeo. La suma vuelve exactamente al
hecho de origen.

## Superficies y seguridad

- `_sale_margin_facts_source`: fuente interna sin privilegios para `anon` ni
  `authenticated`.
- `sale_margin_facts`: detalle para miembros de la organización, filtrado por
  `is_org_member`.
- `organization_margin_coverage`: cobertura agregada para el comercio.
- `platform_org_margin_coverage`: cobertura agregada para Merchant 360. No
  contiene producto, cliente, venta, costo ni impuesto por operación.

La UI de Analytics sólo lee `sale_margin_facts`; ya no cruza `sales`,
liquidaciones de tienda y líneas de MercadoLibre en el navegador.

### Explicación por operación

`sale_margin_operations` agrupa las líneas por ticket u orden y conserva:

- la suma exacta de los cuatro componentes sólo si todas las líneas los tienen;
- los orígenes usados en cada componente;
- el mix de cobro persistido, incluidos pagos divididos, y su diferencia contra
  los ingresos del ticket;
- descuento global medido, cupones y flags de precio promocional;
- bloqueos que impiden llamar final al margen, como una devolución todavía no
  neteada.

El descuento no se vuelve a restar del margen: `sales.total_ars` ya es ingreso
neto. `measured_discount_ars` sirve para reconstruir la base de comparación,
no es un quinto costo. Un descuento global guarda importe por línea; un cupón
histórico sólo conserva el código y un precio promocional no conserva el precio
de referencia. Esos dos casos aparecen como evidencia parcial en vez de usar el
precio actual del producto.

### Evidencia de cobro del POS hacia adelante

Desde `20260822000006_pos_payment_settlements.sql`, una venta nueva de POS y
sus partes de cobro se confirman en la misma transacción:

- efectivo y transferencia generan una liquidación aprobada con arancel cero
  explícito;
- débito, crédito y billeteras quedan `pending` hasta copiar la liquidación
  real del adquirente;
- si un ticket combina efectivo y tarjeta, la parte aprobada no puede esconder
  la pendiente: todo el componente queda bloqueado como `liquidacion_cobro`;
- confirmar exige `payments.edit`; la base valida los importes, calcula el
  neto, registra auditoría y crea el asiento banco + arancel + comisión contra
  valores a liquidar;
- el precio final posterior a cupón/descuento global se guarda como ingreso y
  `precio_autoritativo` conserva la base que antes se descartaba.

No se asigna un arancel a `mayorista`: hoy es una modalidad comercial dentro
del selector de pagos, no evidencia de cómo entró el dinero. Queda faltante
hasta modelarlo correctamente.

## Línea de base real

Medido en producción el 2026-08-22, después de aplicar
`20260822000004`–`20260822000006`:

| Señal | Resultado |
|---|---:|
| Líneas visibles | 34 de 34 |
| Ingresos registrados | ARS 1.143.696 |
| Líneas con los cuatro componentes | 0 |
| Ingresos con margen explicable | 0% |
| Cobertura promedio por línea | 2,9% |
| Costo histórico conocido | 0/34 |
| Comisión conocida | 4/34 |
| Envío real conocido | 0/34 |
| IVA conocido | 0/34 |
| Operaciones reconstruidas | 34; 34 líneas y ARS 1.143.696, sin diferencias |
| Mixes de cobro que no cierran | 0/34 |
| Operaciones marcadas con promoción | 31/34 |
| Promociones con impacto completo | 0/31; falta precio de referencia histórico |
| Liquidaciones POS históricas | 0; la captura empieza con la próxima venta v3 |
| Overrides históricos con precio de referencia | 0/34; no se hizo backfill |

Esto no prueba que el negocio no tenga margen. Prueba que su historial no tiene
evidencia suficiente para afirmarlo. Antes, 32 líneas `manual` quedaban fuera y
los costos en cero parecían costos reales; el tablero podía verse mejor mientras
era menos confiable.

Consulta reproducible para operación con acceso administrativo:

~~~sql
select channel,
       count(*) as lines,
       sum(revenue_ars) as revenue,
       count(*) filter (where is_explainable) as complete,
       round(avg(coverage_pct), 1) as average_coverage,
       count(*) filter (where cogs_ars is not null) as cogs_known,
       count(*) filter (where payment_fee_ars is not null) as fee_known,
       count(*) filter (where shipping_cost_ars is not null) as shipping_known,
       count(*) filter (where tax_ars is not null) as tax_known
from public._sale_margin_facts_source
group by channel order by channel;
~~~

## Comparación competitiva honesta

Verificado contra documentación oficial el 2026-08-22:

- [Shopify Profit reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/profit-reports)
  ofrece margen por producto, orden y mercado, e incorpora costos de producto,
  envío, aranceles e impuestos en reportes de orden/mercado. Su propia ayuda
  advierte que `Cost per item` es estático y que el reporte depende de haberlo
  cargado al momento de la venta.
- [Odoo Margins](https://www.odoo.com/documentation/18.0/es/applications/sales/sales/sales_quotations/margin.html)
  calcula por línea y orden desde precio de venta menos costo de producto, con
  tarifas y descuentos.

Por lo tanto, “tener un reporte de margen” es paridad, no ventaja. La apuesta de
Nerqia es otra: reconciliar POS, tienda propia y marketplace con el mismo
Business Core; conservar la procedencia de costo, cobro, logística e IVA; y
mostrar cobertura antes de afirmar rentabilidad. Todavía falta demostrar que
esa verdad cambia una decisión y mejora un resultado en un comercio externo.

La conciliación POS no se presenta como una función que Shopify u Odoo no
tengan. Refuerza la tesis verificable de Nerqia: el mismo ticket que mueve
stock conserva precio de referencia, partes del cobro, arancel real, asiento y
margen; una parte pendiente reduce cobertura en vez de transformarse en cero.

## Próximo gate

1. Hacer una venta POS real nueva y conciliar su liquidación desde Finanzas.
2. Completar costo de transportista en tienda y fiscalidad de MercadoLibre.
3. Persistir la base de cupón/precio promocional hacia adelante para medir su
   impacto sin backfill.
4. Aplicar con un merchant una propuesta real y completar su ventana.

No se hace backfill heurístico. Si el dato histórico no existe, queda pendiente;
la cobertura mejora con operaciones nuevas y fuentes reales.

## Action loop de precio

`ai_offer_recommendations` conserva la propuesta;
`apply_ai_offer_recommendation` aprueba y aplica de forma atómica; y
`price_change_impact_events` congela baseline, medición y reversión. La vista
`price_change_proposal_outcomes` es la superficie tenant-safe.

- La base recalcula costo y margen; el porcentaje sugerido no es autoridad.
- Aplicar exige `marketing.edit` y una ventana entre 1 hora y 30 días.
- Revertir usa comparación optimista y no pisa una edición posterior.
- Baseline y observación leen `sale_margin_facts`.
- La contribución queda `NULL` si alguna ventana no tiene cobertura completa.
- Todo antes/después se rotula `observed_not_causal`: no es un A/B test.
- Aplicación, medición y reversión quedan auditadas.

Verificación reversible 2026-08-22: aplicación, edición concurrente bloqueada,
reversión segura, permisos tenant y cero restos. Producción conservaba 25
recomendaciones descartadas, 0 aplicadas y 0 outcomes; el contrato técnico no
demuestra impacto comercial.
