# Diferencial MP — Innovación verificada (post-subagent)

Resumen de la revisión interna "Audita MP functions": el flujo Mercado Pago de Nerqia cubre brick, webhook firmado, QR POS, links y reembolsos. Esa revisión interna no sustituye la certificación con el proveedor indicada abajo.

Con las nuevas APIs de MP (2026):

- **Checkout API Orders** (recomendado): unifica POS + tienda online; permite ítems reales, impuestos por línea, deferred capture, auto_return, deep links.
- **Marketplace split**: `application_fee` en Orders para desglose de comisión Nerqia vs merchant en tiempo real.
- **Saved Cards**: `payment_methods` con token del comprador para checkout "una toca".
- **Subscriptions**: `preapproval` con `auto_recurring`, `card_token_id` para cuotas fijas / mantenimiento.

Esto es lo que diferencia a Nerqia de un CRM genérico: el commerce OS no solo cobra con MP, sino que **calcula margen real con datos de MP** (tasa real, split, comisión, devolución, reintegro parcial).

Estado: **En evaluación** — los contratos de A1/C20 están cerrados; el diferencial MP requiere certificar con MP OAuth en producción (gate externo) antes de implementar.
