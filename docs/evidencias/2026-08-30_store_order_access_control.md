# Storefront D5.2 — acceso privado a pedidos

**Fecha:** 2026-08-30  
**Riesgo:** P0 privacidad / broken object-level authorization  
**Estado final del slice:** corte productivo confirmado; compra completa con
proveedor real/sandbox permanece pendiente.

## Hallazgo sin exponer datos

Se ejecutó el RPC histórico con `SET LOCAL ROLE anon`, slug y número de orden
correlativo dentro de `BEGIN … ROLLBACK`. El resultado agregado fue:

```text
exposed_rows = 1
exposes_email = true
exposes_address = true
```

No se imprimieron nombre, email, domicilio, items ni importes. El control
demuestra que el número identificaba y autorizaba a la vez. `store-pay` y
`store-order-email` repetían el problema al releer la orden con `service_role`.

## Contrato elegido

- `ecommerce_orders.public_access_token`: UUID aleatorio, único y no nulo;
- `get_store_order_secure`: capacidad exacta, cuenta compradora autenticada o
  número + email limitado a 8 intentos/10 minutos;
- el RPC de dos argumentos se revoca y elimina;
- checkout obtiene la capacidad usando el email que ya envió al RPC de orden;
- sessionStorage mantiene el retorno desde Mercado Pago;
- emails usan `#access=…`, que no llega en el request HTTP ni en el `Referer`;
- la pantalla consume, guarda y limpia el fragmento antes de leer PII;
- token incorrecto, email incorrecto y pedido inexistente comparten el mismo
  estado de verificación;
- `store-pay`, Checkout Brick y `store-order-email` validan de nuevo en servidor;
- las URLs transaccionales usan `PUBLIC_BASE_URL`, no un origen enviado por el
  navegador.

## Referencias oficiales

- [Shopify — estados de autenticación de Order status](https://shopify.dev/docs/apps/build/customer-accounts/order-status-page)
- [Tiendanube — seguimiento de compra](https://ayuda.tiendanube.com/es_AR/123288-mis-ventas/como-puede-mi-cliente-conocer-el-estado-de-su-compra)
- [OWASP — prevención de IDOR](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)

## Rollout seguro

1. puerta completa local;
2. commit/push y esperar cliente nuevo, que tolera únicamente función ausente;
3. aplicar migración y verificar libro;
4. desplegar `store-pay`, `store-order-email` y `store-order-status-email`;
5. probar como `anon` con agregados booleanos: número solo 0, token malo 0,
   token correcto 1;
6. validar navegador, responsive y consola sin modificar pedidos;
7. actualizar este documento y ambos roadmaps con evidencia publicada.

## Evidencia local inicial

- typecheck: aprobado;
- lint: 0 errores y 139 warnings conocidos;
- guardas focalizadas: 17/17 en 3 archivos;
- suite completa: 2.096/2.096 en 212 archivos;
- build/PWA: 18 entradas y 2.018,70 KiB precacheados;
- Edge Functions: 74 verificadas;
- dependencias: 0 vulnerabilidades reportadas por `npm audit`;
- documentación: 84 enlaces internos en 52 documentos;
- conteos: 74 funciones / 498 migraciones;
- migración completa en transacción revertida: `old_removed=true`,
  `secure_created=true`, `missing_tokens=0`;
- cliente `c543249`: `Ready / Production` y alias principal actualizado;
- migración aplicada/registrada; dry-run final `upToDate=true`;
- `store-pay` v40 ACTIVE (`verify_jwt=false`, capacidad obligatoria);
- `store-order-email` v34 ACTIVE (`verify_jwt=false`, capacidad o service role);
- `store-order-status-email` v17 ACTIVE (`verify_jwt=true` + usuario real).

## Evidencia productiva del cierre

La repetición con `SET LOCAL ROLE anon` devolvió sólo conteos:

```text
old_contract_removed = true
number_only          = 0
wrong_token          = 0
correct_token        = 1
correct_email        = 1
```

Las fronteras Edge se probaron sin imprimir ni registrar la capacidad:

```text
store-pay sin token          = 404
store-pay con token erróneo  = 404
store-pay con token correcto = 409 (orden ya final; acceso aceptado, sin proveedor)
store-order-email sin token  = 404
status-email sin sesión      = 401
```

No se envió email, no se creó preferencia/cobro y no se modificó una orden. En
el cliente publicado, un identificador sintético mostró **Verificá tu pedido**,
label explícito, CTA y mensaje neutral ante email sintético inválido. La matriz:

| Viewport | client/scroll | Input | CTA | PII visible | Consola |
|---:|---:|---:|---:|---|---|
| 360 | 356 / 356 | 42 px | 44 px | No | 0 |
| 768 | 764 / 764 | 42 px | 44 px | No | 0 |
| 1024 | 1020 / 1020 | 42 px | 44 px | No | 0 |
| 1440 | 1436 / 1436 | 42 px | 44 px | No | 0 |

Las sesiones ya autenticadas como comprador conservaron el detalle completo,
confirmando que el corte separa el estado autorizado del neutral. Queda abierto
el recorrido de compra completo con un proveedor sandbox/real; no se presenta
esta validación de lectura como certificación de Mercado Pago.

Una prueba técnica no equivale a cumplimiento integral de Ley 25.326, contrato
de tratamiento, registro AAIP ni revisión profesional. Este slice cierra un
control de acceso concreto; las puertas externas permanecen en `docs/LEGAL.md`.
