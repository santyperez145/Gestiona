/**
 * Camino muerto: Nerqia cobra con Mercado Pago (`mercadopago-webhook`), no
 * con Stripe. Nunca hubo una cuenta de Stripe conectada (0 suscripciones con
 * `stripe_subscription_id`). Antes este handler cargaba el SDK de Stripe y
 * leía `STRIPE_SECRET_KEY` al arrancar: un proveedor dormido con permiso de
 * cambiar planes. Ahora responde 410 sin leer secretos ni tocar la base.
 */
Deno.serve(() =>
  new Response(JSON.stringify({
    error: "Stripe retirado. Los cobros de Nerqia llegan por mercadopago-webhook.",
    code: "stripe_webhook_retired",
  }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
