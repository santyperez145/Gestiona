# Webhooks salientes de Gestiona

Contrato vigente: **`2026-08-29`**. El documento machine-readable se publica
como [OpenAPI 3.1](../public/developer/webhooks/openapi.json) y queda disponible
en cada deploy en `/developer/webhooks/openapi.json`.

## Garantías del transporte

- Gestiona hace `POST` únicamente a un endpoint HTTPS público y no sigue
  redirects.
- La entrega es **al menos una vez**: un receptor puede ver el mismo evento más
  de una vez.
- No se garantiza orden entre eventos. El receptor no debe depender de la
  secuencia de llegada.
- `id` / `X-Gestiona-Event-Id` identifica el evento y se conserva en cada
  reintento. Ésa es la clave de deduplicación.
- `delivery_id` / `X-Gestiona-Delivery` identifica un ciclo de entrega y su
  fila de log. Los retries de red inmediatos pueden compartirlo; un replay
  manual o un nuevo intento de outbox genera otro.
- Cualquier `2xx` confirma la entrega. Un timeout, error de red o status no-2xx
  deja evidencia y puede reintentarse hasta un máximo configurable de cuatro
  intentos totales.
- `sale.created` nace en la misma transacción que la venta y se entrega desde
  la outbox. Cerrar el POS no lo pierde.
- El receptor debería verificar, encolar su trabajo y devolver `2xx` rápido;
  las acciones lentas ocurren después.

Estas decisiones siguen fuentes primarias consultadas el 2026-08-29:
[GitHub recomienda secret, HTTPS, una identidad de entrega y procesamiento
asíncrono](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks),
[GitHub documenta HMAC-SHA256 sobre el cuerpo](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries),
[Stripe declara reintentos y falta de orden garantizado](https://docs.stripe.com/webhooks)
y [OpenAPI 3.1 define `webhooks` como contrato de requests iniciados por el
proveedor](https://spec.openapis.org/oas/v3.1.1.html#openapi-object).

## Sobre y headers

Todos los eventos usan el mismo sobre:

```json
{
  "id": "6cebd3af-1188-46fb-b1b6-9bf655f17d21",
  "delivery_id": "50c3bbc4-a320-45dc-8a20-885fcfa6bfa3",
  "api_version": "2026-08-29",
  "event": "sale.created",
  "org_id": "d870be07-9f40-41f9-a141-3b5bb81813c3",
  "created_at": "2026-08-29T18:30:00.000Z",
  "data": {}
}
```

| Header | Uso |
|---|---|
| `X-Gestiona-Event` | Tipo del evento. |
| `X-Gestiona-Event-Id` | Id estable; deduplicar con éste. |
| `X-Gestiona-Org` | Organización que originó el evento. |
| `X-Gestiona-Delivery` | Id del ciclo de entrega/log; no deduplicar el efecto con éste. |
| `X-Gestiona-Version` | Versión del contrato del payload. |
| `X-Gestiona-Signature` | `t=<unix>,v1=<HMAC hexadecimal>`. |

## Validación de firma

1. Leer el cuerpo como bytes/texto crudo UTF-8. No parsearlo y serializarlo de
   nuevo antes de validar.
2. Separar `t` y `v1` del header `X-Gestiona-Signature`.
3. Rechazar si `abs(ahora - t) > 300` segundos.
4. Calcular `HMAC-SHA256(secret, t + "." + cuerpo_crudo)`.
5. Comparar el hexadecimal esperado con `v1` en tiempo constante.
6. Comprobar que evento, organización e ids de headers coincidan con el cuerpo.
7. Insertar `id` en un registro con restricción única. Si ya existe, responder
   `2xx` sin repetir el efecto.

El ejemplo ejecutable [gestiona-webhook-receiver.mjs](../examples/gestiona-webhook-receiver.mjs)
implementa esos pasos sólo con módulos nativos de Node.js 20 o superior.

```bash
GESTIONA_WEBHOOK_SECRET=whsec_... node examples/gestiona-webhook-receiver.mjs
```

En producción, el `Set` en memoria del ejemplo se reemplaza por una tabla con
índice único sobre `event_id`, y el trabajo se deriva a una cola.

## Eventos

### `sale.created`

`data` contiene `transaction_id`, `occurred_at`, `total_ars` y `lines`. Cada
renglón incluye el producto, cantidad, importes, cliente cuando existe, medio
de pago, canal y vendedor. El total se expresa como número nominal en ARS; no se
debe inferir centavos ni otra moneda.

### `automation.triggered`

`data` mantiene una forma única, sin importar qué ejecutor disparó la regla:
`flow_id`, `flow_name` cuando está disponible, `trigger_type`, `entity_count` y
hasta 50 `entities` con `id` opcional, `label` y `detail`. Teléfonos, emails y
metadata internos no se incluyen.

### `test.ping`

Es la prueba iniciada por un owner/admin desde Integraciones. Usa exactamente la
misma firma y el mismo transporte, con datos sintéticos.

## Cambios incompatibles

La versión viaja en cuerpo y header. Un cambio incompatible publica una nueva
versión y conserva la anterior durante una ventana de migración; agregar un
evento no cambia eventos existentes. El receptor debe rechazar una versión que
no conoce de forma explícita, no intentar adivinar su estructura.

## Certificación reproducible

`npm run certify:webhooks` crea un receptor efímero en Webhook.site, envía un
`test.ping` sintético construido por la misma función que usa producción,
recupera el request, vuelve a calcular la firma, compara headers/cuerpo y borra
el receptor. No usa datos, organizaciones ni secrets reales. Es una prueba de
transporte externo; la prueba desde la UI verifica además autorización, RPC y
registro de entrega de la organización.
