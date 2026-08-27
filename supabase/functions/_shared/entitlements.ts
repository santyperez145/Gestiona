// El plan se chequea en el servidor, donde se gasta la plata.
//
// ── Por qué existe ────────────────────────────────────────────────────────
//
// `requireUser` garantiza que hay una persona real detrás del request. No dice
// nada sobre si esa persona **pagó**. Las funciones de IA queman crédito de
// Anthropic en cada llamada, y hasta el 2026-08-27 ninguna miraba el plan: un
// comercio con la suscripción vencida podía seguir gastando indefinidamente.
//
// El navegador ya corta —`useEntitlements`— pero eso es orientación, no
// autorización. Es la misma distinción que este repo ya escribió para permisos:
// la UI evita ofrecer botones que van a fallar; el servidor decide.
//
// ── La decisión no se escribe acá ─────────────────────────────────────────
//
// La regla vive en `public.org_entitlements(uuid)`, y este archivo sólo la
// consulta. La ventana de gracia, qué estado corta y el piso de límites están
// en un solo lugar para que el hook y las Edge Functions no puedan divergir —
// que es exactamente cómo se rompieron antes el mapa de permisos y el reparto
// de roles.
//
// ⚠️ Y se consulta con el **JWT del usuario**, no con `service_role`. Con
// service_role `auth.uid()` es NULL, el chequeo de membresía de la función se
// saltea, y cualquiera podría mandar el `org_id` de otro comercio para pedir
// prestado su plan. Con el JWT real, pedir por una organización ajena devuelve
// `insufficient_privilege`, que es lo correcto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type Beneficio = "ia" | "backups" | "branding";

export interface Entitlements {
  plan: string | null;
  vigente: boolean;
  motivo_de_corte: "impago" | "cancelado" | "pausado" | null;
  dias_de_gracia: number;
  estado: string | null;
  ia: boolean;
  backups: boolean;
  branding: boolean;
  max_products: number | null;
  max_users: number | null;
  max_sales_per_month: number | null;
}

/** Qué decirle a alguien a quien se le cortó, según por qué. */
function motivoLegible(e: Entitlements): string {
  switch (e.motivo_de_corte) {
    case "impago":
      return "Tu suscripción tiene un pago pendiente. Regularizala desde Mi plan y la función vuelve enseguida.";
    case "cancelado":
      return "Tu suscripción está cancelada. Podés reactivarla desde Mi plan.";
    case "pausado":
      return "Tu suscripción está pausada. Reanudala desde Mi plan.";
    default:
      return "Tu plan actual no incluye esta función. Podés cambiarlo desde Mi plan.";
  }
}

/**
 * Lee los beneficios de una organización. Devuelve `null` si no se pudo
 * resolver — el llamador decide qué hacer con eso.
 */
export async function leerEntitlements(
  req: Request,
  orgId: string,
): Promise<Entitlements | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!url || !anonKey || !authHeader) return null;

  try {
    const sb = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await sb.rpc("org_entitlements", { p_org: orgId });
    if (error || !data) return null;
    return data as Entitlements;
  } catch {
    return null;
  }
}

/**
 * Corta el request con 402 si la organización no tiene el beneficio. Se usa
 * después de `requireUser`:
 *
 *   const gate = await exigirBeneficio(req, orgId, "ia", corsHeaders);
 *   if (gate) return gate;
 *
 * ⚠️ Devuelve 402 (Payment Required) y no 403: no es que la persona no tenga
 * permiso, es que el plan no lo cubre. Son problemas distintos y se resuelven
 * en pantallas distintas.
 *
 * 📌 Si el `org_id` no vino, se corta. Adivinarlo por las membresías del
 * usuario sería peor que no chequear: el dueño pertenece a más de una
 * organización y elegir la equivocada daría un permiso que nadie pidió.
 */
export async function exigirBeneficio(
  req: Request,
  orgId: string | null | undefined,
  beneficio: Beneficio,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (!orgId) {
    return new Response(
      JSON.stringify({
        error: "Falta la organización para verificar el plan.",
        code: "sin_organizacion",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const e = await leerEntitlements(req, orgId);

  // ⚠️ Si no se pudo leer, se corta. La alternativa —dejar pasar ante la duda—
  // convierte cualquier hipo de la base en barra libre sobre una API que se
  // paga por llamada, y nadie se entera hasta la factura.
  if (!e) {
    return new Response(
      JSON.stringify({
        error: "No se pudo verificar tu plan. Probá de nuevo en un momento.",
        code: "plan_no_verificable",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (e[beneficio]) return null;

  return new Response(
    JSON.stringify({
      error: motivoLegible(e),
      code: e.motivo_de_corte ? "suscripcion_" + e.motivo_de_corte : "plan_sin_beneficio",
      beneficio,
      plan: e.plan,
      motivo_de_corte: e.motivo_de_corte,
    }),
    { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
