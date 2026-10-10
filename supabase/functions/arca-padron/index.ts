/**
 * arca-padron — consulta un CUIT en el padrón de ARCA (A5, getPersona_v2).
 *
 * POST { org_id, cuit } con la sesión del usuario. Devuelve nombre, condición
 * frente al IVA y domicilio fiscal para completar un cliente o el alta fiscal.
 *
 * Usa el certificado de la plataforma y su CUIT como representada: los datos
 * del padrón son públicos y así ningún comercio tiene que delegar otro
 * servicio. Requisito único del dueño de la plataforma: asociar el certificado
 * al servicio `ws_sr_constancia_inscripcion` en ARCA.
 *
 * Cache de 30 días por CUIT (arca_padron_cache) y tope de consultas nuevas
 * por organización y día (arca_padron_consultas).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { descifrarSecreto } from "../_shared/secretos.ts";
import { pedirTicketWsaa } from "../_shared/wsaaLogin.ts";
import {
  PADRON_SERVICIO, PADRON_URL, PadronError, cuitValido, leerPersonaA5, soapGetPersona, type PersonaPadron,
} from "../_shared/padronA5.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CACHE_DIAS = 30;
const TOPE_DIARIO = 300;

const responder = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Ticket de la plataforma para el padrón, compartido entre todas las consultas. */
async function ticketPadron(cert: string, key: string, environment: "produccion" | "homologacion") {
  const vigente = (exp: string | null | undefined) => !!exp && new Date(exp) > new Date(Date.now() + 5 * 60_000);
  const leer = async () => (await supabase.from("afip_ta_servicios").select("token, sign, expires_at").eq("servicio", PADRON_SERVICIO).maybeSingle()).data;

  const guardado = await leer();
  if (guardado && vigente(guardado.expires_at)) return guardado;

  const clave = `afip:ta:plataforma:${PADRON_SERVICIO}`;
  const { data: gane } = await supabase.rpc("afip_ta_lease_tomar", { p_clave: clave, p_segundos: 45 });
  if (!gane) {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const otro = await leer();
      if (otro && vigente(otro.expires_at)) return otro;
    }
  }
  try {
    const wsaaUrl = environment === "produccion"
      ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
      : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
    const ta = await pedirTicketWsaa(wsaaUrl, cert, key, PADRON_SERVICIO);
    const fila = { servicio: PADRON_SERVICIO, token: ta.token, sign: ta.sign, expires_at: ta.expiresAt, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("afip_ta_servicios").upsert(fila);
    if (error) console.error("[padron] no se guardó el ticket", error.message);
    return { token: ta.token, sign: ta.sign, expires_at: ta.expiresAt };
  } finally {
    await supabase.rpc("afip_ta_lease_soltar", { p_clave: clave }).then(() => undefined, () => undefined);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return responder({ ok: false, error: "Método no permitido" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const { data: userData } = await supabase.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return responder({ ok: false, error: "Iniciá sesión de nuevo" }, 401);

  let body: { org_id?: string; cuit?: string };
  try { body = await req.json(); } catch { return responder({ ok: false, error: "Pedido inválido" }, 400); }
  const orgId = body.org_id ?? "";
  const cuit = String(body.cuit ?? "").replace(/\D/g, "");
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return responder({ ok: false, error: "Falta la organización" }, 400);
  if (!cuitValido(cuit)) return responder({ ok: false, code: "cuit_invalido", error: "El CUIT no es válido: revisá los 11 dígitos." }, 200);

  const { data: miembro } = await supabase.from("memberships").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (!miembro) return responder({ ok: false, error: "No pertenecés a esta organización" }, 403);

  const registrar = (desdeCache: boolean) =>
    supabase.from("arca_padron_consultas").insert({ org_id: orgId, user_id: userId, cuit, desde_cache: desdeCache })
      .then(({ error }) => { if (error) console.error("[padron] registro", error.message); });

  const { data: cache } = await supabase.from("arca_padron_cache").select("datos, consultado_at").eq("cuit", cuit).maybeSingle();
  if (cache && Date.now() - new Date(cache.consultado_at).getTime() < CACHE_DIAS * 86_400_000) {
    await registrar(true);
    return responder({ ok: true, persona: cache.datos as PersonaPadron, consultado_at: cache.consultado_at, desde_cache: true });
  }

  const desde = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await supabase.from("arca_padron_consultas").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).eq("desde_cache", false).gte("created_at", desde);
  if ((count ?? 0) >= TOPE_DIARIO) {
    return responder({ ok: false, code: "tope_diario", error: `Llegaste a ${TOPE_DIARIO} consultas al padrón en 24 h. Cargá los datos a mano o probá mañana.` });
  }

  const { data: plat } = await supabase.from("afip_platform_credentials").select("cuit, certificate, private_key, environment").maybeSingle();
  if (!plat?.certificate || !plat?.private_key || !plat?.cuit) {
    return responder({ ok: false, code: "no_disponible", error: "La consulta al padrón todavía no está disponible. Cargá los datos a mano." });
  }
  const environment = plat.environment === "produccion" ? "produccion" : "homologacion";

  try {
    const cert = await descifrarSecreto(supabase, plat.certificate);
    const key = await descifrarSecreto(supabase, plat.private_key);
    const ta = await ticketPadron(cert, key, environment);
    const resp = await fetch(PADRON_URL[environment], {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
      body: soapGetPersona(ta.token, ta.sign, String(plat.cuit).replace(/\D/g, ""), cuit),
      signal: AbortSignal.timeout(20_000),
    });
    const xml = await resp.text();
    const persona = leerPersonaA5(xml, cuit);
    await supabase.from("arca_padron_cache").upsert({ cuit, datos: persona, consultado_at: new Date().toISOString() });
    await registrar(false);
    return responder({ ok: true, persona, consultado_at: new Date().toISOString(), desde_cache: false });
  } catch (e) {
    await registrar(false);
    if (e instanceof PadronError) return responder({ ok: false, code: e.code, error: e.message });
    const mensaje = e instanceof Error ? e.message : String(e);
    console.error("[padron] fallo", mensaje.slice(0, 300));
    // El certificado de la plataforma no tiene el servicio asociado en ARCA.
    if (/notAuthorized|no autorizado|not authorized|computador.*no.*autorizado/i.test(mensaje)) {
      return responder({ ok: false, code: "servicio_no_habilitado", error: "La consulta al padrón no está habilitada todavía. Cargá los datos a mano; ya avisamos al equipo." });
    }
    return responder({ ok: false, code: "error_arca", error: "ARCA no respondió la consulta. Probá de nuevo en unos minutos o cargá los datos a mano." });
  }
});
