/**
 * afip-platform-cert — el certificado de AFIP de la plataforma (C14).
 *
 * Es el gemelo de `afip-credentials`, pero de la **otra superficie**: acá no
 * hay `org_id` y no se acepta ninguno. Quien puede tocar esto es staff de
 * plataforma, y ser staff de plataforma no da permisos dentro de ninguna
 * organización — por eso son dos funciones y no dos ramas de la misma.
 *
 * ⚠️ **Este es el secreto más valioso del sistema.** La clave privada de acá
 * adentro es el permiso para emitir comprobantes fiscales en nombre de todos
 * los comercios que delegaron `wsfe`. Vive en `afip_platform_credentials`, con
 * RLS habilitada y **cero policies**: no se lee desde el navegador, ni siendo
 * superadmin. La UI mira `afip_platform_status`, que dice si está cargado y
 * cuándo vence el ticket, nunca el contenido.
 *
 * Por qué no hay OAuth: AFIP no lo ofrece. WSAA se autentica firmando con un
 * certificado X.509 que se saca de la Clave Fiscal. Lo más parecido al modelo
 * marketplace es exactamente esto — un certificado de la plataforma, y cada
 * comercio delegándole el servicio desde "Administrador de Relaciones".
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";
import { requireEnv } from "../_shared/env.ts";
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
    // Usuario real: `verify_jwt` no alcanza, la anon key es un JWT válido y
    // viaja en el bundle de la app.
    const { user, response } = await requireUser(req, corsHeaders);
    if (response) return response;

    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

    // ⚠️ La autorización se pregunta a la base, no al cliente. Es la misma
    // función que usan las políticas de RLS de plataforma.
    const { data: esAdmin, error: errAdmin } = await admin
      .rpc("is_platform_admin", { _user_id: user.id });
    if (errAdmin) {
      console.error("afip-platform-cert is_platform_admin:", errAdmin.message);
      return json({ error: "No se pudo verificar el permiso" }, 500);
    }
    if (!esAdmin) return json({ error: "Solo el staff de plataforma puede tocar este certificado" }, 403);

    const body = await req.json().catch(() => ({}));
    const { action, certificate, privateKey, cuit, razonSocial, environment } = body;

    if (action === "delete") {
      // No se borra la fila: se vacían el certificado y la clave. Así el CUIT
      // y el ambiente quedan cargados, y `afip_platform_status` puede seguir
      // diciendo "hay identidad, falta el certificado" en vez de "no hay nada".
      const { error } = await admin
        .from("afip_platform_credentials")
        .update({
          certificate: null, private_key: null,
          ta_token: null, ta_sign: null, ta_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) return json({ error: "No se pudo borrar el certificado" }, 500);
      return json({ ok: true, removed: true });
    }

    const cuitLimpio = String(cuit ?? "").replace(/[^0-9]/g, "");
    if (cuitLimpio.length !== 11) {
      return json({ error: "El CUIT de la plataforma debe tener 11 dígitos" }, 400);
    }
    if (environment !== "homologacion" && environment !== "produccion") {
      return json({ error: "El ambiente debe ser homologacion o produccion" }, 400);
    }
    if (typeof certificate !== "string" || !esPem(certificate, "CERTIFICATE")) {
      return json({ error: ERROR_CERT }, 400);
    }
    if (typeof privateKey !== "string" || !esPem(privateKey, "PRIVATE KEY")) {
      return json({ error: ERROR_CLAVE }, 400);
    }

    const { error } = await admin
      .from("afip_platform_credentials")
      .upsert({
        id: true,
        cuit: cuitLimpio,
        razon_social: typeof razonSocial === "string" && razonSocial.trim() ? razonSocial.trim() : null,
        certificate: certificate.trim(),
        private_key: privateKey.trim(),
        environment,
        // Cambiar el certificado invalida el ticket anterior: se firmó con el
        // que ya no está. Dejarlo haría que la próxima factura use un TA que
        // WSAA ya no reconoce, y el error llegaría del lado del comercio.
        ta_token: null,
        ta_sign: null,
        ta_expires_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });

    if (error) {
      console.error("afip-platform-cert upsert:", error.message);
      return json({ error: "No se pudo guardar el certificado" }, 500);
    }

    // Nunca se devuelve lo que se guardó.
    return json({ ok: true, configured: true });
  } catch (e) {
    console.error("afip-platform-cert:", e);
    return json({ error: "Error inesperado" }, 500);
  }
});
