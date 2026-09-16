import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { getMpCredentials } from "../_shared/mpToken.ts";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    return json({ error: "Método no permitido" }, 405);
  }

  const { user, supabase, error: authError } = await requireUser(req);
  if (authError) return authError;

  const orgId = req.headers.get("x-org-id") ?? "";
  if (!orgId) return json({ error: "Falta organización" }, 400);

  // Verificar permisos: sales.create o administrador
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  const canManagePayments = membership?.role === "administrador" || membership?.role === "vendedor";
  if (!canManagePayments) return json({ error: "Sin permisos" }, 403);

  const credentials = await getMpCredentials(supabase, orgId);
  if (!credentials) return json({ error: "Mercado Pago no conectado" }, 400);

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const mpBase = "https://api.mercadopago.com/v1";

  if (req.method === "GET") {
    // Listar payment methods guardados del cliente
    const url = new URL(req.url);
    const customerId = url.searchParams.get("customer_id");
    const email = url.searchParams.get("email");

    if (!customerId && !email) {
      return json({ error: "customer_id o email requerido" }, 400);
    }

    // Buscar customer en MP si no tenemos el ID
    let mpCustomerId = customerId;
    if (!mpCustomerId && email) {
      const searchRes = await fetch(
        `${mpBase}/customers/search?email=${encodeURIComponent(email)}`,
        { headers: { Authorization: `Bearer ${credentials.accessToken}` } }
      );
      const searchData = await searchRes.json().catch(() => ({}));
      mpCustomerId = searchData?.results?.[0]?.id;
    }

    if (!mpCustomerId) return json({ methods: [] });

    const methodsRes = await fetch(
      `${mpBase}/customers/${mpCustomerId}/payment_methods`,
      { headers: { Authorization: `Bearer ${credentials.accessToken}` } }
    );
    const methodsData = await methodsRes.json().catch(() => ({}));
    return json({ methods: methodsData ?? [] });
  }

  if (req.method === "POST") {
    // Guardar payment method (tokenizar tarjeta)
    const body = await req.json().catch(() => ({}));
    const { token, customer_id, email, payer_info } = body as {
      token: string;
      customer_id?: string;
      email?: string;
      payer_info?: {
        first_name?: string;
        last_name?: string;
        identification?: { type: string; number: string };
      };
    };

    if (!token) return json({ error: "token requerido" }, 400);

    // Si no hay customer_id, buscar/crear customer
    let mpCustomerId = customer_id;
    if (!mpCustomerId) {
      if (!email) return json({ error: "customer_id o email requerido" }, 400);

      // Buscar customer existente
      const searchRes = await fetch(
        `${mpBase}/customers/search?email=${encodeURIComponent(email)}`,
        { headers: { Authorization: `Bearer ${credentials.accessToken}` } }
      );
      const searchData = await searchRes.json().catch(() => ({}));
      mpCustomerId = searchData?.results?.[0]?.id;

      // Crear customer si no existe
      if (!mpCustomerId) {
        const createRes = await fetch(`${mpBase}/customers`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            ...(payer_info?.first_name && { first_name: payer_info.first_name }),
            ...(payer_info?.last_name && { last_name: payer_info.last_name }),
            ...(payer_info?.identification && { identification: payer_info.identification }),
          }),
        });
        const createData = await createRes.json().catch(() => ({}));
        mpCustomerId = createData?.id;
      }
    }

    if (!mpCustomerId) return json({ error: "No se pudo resolver customer" }, 500);

    // Asociar payment method al customer
    const addRes = await fetch(`${mpBase}/customers/${mpCustomerId}/payment_methods`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });
    const addData = await addRes.json().catch(() => ({}));

    if (!addRes.ok) {
      console.error("mp payment method add:", addRes.status, addData);
      return json({ error: "No se pudo guardar la tarjeta" }, 502);
    }

    // Guardar referencia local para auditoría
    await supabase.from("mp_payment_methods").upsert({
      org_id: orgId,
      mp_customer_id: mpCustomerId,
      mp_payment_method_id: addData.id,
      payment_type_id: addData.payment_type_id,
      card_last_four: addData.card?.last_four_digits ?? null,
      card_brand: addData.card?.brand ?? null,
      card_expiration: addData.card?.expiration_year && addData.card?.expiration_month
        ? `${addData.card.expiration_year}-${String(addData.card.expiration_month).padStart(2, "0")}`
        : null,
      is_default: addData.is_default ?? false,
      created_at: new Date().toISOString(),
    }, { onConflict: "mp_payment_method_id" });

    return json({ payment_method: addData, mp_customer_id: mpCustomerId });
  }

  if (req.method === "DELETE") {
    // Eliminar payment method
    const url = new URL(req.url);
    const mpCustomerId = url.searchParams.get("customer_id");
    const mpPaymentMethodId = url.searchParams.get("payment_method_id");

    if (!mpCustomerId || !mpPaymentMethodId) {
      return json({ error: "customer_id y payment_method_id requeridos" }, 400);
    }

    const delRes = await fetch(`${mpBase}/customers/${mpCustomerId}/payment_methods/${mpPaymentMethodId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
    });

    if (!delRes.ok) {
      const delData = await delRes.json().catch(() => ({}));
      console.error("mp payment method delete:", delRes.status, delData);
      return json({ error: "No se pudo eliminar la tarjeta" }, 502);
    }

    // Borrar referencia local
    await supabase
      .from("mp_payment_methods")
      .delete()
      .eq("org_id", orgId)
      .eq("mp_customer_id", mpCustomerId)
      .eq("mp_payment_method_id", mpPaymentMethodId);

    return json({ ok: true });
  }
});