// Export portable de una organización.
//
// No se hace desde el navegador: un miembro común puede ver datos operativos
// por RLS, pero llevarse la organización entera es una acción del owner. Esta
// función usa service_role sólo después de verificar esa pertenencia y responde
// un manifiesto por tabla; un fallo jamás se convierte en "no había datos".
//
// Credenciales OAuth, claves API, sesiones y secretos de webhooks quedan fuera
// incluso para el dueño. Son credenciales de acceso, no datos portables del
// negocio, y exportarlas rompería el límite que las mantiene fuera del cliente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";
import {
  collectOrganizationSnapshot,
  EXCLUDED_CREDENTIAL_STORES,
  SETTINGS_SNAPSHOT_COLUMNS,
} from "../_shared/organizationSnapshot.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  let body: { orgId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo JSON inválido" }, 400);
  }
  const orgId = body.orgId;
  if (!orgId) return json({ error: "orgId requerido" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) return json({ error: "Configuración de export no disponible" }, 503);
  const admin = createClient(url, serviceRole);

  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (membershipError) return json({ error: "No se pudo verificar el acceso a la organización" }, 500);
  if (membership?.role !== "owner") {
    return json({ error: "Sólo el dueño puede exportar toda la organización" }, 403);
  }

  // D5 y D8 comparten el contrato de cobertura. El import explícito de estas
  // constantes mantiene visible en esta superficie qué defensas no se pueden
  // retirar al editar el export.
  void EXCLUDED_CREDENTIAL_STORES;
  void SETTINGS_SNAPSHOT_COLUMNS;
  return json(await collectOrganizationSnapshot(admin, orgId));
});
