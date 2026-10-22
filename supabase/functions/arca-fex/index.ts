/**
 * arca-fex — Factura de exportación «E» (WSFEX): autoriza la factura 19 y
 * sus notas 20 y 21, y trae de ARCA los parámetros y la cotización.
 *
 * Callers:
 *  - `afip-authorize` reenvía acá los tipos 19, 20 y 21 con la misma
 *    autoridad con la que lo llamaron: el outbox fiscal (`x-cron-secret`) o
 *    el panel (sesión de un dueño o administrador). `{ action: "autorizar", invoice_id }`.
 *  - El panel: `{ action: "parametros", org_id }` (dueño o administrador)
 *    actualiza países, Incoterms y monedas y devuelve los puntos de venta de
 *    exportación; `{ action: "cotizacion", org_id, moneda, fecha? }`.
 *
 * Certificado: el propio del comercio (ADR 007), asociado al servicio
 * «Factura Electrónica de Exportación». El ticket de «wsfex» se guarda por
 * comercio.
 *
 * ⚠️ Contra duplicados, dos llaves: el número candidato (como en WSFE) y el
 * `Id` del pedido, que se guarda antes de llamar. Si la respuesta se pierde,
 * el reintento reenvía el mismo `Id` y ARCA devuelve el CAE ya otorgado
 * (`Reproceso = S`); se verifica que sea este comprobante antes de guardarlo.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolverCredencialesAfip } from "../_shared/afipCredenciales.ts";
import { esLlamadaDeCron } from "../_shared/cronAuth.ts";
import { requireUser } from "../_shared/requireUser.ts";
import { clasificarRechazoWsaa } from "../_shared/certificadoArcaReglas.ts";
import { ticketPorServicio, type AmbienteArca } from "../_shared/ticketServicio.ts";
import { monedaWsfe } from "../_shared/wsfeComprobante.ts";
import {
  cmpFex, leerAutorizacionFex, leerCotizacionFex, leerParametroFex, leerUltimoFex, PARAMETROS_FEX, soapActionFex, soapFex,
  TIPOS_EXPORTACION, WSFEX_SERVICIO, WSFEX_URL, WsfexError,
  type AsociadoExportacion, type ComprobanteExportacion, type DatosExportacion, type ParametroFex,
} from "../_shared/wsfex.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const responder = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Un problema que el comercio tiene que arreglar: no se reintenta solo. */
class ErrorDeConfiguracion extends Error {}

type Auth = { token: string; sign: string; cuit: string };
// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;

async function llamar(env: AmbienteArca, operacion: string, cuerpo: string, auth: Auth, extraAuth = ""): Promise<string> {
  const resp = await fetch(WSFEX_URL[env], {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: soapActionFex(operacion) },
    body: soapFex(operacion, cuerpo, auth, extraAuth),
    signal: AbortSignal.timeout(30_000),
  });
  const xml = await resp.text();
  if (!resp.ok) {
    console.error("[fex] HTTP", { operacion, status: resp.status, body: xml.slice(0, 300) });
    throw new Error(`WSFEX HTTP ${resp.status}`);
  }
  return xml;
}

async function conexion(orgId: string): Promise<{ env: AmbienteArca; auth: Auth }> {
  const r = await resolverCredencialesAfip(supabase, orgId);
  if (!r.cred) throw new ErrorDeConfiguracion(r.error);
  if (r.cred.modo !== "propio") {
    throw new ErrorDeConfiguracion("La factura de exportación se emite con tu propio certificado de ARCA. Cargalo en ARCA → Certificado y asocialo al servicio «Factura Electrónica de Exportación».");
  }
  const env: AmbienteArca = r.cred.environment === "produccion" ? "produccion" : "homologacion";
  try {
    const ta = await ticketPorServicio(supabase, { orgId, servicio: WSFEX_SERVICIO, environment: env, certificate: r.cred.certificate, privateKey: r.cred.private_key });
    return { env, auth: { token: ta.token, sign: ta.sign, cuit: r.cred.cuit } };
  } catch (e) {
    const tipo = clasificarRechazoWsaa(e instanceof Error ? e.message : String(e));
    if (tipo === "no_asociado") {
      throw new ErrorDeConfiguracion("Tu certificado todavía no está asociado a la factura de exportación. En el Administrador de Relaciones de ARCA asocialo al servicio «Factura Electrónica de Exportación» y probá de nuevo.");
    }
    throw e;
  }
}

