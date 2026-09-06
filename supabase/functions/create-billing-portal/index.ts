// Compatibilidad para clientes antiguos. Nerqia cobra sus planes con Mercado
// Pago y la gestión vigente vive en /suscripcion + cancel-subscription.
// Mantener un portal Stripe aparentemente activo duplicaba proveedores,
// requería un secreto que producción no usa y podía confundir soporte.
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  return new Response(JSON.stringify({
    error: "La gestión del plan se realiza desde Mi plan.",
    code: "BILLING_PORTAL_RETIRED",
    use: "/suscripcion",
  }), { status: 410, headers });
});
