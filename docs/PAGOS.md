# Medios de cobro

Cómo cobra cada comercio en su tienda online.

## El modelo: una app de plataforma, muchas cuentas conectadas

Es el mismo esquema de Tiendanube y Empretienda:

- **Vos (la plataforma)** registrás **una sola** aplicación en MercadoPago.
- **Cada comercio** conecta su propia cuenta con un clic desde
  Integraciones → Cobros con MercadoPago.
- El dinero va **directo a la cuenta del comercio**. La plataforma nunca toca
  la plata ni ve las credenciales del comerciante: recibe un token delegado que
  el comercio puede revocar cuando quiera desde su cuenta de MercadoPago.

### Qué había antes

Cada comercio tenía que entrar al panel de desarrolladores de MercadoPago,
generar un Access Token y pegarlo en la configuración. Eso traía tres
problemas:

1. La mayoría de los comerciantes no sabe hacerlo — y no debería tener que.
2. El token quedaba en `settings.mp_access_token`, una columna legible desde el
   navegador por cualquiera con sesión en esa organización.
3. No se renovaba: cuando vencía, los cobros se caían sin aviso.

El fallback del token histórico sigue existiendo para no cortar cobros de una
organización antigua, pero ya no hay un formulario para pegar credenciales en
el navegador. Una conexión nueva se hace únicamente por OAuth; el Checkout
Brick exige además que la credencial provenga de OAuth.

## Configuración de la plataforma (una sola vez)

### 1. Crear la aplicación