/** 14 dígitos (el campo admite 15): milisegundos y una cifra al azar. */
const idNuevo = () => Number(`${Date.now()}${Math.floor(Math.random() * 10)}`);

const diaAnterior = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

/** Errores de ARCA que son de configuración (autenticación, CUIT, punto de venta). */
const ERRORES_DE_CONFIGURACION = new Set([1000, 1001, 1510, 1607, 1668]);
/** Errores internos de ARCA: no hay rechazo, se reintenta. */
const ERRORES_TRANSITORIOS = new Set([500, 501, 502, 505]);

async function resultado(invoiceId: string, estado: string, extra: { cae?: string; vencimiento?: string | null; numero?: number; env: AmbienteArca; error?: string | null }) {
  const { data, error } = await supabase.rpc("afip_autorizacion_resultado", {
    p_invoice_id: invoiceId, p_status: estado, p_cae: extra.cae ?? null, p_cae_vencimiento: extra.vencimiento ?? null,
    p_numero_afip: extra.numero ?? null, p_environment: extra.env, p_error: extra.error ?? null,
  });
  if (error) throw new Error(`No se pudo registrar el resultado: ${error.message}`);
  return data;
}

async function errorPrevio(invoiceId: string, estado: "config_error" | "validation_error", mensaje: string) {
  const { error } = await supabase.rpc("afip_autorizacion_preflight_error", { p_invoice_id: invoiceId, p_status: estado, p_error: mensaje });
  if (error) console.error("[fex] no se registró el error previo", error.message);
}

