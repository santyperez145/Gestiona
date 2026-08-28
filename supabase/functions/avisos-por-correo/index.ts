/**
 * avisos-por-correo — manda por mail los avisos marcados para eso.
 *
 * ── Por qué una sola función ──────────────────────────────────────────────
 *
 * Los avisos ya existen en `notifications`. Lo que faltaba era que algunos
 * salieran también por correo: que se termina la prueba, que alguien de afuera
 * pidió ver los datos del negocio, que el plan no alcanza para el equipo. Son
 * hechos que no pueden esperar a que el comercio entre al panel.
 *
 * 📌 Se marca el aviso con un booleano y esta función los manda. La alternativa
 * era una Edge Function por caso, cada una con su remitente y su forma de
 * fallar — que es exactamente cómo terminaron existiendo nueve remitentes
 * distintos y ninguno funcionando.
 *
 * ⚠️ Un envío fallido **no se marca como enviado**. Queda en la cola con el
 * motivo anotado, y se reintenta mientras el aviso siga siendo reciente. Darlo
 * por mandado es cómo un canal empieza a fallar en silencio.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { sendEmail } from "../_shared/smtpSender.ts";
import { remitenteDe } from "../_shared/remitente.ts";

import { exigirCron } from "../_shared/cronAuth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, " +
    "x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Pendiente {
  id: string;
  org_id: string;
  titulo: string;
  mensaje: string;
  email: string;
}

function cuerpo(p: Pendiente): { subject: string; html: string; text: string } {
  return {
    subject: p.titulo,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#1a1a1a">
        <h2 style="font-size:17px;margin:0 0 14px">${p.titulo}</h2>
        <p style="line-height:1.6">${p.mensaje}</p>
        <p style="line-height:1.6;color:#666;font-size:13px;margin-top:22px">
          Te llega este mensaje porque administrás un negocio en Gestiona.
        </p>
      </div>`,
    text: `${p.titulo}\n\n${p.mensaje}`,
  };
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

  const { data, error } = await admin.rpc("avisos_por_correo_pendientes");
  if (error) {
    console.error("no se pudo leer la cola de avisos", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const pendientes = (data ?? []) as unknown as Pendiente[];
  if (pendientes.length === 0) {
    return new Response(JSON.stringify({ ok: true, enviados: 0, fallidos: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const remitente = await remitenteDe("default");
  if (!remitente.from) {
    // ⚠️ No se marca nada: sin remitente no salió ningún mail, y darlos por
    // enviados perdería los avisos para siempre.
    console.error("avisos-por-correo: no hay dominio configurado");
    return new Response(JSON.stringify({
      ok: false, enviados: 0, fallidos: pendientes.length,
      problema: "Falta configurar el dominio del correo en Plataforma → Mensajería.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  let enviados = 0, fallidos = 0;
  const problemas: string[] = [];

  for (const p of pendientes) {
    const r = await sendEmail(remitente.smtp, apiKey, remitente.from,
                              { to: p.email, ...cuerpo(p) }, { tipo: "aviso" });
    await admin.rpc("aviso_correo_registrar", {
      p_id: p.id, p_ok: r.ok, p_error: r.ok ? null : (r.error ?? "sin detalle"),
    });
    if (r.ok) { enviados++; }
    else {
      fallidos++;
      // Un motivo por corrida alcanza: los 200 fallan por lo mismo.
      if (problemas.length === 0) problemas.push(r.error ?? "sin detalle");
    }
  }

  return new Response(JSON.stringify({
    ok: fallidos === 0, enviados, fallidos, remitente: remitente.from, problemas,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
