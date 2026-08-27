/**
 * mensajeria-probar — manda un correo de prueba y muestra lo que contestó el
 * proveedor, textual.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * El reporte fue «configuré Resend y no veo que funcione». Y era exacto: el
 * sistema manda correo desde diez lugares distintos, todos en crons, y cuando
 * el proveedor rechaza **no lo ve nadie** — el cron termina en verde porque
 * `invoke_edge_function` es asíncrono, y el error queda en un log que hay que ir
 * a buscar.
 *
 * ⚠️ Un canal de salida que falla en silencio es peor que uno que no existe: el
 * dueño cree que sus comercios reciben avisos, campañas y facturas, y no.
 *
 * Esta función hace una cosa: **intenta un envío real y devuelve la respuesta
 * del proveedor sin adornar**. Si Resend dice «el dominio no está verificado»,
 * eso es lo que se lee en pantalla.
 *
 * 📌 Manda a la casilla del propio staff que la ejecuta, no a una escrita a
 * mano: una pantalla que permite mandar correo a cualquier dirección es un
 * relay abierto, y además Resend sin dominio verificado sólo entrega ahí.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { sendEmail } from "../_shared/smtpSender.ts";
import { remitenteDe } from "../_shared/remitente.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, " +
    "x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRole) return json({ error: "Configuración no disponible" }, 503);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autenticado" }, 401);

  const sb = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user?.id) return json({ error: "No autenticado" }, 401);

  // Sólo el staff de plataforma. Se pregunta con el JWT del usuario.
  const { data: esStaff } = await sb.rpc("is_platform_admin", { _user_id: userRes.user.id });
  if (!esStaff) return json({ error: "Sólo el staff de plataforma" }, 403);

  const admin = createClient(url, serviceRole);
  const remitente = await remitenteDe("default");

  if (!remitente.from) {
    return json({
      ok: false,
      etapa: "configuracion",
      // El diagnóstico dice qué falta, no «error».
      detalle: "Todavía no cargaste el dominio desde el que sale el correo.",
    });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) {
    return json({
      ok: false,
      etapa: "configuracion",
      remitente: remitente.from,
      detalle: "Falta la clave de Resend en el entorno de las funciones. Es un secreto: se carga en Supabase, no acá.",
    });
  }

  const destino = userRes.user.email;
  if (!destino) return json({ ok: false, etapa: "configuracion", detalle: "Tu usuario no tiene email." }, 400);

  const r = await sendEmail(remitente.smtp, apiKey, remitente.from, {
    to: destino,
    subject: "Prueba de envío de Gestiona",
    html: `<div style="font-family:system-ui,sans-serif">
      <h2 style="font-size:16px">Llegó.</h2>
      <p>Si estás leyendo esto, el correo de la plataforma sale bien desde
      <strong>${remitente.from}</strong>.</p>
      <p style="color:#666;font-size:13px">Este mensaje lo pediste vos desde la consola de plataforma.</p>
    </div>`,
    text: `Llegó. El correo de la plataforma sale bien desde ${remitente.from}.`,
  }, { tipo: "prueba_de_mensajeria" });

  // ⚠️ Se deja constancia del resultado real: `email_verificado_at` sólo se
  // pone cuando el proveedor aceptó de verdad. Un checkbox de «ya lo configuré»
  // haría que la pantalla diga «listo» y el primer envío real falle — la misma
  // trampa que la verificación de ARCA vino a evitar.
  await admin.rpc("mensajeria_marcar_verificado", { p_canal: "email", p_ok: r.ok });

  if (!r.ok) {
    return json({
      ok: false,
      etapa: "envio",
      remitente: remitente.from,
      // Textual: es la única información que sirve para arreglarlo.
      detalle: r.error ?? "El proveedor rechazó el envío sin dar un motivo.",
    });
  }

  return json({
    ok: true,
    etapa: "envio",
    remitente: remitente.from,
    destino,
    proveedor: r.provider,
    detalle: `Enviado a ${destino}. Si no aparece, mirá spam antes de tocar nada más.`,
  });
});
