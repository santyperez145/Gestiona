/**
 * campaign-chat-dispatcher — despacha la cola de notificaciones del chat
 * marca↔creador (`influencer_chat_notifications`).
 *
 * ── Por qué una función propia ────────────────────────────────────────────
 *
 * La cola ya decide QUÉ enviar: `campaign_chat_notifications_pending()`
 * (service_role) devuelve una fila por notificación con su destino real —
 * correo conocido para email, suscripción web push registrada para push —
 * y sin consentimiento no hay fila (el trigger valida la preferencia del
 * destinatario al encolar). Esta función sólo ejecuta el envío y marca el
 * resultado; un fallo vuelve a la cola con el motivo anotado y se reintenta
 * hasta 3 intentos vía `campaign_chat_notifications_retry()`.
 *
 * 📌 El correo sale por el mismo transporte que el resto de la plataforma
 * (`remitenteDe` + `sendEmail`): ningún remitente nuevo, ningún proveedor
 * nuevo. Push usa las claves VAPID ya existentes de `send-push`.
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

/** Lo que `campaign_chat_notifications_pending()` devuelve por fila. */
interface Pendiente {
  id: string;
  message_id: string;
  user_id: string;
  channel: "email" | "push";
  body: string;
  author_role: string;
  campaign_title: string;
  org_name: string;
  email: string | null;
  endpoint: string | null;
  p256dh: string | null;
  auth_key: string | null;
}

function cuerpoEmail(p: Pendiente): { subject: string; html: string; text: string } {
  const de = p.author_role === "brand" ? "la marca" : "el creador";
  const subject = `Nuevo mensaje en "${p.campaign_title}" — ${p.org_name}`;
  return {
    subject,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#1a1a1a">
        <h2 style="font-size:17px;margin:0 0 14px">${subject}</h2>
        <p style="line-height:1.6">${de} escribió:</p>
        <blockquote style="border-left:3px solid #ddd;margin:12px 0;padding:4px 12px;color:#444">${p.body}</blockquote>
        <p style="line-height:1.6;color:#666;font-size:13px;margin-top:22px">
          Te llega este aviso porque activaste las notificaciones de mensajes
          en Nerqia. Podés apagarlas cuando quieras desde el chat de la colaboración.
        </p>
      </div>`,
    text: `${subject}\n\n${de} escribió:\n${p.body}`,
  };
}

// ── Web Push (mismo protocolo que send-push) ────────────────────────────────
async function buildVapidJwt(audience: string): Promise<string> {
  const privateKeyB64 = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@nerqia.app";
  const header = { alg: "ES256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 3600, sub: subject };
  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const toSign = `${encode(header)}.${encode(payload)}`;
  const keyBytes = Uint8Array.from(atob(privateKeyB64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(toSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${toSign}.${sigB64}`;
}

async function sendPush(
  sub: { endpoint: string; p256dh: string; auth_key: string },
  payload: string,
  vapidPublicKey: string,
): Promise<{ ok: boolean; expired?: boolean }> {
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
      "TTL": "86400",
      "Authorization": `vapid t=${await buildVapidJwt(new URL(sub.endpoint).origin)},k=${vapidPublicKey}`,
      "Urgency": "normal",
    },
    body: payload,
  });
  if (res.status === 404 || res.status === 410) return { ok: false, expired: true };
  return { ok: res.ok };
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

  const { data, error } = await admin.rpc("campaign_chat_notifications_pending");
  if (error) {
    console.error("no se pudo leer la cola del chat", error);
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

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  let enviados = 0, fallidos = 0;
  const problemas: string[] = [];

  for (const p of pendientes) {
    let r: { ok: boolean; error?: string; expired?: boolean } = { ok: false, error: "canal desconocido" };
    if (p.channel === "email") {
      const remitente = await remitenteDe("default");
      if (!remitente.from) {
        // Sin remitente no se marca nada: darlo por enviado lo perdería.
        r = { ok: false, error: "Falta configurar el dominio del correo en Plataforma → Mensajería." };
      } else {
        const cuerpo = cuerpoEmail(p);
        const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
        const smtpRes = await sendEmail(remitente.smtp, apiKey, remitente.from, {
          to: p.email!,
          subject: cuerpo.subject,
          html: cuerpo.html,
          text: cuerpo.text,
        }, { tipo: "aviso" });
        r = { ok: smtpRes.ok, error: smtpRes.ok ? undefined : (smtpRes.error ?? "sin detalle") };
      }
    } else if (p.channel === "push") {
      if (!p.endpoint || !p.p256dh || !p.auth_key) {
        r = { ok: false, error: "sin suscripción web push" };
      } else if (!vapidPublicKey || !Deno.env.get("VAPID_PRIVATE_KEY")) {
        r = { ok: false, error: "VAPID no configurado en la plataforma" };
      } else {
        const res = await sendPush({ endpoint: p.endpoint, p256dh: p.p256dh, auth_key: p.auth_key },
          JSON.stringify({ title: `Nuevo mensaje — ${p.campaign_title}`, body: p.body, url: "/creator-portal", tag: "nerqia-chat" }),
          vapidPublicKey);
        r = { ok: res.ok, error: res.ok ? undefined : (res.expired ? "suscripción expirada" : "push respondió sin éxito") };
      }
    }

    await admin.rpc("campaign_chat_notification_result", { p_id: p.id, p_ok: r.ok, p_error: r.error ?? null });
    if (r.ok) enviados++;
    else {
      fallidos++;
      if (problemas.length === 0) problemas.push(r.error ?? "sin detalle");
    }
  }

  // Los fallidos con intentos < 3 vuelven a la cola en la próxima corrida.
  await admin.rpc("campaign_chat_notifications_retry");

  return new Response(JSON.stringify({ ok: fallidos === 0, enviados, fallidos, problemas }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});