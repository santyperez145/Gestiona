import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date().toISOString();

  // Find scheduled campaigns whose send time has passed and are still draft
  const { data: campaigns, error } = await supabase
    .from("email_campaigns")
    .select("id, org_id, subject, body_html, segment")
    .eq("status", "draft")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", now);

  if (error || !campaigns?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { headers: { "Content-Type": "application/json" } });
  }

  let totalTriggered = 0;

  for (const campaign of campaigns) {
    // Mark as sending
    await supabase.from("email_campaigns").update({ status: "sending" }).eq("id", campaign.id);

    // Get recipients by segment
    const { data: customers } = await supabase
      .from("customers")
      .select("id, name, email")
      .eq("org_id", campaign.org_id)
      .not("email", "is", null);

    const now30 = new Date(); now30.setDate(now30.getDate() - 30);
    const now60 = new Date(); now60.setDate(now60.getDate() - 60);
    const now90 = new Date(); now90.setDate(now90.getDate() - 90);

    // Get last purchase dates per customer
    const { data: sales } = await supabase
      .from("sales")
      .select("customer_name, date")
      .eq("org_id", campaign.org_id)
      .gte("date", new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));

    const lastPurchase: Record<string, Date> = {};
    for (const s of sales || []) {
      if (s.customer_name) {
        const d = new Date(s.date);
        if (!lastPurchase[s.customer_name] || d > lastPurchase[s.customer_name]) {
          lastPurchase[s.customer_name] = d;
        }
      }
    }

    const recipients = (customers || []).filter((c: any) => {
      if (!c.email) return false;
      if (campaign.segment === "all") return true;
      const last = lastPurchase[c.name];
      if (!last) return campaign.segment === "dormant";
      const daysSince = (Date.now() - last.getTime()) / 86400000;
      if (campaign.segment === "at_risk") return daysSince >= 30 && daysSince < 60;
      if (campaign.segment === "dormant") return daysSince >= 60 && daysSince < 90;
      return false;
    });

    if (!recipients.length) {
      await supabase.from("email_campaigns").update({ status: "sent", sent_count: 0, sent_at: now }).eq("id", campaign.id);
      continue;
    }

    // Invoke the main send function
    await supabase.functions.invoke("send-email-campaign", {
      body: {
        campaignId: campaign.id,
        subject: campaign.subject,
        bodyHtml: campaign.body_html,
        recipients: recipients.map((r: any) => ({ email: r.email, name: r.name })),
        orgName: "Gestiona",
      },
    });

    totalTriggered++;
  }

  return new Response(JSON.stringify({ triggered: totalTriggered }), {
    headers: { "Content-Type": "application/json" },
  });
});
