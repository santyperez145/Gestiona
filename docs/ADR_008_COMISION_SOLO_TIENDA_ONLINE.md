# ADR 008 — La comisión de Nerqia, sólo sobre ventas de la tienda online

**Estado:** aceptada, 2026-10-22.
**Decide:** el dueño.
**Implementa:** migración `20261022000500_comision_solo_tienda_online.sql`, Edge `mercadopago-link`, `src/lib/paymentFees.ts`.

## Contexto

Nerqia puede quedarse con una comisión por cobro. Se la pide a Mercado Pago al crear el cobro (`application_fee`) y la registra en la liquidación. La regla se resolvía por canal, con tres valores posibles: `online`, `pos` y `all`. Así, una regla `all` o `pos` cobraba en lugares que no son la tienda:

- el QR de la caja, que es una venta en el local;
- los links de pago, que hasta hoy se calculaban como `online` y sirven para cobrar presupuestos y cuentas corrientes.

Esa plata es del sistema de gestión, no de la tienda.

## Decisión

El dueño lo pidió así: *«lo que son las comisiones del sistema debería ser únicamente para las ventas por tienda online»*.

- `platform_commission_amount` devuelve 0 para cualquier canal que no sea `online`. Es la única fuente: la usan el checkout de la tienda, el QR, los links y la liquidación.
- `record_payment_settlement` toma el canal de la fuente. Sólo `ecommerce` es `online`, así que un link de pago no anota una comisión que no se cobró.
- Los links piden la comisión con el canal `link`, y la respuesta es 0.
- En Platform el canal de la regla dice «Tienda online». Una regla guardada como `all` sigue cobrando en la tienda.
- El comercio lo ve explicado en Nerqia Pay y en la liquidación estimada del QR.

## Consecuencias

- El local y la gestión (caja, QR, links, presupuestos y cuentas corrientes) no tienen comisión de Nerqia. Ahí Nerqia cobra la suscripción, no un porcentaje de cada venta.
- La tienda online es el único lugar donde Nerqia cobra por venta.
- Las reglas guardadas no se reescriben. Si alguna dice `pos`, deja de cobrar.

**Pendiente con la base activa:** el simulacro (`scripts/comision-solo-tienda-matrix.sql`), aplicar la migración y desplegar `mercadopago-link`.
