/**
 * arca-padron — consulta un CUIT en el padrón de ARCA (A5, getPersona_v2).
 *
 * POST { org_id, cuit } con la sesión del usuario. Devuelve nombre, condición
 * frente al IVA y domicilio fiscal para completar un cliente o el alta fiscal.
 *
 * Credencial, en orden (2026-10-22):
 *   1. el certificado de la plataforma, con su CUIT como representada (los
 *      datos del padrón son públicos: ningún comercio tiene que asociar nada);
 *   2. si la plataforma no tiene certificado o no tiene el servicio, el
 *      certificado propio del comercio (ADR 007), con su CUIT.
 * Antes había sólo la primera, y desde que cada comercio usa su certificado
 * la consulta quedaba «no disponible» sin decir por qué. Ahora, si ninguna
 * sirve, la respuesta dice exactamente qué asociar en ARCA.
 * El servicio es `ws_sr_constancia_inscripcion` (A5, getPersona_v2); el
 * contrato se verificó contra el WSDL oficial.
 *
 * Cache de 30 días por CUIT (arca_padron_cache) y tope de consultas nuevas
 * por organización y día (arca_padron_consultas).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { descifrarSecreto } from "../_shared/secretos.ts";
import { pedirTicketWsaa } from "../_shared/wsaaLogin.ts";
import { ticketPorServicio } from "../_shared/ticketServicio.ts";
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
    const { error: soltarError } = await supabase.rpc("afip_ta_lease_soltar", { p_clave: clave });
    // Si no se suelta, el lease vence solo; queda en el log.
    if (soltarError) console.error("[padron] no se soltó el lease del ticket", soltarError.message);
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

  // Las credenciales que pueden consultar, en orden.
  type Fuente = { origen: "plataforma" | "comercio"; environment: "produccion" | "homologacion"; cuit: string; ticket: () => Promise<{ token: string; sign: string }> };
  const fuentes: Fuente[] = [];
  const { data: plat } = await supabase.from("afip_platform_credentials").select("cuit, certificate, private_key, environment").maybeSingle();
  if (plat?.certificate && plat?.private_key && plat?.cuit) {
    const environment = plat.environment === "produccion" ? "produccion" : "homologacion";
    fuentes.push({ origen: "plataforma", environment, cuit: String(plat.cuit).replace(/\D/g, ""), ticket: async () => {
      const cert = await descifrarSecreto(supabase, plat.certificate);
      const key = await descifrarSecreto(supabase, plat.private_key);
      return await ticketPadron(cert, key, environment);
    } });
  }
  const { data: propio } = await supabase.from("afip_credentials").select("cuit, certificate, private_key, environment, modo").eq("org_id", orgId).maybeSingle();
  if (propio?.modo === "propio" && propio.certificate && propio.private_key && propio.cuit) {
    const environment = propio.environment === "produccion" ? "produccion" : "homologacion";
    fuentes.push({ origen: "comercio", environment, cuit: String(propio.cuit).replace(/\D/g, ""), ticket: async () => {
      const cert = await descifrarSecreto(supabase, propio.certificate);
      const key = await descifrarSecreto(supabase, propio.private_key);
      return await ticketPorServicio(supabase, { orgId, servicio: PADRON_SERVICIO, environment, certificate: cert, privateKey: key });
    } });
  }
  const PASOS = "En ARCA, entrá a «Administrador de Relaciones de Clave Fiscal» → «Nueva relación» → «ARCA» → «WebServices» → «Consulta de Constancia de Inscripción» (ws_sr_constancia_inscripcion) y asociá el mismo certificado con el que facturás. Después probalo en Nerqia → ARCA → Consulta de CUIT.";
  if (!fuentes.length) {
    return responder({ ok: false, code: "sin_credencial", error: "Para completar los datos con el CUIT hace falta tu certificado de ARCA con la consulta habilitada. " + PASOS, pasos: PASOS });
  }

  let ultimo: { code: string; error: string } | null = null;
  for (const f of fuentes) {
    try {
      const ta = await f.ticket();
      const resp = await fetch(PADRON_URL[f.environment], {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
        body: soapGetPersona(ta.token, ta.sign, f.cuit, cuit),
        signal: AbortSignal.timeout(20_000),
      });
      const xml = await resp.text();
      const persona = leerPersonaA5(xml, cuit);
      const { error: cacheErr } = await supabase.from("arca_padron_cache").upsert({ cuit, datos: persona, consultado_at: new Date().toISOString() });
      if (cacheErr) console.error("[padron] no se guardó el cache", cacheErr);
      await registrar(false);
      return responder({ ok: true, persona, consultado_at: new Date().toISOString(), desde_cache: false, origen: f.origen });
    } catch (e) {
      // Un CUIT inexistente es la respuesta, no una falla: no se prueba otra credencial.
      if (e instanceof PadronError && e.code === "no_encontrado") {
        await registrar(false);
        return responder({ ok: false, code: e.code, error: e.message });
      }
      const mensaje = e instanceof Error ? e.message : String(e);
      console.error(`[padron] ${f.origen} falló`, mensaje.slice(0, 300));
      ultimo = /notAuthorized|no autorizado|not authorized|no tiene autorizado|computador.*no.*autorizado/i.test(mensaje)
        ? { code: "servicio_no_asociado", error: "Tu certificado todavía no tiene habilitada la consulta de CUIT en ARCA. " + PASOS }
        : e instanceof PadronError ? { code: e.code, error: e.message }
        : { code: "error_arca", error: "ARCA no respondió la consulta. Probá de nuevo en unos minutos o cargá los datos a mano." };
    }
  }
  await registrar(false);
  return responder({ ok: false, ...ultimo!, pasos: ultimo!.code === "servicio_no_asociado" ? PASOS : undefined });
});
