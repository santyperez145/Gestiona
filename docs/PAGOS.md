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

El token pegado a mano **sigue funcionando** para no romper a quien ya lo tenía,
pero la app avisa que conviene migrar.

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

## Comisión de la plataforma (pendiente)

MercadoPago permite cobrar una comisión por operación con
`marketplace_fee` en la preferencia, en modo marketplace. Todavía no está
implementado: hoy el 100% va al comercio. Cuando quieras monetizar por
transacción en vez de por suscripción, ese es el camino.