async function autorizar(invoiceId: string, actorId: string | null): Promise<Response> {
  const desdeOutbox = actorId === null;
  const { data: inv, error } = await supabase.from("invoices").select("*, invoice_items(*)").eq("id", invoiceId).maybeSingle();
  if (error) return responder({ ok: false, error: "No se pudo leer la factura. Probá de nuevo." }, 503);
  if (!inv) return responder({ ok: false, error: "Factura no encontrada" }, 404);
  if (inv.cae) return responder({ ok: true, status: "authorized", idempotent: true, cae: inv.cae, numero_afip: inv.numero_afip });
  const tipo = Number(inv.tipo_comprobante);
  if (!TIPOS_EXPORTACION.has(tipo)) return responder({ ok: false, error: "El comprobante no es de exportación." }, 422);
  if (actorId) {
    const { data: miembro } = await supabase.from("memberships").select("role").eq("org_id", inv.org_id).eq("user_id", actorId)
      .in("role", ["owner", "admin"]).maybeSingle();
    if (!miembro) return responder({ ok: false, error: "Sólo el dueño o un administrador pueden autorizar facturas." }, 403);
  }

  // Lo que se valida antes de tocar la secuencia fiscal.
  let datos = inv.exportacion as DatosExportacion | null;
  let asociado: AsociadoExportacion | null = null;
  let env: AmbienteArca;
  let auth: Auth;
  let puntoVenta: number;
  try {
    if (tipo !== 19) {
      const origenId = tipo === 21 ? inv.nota_credito_de : inv.nota_debito_de;
      const { data: o } = await supabase.from("invoices")
        .select("tipo_comprobante, punto_venta, numero_afip, cae, emisor_cuit, exportacion, afip_status")
        .eq("id", origenId).eq("org_id", inv.org_id).maybeSingle();
      if (!o?.cae || o.afip_status !== "authorized") throw new ErrorDeConfiguracion("La factura de exportación que corrige esta nota tiene que estar autorizada.");
      datos = datos ?? o.exportacion;
      asociado = { tipo: Number(o.tipo_comprobante), puntoVenta: Number(o.punto_venta), numero: Number(o.numero_afip), cuit: String(o.emisor_cuit ?? "") };
    }
    if (!datos) throw new ErrorDeConfiguracion("Faltan los datos de exportación de la factura.");
    const { data: cred } = await supabase.from("afip_credentials").select("punto_venta_exportacion").eq("org_id", inv.org_id).maybeSingle();
    if (!cred?.punto_venta_exportacion) throw new ErrorDeConfiguracion("Configurá el punto de venta de exportación en ARCA → Factura de exportación.");
    puntoVenta = Number(cred.punto_venta_exportacion);
    try {
      cmpFex(inv as ComprobanteExportacion, datos, { id: 1, tipoCbte: tipo, puntoVenta, numero: 1, asociado, cotizacion: 1 });
    } catch (e) {
      await errorPrevio(invoiceId, "validation_error", e instanceof Error ? e.message : String(e));
      return responder({ ok: false, status: "validation_error", error: e instanceof Error ? e.message : String(e) }, 422);
    }
    ({ env, auth } = await conexion(inv.org_id));
  } catch (e) {
    if (e instanceof ErrorDeConfiguracion) {
      await errorPrevio(invoiceId, "config_error", e.message);
      return responder({ ok: false, status: "config_error", error: e.message, terminal: true }, desdeOutbox ? 200 : 422);
    }
    console.error("[fex] sin conexión antes de reservar", (e instanceof Error ? e.message : String(e)).slice(0, 300));
    return responder({ ok: false, status: "network_error", error: "ARCA no respondió. Probá de nuevo en unos minutos." }, 503);
  }

  const { data: reserva, error: reservaError } = await supabase.rpc("afip_autorizacion_reservar", {
    p_invoice_id: invoiceId, p_requested_by: actorId, p_punto_venta: puntoVenta, p_tipo_cbte: tipo, p_environment: env,
  });
  if (reservaError) {
    const mensaje = reservaError.message.replace(/^.*?:\s*/, "");
    await errorPrevio(invoiceId, "config_error", mensaje);
    return responder({ ok: false, status: "config_error", error: mensaje, terminal: true }, desdeOutbox ? 200 : 422);
  }
  if (reserva?.status === "authorized") return responder(reserva);
  if (!reserva?.acquired) {
    return responder({ ok: true, status: "processing", message: "La factura ya tiene una autorización en curso. Esperá la verificación antes de reintentar." }, desdeOutbox ? 503 : 202);
  }

  let numero: number | null = null;
  try {
    const { data: reservada, error: leerError } = await supabase.from("invoices").select("*, invoice_items(*)").eq("id", invoiceId).single();
    if (leerError || !reservada) throw new Error("No se pudo leer la factura reservada");
    const { data: fexId, error: idError } = await supabase.rpc("afip_fex_asignar_id", { p_invoice_id: invoiceId, p_id: idNuevo() });
    if (idError || !fexId) throw new Error("No se pudo guardar el identificador del pedido antes de llamar a ARCA");

    numero = Number(reservada.afip_candidate_number) || null;
    if (!numero) {
      const ultimo = leerUltimoFex(await llamar(env, "FEXGetLast_CMP", "", auth, `<ar:Pto_venta>${puntoVenta}</ar:Pto_venta><ar:Cbte_Tipo>${tipo}</ar:Cbte_Tipo>`));
      numero = ultimo + 1;
      const { error: candError } = await supabase.rpc("afip_autorizacion_candidato", { p_invoice_id: invoiceId, p_numero_afip: numero });
      if (candError) throw new Error("No se pudo guardar el número antes de llamar a ARCA");
    }

    let cotizacion = Number(reservada.moneda_cotizacion) || null;
    const moneda = monedaWsfe(reservada.currency);
    if (moneda !== "PES" && !cotizacion) {
      // La del día hábil cambiario anterior a la fecha del comprobante (RG / error 2053).
      const c = leerCotizacionFex(await llamar(env, "FEXGetPARAM_Ctz", `<ar:Mon_id>${moneda}</ar:Mon_id><ar:FchCotiz>${diaAnterior(reservada.issue_date)}</ar:FchCotiz>`, auth));
      const { error: cotError } = await supabase.rpc("afip_fijar_cotizacion", { p_invoice_id: invoiceId, p_cotizacion: c.cotizacion });
      if (cotError) throw new Error("No se pudo guardar la cotización de la factura");
      cotizacion = c.cotizacion;
    }

    const cmp = cmpFex({ ...(reservada as ComprobanteExportacion), moneda_cotizacion: cotizacion }, datos!, { id: Number(fexId), tipoCbte: tipo, puntoVenta, numero, asociado });
    const r = leerAutorizacionFex(await llamar(env, "FEXAuthorize", cmp, auth));

    if (r.resultado === "A" && r.cae) {
      // Con Reproceso = S ARCA devuelve lo otorgado para este Id: tiene que ser este comprobante.
      if (r.numero !== numero || r.puntoVenta !== puntoVenta || r.tipo !== tipo) {
        console.error("[fex] ARCA devolvió otro comprobante para el Id", { invoiceId, esperado: [tipo, puntoVenta, numero], recibido: [r.tipo, r.puntoVenta, r.numero] });
        const final = await resultado(invoiceId, "processing", { env, numero, error: "ARCA devolvió otro comprobante para este pedido. Escribinos antes de reintentar." });
        return responder({ ok: false, status: "processing", error: "ARCA devolvió otro comprobante para este pedido. Escribinos antes de reintentar.", detalle: final }, desdeOutbox ? 200 : 409);
      }
      const final = await resultado(invoiceId, "authorized", { cae: r.cae, vencimiento: r.vencimiento, numero, env });
      if (r.observaciones) {
        const { error: obsError } = await supabase.rpc("afip_registrar_observaciones", { p_invoice_id: invoiceId, p_observaciones: [{ code: 0, msg: r.observaciones }] });
        if (obsError) console.error("[fex] no se guardaron las observaciones", obsError.message);
      }
      return responder({ ...(final as Fila), reproceso: r.reproceso });
    }

    if (r.error && ERRORES_TRANSITORIOS.has(r.error.codigo)) throw new Error(`ARCA ${r.error.codigo}: ${r.error.mensaje}`);
    if (r.resultado === "R" || r.error) {
      const motivo = r.error ? `${r.error.codigo}: ${r.error.mensaje}` : r.observaciones || "ARCA rechazó el comprobante.";
      const estado = r.error && ERRORES_DE_CONFIGURACION.has(r.error.codigo) ? "config_error" : "rejected";
      const final = await resultado(invoiceId, estado, { env, numero, error: `ARCA rechazó la factura de exportación (${motivo}).` });
      return responder({ ok: false, status: estado, error: `ARCA rechazó la factura de exportación (${motivo}).`, terminal: true, detalle: final }, desdeOutbox ? 200 : 422);
    }
    throw new Error("ARCA no devolvió un resultado.");
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    console.error("[fex] autorización sin confirmar", { invoiceId, error: mensaje.slice(0, 300) });
    // Sin respuesta confirmada queda en verificación: el reintento reenvía el
    // mismo Id y recupera el CAE si ARCA lo otorgó.
    try {
      await resultado(invoiceId, "processing", { env, numero: numero ?? undefined, error: "ARCA no confirmó la autorización. Reintentá en unos minutos: se recupera el mismo comprobante, no se emite otro." });
    } catch (persistError) {
      console.error("[fex] no se registró el estado", persistError);
    }
    if (e instanceof WsfexError && e.codigo > 0 && !ERRORES_TRANSITORIOS.has(e.codigo)) {
      return responder({ ok: false, status: "processing", error: `ARCA respondió ${e.codigo}: ${e.message}` }, desdeOutbox ? 503 : 422);
    }
    return responder({ ok: false, status: "processing", error: "ARCA no confirmó la autorización. Reintentá en unos minutos: se recupera el mismo comprobante, no se emite otro." }, 503);
  }
}

