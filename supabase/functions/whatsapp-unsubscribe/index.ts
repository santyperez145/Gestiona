/**
 * whatsapp-unsubscribe — baja pública, de un solo uso, para campañas de WhatsApp.
 *
 * El destinatario no tiene por qué tener una cuenta. El token opaco identifica
 * solamente a su registro de cliente y el RPC lo consume atómicamente; nunca se
 * acepta teléfono, email ni un id de cliente que permitirían dar de baja a otro.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function htmlPage(title: string, body: string, success: boolean) {
  const accent = success ? "#166534" : "#991b1b";
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,sans-serif;color:#0f172a">
  <main style="max-width:520px;margin:72px auto;padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;text-align:center">
    <h1 style="margin:0 0 12px;color:${accent};font-size:22px">${title}</h1>
    <p style="margin:0;line-height:1.55;color:#475569">${body}</p>
  </main>
</body></html>`;
}

function responseHtml(title: string, body: string, success: boolean, status = 200) {
  return new Response(htmlPage(title, body, success), {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let token: string | null = null;
  if (req.method === "GET") {
    token = new URL(req.url).searchParams.get("token");
  } else if (req.method === "POST") {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      token = form.get("token") as string | null;
    } else {
      const body = await req.json().catch(() => ({})) as { token?: string };
      token = body.token ?? null;
    }
  } else {
    return responseHtml("Método no permitido", "Usá el enlace de baja que recibiste.", false, 405);
  }

  if (!token) {
    return responseHtml("Enlace incompleto", "El enlace de baja no contiene un token válido.", false, 400);
  }

  // No usa service_role: el único permiso público es ejecutar el RPC con un
  // token opaco. Así esta función no puede leer contactos ni crear bajas libres.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  try {
    const { data, error } = await supabase.rpc("process_whatsapp_unsubscribe", { p_token: token });
    if (error) throw error;

    const result = data as { ok?: boolean; error?: string; already_unsubscribed?: boolean } | null;
    if (result?.ok) {
      const message = result.already_unsubscribed
        ? "Ya no vas a recibir promociones por WhatsApp de este comercio."
        : "Listo: no vas a recibir más promociones por WhatsApp de este comercio.";
      return responseHtml("Baja confirmada", message, true);
    }

    const message = result?.error === "token_expired"
      ? "Este enlace venció. Contactá al comercio y pedí la baja de promociones por WhatsApp."
      : "No pudimos validar este enlace. Es posible que ya se haya usado o que esté incompleto.";
    return responseHtml("No se pudo procesar la baja", message, false, 404);
  } catch (error) {
    console.error("whatsapp-unsubscribe:", error instanceof Error ? error.message : String(error));
    return responseHtml("Error al procesar la baja", "Intentá de nuevo más tarde o contactá al comercio.", false, 500);
  }
});
