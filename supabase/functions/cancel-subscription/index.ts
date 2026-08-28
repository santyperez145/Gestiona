/**
 * cancel-subscription — dar de baja la suscripción al SaaS.
 *
 * ── Lo que había acá, y por qué no podía funcionar ────────────────────────
 *
 * ⚠️ Esta función era **100% Stripe**, y Stripe nunca se usó para cobrar. Tres
 * cosas la hacían imposible, medidas el 2026-08-27:
 *
 *   1. `requireEnv("STRIPE_SECRET_KEY")` corre al **cargar el módulo** y lanza
 *      si la variable no está. Sin ese secreto la función devuelve 500 en cada
 *      llamada, antes de ejecutar una sola línea del handler.
 *   2. Buscaba la suscripción por `stripe_subscription_id`, que está en **0 de
 *      2** filas. El id real de MercadoPago vive en `mp_preapproval_id`.
 *   3. Y aunque las dos anteriores se resolvieran, **nunca le avisaba a
 *      MercadoPago**: el `preapproval` seguía vivo.
 *
 * O sea: el comercio apretaba «Cancelar suscripción», veía un error, y el
 * cobro seguía saliéndole todos los meses. Es la peor combinación posible —no
 * poder darse de baja de algo que se sigue cobrando— y en Argentina la baja
 * tiene que ser tan fácil como el alta.
 *
 * ── Cómo funciona ahora ───────────────────────────────────────────────────
 *
 * Se cancela el `preapproval` en MercadoPago (deja de cobrar) y se marca
 * `cancel_at_period_end`. 📌 El período ya pagado **se respeta**: el comercio
 * sigue con su plan hasta que termine, y recién ahí el barrido lo pasa a
 * `canceled`. Cortarle el servicio el día que cancela sería quedarse con
 * plata por un servicio que no se prestó.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { tokenDeLaPlataforma } from "../_shared/mpPlataforma.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, " +
    "x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRole) return json({ error: "Configuración no disponible" }, 503);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autenticado" }, 401);

  const sb = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user?.id) return json({ error: "No autenticado" }, 401);

  let orgId: string | undefined;
  try {
    orgId = (await req.json())?.org_id;
  } catch {
    return json({ error: "Cuerpo JSON inválido" }, 400);
  }
  if (!orgId) return json({ error: "Falta la organización" }, 400);

  // ⚠️ Sólo quien manda en el comercio da de baja lo que el comercio paga.
  //
  // 📌 El `_user_id` sale de `auth.getUser()`, que el servidor validó contra la
  // base — nunca del cuerpo del request. `has_org_role` recibe el usuario como
  // argumento, así que pasarle uno del cliente sería dejar que cualquiera diga
  // quién es.
  const { data: puede, error: errPermiso } = await sb.rpc("has_org_role", {
    _org_id: orgId, _user_id: userRes.user.id, _roles: ["owner", "admin"],
  });
  if (errPermiso) {
    console.error("no se pudo verificar el rol", errPermiso);
    return json({ error: "No se pudo verificar tus permisos" }, 503);
  }
  if (!puede) return json({ error: "Sólo el dueño o un administrador puede dar de baja el plan" }, 403);

  const admin = createClient(url, serviceRole);
  const { data: sub } = await admin
    .from("subscriptions")
    .select("id, status, mp_preapproval_id, cancel_at_period_end, current_period_end")
    .eq("org_id", orgId)
    .maybeSingle();

  if (!sub) return json({ error: "Esta organización no tiene una suscripción activa" }, 404);
  if (sub.cancel_at_period_end) {
    return json({ ok: true, ya_estaba: true, hasta: sub.current_period_end });
  }

  // ── 1. Que MercadoPago deje de cobrar ───────────────────────────────────
  //
  // 📌 Va PRIMERO. Si se marcara en la base y después fallara acá, el comercio
  // vería «dado de baja» mientras le siguen debitando — que es exactamente el
  // problema que esta función tenía.
  if (sub.mp_preapproval_id) {
    const token = await tokenDeLaPlataforma();
    if (!token) {
      console.error("cancel-subscription: sin token de plataforma");
      return json({ error: "No pudimos contactar a MercadoPago. Probá de nuevo en unos minutos." }, 503);
    }

    const res = await fetch(`https://api.mercadopago.com/preapproval/${sub.mp_preapproval_id}`, {
      method: "PUT",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      console.error("MercadoPago rechazó la cancelación", res.status, detalle);
      // El mensaje al comercio no repite el cuerpo crudo de MercadoPago: no le
      // dice nada y expone cómo está armado esto por dentro.
      return json({
        error: "MercadoPago no pudo procesar la baja. Escribinos y la resolvemos nosotros.",
        preapproval_id: sub.mp_preapproval_id,
      }, 502);
    }
  }

  /**
   * ── 2. Recién ahora se deja constancia ──────────────────────────────────
   *
   * ⚠️ **«Al final del período» no significa nada si no hubo período.** Hasta
   * el 2026-08-28 la baja escribía `cancel_at_period_end: true` siempre, y una
   * suscripción que se cancela antes del primer cobro quedaba en `past_due`
   * con `current_period_end` NULL — esperando para siempre un cobro que nunca
   * iba a llegar.
   *
   * Verificado en producción con la sesión real: Mi plan mostraba **tres
   * mensajes contradictorios a la vez** — el banner «estamos confirmando tu
   * suscripción», «cancelaste, no se te va a cobrar» y «estamos esperando que
   * MercadoPago confirme tu primer cobro», los tres en la misma pantalla.
   *
   * 📌 El estado real es `canceled`: no hay período que respetar. Cuando sí lo
   * hay, se conserva el comportamiento — el comercio pagó por ese tiempo.
   */
  const cierreInmediato = !sub.current_period_end;

  const { error: errUpdate } = await admin
    .from("subscriptions")
    .update(
      cierreInmediato
        ? { cancel_at_period_end: true, status: "canceled" }
        : { cancel_at_period_end: true },
    )
    .eq("id", sub.id);

  if (errUpdate) {
    // ⚠️ Se mira el error: un rpc/update sin `.error` convierte «no se guardó»
    // en «listo», y acá eso dejaría a MercadoPago cancelado y a la base
    // creyendo que la suscripción sigue viva.
    console.error("no se pudo marcar la baja", errUpdate);
    return json({
      error: "Cancelamos el cobro en MercadoPago pero no pudimos registrarlo. Escribinos para confirmarlo.",
    }, 500);
  }

  return json({
    ok: true,
    hasta: sub.current_period_end,
    mensaje: sub.current_period_end
      ? "Tu plan sigue activo hasta el final del período que ya pagaste."
      : "Tu suscripción quedó dada de baja.",
  });
});