async function parametros(orgId: string): Promise<Response> {
  const { env, auth } = await conexion(orgId);
  const guardados: Record<string, number> = {};
  for (const tipo of ["paises", "cuit_paises", "incoterms", "monedas"] as ParametroFex[]) {
    const lista = leerParametroFex(await llamar(env, PARAMETROS_FEX[tipo].op, "", auth), tipo);
    const { error } = await supabase.from("arca_parametros_fex").upsert({ environment: env, tipo, datos: lista, actualizado_at: new Date().toISOString() });
    if (error) throw new Error(`No se guardaron los parámetros: ${error.message}`);
    guardados[tipo] = lista.length;
  }
  const puntos = leerParametroFex(await llamar(env, PARAMETROS_FEX.puntos_venta.op, "", auth), "puntos_venta");
  return responder({ ok: true, guardados, puntos_venta: puntos.map(p => ({ numero: Number(p.codigo), bloqueado: p.descripcion === "S" })) });
}

async function cotizacion(orgId: string, moneda: string, fecha: string | null): Promise<Response> {
  const { env, auth } = await conexion(orgId);
  const monId = monedaWsfe(moneda);
  if (monId === "PES") return responder({ ok: true, cotizacion: 1, fecha });
  const cuerpo = `<ar:Mon_id>${monId}</ar:Mon_id>` + (fecha ? `<ar:FchCotiz>${diaAnterior(fecha)}</ar:FchCotiz>` : "");
  return responder({ ok: true, ...leerCotizacionFex(await llamar(env, "FEXGetPARAM_Ctz", cuerpo, auth)) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return responder({ ok: false, error: "Método no permitido" }, 405);

  let body: { action?: string; invoice_id?: string; org_id?: string; moneda?: string; fecha?: string };
  try { body = await req.json(); } catch { return responder({ ok: false, error: "Pedido inválido" }, 400); }
  const uuid = (v: unknown) => /^[0-9a-f-]{36}$/i.test(String(v ?? ""));

  // El outbox fiscal sólo autoriza; lo reenvía afip-authorize con el secreto de cron.
  if (esLlamadaDeCron(req)) {
    if (body.action !== "autorizar" || !uuid(body.invoice_id)) return responder({ ok: false, error: "Pedido inválido" }, 400);
    return await autorizar(String(body.invoice_id), null);
  }

  const { user, response } = await requireUser(req, corsHeaders);
  if (response) return response;

  try {
    if (body.action === "autorizar") {
      if (!uuid(body.invoice_id)) return responder({ ok: false, error: "Falta la factura" }, 400);
      return await autorizar(String(body.invoice_id), user.id);
    }
    if (!uuid(body.org_id)) return responder({ ok: false, error: "Falta la organización" }, 400);
    const orgId = String(body.org_id);
    const { data: miembro } = await supabase.from("memberships").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
    if (!miembro) return responder({ ok: false, error: "No pertenecés a esta organización" }, 403);
    if (body.action === "parametros") {
      if (!["owner", "admin"].includes(String(miembro.role))) return responder({ ok: false, error: "Sólo el dueño o un administrador actualizan los datos de ARCA." }, 403);
      return await parametros(orgId);
    }
    if (body.action === "cotizacion") {
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha ?? "")) ? String(body.fecha) : null;
      return await cotizacion(orgId, String(body.moneda ?? ""), fecha);
    }
    return responder({ ok: false, error: "Acción desconocida" }, 400);
  } catch (e) {
    if (e instanceof ErrorDeConfiguracion) return responder({ ok: false, code: "configuracion", error: e.message });
    if (e instanceof WsfexError && e.codigo > 0) return responder({ ok: false, code: "arca_rechazo", error: `ARCA respondió ${e.codigo}: ${e.message}` });
    console.error("[fex] fallo", (e instanceof Error ? e.message : String(e)).slice(0, 300));
    return responder({ ok: false, code: "no_disponible", error: "ARCA no respondió. Probá de nuevo en unos minutos." });
  }
});
