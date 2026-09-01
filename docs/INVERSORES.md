# Narrativa para inversores

**Fecha:** 2026-09-01.  
**Canon de producto:** [ADR 002](ADR_002_COMMERCE_OPERATING_SYSTEM.md).  
**Métricas instrumentadas:** [ESTRATEGIA.md](ESTRATEGIA.md) §6 y el panel
`/platform/metricas`. Este archivo no inventa GMV, ATM de terceros ni
retención.

Gestiona is building the Commerce Operating System and Merchant Financial
Network for Latin America.

## Problema

Los comercios operan tienda, POS, Mercado Pago, Excel, un ERP, WhatsApp,
contador, logística y crédito por separado. No pueden responder con una sola
verdad cuánto ganan por venta, qué stock comprar, qué precio mover, qué canal
conviene ni cuánto capital pueden tomar.

## Solución

Commerce + Business + Pay + Finance + (más adelante) Capital y acciones
autónomas con política, sobre **un** Business Graph. La tienda es la puerta;
el foso es costo landed + comisión + envío + IVA en la misma operación, más
el flujo de cobro y —cuando haya partner— el crédito atado a inventario y
ventas.

## Qué se puede mostrar hoy

Instrumentación lista, no product-market fit:

| Señal | Estado | Dónde |
|---|---|---|
| Activación (G1–G3) | Vistas y hitos en base | `platform_org_health`, `platform_org_activation` |
| GMV / orgs (G4/G5) | Instrumentado; no reportar como SaaS sin denominador de pago | `platform_org_health` |
| Precisión de stock (G7) | Vista staff | `platform_org_stock_accuracy` |
| AI Action Rate (G8) | Acciones aplicadas, no chats | `apply_ai_offer_recommendation` |
| Comisión de plataforma | Cobrada en compras de prueba | `platform_commission_rules` + Mercado Pago `application_fee` |
| ATM externos | Todavía el gate comercial, no un número de ronda | Dueño + pruebas |

Hasta que un segundo comercio complete el recorrido, **no** se citan retención
a 90 días, Pay Penetration ni GMV mensual de merchants ajenos.

## Qué no se promete en una deck

- Stripe Capital, Treasury o Adyen Capital en Argentina.
- Gestiona como PSPCP o prestamista en el primer año de código.
- Paridad de temas/apps con Tiendanube como tesis.
- “Todos los módulos completos” como diez productos simultáneos. Completo =
  un trabajo de punta a punta (ADR 002 §4).

## Hitos de evidencia (referencia, no covenant)

Pre-seed razonable: 20–50 ATM, GMV mensual medible y conciliado, 3–5 casos,
Pay Penetration inicial, retención 90 días, ingresos variables.  
Seed: cientos de ATM, GMV de varios millones, Pay 40–60%, Finance adoptado,
piloto de Capital con partner.

Uso de una ronda (producto y GTM, no libro de préstamos): ~35% Commerce y
confiabilidad, 20% payments y risk, 15% datos e intelligence, 15% GTM, 10%
compliance y Finance, 5% operaciones.

## Rails de pago (decisión 2026-09-01)

- **Argentina v1:** Mercado Pago (OAuth, split/fee, checkout, QR, Point,
  refunds, webhooks). Validar contrato de Split Payments; la API no equivale
  a aprobación comercial.
- **Segundo rail:** Payway, con negociación de marketplace.
- **Regional:** dLocal cuando haya etapa enterprise.
- **Stripe:** adapter para países soportados (Connect, Payment Element,
  Billing, Radar). No es el lanzamiento argentino de Pay.

## Mercado (contexto, no tracción de Gestiona)

❓ CACE: 181,5 millones de órdenes en el 1S 2026, +21% i.a.; Herramientas y
Construcción entre rubros de mayor facturación — citar sólo con la fuente
oficial al día de la reunión.  
❓ BCRA: 218 PSPCP a marzo 2026; cartera fintech PNFC +47% i.a. a febrero
2026 — igual: verificar el informe vigente antes de una deck.
