/**
 * Weekly performance digest — runs every Monday 9 AM UTC.
 * Sends an in-app notification summarizing the previous week's KPIs per org.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { remitenteDe } from "../_shared/remitente.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendEmail, smtpDeOrganizacion } from "../_shared/smtpSender.ts";

import { exigirCronOUsuario } from "../_shared/cronAuth.ts";
serve(async (req) => {

  // Sólo el cron de la base o una persona con sesión real.
  const noEsCron = await exigirCronOUsuario(req, { "Access-Control-Allow-Origin": "*" });
  if (noEsCron) return noEsCron;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setHours(0, 0, 0, 0);
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 7);

  const wStartStr = weekStart.toISOString().slice(0, 10);
  const wEndStr = weekEnd.toISOString().slice(0, 10);

  // Get all active orgs
  const { data: orgs } = await supabase.from("organizations").select("id, name");
  if (!orgs?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { "Content-Type": "application/json" } });

  let sent = 0;

  for (const org of orgs) {
    // Sales for the week
    const { data: sales } = await supabase
      .from("sales")
      .select("total_ars, profit_ars, customer_name")
      .eq("org_id", org.id)
      .gte("date", wStartStr)
      .lt("date", wEndStr);

    if (!sales?.length) continue;

    const totalRevenue = sales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
    const totalProfit = sales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
    const saleCount = sales.length;
    const uniqueCustomers = new Set(sales.map((s: any) => s.customer_name).filter(Boolean)).size;
    const avgTicket = saleCount > 0 ? totalRevenue / saleCount : 0;
    const marginPct = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : "0";

    // Same week last year for comparison
    const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekEnd = new Date(weekEnd); prevWeekEnd.setDate(prevWeekEnd.getDate() - 7);
    const { data: prevSales } = await supabase
      .from("sales")
      .select("total_ars")
      .eq("org_id", org.id)
      .gte("date", prevWeekStart.toISOString().slice(0, 10))
      .lt("date", prevWeekEnd.toISOString().slice(0, 10));

    const prevRevenue = (prevSales || []).reduce((s: number, v: any) => s + Number(v.total_ars), 0);
    const growthPct = prevRevenue > 0 ? (((totalRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1) : null;

    // Get admin/owner members to notify
    const { data: members } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("org_id", org.id)
      .in("role", ["owner", "admin"]);

    const growthLine = growthPct
      ? ` (${Number(growthPct) >= 0 ? "+" : ""}${growthPct}% vs semana anterior)`
      : "";

    const title = `📊 Resumen semanal — ${wStartStr} al ${wEndStr}`;
    const message = [
      `💰 Ingresos: $${Math.round(totalRevenue).toLocaleString("es-AR")}${growthLine}`,
      `📈 Ganancia: $${Math.round(totalProfit).toLocaleString("es-AR")} (${marginPct}%)`,
      `🛍️ Ventas: ${saleCount} · Ticket prom: $${Math.round(avgTicket).toLocaleString("es-AR")}`,
      `👥 Clientes únicos: ${uniqueCustomers}`,
    ].join("\n");

    // Deduplication: check if we already sent this week's digest
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("org_id", org.id)
      .eq("type", "weekly_digest")
      .gte("created_at", weekEnd.toISOString())
      .maybeSingle();

    if (existing) continue;

    for (const mb of members || []) {
      const { error: errNotificacion } = await supabase
        .from("notifications").insert({
        user_id: mb.user_id,
        org_id: org.id,
        type: "weekly_digest",
        title,
        message,
        read: false,
      });
      // Un insert sin mirar `.error` convierte «no se guardó» en «listo»:
      // es lo que escondió durante meses que check-alerts no guardaba nada.
      if (errNotificacion) console.error("weekly-performance-digest: no se pudo notificar", errNotificacion);

      // Send digest email using own SMTP or Resend fallback
      const { data: profile } = await supabase.auth.admin.getUserById(mb.user_id);
      const email = profile?.user?.email;
      if (email) {
        const smtpCfg = await smtpDeOrganizacion(org.id);
        const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";

        if (smtpCfg || resendKey) {
          const growthLine = growthPct
            ? `<span style="color:${Number(growthPct) >= 0 ? '#22c55e' : '#ef4444'}">${Number(growthPct) >= 0 ? "▲" : "▼"} ${Math.abs(Number(growthPct))}%</span>`
            : "";
          const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a14;color:#fff;font-family:system-ui,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:32px 24px">
  <div style="background:#D4A84320;border:1px solid #D4A84340;border-radius:16px;padding:24px;margin-bottom:20px">
    <h1 style="margin:0 0 4px;font-size:18px;font-weight:900;color:#D4A843">📊 Resumen semanal</h1>
    <p style="margin:0;font-size:12px;color:#ffffff60">${org.name} · ${wStartStr} al ${wEndStr}</p>
  </div>
  <table style="width:100%;border-collapse:separate;border-spacing:0 8px">
    <tr><td style="background:#ffffff08;border-radius:10px;padding:14px 16px">
      <p style="margin:0;font-size:11px;color:#ffffff50;text-transform:uppercase;letter-spacing:.05em">Facturación</p>
      <p style="margin:4px 0 0;font-size:22px;font-weight:900;color:#D4A843">$${Math.round(totalRevenue).toLocaleString("es-AR")} ${growthLine}</p>
    </td></tr>
    <tr><td style="background:#ffffff08;border-radius:10px;padding:14px 16px">
      <p style="margin:0;font-size:11px;color:#ffffff50;text-transform:uppercase;letter-spacing:.05em">Ganancia bruta</p>
      <p style="margin:4px 0 0;font-size:22px;font-weight:900;color:#22c55e">$${Math.round(totalProfit).toLocaleString("es-AR")} <span style="font-size:14px;color:#ffffff50">(${marginPct}%)</span></p>
    </td></tr>
    <tr><td style="background:#ffffff08;border-radius:10px;padding:14px 16px">
      <p style="margin:0;font-size:11px;color:#ffffff50;text-transform:uppercase;letter-spacing:.05em">Ventas</p>
      <p style="margin:4px 0 0;font-size:16px;font-weight:700">${saleCount} ventas · Ticket $${Math.round(avgTicket).toLocaleString("es-AR")} · ${uniqueCustomers} clientes</p>
    </td></tr>
  </table>
  <a href="https://nerqia.app" style="display:block;margin-top:24px;text-align:center;padding:14px;border-radius:12px;background:#D4A843;color:#000;font-weight:700;font-size:14px;text-decoration:none">Ver dashboard →</a>
  <p style="margin-top:20px;text-align:center;font-size:10px;color:#ffffff30">Nerqia — sistema de gestión para pymes argentinas</p>
</div></body></html>`;

          await sendEmail(
            smtpCfg,
            resendKey,
            (await remitenteDe("digest")).from,
            { to: email, subject: `📊 ${org.name} — Resumen ${wStartStr} al ${wEndStr}`, html },
          );
        }
      }
    }

    sent++;
  }

  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
