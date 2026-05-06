import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEnv } from "../_shared/env.ts";

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), { apiVersion: "2024-06-20" });
const supabaseUrl = requireEnv("SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    supabaseUrl,
    serviceRoleKey,
  );

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });

  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });

  const { planCode, orgId, yearly = false, successUrl, cancelUrl } = await req.json();

  // Get plan from DB
  const { data: plan } = await supabase.from("plans").select("*").eq("code", planCode).single();
  if (!plan) return new Response(JSON.stringify({ error: "Plan no encontrado" }), { status: 400, headers: corsHeaders });

  const priceId = yearly ? plan.stripe_price_id_yearly : plan.stripe_price_id_monthly;
  if (!priceId) return new Response(JSON.stringify({ error: "Plan sin precio configurado en Stripe" }), { status: 400, headers: corsHeaders });

  // Get or create Stripe customer — stripe_customer_id lives in subscriptions table
  const { data: org } = await supabase.from("organizations").select("name").eq("id", orgId).single();
  const { data: existingSub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("org_id", orgId)
    .maybeSingle();

  let customerId = existingSub?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: org?.name || user.email,
      metadata: { org_id: orgId, user_id: user.id },
    });
    customerId = customer.id;
    await supabase
      .from("subscriptions")
      .update({ stripe_customer_id: customerId })
      .eq("org_id", orgId);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl || `${req.headers.get("origin")}/ajustes?checkout=success`,
    cancel_url: cancelUrl || `${req.headers.get("origin")}/pricing`,
    subscription_data: { metadata: { org_id: orgId, plan_code: planCode } },
    allow_promotion_codes: true,
  });

  return new Response(JSON.stringify({ url: session.url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
