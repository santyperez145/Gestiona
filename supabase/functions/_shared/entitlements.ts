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
  /** Acciones de IA por mes. `null` = sin tope. */
  ia_cupo_mensual: number | null;
  ia_usado: number;
  /** `null` = sin tope. `0` = no le queda ninguna. No son lo mismo. */
  ia_restante: number | null;
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

  if (!e[beneficio]) {
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

  /**
   * ⚠️ Tener el beneficio no es tener cupo. Hasta el 2026-08-28 la IA era un
   * booleano: cualquier organización con `ia=true` podía quemar
   * `ANTHROPIC_API_KEY` sin techo, y `ai_usage_stats` —que existía desde hacía
   * meses— tenía **0 filas**. Nadie registraba lo que costaba.
   *
   * 📌 `null` es sin tope y `0` es sin cupo. Compararlos con `!` los haría
   * iguales, y el plan Business —el que más paga— sería el que no puede usarla.
   */
  if (beneficio === "ia" && e.ia_restante !== null && e.ia_restante <= 0) {
    return new Response(
      JSON.stringify({
        error:
          `Usaste las ${e.ia_cupo_mensual} acciones de IA de tu plan este mes. ` +
          `El cupo se renueva el 1°, y desde Mi plan podés pasar a uno con más.`,
        code: "cupo_ia_agotado",
        beneficio,
        plan: e.plan,
        ia_cupo_mensual: e.ia_cupo_mensual,
        ia_usado: e.ia_usado,
      }),
      { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return null;
}

/**
 * Registra una acción de IA ya ocurrida.
 *
 * ⚠️ Se llama **después** de que el proveedor contestó. Registrar antes le
 * cobraría al comercio una acción que falló — y el cupo es lo que decide si
 * puede seguir trabajando.
 *
 * 📌 No calcula el costo en dólares a propósito. El precio por token cambia y
 * hornearlo acá lo dejaría viejo sin que nadie se entere; los tokens sí son
 * medidos, así que el costo se puede calcular cuando se necesite con el precio
 * que rija ese día. `estimated_cost_usd` queda NULL, que significa «no se
 * calculó» y no «salió gratis».
 *
 * 📌 Va con `service_role` porque `ia_registrar_consumo` está revocada para
 * todos los demás: si el navegador pudiera escribir ahí, el cupo lo decidiría
 * el cliente. La organización ya la validó `exigirBeneficio` con el JWT real.
 *
 * Nunca lanza: que la contabilidad falle no puede tumbar una respuesta que el
 * comercio ya recibió. Sí deja rastro en el log.
 */
export async function registrarConsumoIA(opciones: {
  orgId: string | null | undefined;
  userId: string | null | undefined;
  model: string;
  input?: number;
  output?: number;
}): Promise<void> {
  const { orgId, userId, model, input = 0, output = 0 } = opciones;
  if (!orgId) return;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) {
    console.error("no se pudo registrar el consumo de IA: falta configuración");
    return;
  }

  try {
    const admin = createClient(url, serviceRole);
    const { error } = await admin.rpc("ia_registrar_consumo", {
      p_org: orgId,
      p_user: userId ?? null,
      p_model: model,
      p_input: Math.max(0, Math.round(input)),
      p_output: Math.max(0, Math.round(output)),
    });
    // ⚠️ Un `rpc` sin mirar `.error` convierte «no se guardó» en «listo», que es
    // exactamente cómo el panel de AFIP quedó diciendo «falta conectar» para
    // siempre. Si el consumo no se registra, el cupo no se gasta nunca.
    if (error) console.error("ia_registrar_consumo falló", error);
  } catch (e) {
    console.error("ia_registrar_consumo lanzó", e);
  }
}
