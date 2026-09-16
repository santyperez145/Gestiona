# Diferencial MP — Innovación verificada (post-subagent)

Confirmado por [Audita MP functions](ee7313b7-e7fc-422c-9792-e09d8fa826b7): el flujo Mercado Pago de Nerqia es profundo (brick, webhook firmado, QR POS, links, reembolsos) y usa las APIs actuales de MP.

Con las nuevas APIs de MP (2026):

- **Checkout API Orders** (recomendado): unifica POS + tienda online; permite ítems reales, impuestos por línea, deferred capture, auto_return, deep links.
- **Marketplace split**: `marketplace_fee` en Orders para desglose de comisión Nerqia vs merchant en tiempo real.
- **Saved Cards**: `payment_methods` con token del comprador para checkout "una toca".
- **Subscriptions**: `preapproval` con `auto_recurring`, `card_token_id` para cuotas fijas / mantenimiento.

Esto es lo que diferencia a Nerqia de un CRM genérico: el commerce OS no solo cobra con MP, sino que **calcula margen real con datos de MP** (tasa real, split, comisión, devolución, reintegro parcial).

Estado: **En evaluación** — los contratos de A1/C20 están cerrados; el diferencial MP requiere certificar con MP OAuth en producción (gate externo) antes de implementar.
