# Evidencia — receptor externo de webhooks

**Fecha:** 2026-08-29 07:39:21 UTC

**Comando:** `npm run certify:webhooks`

**Receptor:** Webhook.site, token efímero sin cuenta
**Evento:** `test.ping` sintético, contrato `2026-08-29`

## Resultado

El certificador construyó el request con
`buildSignedOutboundWebhookRequest`, la misma función pura que usa el transporte
de las Edge Functions. El receptor externo devolvió HTTP 200 y la API de
captura permitió comprobar:

- método `POST`;
- cuerpo crudo byte-for-byte igual al firmado;
- HMAC-SHA256 recalculado correctamente sobre `timestamp.cuerpo_crudo`;
- `X-Gestiona-Event`;
- `X-Gestiona-Event-Id` estable;
- `X-Gestiona-Delivery` del ciclo de entrega;
- `X-Gestiona-Org`;
- `X-Gestiona-Version`;
- `Content-Type: application/json`.

El contrato `public/developer/webhooks/openapi.json` pasó además
`@redocly/cli@1.34.5 lint` con **cero errores y cero warnings** el 2026-08-29;
la validación no usa un ignore file.

Después del gate, el helper quedó desplegado en las cuatro consumidoras:
`send-webhook` v41 (`verify_jwt=true`), `dispatch-outbound-webhook` v2,
`execute-automations` v46 y `run-automation-flows` v46 (las tres con
`verify_jwt=false` y autenticación propia). Las cuatro devolvieron 401 ante una
llamada anónima. El build sirvió el contrato con HTTP 200,
`Content-Type: application/json`, OpenAPI 3.1.1 y tres eventos.

Request de evidencia: `938b55a4-56b1-41b1-85c9-2ace7869df2f`. El token del
receptor se borró y Webhook.site confirmó `204`; la URL ya no existe. No se
envió dato comercial, usuario, organización ni secret real.

## Incidencias encontradas durante la certificación

La primera conexión fue cerrada por el servidor antes de responder. El script
ahora reintenta sólo errores de red, con intentos y timeouts acotados. Una
segunda corrida reveló que la API promete un UUID de 36 caracteres pero no una
versión/variant específica; el certificador dejó de imponer una restricción
que el proveedor no documenta. Las pruebas no enviaron datos reales y la
corrida final confirmó explícitamente el borrado.

## Alcance honesto

Esto demuestra interoperabilidad del request canónico contra Internet y es
reproducible sin credenciales. No reemplaza la prueba de un endpoint propio del
comercio desde la UI: esa prueba sigue verificando autorización, configuración,
secret one-time y log de entrega para el tenant. Tampoco demuestra consumo de
una venta real; `sale.created` ya tiene por separado fixture transaccional de
outbox con cero restos.

Fuentes oficiales consultadas el 2026-08-29:
[API de tokens de Webhook.site](https://docs.webhook.site/api/tokens.html),
[API de requests de Webhook.site](https://docs.webhook.site/api/requests.html),
[prácticas de webhooks de GitHub](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks),
[entrega y orden de Stripe](https://docs.stripe.com/webhooks) y
[objeto Webhooks de OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.1.html#openapi-object).
