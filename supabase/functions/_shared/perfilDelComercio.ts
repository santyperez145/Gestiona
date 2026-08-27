// El rubro del comercio lo resuelve el servidor, y NULL es un estado real.
//
// ── De dónde sale el rubro ────────────────────────────────────────────────
//
// De `settings.industry_code`, leído acá. **No del cliente.** Es la misma
// regla que precios y stock aplicada al prompt: el navegador manda intención
// y datos, y el servidor compone. Ya se había intentado por el otro lado y
// falló en silencio — `MarketingPage` mandaba `data.industry` a
// `marketing_copy`, que nunca lo leyó, igual que el `instructions` del widget.
//
// ⚠️ Se lee con el **JWT del usuario**, nunca con `service_role`, por lo mismo
// que `leerEntitlements`: con service_role `auth.uid()` es NULL, la RLS de
// `settings` no acota nada, y alguien podría mandar el `org_id` de otro
// comercio para pedirle prestado el rubro. Verificado el 2026-08-27 con el rol
// `authenticated` real y el JWT del dueño de Exentry: ve **1** fila de
// `settings` —la suya— y las 9 de `industry_presets`.
//
// ⚠️ Y NULL significa «todavía no eligió», que es un estado real y no un
// sinónimo de perfumería. Medido el 2026-08-27: de las 2 organizaciones, una
// tiene `perfumes` elegido de verdad —con fila en
// `organization_business_profiles` y 60 productos— y la otra tiene NULL.
//
// 📌 El texto del prompt vive en `promptDelComercio.ts`, que es puro y tiene
// test. Acá queda sólo la lectura, que necesita `createClient` y por eso no la
// puede importar vitest. Se re-exporta para que un llamador tenga un import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { SIN_RUBRO, type PerfilDelComercio } from "./promptDelComercio.ts";

export {
  FORMATO_INFORME,
  personaDe,
  reglasDelAnalisis,
  SIN_RUBRO,
  type PerfilDelComercio,
} from "./promptDelComercio.ts";

/**
 * Lee el rubro de la organización con el JWT del usuario. Nunca lanza: si algo
 * falla devuelve `SIN_RUBRO`, y el análisis sale genérico en vez de salir con
 * un rubro inventado.
 */
export async function leerPerfilDelComercio(
  req: Request,
  orgId: string | null | undefined,
): Promise<PerfilDelComercio> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!url || !anonKey || !authHeader || !orgId) return SIN_RUBRO;

  try {
    const sb = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Se pide exactamente lo que se usa. Pedir de más expone una columna sin
    // motivo; pedir de menos llega `undefined` y no falla nunca — los dos
    // errores ya costaron pantallas equivocadas en este repo.
    const { data: ajustes, error } = await sb
      .from("settings")
      .select("industry_code, ai_tone")
      .eq("org_id", orgId)
      .maybeSingle();
    if (error || !ajustes) return SIN_RUBRO;

    const rubro = typeof ajustes.industry_code === "string" && ajustes.industry_code.trim()
      ? ajustes.industry_code.trim()
      : null;

    // ⚠️ El tono es la VOZ, no el rubro, y no se usa para deducirlo. La columna
    // trae `DEFAULT 'profesional rioplatense argentino'`, que es neutral a
    // propósito: sirve de piso para un comercio sin rubro sin sugerirle uno.
    const tonoDelComercio = typeof ajustes.ai_tone === "string" && ajustes.ai_tone.trim()
      ? ajustes.ai_tone.trim()
      : null;

    if (!rubro) return { rubro: null, nombreRubro: null, tono: tonoDelComercio };

    const { data: preset } = await sb
      .from("industry_presets")
      .select("name, ai_tone")
      .eq("code", rubro)
      .maybeSingle();

    return {
      rubro,
      nombreRubro: typeof preset?.name === "string" ? preset.name : null,
      tono: tonoDelComercio ?? (typeof preset?.ai_tone === "string" ? preset.ai_tone : null),
    };
  } catch {
    return SIN_RUBRO;
  }
}
