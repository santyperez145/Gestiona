/**
 * send-scheduled-campaigns — worker del cron para campañas programadas.
 *
 * Antes repetía aquí la lógica de segmentos y re-invocaba `send-email-campaign`
 * con `functions.invoke`, que no lleva la sesión de usuario que la función
 * exige: el envío programado era un camino muerto — el cron marcaba las
 * campañas en "sending" y luego 401.
 *
 * Ahora es un disparador: encuentra las campañas programadas vencidas y las
 * invoca pasando sólo el id. Contenido, audiencia, consentimiento y baja los
 * resuelve la función autoridad. Falla ruidoso: un error de invocación marca
 * la campaña `failed` y se reporta.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { mensajeDeError } from "../_shared/errorMessage.ts";

import { exigirCron } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  const cors = new Headers({ "Content-Type": "application/json", ...corsHeaders });
  const noEsCron = exigirCron(req, corsHeaders);
  if (noEsCron) return noEsCron;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  try {
    const now = new Date().toISOString();

    // Campañas programadas cuyo momento llegó y siguen borrador.
    const { data: campaigns, error } = await supabase
      .from("email_campaigns")
      .select("id, org_id, scheduled_at")
      .eq("status", "draft")
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", now);

    if (error) {
      // Un fallo de consulta NO es "no hay campañas programadas". Devolver
      // { sent: 0 } con 200 ante un error de RLS o una columna renombrada hacía
      // que el cron informara éxito para siempre mientras nada salía.
      console.error("send-scheduled-campaigns: no se pudieron leer las campañas", error);
      return new Response(JSON.stringify({ error: mensajeDeError(error) }), {
        status: 500, headers: corsHeaders,
      });
    }
    if (!campaigns?.length) {
      return new Response(JSON.stringify({ triggered: 0 }), { headers: corsHeaders });
    }

    let totalTriggered = 0;
    const fallidas: string[] = [];

    for (const campaign of campaigns) {
      // La invocación interna usa el mismo gate de cron (x-cron-secret): la
      // función autoridad acepta al worker y resuelve contenido y audiencia.
      const res = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email-campaign`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": Deno.env.get("BACKUP_CRON_SECRET") ?? "",
          },
          body: JSON.stringify({ campaignId: campaign.id }),
          signal: AbortSignal.timeout(110_000),
        },
      );
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        // Sin esto la campaña quedaba en "sending"/"draft" para siempre: no se
        // reintenta (el cron sólo mira las draft) y no se ve como fallida.
        console.error(`send-scheduled-campaigns: fallo la campaña ${campaign.id}`, res.status, payload);
        await supabase.from("email_campaigns")
          .update({ status: "failed" }).eq("id", campaign.id);
        fallidas.push(`${campaign.id}: ${res.status}`);
        continue;
      }

      // El payload trae { sent, failed, audience } del envío real.
      const sentCount = Number(payload?.sent ?? 0);
      await supabase.from("email_campaigns").update({
        status: sentCount > 0 ? "sent" : "failed",
        sent_count: sentCount,
        failed_count: Number(payload?.failed ?? 0),
        sent_at: new Date().toISOString(),
      }).eq("id", campaign.id);

      totalTriggered++;
    }

    return new Response(JSON.stringify({
      triggered: totalTriggered,
      ...(fallidas.length ? { failed: fallidas } : {}),
    }), { headers: corsHeaders });
  } catch (err) {
    // Sin este catch, un throw salía como {"error":"[object Object]"} — el
    // runtime coacciona el objeto y el mensaje se pierde justo cuando importa.
    console.error("send-scheduled-campaigns fatal:", err);
    return new Response(JSON.stringify({ error: mensajeDeError(err) }), {
      status: 500, headers: corsHeaders,
    });
  }
});