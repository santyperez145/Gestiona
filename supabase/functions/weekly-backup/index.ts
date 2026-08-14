// Punto de entrada retirado hasta que exista un backup POR ORGANIZACIÓN con
// restauración probada. La versión anterior recorría el modelo legacy por
// usuario y se podía invocar sin una sesión real: no era un respaldo confiable
// del negocio y no debe seguir generando archivos que aparenten serlo.
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  return new Response(JSON.stringify({
    error: "Los backups gestionados están temporalmente deshabilitados hasta que exista restauración verificada por organización.",
    code: "BACKUP_SERVICE_UNAVAILABLE",
  }), {
    status: 503,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
