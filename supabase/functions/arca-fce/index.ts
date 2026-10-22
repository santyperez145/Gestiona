/**
 * arca-fce — ¿este cliente está obligado a recibir Factura de Crédito
 * Electrónica MiPyME, y desde qué monto? (WSFECRED,
 * `consultarMontoObligadoRecepcion`).
 *
 * POST { org_id, cuit, fecha? } con la sesión del usuario. Consulta con el
 * certificado del propio comercio (ADR 007): es su CUIT el que emite. El
 * comercio tiene que asociar ese certificado también al servicio de Factura
 * de Crédito Electrónica MiPyMEs en ARCA; si no, la respuesta lo dice.
 *
 * El ticket de WSAA de este servicio se guarda por comercio
 * (`afip_ta_por_servicio`) y se pide uno solo a la vez (lease): ARCA rechaza
 * un ticket nuevo mientras hay otro vigente.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolverCredencialesAfip } from "../_shared/afipCredenciales.ts";
import { pedirTicketWsaa } from "../_shared/wsaaLogin.ts";
import { clasificarRechazoWsaa } from "../_shared/certificadoArcaReglas.ts";
import {
  WSFECRED_SERVICIO, WSFECRED_URL, WsfecredError, leerObligadoRecepcion, soapObligadoRecepcion,
} from "../_shared/wsfecred.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const responder = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const WSAA_URL = {
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
} as const;

type Ambiente = "produccion" | "homologacion";

async function ticket(orgId: string, environment: Ambiente, cert: string, key: string) {
  const vigente = (exp: string | null | undefined) => !!exp && new Date(exp) > new Date(Date.now() + 5 * 60_000);
  const leer = async () => (await supabase.from("afip_ta_por_servicio").select("token, sign, expires_at")
    .eq("org_id", orgId).eq("servicio", WSFECRED_SERVICIO).eq("environment", environment).maybeSingle()).data;

  const guardado = await leer();
  if (guardado && vigente(guardado.expires_at)) return guardado;

  const clave = `afip:ta:${orgId}:${WSFECRED_SERVICIO}:${environment}`;
  const { data: gane } = await supabase.rpc("afip_ta_lease_tomar", { p_clave: clave, p_segundos: 45 });
  if (!gane) {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const otro = await leer();
      if (otro && vigente(otro.expires_at)) return otro;
    }
  }
  try {
    const ta = await pedirTicketWsaa(WSAA_URL[environment], cert, key, WSFECRED_SERVICIO);
    const { error } = await supabase.from("afip_ta_por_servicio").upsert({
      org_id: orgId, servicio: WSFECRED_SERVICIO, environment,
      token: ta.token, sign: ta.sign, expires_at: ta.expiresAt, updated_at: new Date().toISOString(),
    });
    if (error) console.error("[fce] no se guardó el ticket", error.message);
    return { token: ta.token, sign: ta.sign, expires_at: ta.expiresAt };
  } finally {
    const { error } = await supabase.rpc("afip_ta_lease_soltar", { p_clave: clave });
    if (error) console.error("[fce] no se soltó el lease", error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return responder({ ok: false, error: "Método no permitido" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const { data: userData } = await supabase.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return responder({ ok: false, error: "Iniciá sesión de nuevo" }, 401);

  let body: { org_id?: string; cuit?: string; fecha?: string };
  try { body = await req.json(); } catch { return responder({ ok: false, error: "Pedido inválido" }, 400); }
  const orgId = String(body.org_id ?? "");
  const cuit = String(body.cuit ?? "").replace(/\D/g, "");
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha ?? "")) ? String(body.fecha) : hoy;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return responder({ ok: false, error: "Falta la organización" }, 400);
  if (cuit.length !== 11) return responder({ ok: false, code: "cuit_invalido", error: "El CUIT del cliente tiene que tener 11 dígitos." });

  const { data: miembro } = await supabase.from("memberships").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (!miembro) return responder({ ok: false, error: "No pertenecés a esta organización" }, 403);

  const resuelto = await resolverCredencialesAfip(supabase, orgId);
  if (!resuelto.cred) return responder({ ok: false, code: "sin_certificado", error: resuelto.error });
  const cred = resuelto.cred;
  const environment: Ambiente = cred.environment === "produccion" ? "produccion" : "homologacion";

  try {
    const ta = await ticket(orgId, environment, cred.certificate, cred.private_key);
    const resp = await fetch(WSFECRED_URL[environment], {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "http://ar.gob.afip.wsfecred/FECredService/consultarMontoObligadoRecepcion" },
      body: soapObligadoRecepcion({ token: ta.token, sign: ta.sign, cuitRepresentada: cred.cuit, cuitConsultada: cuit, fecha }),
      signal: AbortSignal.timeout(20_000),
    });
    const resultado = leerObligadoRecepcion(await resp.text());
    return responder({ ok: true, cuit, fecha, obligado: resultado.obligado, monto_desde: resultado.montoDesde, observaciones: resultado.observaciones });
  } catch (e) {
    if (e instanceof WsfecredError) return responder({ ok: false, code: "arca_rechazo", error: e.message });
    const mensaje = e instanceof Error ? e.message : String(e);
    console.error("[fce] fallo", mensaje.slice(0, 300));
    const tipo = clasificarRechazoWsaa(mensaje);
    if (tipo === "no_asociado") {
      return responder({
        ok: false, code: "servicio_no_asociado",
        error: "Tu certificado todavía no está asociado a la Factura de Crédito Electrónica en ARCA. En el Administrador de Relaciones, asocialo al servicio «Factura de Crédito Electrónica MiPyMEs» y probá de nuevo.",
      });
    }
    if (tipo === "ticket_vigente") return responder({ ok: false, code: "ticket_vigente", error: "ARCA ya tiene una sesión abierta con tu certificado para este servicio. Probá de nuevo en unos minutos." });
    return responder({ ok: false, code: "no_disponible", error: "ARCA no respondió la consulta. Probá de nuevo en unos minutos." });
  }
});
