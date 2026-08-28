// Edge function: check-overdue-debts
// Runs daily via pg_cron. Finds unpaid debts past their due date,
// creates in-app notifications for org admins AND sends a WhatsApp
// alert via Evolution API if the org has it configured.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarWhatsApp } from "../_shared/whatsapp.ts";
import { getEvolutionCredentials } from "../_shared/evolutionConnection.ts";

import { exigirCron } from "../_shared/cronAuth.ts";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/**
 * ⚠️ Acá había una copia propia del `fetch` a Evolution API — el puente no
 * oficial que enlaza un teléfono escaneando un QR. Había cinco copias iguales
 * en cinco crons: el mismo patrón que dejó nueve remitentes de correo
 * distintos, ninguno funcionando.
 *
 * Ahora delega en `_shared/whatsapp.ts`, que manda por la API oficial de Meta
 * desde el número de la plataforma. Se conserva la firma para no tocar los
 * llamados; los argumentos de Evolution quedaron sin uso.
 */
async function sendWhatsApp(_baseUrl: string, _apiKey: string, _instance: string, number: string, text: string): Promise<boolean> {
  const r = await enviarWhatsApp(number, text);
  // «Sin WhatsApp configurado» no es un error para loguear en cada corrida:
  // es que todavía no se dio de alta el número.
  if (!r.ok && r.configurado) console.error("WhatsApp no salió:", r.error);
  return r.ok;
}

Deno.serve(async (req) => {

  // Sólo el cron de la base: sin el secreto no pasa nadie.
  // ⚠️ Antes ni recibía `req`: no podía mirar quién la llamaba.
  const noEsCron = exigirCron(req, { "Access-Control-Allow-Origin": "*" });
  if (noEsCron) return noEsCron;
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Get all unpaid debts with overdue due_date
    const { data: debts } = await supabase
      .from("debts")
      .select("id, customer_name, remaining_ars, due_date, org_id")
      .eq("status", "pending")
      .not("due_date", "is", null)
      .lt("due_date", today);

    if (!debts?.length) {
      return new Response(JSON.stringify({ ok: true, alerts: 0, wa_sent: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Group by org
    const byOrg: Record<string, typeof debts> = {};
    debts.forEach((d) => {
      if (!byOrg[d.org_id]) byOrg[d.org_id] = [];
      byOrg[d.org_id].push(d);
    });

    let totalAlerts = 0;
    let totalWaSent = 0;

    for (const [orgId, orgDebts] of Object.entries(byOrg)) {
      const totalARS = orgDebts.reduce((s, d) => s + Number(d.remaining_ars), 0);
      const names = orgDebts.slice(0, 3).map((d) => d.customer_name).join(", ");
      const extra = orgDebts.length > 3 ? ` y ${orgDebts.length - 3} más` : "";
      const countLabel = `${orgDebts.length} deuda${orgDebts.length !== 1 ? "s" : ""} vencida${orgDebts.length !== 1 ? "s" : ""}`;

      // ── In-app notifications for admins ──────────────────────────────────
      const { data: members } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("org_id", orgId)
        .in("role", ["owner", "admin"]);

      for (const member of members ?? []) {
        // One notification per org per day
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", member.user_id)
          .eq("type", "deuda_vencida")
          .gte("created_at", `${today}T00:00:00`)
          .limit(1);

        if (existing?.length) continue;

        const { error: errNotificacion } = await supabase
          .from("notifications").insert({
          user_id: member.user_id,
          org_id: orgId,
          type: "deuda_vencida",
          title: countLabel,
          message: `${names}${extra} — Total: $${Math.round(totalARS).toLocaleString("es-AR")}`,
          read: false,
        });
        // Un insert sin mirar `.error` convierte «no se guardó» en «listo»:
        // es lo que escondió durante meses que check-alerts no guardaba nada.
        if (errNotificacion) console.error("check-overdue-debts: no se pudo notificar", errNotificacion);
        totalAlerts++;
      }

      // ── WhatsApp alert via Evolution API ─────────────────────────────────
      const { data: settings } = await supabase
        .from("settings")
        .select("whatsapp_number")
        .eq("org_id", orgId)
        .maybeSingle();

      const evolution = await getEvolutionCredentials(supabase, orgId);
      const waNumber = settings?.whatsapp_number;

      if (evolution && waNumber) {
        // Deduplicate: check if we already sent a WA overdue alert today
        const { data: existingWa } = await supabase
          .from("notifications")
          .select("id")
          .eq("org_id", orgId)
          .eq("type", "deuda_vencida_wa")
          .gte("created_at", `${today}T00:00:00`)
          .limit(1);

        if (!existingWa?.length) {
          const number = waNumber.replace(/\D/g, "");
          const debtLines = orgDebts
            .slice(0, 5)
            .map((d) =>
              `• ${d.customer_name}: $${Math.round(Number(d.remaining_ars)).toLocaleString("es-AR")} (vto: ${d.due_date})`
            )
            .join("\n");
          const moreLine = orgDebts.length > 5 ? `\n_...y ${orgDebts.length - 5} más_` : "";

          const text =
            `⚠️ *Deudas vencidas — ${today}*\n\n` +
            `Tenés *${orgDebts.length}* deuda${orgDebts.length !== 1 ? "s" : ""} vencida${orgDebts.length !== 1 ? "s" : ""} sin cobrar:\n\n` +
            debtLines +
            moreLine +
            `\n\n💰 *Total pendiente: $${Math.round(totalARS).toLocaleString("es-AR")}*\n` +
            `_Revisá la sección de Clientes para gestionar los cobros._`;

          const sent = await sendWhatsApp(evolution.apiUrl, evolution.apiKey, evolution.instance, number, text);
          if (sent) {
            totalWaSent++;
            // Log so we don't double-send today
            await supabase.from("notifications").insert({
              user_id: (members?.[0]?.user_id ?? null) as any,
              org_id: orgId,
              type: "deuda_vencida_wa",
              title: "Alerta WA enviada",
              message: `${countLabel} — $${Math.round(totalARS).toLocaleString("es-AR")}`,
              read: true,
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, alerts: totalAlerts, wa_sent: totalWaSent }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
