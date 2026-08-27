// Alta de la suscripción al SaaS con MercadoPago.
//
// ── Quién cobra, que es lo que más se confunde ─────────────────────────────
//
// Esta función usa el token de **la plataforma**, no el del comercio. Son dos
// relaciones distintas:
//
//   comprador → comercio    el checkout de la tienda, con `marketplace_fee`
//   comercio  → Gestiona    esto
//
// Usar el token del comercio para cobrarle al comercio no tiene sentido y
// además MercadoPago lo rechazaría. Por eso `MP_PLATFORM_ACCESS_TOKEN` es un
// secreto propio y no sale de `payment_connections`.
//
// ── Por qué preapproval y no un pago suelto ───────────────────────────────
//
// Un pago suelto habría que cobrarlo a mano cada mes y perseguir al que no
// paga. Con `preapproval` el comercio autoriza una vez y MercadoPago cobra
// solo, avisando por webhook. Nosotros **nunca vemos la tarjeta** — es la misma
// razón por la que el checkout de la tienda usa el Brick.
//
// ── Lo que esta función NO hace ───────────────────────────────────────────
//
// No marca la suscripción como activa. Eso lo hace el webhook cuando
// MercadoPago confirma que cobró. Activarla acá le daría acceso a alguien que
// abrió el link de pago y no lo completó.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getAuthedUser } from "../_shared/requireUser.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });


/**
 * El token con el que la plataforma cobra sus suscripciones.
 *
 * ── Por qué hay dos caminos ───────────────────────────────────────────────
 *
 * ⚠️ `MP_APP_ID` **no es** un token: es el identificador público de la
 * aplicación y no autentica ninguna llamada. Pero no hace falta cargar un
 * secreto nuevo: con `MP_APP_ID` + `MP_APP_SECRET` —los que ya usa `mp-connect`
 * para el OAuth de los comercios— MercadoPago entrega un token de aplicación
 * por `client_credentials`, y ese token actúa sobre la cuenta **dueña de la
 * aplicación**, que es justo la de la plataforma.
 *
 * `MP_PLATFORM_ACCESS_TOKEN` sigue teniendo prioridad si está cargado: un
 * token puesto a mano es una decisión explícita y no se pisa.
 *
 * 📌 El token derivado **no se cachea acá**. Vence, y guardarlo en memoria de
 * una Edge Function que se recicla sola es la clase de estado que después nadie
 * puede explicar. Pedirlo cuesta una llamada por suscripción contratada, que es
 * una operación que pasa pocas veces por día.
 */
