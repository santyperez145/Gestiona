# Storefront D5.3 — emails transaccionales idempotentes

**Fecha:** 2026-08-30  
**Riesgo:** P0 confiabilidad, abuso y costo de proveedor  
**Estado inicial:** implementación y fixture aprobadas; rollout productivo
pendiente del commit.

## Hallazgo

La confirmación de una orden podía invocarse desde checkout, pago y webhook con
la misma capacidad válida, pero no registraba una identidad de entrega. Un
reintento legítimo o abusivo llamaba otra vez a SMTP/Resend para comprador y
comercio. El aviso de despacho sí tenía tabla y clave única, aunque su secuencia
`SELECT` → `INSERT/UPDATE` → proveedor permitía dos workers concurrentes.

No se enviaron correos para reproducir el riesgo: el contrato del código y las
fronteras concurrentes eran suficientes, y utilizar destinatarios reales habría
convertido una verificación en spam.

## Contrato implementado

- identidad: orden + audiencia (`buyer`/`merchant`) + evento
  (`order_created`, `payment_confirmed`, `shipped`, `delivered`);
- índice único y ledger privado bajo RLS, sin acceso `anon`/`authenticated`;
- `claim_store_order_email`: inserción/lock atómico, token de worker y lease
  acotado de 30–900 segundos;
- `finish_store_order_email`: sólo el token vigente puede cerrar enviado/fallo;
- la red SMTP/HTTP sucede entre claim y finish, nunca dentro de la transacción;
- un enviado retorna éxito deduplicado y un worker activo retorna `inProgress`;
- un fallo o lease vencido reabre el mismo evento con contador de intento;
- Resend recibe una clave estable por evento y el id del proveedor sólo se
  conserva en el ledger privado;
- el aviso al comercio existe sólo para `order_created`; el comprador puede
  recibir creación y confirmación de pago como eventos distintos.

El ledger evita duplicados durablemente para SMTP y Resend. Resend ofrece una
segunda barrera de 24 horas. No se declara exactly-once para SMTP ante la caída
imposible de distinguir entre “proveedor aceptó” y “worker registró resultado”.

## Referencias oficiales

- [Resend — idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend — webhooks al menos una vez](https://resend.com/docs/webhooks/introduction)

## Verificación reversible

La migración completa y la fixture se ejecutaron juntas contra PostgreSQL real
dentro de `BEGIN … ROLLBACK`. Se usó una orden existente sólo como FK y un
destinatario `example.invalid`; no se leyó ni imprimió PII y no se llamó a un
proveedor.

```text
first_claim                  = true
concurrent_blocked           = true
wrong_worker_blocked         = true
finished                     = true
sent_deduplicated            = true
stale_reclaimed              = true
stale_worker_blocked         = true
retry_attempt                = 2
anon_table_blocked           = true
authenticated_table_blocked  = true
anon_claim_blocked           = true
authenticated_finish_blocked = true
```

El rollback retiró migración y filas de prueba en la misma transacción.

## Puerta local

- typecheck: aprobado;
- lint: 0 errores / 139 warnings conocidos;
- pruebas: 2.102/2.102 en 213 archivos;
- build/PWA: 18 entradas y 2.018,70 KiB precacheados;
- Edge Functions: 74 verificadas por Deno;
- dependencias: 0 vulnerabilidades reportadas;
- documentación: 85 enlaces internos en 53 documentos;
- conteos: 74 funciones / 499 migraciones.

## Rollout pendiente

1. commit y push del slice;
2. aplicar y registrar `20260830000021`;
3. desplegar `store-order-email` y `store-order-status-email`;
4. repetir la fixture standalone en producción con rollback;
5. comprobar versiones y fronteras sin disparar un email real;
6. actualizar esta evidencia y ambos roadmaps.

Una prueba interna no certifica entregabilidad, reputación de dominio, DPA del
proveedor ni operación real. Esos gates permanecen externos y explícitos.
