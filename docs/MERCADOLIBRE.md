# Integración con MercadoLibre

Publica productos, sincroniza stock y precio, y baja las órdenes.

## Antes de empezar: los vapers no se pueden vender

MercadoLibre Argentina **no permite publicar cigarrillos electrónicos**. ANMAT
los tiene prohibidos (Disposición 3226/2011) y una publicación así se da de baja
con sanción en la cuenta.

La integración bloquea la categoría `vaper` del lado del servidor
(`meli-sync`, constante `CATEGORIAS_PROHIBIDAS`), así que no se puede publicar
uno por accidente. Sirve para perfumes y el resto del catálogo.

## Paso 1 — Crear la aplicación

1. Entrá a [developers.mercadolibre.com.ar/devcenter](https://developers.mercadolibre.com.ar/devcenter)
   y creá una aplicación.
2. En **Redirect URI** poné exactamente:
   ```
   https://TU-DOMINIO/integraciones?tab=conexiones
   ```
   (para probar en local: `http://localhost:8080/integraciones?tab=conexiones`)
3. Marcá los scopes `read`, `write` y `offline_access`. Sin `offline_access` no
   te dan `refresh_token` y la conexión se cae a las 6 horas.
4. Anotá el **Client ID** y el **Client Secret**.

## Paso 2 — Cargar las credenciales

El Client Secret es un secreto: va del lado del servidor, nunca en el bundle.

**Secretos de Edge Functions** (Dashboard → Edge Functions → Secrets, o CLI):

```bash
npx supabase secrets set MELI_CLIENT_ID=tu-client-id
npx supabase secrets set MELI_CLIENT_SECRET=tu-client-secret
npx supabase secrets set MELI_REDIRECT_URI=https://TU-DOMINIO/integraciones?tab=conexiones
```

**Variable del frontend** (`.env`), solo el Client ID, que es público:

```
VITE_MELI_CLIENT_ID=tu-client-id
```

## Paso 3 — Desplegar las funciones

```bash
npx supabase functions deploy meli-oauth
npx supabase functions deploy meli-sync
```

## Paso 4 — Conectar

En la app: **Integraciones → Conexiones → Conectar con MercadoLibre**.
Te manda a MercadoLibre, autorizás, y volvés con la cuenta vinculada.

## Cómo se guardan los tokens

`meli_connections` tiene RLS habilitada y **cero policies**, a propósito: solo
las Edge Functions (service_role) leen y escriben los tokens. El navegador nunca
los ve.

La UI consulta la vista `meli_connection_status`, que muestra si está conectado,
con qué cuenta y hasta cuándo vale el token — pero no el token.

> No agregues una policy de lectura a `meli_connections` para `authenticated`:
> expondría el access_token de la cuenta a cualquiera con sesión en la org.

El `access_token` de MercadoLibre dura 6 horas. `meli-sync` lo renueva solo
cuando le quedan menos de 10 minutos, para no pedir un token nuevo en cada
sincronización.

## Acciones disponibles

| Acción | Qué hace |
|---|---|
| `publish` | Publica un producto y guarda el vínculo en `meli_listings` |
| `sync-stock` | Empuja stock y precio de todas las publicaciones activas |
| `pull-orders` | Baja las últimas 50 órdenes a `meli_orders` |

## Sincronización automática (opcional)

Para que el stock se actualice solo, agregá un cron usando el helper que ya
existe (ver `docs/CRON.md`):

```sql
SELECT cron.schedule(
  'meli-sync-stock', '0 */2 * * *',
  $$SELECT public.invoke_edge_function('meli-sync-cron');$$
);
```

Ojo: `meli-sync` espera un `orgId` y valida el rol del usuario que llama, así
que para el cron hace falta una función aparte que recorra las organizaciones
conectadas. Todavía no está hecha — hoy la sincronización es manual desde el
panel.

## Qué falta

- Publicar desde la ficha del producto (hoy la acción `publish` existe pero no
  tiene botón; falta elegir la categoría de ML con el predictor de categorías).
- Importar una orden de `meli_orders` como venta en Gestiona (la columna
  `sale_id` está lista para ese vínculo).
- Webhook de notificaciones de ML para no depender del polling.
- Función de cron multi-organización para la sincronización automática.