En [MercadoPago Developers](https://www.mercadopago.com.ar/developers/panel/app)
creá una aplicación y anotá el **App ID** (client id) y el **Secret**.

En la solapa de OAuth agregá la **Redirect URI**:

```
https://TU-DOMINIO/integraciones?tab=conexiones
```

### 2. Cargar los secretos

```bash
npx supabase secrets set MP_APP_ID=tu_app_id
npx supabase secrets set MP_APP_SECRET=tu_secret
npx supabase secrets set MP_OAUTH_REDIRECT_URI=https://TU-DOMINIO/integraciones?tab=conexiones
```

### 3. Configurar el webhook

En la misma aplicación, en Webhooks, poné:

```
https://<project-ref>.supabase.co/functions/v1/mercadopago-webhook
```

Y guardá la clave secreta que te da MercadoPago:

```bash
npx supabase secrets set MP_WEBHOOK_SECRET=la_clave_del_webhook
```

Sin `MP_WEBHOOK_SECRET` el webhook igual funciona, pero **no valida la firma**:
cualquiera podría hacerle creer que un pedido se pagó. Configuralo antes de
salir a producción.

### 4. Desplegar

```bash
npx supabase functions deploy mp-connect
npx supabase functions deploy store-pay
npx supabase functions deploy mercadopago-webhook
```

## Cómo se guardan los tokens

`payment_connections` tiene RLS habilitada y **cero policies**, a propósito:
solo las Edge Functions (service_role) leen los tokens. El navegador consulta
la vista `payment_connection_status`, que muestra si está conectado, con qué
cuenta y hasta cuándo vale — pero nunca el token.

> No agregues una policy de lectura a `payment_connections` para
> `authenticated`: expondría el token de cobro del comercio.

El `state` del OAuth se guarda en `oauth_states` y es de un solo uso, con 15
minutos de vida. Sin eso, alguien podría inducir a un comercio a conectar una
cuenta ajena (CSRF).

## Renovación

MercadoPago vence los tokens OAuth a los **180 días**. `_shared/mpToken.ts` los
renueva solo cuando faltan menos de 7 días, en la misma llamada que los usa. El
comercio no tiene que hacer nada; el botón "Renovar ahora" del panel es solo por
si se quiere forzar.

## Agregar otro proveedor

`payment_connections.provider` ya admite `stripe`. Para sumar uno nuevo:

1. Ampliar el CHECK de `provider`.
2. Crear una Edge Function `xx-connect` con las mismas acciones
   (start / callback / refresh / disconnect).
3. Agregar el resolvedor de credenciales en `_shared/`.
4. Sumar la tarjeta al `PaymentConnectionsPanel`.

## Comisión de la plataforma

La infraestructura está implementada con una única autoridad
`platform_commission_amount`:

- Checkout Pro envía `marketplace_fee`;
- Checkout Brick envía `application_fee`;
- `record_payment_settlement` registra la misma regla y el neto resultante.

La regla encontrada en producción el 2026-08-21 era **0,5% activa**, aunque la
documentación decía 0%. Se preservó como propuesta, pero ahora está en estado
`draft`, inactiva y cobra **$0**. Los dos pagos de prueba históricos (ARS 1 cada
uno) habían registrado en total ARS 0,10 de plataforma, equivalente a 5%; eso
es evidencia de la mecánica, no pricing aprobado.

Desde `20260821000058_commission_approval_gate.sql`, editar una regla invalida
su aprobación. Para activarla, Finance debe registrar versión de términos,
tratamiento fiscal y ventana de vigencia; la tabla ya no admite escrituras
directas del cliente. La función que llega a `marketplace_fee` sólo considera
reglas aprobadas y vigentes. Si el impuesto se aprueba como adicional, se suma
después del piso/tope comercial; si se declara incluido, no se duplica. Ambos
caminos están espejados entre SQL y `paymentFees.ts`. Activar un porcentaje
sigue siendo una decisión comercial, fiscal y de unit economics, no un efecto
colateral del deploy.

Las fórmulas de contribución, break-even, calidad de supuestos y benchmark de
costo transaccional están en [ECONOMICS.md](ECONOMICS.md). El workbench del
panel es una simulación local: no escribe reglas ni activa pricing.

## Matriz operativa

~~~bash
npm run drill:payments
~~~

El comando ejecuta una organización `ZZ` en un sub-bloque transaccional contra
la base linkeada. Prueba las funciones reales de PostgreSQL y al final provoca
un rollback controlado; no llama a MercadoPago, no usa una tarjeta y no deja
ventas, stock, eventos ni asientos de prueba.

Cobertura aprobada el 2026-08-21:

| Escenario | Evidencia |
|---|---|
| Checkout duplicado | Misma clave → una intención y un intento. |
| Timeout ambiguo | Reusa el intento pendiente; no vuelve a cobrar. |
| Webhook aprobado duplicado | Una venta, un movimiento de stock y una liquidación. |
| Rechazo | No acredita; el retry explícito abre un intento nuevo. |
| Settlement → ledger | La comisión real y su IVA llegan al asiento. |
| Timeout de refund | Conserva operación y clave idempotente en `processing`. |
| Refund reconciliado duplicado | Orden devuelta, RMA resuelto y stock sin reposición ficticia. |
| Traza end-to-end | La misma correlación aparece en checkout, eventos, orden, liquidación y ledger. |

La matriz encontró dos fallas que los tests estáticos no veían:

1. settlement guardaba `source=ecommerce`, mientras el ledger buscaba el valor
   imposible `ecommerce_order`; por eso omitía comisiones (`20260821000055`);
2. el wrapper de refund tenía un argumento default que volvía ambigua su
   delegación y bloqueaba el reintegro (`20260821000056`).

La certificación externa sigue pendiente: pago aprobado, rechazado, webhook
firmado, timeout/reconsulta y refund deben repetirse con una cuenta y medio de
prueba reales. Eso mueve dinero y requiere una operación explícita del dueño;
la matriz interna no se presenta como evidencia de disponibilidad de
MercadoPago.

## Trazabilidad de una operación

Cada `payment_intent` tiene un `correlation_id` opaco generado por PostgreSQL.
No contiene email, nombre, número de orden ni otra información personal. El
checkout lo recibe del RPC y lo envía a MercadoPago como `metadata`; la base lo
deriva de nuevo al registrar la liquidación y al emitir los eventos de la orden.
La partida de cobro del ledger conserva el mismo valor.

El comercio puede abrir **Finanzas → Costos de cobro → Ver traza completa**.
La vista `payment_operation_trace` muestra sólo etapa, estado, proveedor,
referencia y momento. Corre con `security_invoker`, respeta la RLS de cada tabla
y no está concedida a `anon`: ser staff de plataforma no otorga acceso a una
organización.

La matriz `npm run drill:payments` exige cinco etapas distintas —operación,
intento, evento, liquidación y asiento— con una sola correlación. Una metadata
ausente en un pago histórico no bloquea la acreditación; una metadata del
proveedor distinta deja un warning explícito y la relación server-side por
organización + orden sigue siendo la autoridad.
