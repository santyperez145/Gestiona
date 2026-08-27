/**
 * daily-whatsapp-digest
 *
 * Sends a daily WhatsApp message to the org owner's WhatsApp number
 * summarizing today's sales KPIs via Evolution API (self-hosted).
 *
 * Called daily at 20:00 UTC by pg_cron (end of business day Argentina time).
 * Only runs for orgs that have:
 *   - a private Evolution API connection configured server-side
 *   - whatsapp_number set in settings (owner's personal number to receive the digest)
 *   - whatsapp_digest_enabled = true in settings (opt-in, defaults to false)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarWhatsApp } from "../_shared/whatsapp.ts";
import { getEvolutionCredentials } from "../_shared/evolutionConnection.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const todayDisplay = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

    // La conexión se resuelve después desde el almacén privado; settings
    // conserva sólo la preferencia y datos de negocio.
    const { data: orgSettings } = await supabase
      .from("settings")
      .select(`
        org_id,
        whatsapp_number,
        business_name,
        whatsapp_digest_enabled,
        exchange_rate
      `)
      .not("whatsapp_number", "is", null)
      .eq("whatsapp_digest_enabled", true);

    if (!orgSettings?.length) {
      return json({ ok: true, sent: 0, reason: "no orgs with digest enabled" });
    }

    let sent = 0;

    for (const s of orgSettings) {
      try {
        const evolution = await getEvolutionCredentials(supabase, s.org_id);
        const ownerNumber = s.whatsapp_number?.replace(/\D/g, "");

        if (!evolution || !ownerNumber) continue;

        // ── Load today's sales ────────────────────────────────
        const { data: sales } = await supabase
          .from("sales")
          .select("total_ars, profit_ars, product_name, customer_name, quantity")
          .eq("org_id", s.org_id)
          .gte("date", `${today}T00:00:00`)
          .lte("date", `${today}T23:59:59`);

        if (!sales?.length) {
          // Even if no sales, send encouraging "no sales today" message
          const text = `📊 *Resumen del día — ${todayDisplay}*\n\n_Sin ventas registradas hoy._\n\nRecordá registrar tus ventas en Gestiona para ver tus métricas aquí. 💪\n\n_— ${s.business_name || "Gestiona"}_`;
          await sendWhatsApp(evolution.apiUrl, evolution.apiKey, evolution.instance, ownerNumber, text);
          sent++;
          continue;
        }

        // ── Compute KPIs ─────────────────────────────────────
        const totalRevenue = sales.reduce((acc, v) => acc + Number(v.total_ars || 0), 0);
        const totalProfit = sales.reduce((acc, v) => acc + Number(v.profit_ars || 0), 0);
        const saleCount = sales.length;
        const avgTicket = saleCount > 0 ? totalRevenue / saleCount : 0;
        const marginPct = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(0) : "0";
        const uniqueCustomers = new Set(sales.map((v) => v.customer_name).filter(Boolean)).size;

        // Top product by quantity
        const productQty: Record<string, number> = {};
        for (const sale of sales) {
          if (sale.product_name) {
            productQty[sale.product_name] = (productQty[sale.product_name] || 0) + Number(sale.quantity || 1);
          }
        }
        const topProduct = Object.entries(productQty).sort((a, b) => b[1] - a[1])[0];

        // ── Format KPIs ───────────────────────────────────────
        const fmtARS = (n: number) =>
          new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

        const profitEmoji = totalProfit > 0 ? "📈" : "📉";
        const marginEmoji = Number(marginPct) >= 30 ? "🟢" : Number(marginPct) >= 15 ? "🟡" : "🔴";

        const text = [
          `📊 *Resumen del día — ${todayDisplay}*`,
          "",
          `💰 *Ventas:* ${fmtARS(totalRevenue)}`,
          `🧾 *Tickets:* ${saleCount}${uniqueCustomers > 0 ? ` (${uniqueCustomers} clientes)` : ""}`,
          `🎫 *Ticket prom:* ${fmtARS(avgTicket)}`,
          `${profitEmoji} *Ganancia:* ${fmtARS(totalProfit)} ${marginEmoji} ${marginPct}%`,
          topProduct ? `🏆 *Top:* ${topProduct[0]} (${topProduct[1]} u.)` : "",
          "",
          `_Powered by ${s.business_name || "Gestiona"}_`,
        ]
          .filter((l) => l !== undefined)
          .join("\n");

        await sendWhatsApp(evolution.apiUrl, evolution.apiKey, evolution.instance, ownerNumber, text.trim());
        sent++;

        // ── Log notification ─────────────────────────────────
        const { data: members } = await supabase
          .from("memberships")
          .select("user_id")
          .eq("org_id", s.org_id)
          .in("role", ["owner", "admin"])
          .limit(1);
        const ownerId = members?.[0]?.user_id;
        if (ownerId) {
          await supabase.from("notifications").insert({
            user_id: ownerId,
            org_id: s.org_id,
            type: "whatsapp_digest",
            title: `Resumen del día enviado`,
            message: `WhatsApp digest enviado: ${fmtARS(totalRevenue)} en ${saleCount} venta${saleCount !== 1 ? "s" : ""}`,
            read: false,
          });
        }
      } catch (orgErr) {
        console.error(`daily-whatsapp-digest org=${s.org_id} error:`, orgErr);
      }
    }

    return json({ ok: true, sent, date: today });
  } catch (err: any) {
    console.error("daily-whatsapp-digest error:", err);
    return json({ error: err.message }, 500);
  }
});

// ── Helpers ─────────────────────────────────────────────────
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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
