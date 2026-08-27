/**
 * El access token de la PLATAFORMA en MercadoPago.
 *
 * ⚠️ No confundir con `mpToken.ts`, que resuelve el token **del comercio**
 * —el que cobra las ventas de su tienda—. Éste es el de la cuenta dueña de la
 * aplicación, y es con el que se manejan las suscripciones al SaaS: crearlas,
 * cambiarles el precio y cancelarlas.
 *
 * Orden de preferencia:
 *   1. `MP_PLATFORM_ACCESS_TOKEN` puesto a mano — es una decisión explícita y
 *      manda sobre todo lo demás.
 *   2. `client_credentials` con `MP_APP_ID` + `MP_APP_SECRET`, que son los que
 *      ya usa el OAuth de `mp-connect`. 📌 `MP_APP_ID` **no es un token**: es el
 *      identificador público de la aplicación. Con el secreto al lado,
 *      MercadoPago entrega un token sobre la cuenta dueña de la app.
 *
 * 📌 Vive acá porque lo necesitan tres funciones —`mp-subscribe`,
 * `precio-suscripcion` y `cancel-subscription`—. Con dos ya estaba duplicado;
 * con tres se convierte en la clase de decisión repetida que en este repo ya
 * divergió dos veces.
 */
export async function tokenDeLaPlataforma(): Promise<string | null> {
  const directo = Deno.env.get("MP_PLATFORM_ACCESS_TOKEN");
  if (directo) return directo;

  const id = Deno.env.get("MP_APP_ID");
  const secret = Deno.env.get("MP_APP_SECRET");
  if (!id || !secret) return null;

  try {
    const res = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials", client_id: id, client_secret: secret,
      }),
    });
    if (!res.ok) {
      console.error("no se pudo obtener el token de plataforma", res.status, await res.text());
      return null;
    }
    return (await res.json())?.access_token ?? null;
  } catch (e) {
    console.error("error pidiendo el token de plataforma", e);
    return null;
  }
}
