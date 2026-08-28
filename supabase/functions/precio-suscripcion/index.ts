/**
 * precio-suscripcion — avisa un cambio de precio y lo aplica el día que rige.
 *
 * Corre por cron, una vez por día. Hace dos cosas, en este orden:
 *
 *   1. **Avisa** a cada comercio con un cambio programado que todavía no le fue
 *      comunicado, con el precio viejo, el nuevo y la fecha exacta.
 *   2. **Aplica** en MercadoPago los cambios cuya fecha ya llegó, actualizando
 *      el `preapproval` de cada suscripción.
 *
 * ── Por qué avisar y aplicar viven juntos ─────────────────────────────────
 *
 * Porque el orden importa y separarlos deja abierta la peor secuencia: cobrar
 * más antes de haber avisado. Acá el aviso corre primero y, si falla, el
 * objetivo queda `pendiente` — no se aplica nada que el comercio no haya
 * podido leer.
 *
 * ⚠️ **El camino de MercadoPago no está verificado contra la API real.** El
 * `PUT /preapproval/{id}` sigue la documentación publicada, pero este proyecto
 * no probó todavía un cambio de monto sobre una suscripción viva, y hay un
 * comportamiento que sólo se puede confirmar cobrando: si al subir el monto MP
 * exige que el pagador vuelva a autorizar. Por eso la respuesta se guarda
 * entera en `mp_respuesta` y existe el estado `requiere_reautorizacion` — para
 * que el día que pase se vea, en vez de quedar como un error genérico.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { remitenteDe } from "../_shared/remitente.ts";
import { tokenDeLaPlataforma } from "../_shared/mpPlataforma.ts";
import { sendEmail } from "../_shared/smtpSender.ts";

import { exigirCron } from "../_shared/cronAuth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, " +
    "x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const pesos = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS",
    minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const fecha = (d: string) =>
  new Date(d + "T12:00:00-03:00").toLocaleDateString("es-AR",
    { day: "2-digit", month: "long", year: "numeric" });


function cuerpoDelAviso(o: {
  comercio: string; anterior: number | null; nuevo: number;
  desde: string; ciclo: string; motivo: string | null; sube: boolean;
}): { subject: string; html: string; text: string } {
  const periodo = o.ciclo === "anual" ? "por año" : "por mes";
  const titulo = o.sube
    ? `Tu suscripción a Gestiona pasa a ${pesos(o.nuevo)} ${periodo}`
    : `Buena noticia: tu suscripción baja a ${pesos(o.nuevo)} ${periodo}`;

  // El precio anterior sólo se nombra si consta. Decir «pasa de X a Y» con una
  // X inventada es peor que no decirlo.
  const desdeTexto = o.anterior != null
    ? `Hoy pagás <strong>${pesos(o.anterior)}</strong> ${periodo}.`
    : `No tenemos registro del monto exacto que venías pagando, así que revisalo en tu resumen de MercadoPago.`;

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#1a1a1a">
      <h2 style="font-size:18px;margin:0 0 16px">${titulo}</h2>
      <p style="line-height:1.6">Hola ${o.comercio},</p>
      <p style="line-height:1.6">${desdeTexto}
      A partir del <strong>${fecha(o.desde)}</strong> el monto pasa a
      <strong>${pesos(o.nuevo)}</strong> ${periodo}.</p>
      ${o.motivo ? `<p style="line-height:1.6;color:#555">${o.motivo}</p>` : ""}
      <p style="line-height:1.6">No tenés que hacer nada: el cambio se aplica solo sobre
      tu suscripción de MercadoPago. Si preferís cambiar de plan o darla de baja,
      podés hacerlo en cualquier momento desde <strong>Mi plan</strong>, y si lo hacés
      antes de esa fecha no se te cobra el monto nuevo.</p>
      <p style="line-height:1.6;color:#555;font-size:13px">Tus datos, ventas y stock no se
      tocan en ningún caso.</p>
    </div>`;

  const text = `${titulo}\n\n${o.anterior != null ? `Hoy pagás ${pesos(o.anterior)} ${periodo}. ` : ""}`
    + `Desde el ${fecha(o.desde)} el monto pasa a ${pesos(o.nuevo)} ${periodo}.`
    + `${o.motivo ? `\n\n${o.motivo}` : ""}`
    + `\n\nPodés cambiar de plan o darte de baja desde Mi plan. Tus datos no se tocan.`;

  return { subject: titulo, html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Sólo el cron de la base: sin el secreto no pasa nadie.
  const noEsCron = exigirCron(req, corsHeaders);
  if (noEsCron) return noEsCron;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) {
    return new Response(JSON.stringify({ error: "Configuración no disponible" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const admin = createClient(url, serviceRole);

  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  // Un solo lugar resuelve remitente y SMTP: pedirlos por separado hacía
  // que el  y el servidor pudieran quedar desalineados.
  const remitente = await remitenteDe("default");
  const resendFrom = remitente.from;

  let avisados = 0, aplicados = 0, reautorizar = 0, fallidos = 0;
  const problemas: string[] = [];

  // ── 1. Avisar lo que todavía no se avisó ────────────────────────────────
  const { data: porAvisar, error: errAvisar } = await admin
    .from("plan_price_change_targets")
    .select("id, org_id, precio_anterior, precio_nuevo, " +
            "plan_price_changes!inner(vigente_desde, ciclo, motivo, estado), " +
            "subscriptions!inner(mp_payer_email), organizations!inner(name)")
    .eq("estado", "pendiente")
    .neq("plan_price_changes.estado", "cancelado");

  if (errAvisar) {
    console.error("no se pudieron leer los avisos pendientes", errAvisar);
    problemas.push("lectura de pendientes: " + errAvisar.message);
  }

  // El select con joins no se puede tipar desde acá: los tipos generados no
  // llegan a Deno. Se declara la forma que este archivo usa, que es poca.
  interface Objetivo {
    id: string;
    precio_anterior: number | null;
    precio_nuevo: number;
    plan_price_changes: { vigente_desde: string; ciclo: string; motivo: string | null };
    subscriptions: { mp_payer_email: string | null } | null;
    organizations: { name: string } | null;
  }

  for (const t of (porAvisar ?? []) as unknown as Objetivo[]) {
    const c = t.plan_price_changes;
    const email = t.subscriptions?.mp_payer_email;
    const comercio = t.organizations?.name ?? "";

    if (!email) {
      // ⚠️ No se marca como notificado: sin destinatario NO hubo aviso, y
      // marcarlo dejaría que el precio suba sin que nadie se haya enterado.
      problemas.push(`sin email para avisar a ${comercio}`);
      fallidos++;
      continue;
    }

    const cuerpo = cuerpoDelAviso({
      comercio,
      anterior: t.precio_anterior,
      nuevo: Number(t.precio_nuevo),
      desde: c.vigente_desde,
      ciclo: c.ciclo,
      motivo: c.motivo,
      sube: Number(t.precio_nuevo) > Number(t.precio_anterior ?? 0),
    });

    const r = await sendEmail(remitente.smtp, resendKey, resendFrom, { to: email, ...cuerpo },
                              { tipo: "cambio_de_precio" });
    if (!r.ok) {
      problemas.push(`no se pudo avisar a ${comercio}: ${r.error ?? "sin detalle"}`);
      fallidos++;
      continue;
    }

    await admin.rpc("registrar_cambio_de_precio", {
      p_target_id: t.id, p_estado: "notificado",
    });
    avisados++;
  }

  // ── 2. Aplicar lo que ya rige ───────────────────────────────────────────
  const { data: aAplicar, error: errAplicar } = await admin
    .rpc("cambios_de_precio_a_aplicar");

  if (errAplicar) {
    console.error("no se pudo leer qué aplicar", errAplicar);
    problemas.push("lectura de aplicables: " + errAplicar.message);
  }

  const token = (aAplicar ?? []).length > 0 ? await tokenDeLaPlataforma() : null;
  if ((aAplicar ?? []).length > 0 && !token) {
    problemas.push("sin token de MercadoPago: no se aplicó ningún cambio");
  }

  for (const c of (token ? (aAplicar ?? []) : [])) {
    // ⚠️ Un objetivo que nunca se notificó NO se aplica. Es el invariante que
    // hace que esto sea un aviso y no un aumento sorpresa.
    const { data: estadoActual } = await admin
      .from("plan_price_change_targets").select("estado").eq("id", c.target_id).maybeSingle();
    if (estadoActual?.estado !== "notificado") {
      problemas.push(`no se aplica ${c.target_id}: todavía no se avisó`);
      continue;
    }

    let respuesta: unknown = null;
    let ok = false;
    let estado = "error";
    let motivo: string | null = null;

    try {
      const res = await fetch(`https://api.mercadopago.com/preapproval/${c.mp_preapproval_id}`, {
        method: "PUT",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          auto_recurring: {
            transaction_amount: Number(c.precio_nuevo),
            currency_id: "ARS",
          },
        }),
      });
      const texto = await res.text();
      try { respuesta = JSON.parse(texto); } catch { respuesta = { raw: texto.slice(0, 2000) }; }

      if (res.ok) {
        ok = true;
        estado = "aplicado";
      } else {
        // deno-lint-ignore no-explicit-any
        const r = respuesta as any;
        motivo = r?.message ?? r?.error ?? `HTTP ${res.status}`;
        // MercadoPago puede pedir que el pagador vuelva a autorizar un monto
        // mayor. Eso NO es un error nuestro y se resuelve distinto: el comercio
        // tiene que aceptar. Se distingue para poder pedírselo.
        estado = res.status === 400 && /authoriz|autoriz|consent/i.test(String(motivo))
          ? "requiere_reautorizacion" : "error";
      }
    } catch (e) {
      motivo = e instanceof Error ? e.message : String(e);
    }

    await admin.rpc("registrar_cambio_de_precio", {
      p_target_id: c.target_id,
      p_estado: estado,
      p_error: motivo,
      p_respuesta: respuesta,
    });

    if (ok) aplicados++;
    else if (estado === "requiere_reautorizacion") { reautorizar++; problemas.push(`${c.org_id}: requiere reautorización`); }
    else { fallidos++; problemas.push(`${c.org_id}: ${motivo}`); }
  }

  return new Response(JSON.stringify({
    ok: true, avisados, aplicados, reautorizar, fallidos, problemas,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
