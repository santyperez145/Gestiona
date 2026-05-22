// Edge function: send-birthday-whatsapp
// Runs daily via pg_cron (08:00 UTC). Finds customers with birthday today,
// sends a personalized WhatsApp greeting via Evolution API if configured.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function sendWhatsApp(
  baseUrl: string,
  apiKey: string,
  instance: string,
  number: string,
  text: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/message/sendText/${instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number, text }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch (e) {
    console.error("Evolution API error:", e);
    return false;
  }
}

Deno.serve(async () => {
  try {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    // Match customers whose birthday month+day equals today (any year)
    const pattern = `%-${mm}-${dd}`;

    // Fetch all customers with birthday today across all orgs
    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("id, name, phone, org_id")
      .not("phone", "is", null)
      .like("birthday", pattern);

    if (custErr) throw custErr;
    if (!customers?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, message: "No birthdays today" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Group by org
    const byOrg: Record<string, typeof customers> = {};
    for (const c of customers) {
      if (!byOrg[c.org_id]) byOrg[c.org_id] = [];
      byOrg[c.org_id].push(c);
    }

    let totalSent = 0;
    const todayStr = today.toISOString().slice(0, 10);

    for (const [orgId, orgCustomers] of Object.entries(byOrg)) {
      // Load org's Evolution API settings + business name
      const { data: settings } = await supabase
        .from("settings")
        .select("evolution_api_url, evolution_api_key, evolution_instance, business_name, whatsapp_birthday_enabled")
        .eq("org_id", orgId)
        .maybeSingle();

      const baseUrl = settings?.evolution_api_url?.replace(/\/$/, "");
      const apiKey  = settings?.evolution_api_key;
      const instance = settings?.evolution_instance;
      const businessName = settings?.business_name || "el equipo";

      // Skip org if Evolution API not configured or birthday WA not enabled
      if (!baseUrl || !apiKey || !instance) continue;
      if (settings?.whatsapp_birthday_enabled === false) continue;

      for (const customer of orgCustomers) {
        if (!customer.phone) continue;

        // Dedup: check if we already sent a birthday WA to this customer today
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("org_id", orgId)
          .eq("type", "birthday_wa")
          .like("message", `%${customer.id}%`)
          .gte("created_at", `${todayStr}T00:00:00`)
          .limit(1);

        if (existing?.length) continue;

        const number = customer.phone.replace(/\D/g, "");
        const text =
          `🎂 *¡Feliz cumpleaños, ${customer.name}!*\n\n` +
          `En nombre de todo el equipo de *${businessName}* te deseamos un día increíble lleno de alegría y éxito. 🎉\n\n` +
          `¡Esperamos verte pronto!`;

        const sent = await sendWhatsApp(baseUrl, apiKey, instance, number, text);
        if (sent) {
          totalSent++;
          // Log to avoid duplicate sends
          await supabase.from("notifications").insert({
            user_id: null as any,
            org_id: orgId,
            type: "birthday_wa",
            title: `🎂 Cumpleaños: ${customer.name}`,
            message: `WA enviado a ${customer.id} — ${customer.name}`,
            read: true,
          });
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent: totalSent, checked: customers.length }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
