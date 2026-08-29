// Daily birthday WhatsApp delivery.
//
// This is a proactive marketing notification: it only uses an approved Meta
// template, customers with explicit consent and a durable delivery claim that
// prevents a retry from sending the same birthday twice.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { enviarPlantillaWhatsApp } from "../_shared/whatsapp.ts";
import { exigirCron } from "../_shared/cronAuth.ts";

const jsonHeaders = { "Content-Type": "application/json" };
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

/** Calendar day of the campaign, independent from the Edge region timezone. */
function argentinaDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function markFailed(deliveryId: string, error: string) {
  const { error: updateError } = await supabase
    .from("birthday_whatsapp_deliveries")
    .update({ status: "failed", error: error.slice(0, 1000), updated_at: new Date().toISOString() })
    .eq("id", deliveryId);
  if (updateError) console.error("birthday: no se pudo registrar el fallo", updateError);
}

Deno.serve(async (req) => {
  const noEsCron = exigirCron(req, { "Access-Control-Allow-Origin": "*" });
  if (noEsCron) return noEsCron;

  try {
    // The approved template is platform configuration, not merchant-authored
    // free text. NULL deliberately disables delivery until Meta approves it.
    const { data: channel, error: channelError } = await supabase
      .from("platform_messaging_config")
      .select("whatsapp_proveedor,whatsapp_phone_number_id,whatsapp_birthday_template,whatsapp_birthday_template_language")
      .eq("id", true)
      .maybeSingle();
    if (channelError) throw channelError;

    if (
      channel?.whatsapp_proveedor !== "meta_cloud" ||
      !channel?.whatsapp_phone_number_id ||
      !channel?.whatsapp_birthday_template
    ) {
      return json({
        ok: true,
        sent: 0,
        checked: 0,
        skipped: "platform_template_not_ready",
      });
    }
    if (!Deno.env.get("WHATSAPP_TOKEN")) {
      return json({ error: "Falta WHATSAPP_TOKEN", code: "whatsapp_token_missing" }, 503);
    }

    const runDate = argentinaDate();
    const { data: customers, error: candidatesError } = await supabase.rpc(
      "birthday_whatsapp_candidates",
      { p_run_date: runDate },
    );
    if (candidatesError) throw candidatesError;
    if (!customers?.length) {
      return json({ ok: true, sent: 0, checked: 0, runDate });
    }

    const unsubscribeBaseUrl = `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/whatsapp-unsubscribe`;
    const language = channel.whatsapp_birthday_template_language || "es_AR";
    let sent = 0;
    let failed = 0;
    let duplicate = 0;

    for (const customer of customers) {
      // Claim before the external side effect. If the process dies after Meta
      // accepts the message, the processing row remains and a retry skips it.
      const { data: delivery, error: claimError } = await supabase
        .from("birthday_whatsapp_deliveries")
        .insert({
          org_id: customer.org_id,
          customer_id: customer.customer_id,
          birthday_date: runDate,
          status: "processing",
        })
        .select("id")
        .single();
      if (claimError?.code === "23505") {
        duplicate++;
        continue;
      }
      if (claimError || !delivery) throw claimError || new Error("No se pudo reservar el envío");

      const unsubscribeToken = crypto.randomUUID();
      const { error: tokenError } = await supabase.from("whatsapp_unsubscribe_tokens").insert({
        token: unsubscribeToken,
        org_id: customer.org_id,
        customer_id: customer.customer_id,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      if (tokenError) {
        failed++;
        await markFailed(delivery.id, `unsubscribe_token: ${tokenError.message}`);
        continue;
      }

      const unsubscribeUrl = `${unsubscribeBaseUrl}?token=${unsubscribeToken}`;
      // Approved body contract: {{1}} customer, {{2}} merchant, {{3}} opt-out URL.
      const result = await enviarPlantillaWhatsApp(
        customer.phone,
        channel.whatsapp_birthday_template,
        language,
        [customer.customer_name, customer.business_name, unsubscribeUrl],
      );

      if (!result.ok) {
        failed++;
        const { error: cleanupError } = await supabase
          .from("whatsapp_unsubscribe_tokens")
          .delete()
          .eq("token", unsubscribeToken);
        if (cleanupError) console.error("birthday: no se pudo limpiar el token no enviado", cleanupError);
        await markFailed(delivery.id, result.error || "Meta rechazó el mensaje");
        continue;
      }

      sent++;
      const { error: sentError } = await supabase
        .from("birthday_whatsapp_deliveries")
        .update({
          status: "sent",
          provider_message_id: result.messageId || null,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);
      if (sentError) console.error("birthday: Meta aceptó pero no se pudo cerrar la entrega", sentError);

      const { error: notificationError } = await supabase.from("notifications").insert({
        user_id: null,
        org_id: customer.org_id,
        type: "birthday_wa",
        title: `Cumpleaños: ${customer.customer_name}`,
        message: `WA enviado a ${customer.customer_id}`,
        read: true,
      });
      if (notificationError) console.error("birthday: no se pudo registrar la notificación", notificationError);
    }

    const response = { ok: failed === 0, sent, failed, duplicate, checked: customers.length, runDate };
    return json(response, failed ? 502 : 200);
  } catch (error) {
    console.error("send-birthday-whatsapp error", error);
    return json({ error: error instanceof Error ? error.message : "Error desconocido" }, 500);
  }
});
