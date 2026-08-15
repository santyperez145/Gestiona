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
| `predict-category` | Propone hasta tres categorías a partir de la ficha guardada del producto |
| `publish` | Publica un producto y guarda el vínculo en `meli_listings` |
| `sync-stock` | Empuja stock y precio de todas las publicaciones activas |
| `pull-orders` | Baja las últimas 50 órdenes a `meli_orders`, con precio y comisión por línea |
| `import-order` | Convierte una orden `paid` ya bajada en ventas de Gestiona, stock y cobro neto |

## Publicar desde un producto

Abrí un producto **ya guardado** en Productos. Si la cuenta está conectada, la
ficha muestra **Publicar en MercadoLibre**. Primero elegí **Sugerir categoría**:
Gestiona manda el título que ya está guardado a `domain_discovery` de
MercadoLibre y presenta hasta tres opciones. La primera es una sugerencia, no
una decisión automática; elegí la que corresponda y recién entonces usá
**Confirmar y publicar**.

El servidor vuelve a leer el producto antes de crear el ítem: título, precio,
stock e imágenes no salen de lo que tenga el navegador en un borrador. Si ese
producto ya tiene un vínculo en `meli_listings`, devuelve la publicación
existente en lugar de crear otra. Los vapers se bloquean tanto en la ficha como
en la Edge Function.

MercadoLibre puede pedir atributos adicionales para algunas categorías. Si los
requiere, la respuesta del API aparece como error de publicación: completá la
ficha o elegí la categoría correcta y reintentá; no se guarda un vínculo falso.

## Importar una orden cobrada

Después de **Traer órdenes**, cada orden `paid` muestra **Importar venta** en
Integraciones. La importación es atómica: vincula cada publicación de
MercadoLibre con el producto interno, crea una venta por línea y deja que el
trigger de `sales` descuente el stock una única vez. Si una publicación no está
vinculada, no se crea ninguna venta; no se adivina por el título.

La orden conserva el precio y `sale_fee` que informó MercadoLibre; para
órdenes descargadas antes de esta mejora se lo recupera de su payload original.
Si no existe ese dato, la importación se frena en vez de registrar una comisión
en cero. La comisión queda en `payment_transactions` y por línea en
`meli_order_sale_lines`, lista para el margen por canal. El costo de envío de
MercadoLibre todavía no forma parte del payload descargado: no se muestra una
estimación como si fuera un costo real.

Una misma orden no puede importarse dos veces. `meli_orders`, sus vínculos de
venta y las publicaciones vinculadas son de sólo lectura para el navegador; la
sincronización y la conversión las escriben las Edge Functions con service role.

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

- Webhook de notificaciones de ML para no depender del polling.
- Función de cron multi-organización para la sincronización automática.
