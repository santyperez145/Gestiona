/**
 * Camino muerto: la suscripción se contrata con `mp-subscribe` (Mercado Pago).
 * Stripe quedó fuera del producto. Esta función responde 410 para no fingir
 * un checkout vivo ni cargar `STRIPE_SECRET_KEY` al arrancar (OPTIONS 500).
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    error: "Stripe checkout retirado. Contratá el plan con mp-subscribe (Mercado Pago).",
    code: "stripe_checkout_retired",
    use: "mp-subscribe",
  }), {
    status: 410,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
