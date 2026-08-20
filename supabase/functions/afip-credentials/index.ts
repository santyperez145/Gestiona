/**
 * afip-credentials — carga del certificado de AFIP.
 *
 * El certificado y su clave privada entran por acá y sólo por acá. Van a
 * `afip_credentials`, tabla con RLS y **cero policies**: no hay forma de
 * leerlos desde el navegador, ni siquiera siendo dueño de la organización.
 * La UI ve `afip_connection_status`, que dice si están cargados y cuándo vence
 * el ticket, nunca el contenido.
 *
 * Antes vivían en `settings`, que tiene una policy SELECT para todos los
 * miembros. RLS es a nivel de fila, no de columna: cualquier empleado con
 * acceso a la app podía leer la clave con la que se firman las facturas
 * fiscales del contribuyente.
 *
 * Por qué esto no es un OAuth: AFIP no lo ofrece. Su autenticación (WSAA) se
 * basa en firmar un ticket con un certificado X.509 que el contribuyente saca
 * de su Clave Fiscal. No hay pantalla de consentimiento que devuelva un token.
 * Lo más parecido es delegar el servicio WSFE al CUIT de la plataforma desde
 * "Administrador de Relaciones" — ahí el comercio no sube ninguna clave y esta
 * tabla guarda el certificado de la plataforma en vez del suyo.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";
import { requireEnv } from "../_shared/env.ts";
// Compartida con `afip-platform-cert`: una sola regla de PEM para los dos
// caminos que reciben certificados.
import { esPem, ERROR_CERT, ERROR_CLAVE } from "../_shared/pem.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Usuario real: `verify_jwt` no alcanza, la anon key es un JWT válido
    // y viaja en el bundle.
    const { user, response } = await requireUser(req, corsHeaders);
    if (response) return response;

    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { action, certificate, privateKey, org_id: orgId } = await req.json().catch(() => ({}));

    if (typeof orgId !== "string") {
      return json({ error: "Falta la organización a configurar" }, 400);
    }

    // Sólo dueño o administrador de LA organización elegida. Elegir la primera
    // membresía del usuario guardaría datos fiscales en otro comercio cuando
    // un mismo dueño administra más de uno.
    const { data: membership } = await admin
      .from("memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("org_id", orgId)
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (!membership) {
      return json({ error: "Sólo el dueño o un administrador pueden cargar el certificado" }, 403);
    }

    if (action === "delete") {
      await admin.from("afip_credentials")
        .update({
          certificate: null, private_key: null,
          // Sin certificado propio el único camino posible es el delegado.
          // Dejarlo en 'propio' lo dejaría sin poder facturar y con el panel
          // diciendo "no configurado", que manda a revisar lo único que no
          // está fallando.
          modo: "delegado",
          ta_token: null, ta_sign: null, ta_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", orgId);
      return json({ ok: true, removed: true });
    }

    // ── Carga ────────────────────────────────────────────────────────────
    if (typeof certificate !== "string" || !esPem(certificate, "CERTIFICATE")) {
      return json({ error: ERROR_CERT }, 400);
    }
    if (typeof privateKey !== "string" || !esPem(privateKey, "PRIVATE KEY")) {
      return json({ error: ERROR_CLAVE }, 400);
    }

    const { error } = await admin
      .from("afip_credentials")
      .upsert({
        org_id: orgId,
        certificate: certificate.trim(),
        private_key: privateKey.trim(),
        // C14: subir un certificado propio ES elegir el modo propio. Sin esta
        // línea el comercio seguiría facturando con el de la plataforma,
        // teniendo el suyo cargado y sin ninguna señal de que no se usa.
        modo: "propio",
        // Cambiar el certificado invalida el ticket anterior: se firmó con el
        // que ya no está.
        ta_token: null,
        ta_sign: null,
        ta_expires_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "org_id" });

    if (error) {
      console.error("afip-credentials upsert:", error.message);
      return json({ error: "No se pudo guardar el certificado" }, 500);
    }

    // Nunca se devuelve lo que se guardó.
    return json({ ok: true, configured: true });
  } catch (e) {
    console.error("afip-credentials:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