async function tokenDeLaPlataforma(): Promise<string | null> {
  const directo = Deno.env.get("MP_PLATFORM_ACCESS_TOKEN");
  if (directo) return directo;

  const clientId = Deno.env.get("MP_APP_ID");
  const clientSecret = Deno.env.get("MP_APP_SECRET");
  if (!clientId || !clientSecret) return null;

  try {
    const resp = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.access_token) {
      // El motivo va al log, no a la pantalla: acá hay credenciales de por
      // medio y el comercio no puede hacer nada con el detalle.
      console.error("mp-subscribe: client_credentials falló", resp.status, data?.message ?? data?.error);
      return null;
    }
    return String(data.access_token);
  } catch (e) {
    console.error("mp-subscribe: no se pudo pedir el token de aplicación", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Contratar una suscripción cuesta plata: hace falta un usuario real, no la
  // clave anónima que viaja en el bundle.
  const user = await getAuthedUser(req);
  if (!user) return json({ error: "Necesitás iniciar sesión" }, 401);

  const token = await tokenDeLaPlataforma();
  if (!token) {
    // Se dice qué falta en vez de fallar con un 500 opaco: este es el modo de
    // falla que tuvo los 13 crons caídos durante meses por un secreto ausente.
    console.error("mp-subscribe: no hay token de plataforma (ni MP_PLATFORM_ACCESS_TOKEN ni MP_APP_ID+MP_APP_SECRET)");
    return json({ error: "El cobro de suscripciones no está configurado todavía" }, 503);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  let body: { org_id?: string; plan_code?: string; ciclo?: string; back_url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo inválido" }, 400);
  }

  const orgId = String(body.org_id ?? "");
  const planCode = String(body.plan_code ?? "");
  const ciclo = body.ciclo === "anual" ? "anual" : "mensual";

  if (!orgId || !planCode) return json({ error: "Falta la organización o el plan" }, 400);

  // ⚠️ La membresía se verifica en el servidor. Si se confiara en el `org_id`
  // que manda el navegador, cualquiera podría contratarle un plan a otro
  // comercio — y peor, atarle un cobro recurrente.
  const { data: miembro } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!miembro || !["owner", "admin"].includes(String(miembro.role))) {
    return json({ error: "No tenés permiso para contratar un plan en esta organización" }, 403);
  }

  const { data: plan, error: planErr } = await admin
    .from("plans")
    .select("id, code, name, price_ars_monthly, price_ars_yearly")
    .eq("code", planCode)
    .maybeSingle();

  if (planErr || !plan) return json({ error: "El plan no existe" }, 404);

  const monto = ciclo === "anual" ? Number(plan.price_ars_yearly) : Number(plan.price_ars_monthly);

  // Un plan sin precio en pesos no se puede cobrar por MercadoPago. Se dice, en
  // vez de cobrar un número convertido de dólares que nadie decidió.
  if (!Number.isFinite(monto) || monto <= 0) {
    return json({ error: "Ese plan todavía no tiene precio en pesos configurado" }, 409);
  }

  const { data: org } = await admin
    .from("organizations").select("name").eq("id", orgId).maybeSingle();

  const backUrl = String(body.back_url ?? "").startsWith("http")
    ? String(body.back_url)
    : `${url.replace(".supabase.co", "")}/suscripcion`;

  // `external_reference` es lo que ata la suscripción de MercadoPago con la
  // nuestra cuando llega el webhook.
  const referencia = `org:${orgId}:${plan.code}:${ciclo}`;

  const preapproval = {
    reason: `Gestiona ${plan.name} — ${ciclo}`,
    external_reference: referencia,
    payer_email: user.email,
    back_url: backUrl,
    auto_recurring: {
      frequency: ciclo === "anual" ? 12 : 1,
      frequency_type: "months",
      transaction_amount: monto,
      currency_id: "ARS",
    },
    status: "pending",
  };

  let mpRes: Response;
  try {
    mpRes = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Idempotencia del lado de MercadoPago: si el navegador reintenta, no
        // se crean dos suscripciones. Es la misma disciplina que H1 adentro.
        "X-Idempotency-Key": `${orgId}-${plan.code}-${ciclo}`,
      },
      body: JSON.stringify(preapproval),
    });
  } catch (e) {
    // Los sistemas externos fallan (principio 7). Se dice qué pasó en vez de
    // dejar al comercio mirando un spinner.
    console.error("mp-subscribe: no se pudo hablar con MercadoPago", e);
    return json({ error: "No pudimos contactar a MercadoPago. Probá de nuevo en un momento." }, 502);
  }

  const mp = await mpRes.json().catch(() => ({}));

  if (!mpRes.ok || !mp?.id) {
    console.error("mp-subscribe: MercadoPago rechazó el alta", mpRes.status, mp);
    return json({
      error: mp?.message ?? "MercadoPago rechazó la suscripción",
      detalle: mp?.cause ?? null,
    }, 502);
  }

  // Se guarda la suscripción en estado NO activo. La activa el webhook cuando
  // MercadoPago confirme el primer cobro: activarla acá le daría acceso a
  // alguien que abrió el link y nunca lo pagó.
  const { error: subErr } = await admin.from("subscriptions").upsert({
    org_id: orgId,
    plan_id: plan.id,
    status: "past_due",
    provider: "mercadopago",
    ciclo,
    mp_preapproval_id: String(mp.id),
    mp_payer_email: user.email,
  }, { onConflict: "mp_preapproval_id" });

  if (subErr) {
    console.error("mp-subscribe: no se pudo guardar la suscripción", subErr);
    return json({ error: "La suscripción se creó en MercadoPago pero no se pudo guardar. Escribinos." }, 500);
  }

  return json({
    ok: true,
    preapproval_id: mp.id,
    // Adonde hay que mandar al comercio para que autorice el débito.
    init_point: mp.init_point ?? mp.sandbox_init_point ?? null,
    monto,
    ciclo,
    plan: plan.name,
  });
});
