# Lote P3 — Margen explicado por operación/canal

Estado: autoridad y UI construidas; cobertura de producción medida en 2026-08-22. No se simula cierre.

## Contrato (MARGIN_FACTS.md)

`contribution_margin_ars` existe sólo con los 4 hechos:

- costo histórico de mercadería
- comisión real de cobro/canal
- costo real de envío
- IVA de la operación

Fuente canónica: `sale_margin_facts` (migración `20260822000004`).
`_sale_margin_facts_source` es interna; `anon`/`authenticated` no leen costos.

## Lo que ya está (verificado en código)

- `ChannelMarginTab.tsx`: lee la SQL, muestra Pendiente cuando falta componente, nunca convierte ausente en cero, grupo producto × canal con tabla de estados.
- `channelMargins.ts`: `summarizeChannelMargins`/`summarizeMarginCoverage` agrupan hechos, no recalculan autoridad financiera; `marginGapAction` enlaza a `/productos`, `/movimientos`, `/afip`, `/devoluciones`.
- Tests: `channelMargins.test.ts`, `canonicalMarginFactsAuthority.test.ts`, `marginOperationExplanationsAuthority.test.ts`, `storeOrderMarginFactsAuthority.test.ts`.
- `operationMarginPanel.test.ts` y `semaforoDelPanel.test.ts` cubren la superficie del panel.

## Línea de base real (producción, 2026-08-22)

- 34 líneas visibles, ARS 1.143.696.
- Líneas con los 4 componentes: 0. Ingresos explicables: 0%.
- Costo histórico conocido 0/34; comisión 4/34; envío 0/34; IVA 0/34.

No es "margen 0". Es "sin evidencia suficiente para afirmarlo".

## Gate para cerrar P3 (externo, no código)

1. Venta POS real nueva + liquidación conciliada.
2. Costo de transportista en tienda.
3. Fiscalidad de MercadoLibre.
4. Precio de referencia histórico para cupones/promo.

## Próximo corte real

- `M2 — Acción de margen`: una recomendación ejecutada muestra resultado atribuible (`ai_offer_recommendations` + `apply_ai_offer_recommendation` + `price_change_impact_events`). Se revisa antes de sumar autonomía.

## Referencias

- `docs/MARGIN_FACTS.md`, `ROADMAP.md` §5/P3, `ESTRATEGIA.md` §7, `ADR_002` §4.
