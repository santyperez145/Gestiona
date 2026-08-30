# Storefront D5.2 — acceso privado a pedidos

**Fecha:** 2026-08-30  
**Riesgo:** P0 privacidad / broken object-level authorization  
**Estado inicial:** reproducción productiva confirmada; corte preparado,
pendiente de despliegue al crear este documento.

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
- base/Edges/cliente productivos: pendientes en este corte.

Una prueba técnica no equivale a cumplimiento integral de Ley 25.326, contrato
de tratamiento, registro AAIP ni revisión profesional. Este slice cierra un
control de acceso concreto; las puertas externas permanecen en `docs/LEGAL.md`.
