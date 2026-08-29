# API pública de Gestiona

Contrato vigente: **v1**, release **2026-08-29**. La descripción ejecutable se
publica como [OpenAPI 3.1](../public/developer/api/openapi.json) y el estado de
versiones como [changelog machine-readable](../public/developer/api/changelog.json).

## Para qué existe

La API conecta un sistema externo con el mismo Business Core que usan POS,
tienda y marketplaces. No crea un segundo stock ni recalcula precios desde el
cliente. La key identifica organización y permisos; la base sigue siendo la
autoridad de stock, costo, margen, tenant e idempotencia.

Base URL:

```text
https://hummeopatkniwkyrrhwc.supabase.co/functions/v1/public-api/v1
```

`/v1` es obligatorio. La ruta equivalente sin versión responde `404`; no hay
alias silencioso que mañana pueda cambiar de semántica.

Es **server-to-server**. No tiene CORS para navegadores: una `gst_live_...` en
JavaScript público queda expuesta a cualquier visitante. Guardala en variables
de entorno o en un secret manager.

## Primer request

```bash
curl "https://hummeopatkniwkyrrhwc.supabase.co/functions/v1/public-api/v1/products?limit=50" \
  -H "Authorization: Bearer $GESTIONA_API_KEY"
```

La key completa se muestra una sola vez. En Gestiona queda únicamente su
SHA-256, prefijo, scopes, expiración y uso. Owner/admin puede revocarla sin
borrar la evidencia histórica.

## Endpoints y scopes

| Endpoint | Scope | Contrato adicional |
|---|---|---|
| `GET /products` | `products:read` | `stock` exige además `stock:read`; `cost_usd`, `costs:read`. |
| `GET /products/{id}` | `products:read` | Stock y costos conservan scopes separados. |
| `GET /stock/{id}` | `stock:read` | Devuelve unidades enteras; un negativo no se oculta. |
| `PATCH /stock/{id}` | `stock:write` | Fija el valor absoluto; la base calcula delta y Kardex. |
| `GET /sales` | `sales:read` | `since`/`until` son ISO 8601; máximo 200 filas. |
| `POST /sales` | `sales:write` | `Idempotency-Key` obligatorio; costos de respuesta requieren `costs:read`. |
| `GET /customers` | `customers:read` | Máximo 500 filas. |

`products:read` ya no concede stock por accidente y `sales:write` ya no concede
margen. Los campos condicionales simplemente no aparecen cuando falta su scope.

## Importes y cantidades

v1 conserva compatibilidad con su representación original:

- ARS es un JSON number nominal con hasta **2 decimales** y máximo
  `999999999999.99`;
- USD es un JSON number nominal con hasta **4 decimales** y máximo
  `99999999.9999`;
- stock y cantidad de venta son **unidades enteras**: stock desde 0 y venta
  desde 1, ambos hasta `2147483647`;
- `PATCH /stock` no acepta negativos, pero una lectura puede mostrarlos: tapar
  una inconsistencia con cero sería falsear el inventario;
- el servidor normaliza cada salida a esa precisión y rechaza escrituras con
  escala o rango distintos.

[Stripe usa minor units enteras](https://docs.stripe.com/currencies#minor-units-in-api-amounts)
y Shopify serializa su decimal arbitrario como string. Cambiar v1 a uno de esos
modelos rompería clientes; si Gestiona adopta otra representación será en `v2`,
nunca silenciosamente dentro de v1.

## Crear una venta sin duplicarla

```bash
curl -X POST \
  "https://hummeopatkniwkyrrhwc.supabase.co/functions/v1/public-api/v1/sales" \
  -H "Authorization: Bearer $GESTIONA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 64fbaf87-1f42-45ac-8a5e-3afcc1ff70ac" \
  --data '{
    "product_id": "11111111-1111-4111-8111-111111111111",
    "quantity": 2,
    "total_ars": 24990.00,
    "payment_method": "transferencia",
    "paid": true
  }'
```

La misma key con el mismo body devuelve la misma venta y
`idempotent_replay: true`. La misma key con otro body responde `409`. Producto,
key, scope, tenant, costo y owner se releen en servidor; un lock serializa la
misma key y reserva, insert, triggers de stock/outbox y cierre idempotente son
una única transacción.

## Cupo y trazabilidad

Una request autenticada recibe:

| Header | Uso |
|---|---|
| `X-Request-Id` | Id exacto de la traza y del error reportable. |
| `X-API-Version` | Major de contrato (`1`). |
| `X-Gestiona-API-Release` | Revisión compatible (`2026-08-29`). |
| `X-RateLimit-Limit` | Cupo de esa key en la ventana actual. |
| `X-RateLimit-Remaining` | Requests restantes. |
| `X-RateLimit-Reset` | Epoch UTC de reinicio. |
| `Link` | Descubrimiento del OpenAPI. |

El contador es atómico en Postgres y compartido entre instancias. Un `429`
incluye `Retry-After`. Si no se puede consultar la autoridad de cupo, responde
`503`: no finge un límite que no verificó.

## Errores

```json
{
  "error": "Product not found",
  "code": "not_found",
  "request_id": "0284d980-10c1-49d2-ad8e-d2bfa504aed2"
}
```

Los mensajes internos de Postgres quedan en logs. El integrador recibe un
status semántico y el mismo request id que usa Operaciones para encontrar la
traza.

## Versionado y deprecación

- La versión va en URL y en cada respuesta.
- Un breaking change crea otra ruta (`v2`); agregar campos opcionales o nuevos
  endpoints puede ocurrir en una versión soportada.
- Cuando exista sucesora, v1 se mantiene al menos **12 meses**.
- La deprecación se anuncia en el changelog, en la guía y en runtime con los
  headers estándar `Deprecation`, `Sunset` y `Link; rel="deprecation"`.
- Después del sunset, una versión retirada responde `410 Gone`; no cae en
  silencio a otra semántica.

El patrón se contrastó el 2026-08-29 con fuentes primarias: [GitHub versiona los
breaking changes y comunica cierre con `Deprecation`/`Sunset`](https://docs.github.com/en/rest/about-the-rest-api/api-versions),
[Shopify mantiene versiones solapadas y expone la versión efectiva](https://shopify.dev/docs/api/usage/versioning),
[RFC 9745 estandariza `Deprecation`](https://www.rfc-editor.org/rfc/rfc9745.html),
[Stripe documenta la idempotencia](https://docs.stripe.com/api/idempotent_requests)
y [Shopify serializa decimales arbitrarios como string](https://shopify.dev/docs/api/admin-graphql/latest/scalars/decimal).
