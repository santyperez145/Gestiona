/**
 * arca-caea — CAEA de contingencia: facturar cuando ARCA no responde.
 *
 * El CAEA es un código por quincena que ARCA otorga por adelantado. Con él un
 * comprobante sale autorizado sin esperar el CAE, en un punto de venta
 * habilitado para CAEA, y después se le informa a ARCA uno por uno antes de la
 * fecha tope (FECAEARegInformativo). Si el punto de venta no tuvo movimiento
 * en la quincena, se informa eso (FECAEASinMovimientoInformar).
 *
 * Dos callers:
 *  - El cron (`x-cron-secret`), cada 6 horas: pide el CAEA de la quincena en
 *    curso y de la siguiente a los comercios con la contingencia habilitada,
 *    informa los comprobantes pendientes y los puntos de venta sin movimiento.
 *  - El panel, con la sesión de un dueño o administrador:
 *      { action: "solicitar", org_id }            pide el CAEA ya (al habilitar)
 *      { action: "emitir", org_id, invoice_id }   emite la factura con el CAEA
 *      { action: "informar", org_id }             reintenta los informes, también los rechazados
 *
 * ⚠️ Una factura con un pedido de CAE sin confirmar no se emite por CAEA: ese
 * CAE puede existir en ARCA y la venta tendría dos comprobantes. Lo impide
 * `afip_caea_emitir` en la base (migración 20261022000900), no esta función.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolverCredencialesAfip, type CredencialesAfip } from "../_shared/afipCredenciales.ts";
import { esLlamadaDeCron } from "../_shared/cronAuth.ts";
import { requireUser } from "../_shared/requireUser.ts";
import { clasificarRechazoWsaa } from "../_shared/certificadoArcaReglas.ts";
import { CREDIT_NOTE_TYPES, DEBIT_NOTE_TYPES, type AfipAssociatedVoucher } from "../_shared/afipAssociatedVoucher.ts";
import { FCE } from "../_shared/comprobantesArca.ts";
import { detalleWsfe, opcionalesFce, quincenaDe, quincenaSiguiente, type ComprobanteParaWsfe } from "../_shared/wsfeComprobante.ts";
import { leerCaeaWsfe, leerInformeCaeaWsfe, leerSinMovimientoWsfe, type CaeaWsfe, type MensajeWsfe } from "../_shared/wsfeRespuesta.ts";
import { ticketWsfe, wsfeCall, WSFE_URL, type Ambiente, type AuthWsfe } from "../_shared/wsfeSoap.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const responder = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const hoyArgentina = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const diasHasta = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);
const resumen = (m: MensajeWsfe[]) => m.map(x => `${x.code}: ${x.msg}`).join(" · ");
const ambienteDe = (cred: CredencialesAfip): Ambiente => (cred.environment === "produccion" ? "produccion" : "homologacion");

/** ARCA permite pedir el CAEA desde 5 días antes de que empiece la quincena. */
const DIAS_ANTES = 5;
/** Comprobantes por corrida y comercio: el cron vuelve en 6 horas. */
const LOTE = 50;

type Conexion = { url: string; auth: AuthWsfe };
// deno-lint-ignore no-explicit-any
type Factura = Record<string, any>;

async function credencialDe(orgId: string): Promise<CredencialesAfip> {
  const r = await resolverCredencialesAfip(supabase, orgId);
  if (!r.cred) throw new Error(r.error);
  return r.cred;
}

/** El ticket se pide recién cuando hay algo que mandarle a ARCA. */
function conexionPerezosa(orgId: string, cred: CredencialesAfip) {
  let c: Conexion | null = null;
  return async () => (c ??= { url: WSFE_URL[ambienteDe(cred)], auth: await ticketWsfe(supabase, cred, orgId) });
}

async function contingenciaDe(orgId: string) {
  const { data, error } = await supabase.from("afip_credentials")
    .select("contingencia_caea, punto_venta_caea, environment").eq("org_id", orgId).maybeSingle();
  if (error) throw new Error("No se pudo leer la configuración de contingencia");
  return {
    habilitada: Boolean(data?.contingencia_caea),
    puntoVenta: data?.punto_venta_caea as number | null,
    ambiente: (data?.environment === "produccion" ? "produccion" : "homologacion") as Ambiente,
  };
}

// ── Pedir el CAEA ────────────────────────────────────────────────────────────

async function pedirCaea(orgId: string, ambiente: Ambiente, c: Conexion, q: { periodo: number; orden: 1 | 2 }): Promise<CaeaWsfe> {
  const cuerpo = `<ar:Periodo>${q.periodo}</ar:Periodo><ar:Orden>${q.orden}</ar:Orden>`;
  const pedido = leerCaeaWsfe(await wsfeCall(c.url, "FECAEASolicitar", cuerpo, c.auth), "FECAEASolicitar");
  let caea = pedido.caea;
  if (!caea) {
    // Ya estaba otorgado (otra corrida, u otro sistema del comercio): se consulta.
    const consulta = leerCaeaWsfe(await wsfeCall(c.url, "FECAEAConsultar", cuerpo, c.auth), "FECAEAConsultar");
    caea = consulta.caea;
    if (!caea) throw new Error(resumen(pedido.errores) || resumen(consulta.errores) || "ARCA no otorgó el CAEA.");
  }
  const { error } = await supabase.from("afip_caea").upsert({
    org_id: orgId, environment: ambiente, periodo: caea.periodo, orden: caea.orden, caea: caea.caea,
    vig_desde: caea.vigDesde, vig_hasta: caea.vigHasta, tope_informe: caea.topeInforme, obtenido_at: new Date().toISOString(),
  }, { onConflict: "org_id,environment,periodo,orden" });
  if (error) throw new Error(`No se guardó el CAEA: ${error.message}`);
  return caea;
}

async function solicitar(orgId: string): Promise<CaeaWsfe[]> {
  const cred = await credencialDe(orgId);
  const ambiente = ambienteDe(cred);
  const hoy = hoyArgentina();
  const quincenas = [quincenaDe(hoy)];
  const siguiente = quincenaSiguiente(hoy);
  if (diasHasta(hoy, siguiente.desde) <= DIAS_ANTES) quincenas.push(siguiente);

  const { data: tengo, error } = await supabase.from("afip_caea").select("periodo, orden")
    .eq("org_id", orgId).eq("environment", ambiente).in("periodo", quincenas.map(q => q.periodo));
  if (error) throw new Error("No se pudieron leer los CAEA guardados");
  const faltan = quincenas.filter(q => !(tengo ?? []).some(t => t.periodo === q.periodo && Number(t.orden) === q.orden));

  const conexion = conexionPerezosa(orgId, cred);
  const obtenidos: CaeaWsfe[] = [];
  for (const q of faltan) obtenidos.push(await pedirCaea(orgId, ambiente, await conexion(), q));
  return obtenidos;
}

// ── Informar ─────────────────────────────────────────────────────────────────

async function asociadoDe(inv: Factura): Promise<AfipAssociatedVoucher | null> {
  const tipo = Number(inv.tipo_comprobante);
  const id = CREDIT_NOTE_TYPES.includes(tipo) ? inv.nota_credito_de : DEBIT_NOTE_TYPES.includes(tipo) ? inv.nota_debito_de : null;
  if (!id) return null;
  const { data, error } = await supabase.from("invoices")
    .select("tipo_comprobante, punto_venta, numero_afip, cae, afip_status, emisor_cuit, issue_date")
    .eq("id", id).eq("org_id", inv.org_id).maybeSingle();
  if (error) throw new Error("No se pudo leer la factura original de la nota");
  if (!data?.cae || data.afip_status !== "authorized") throw new Error("La factura original de la nota tiene que estar autorizada");
  return data;
}

async function detalleCaea(inv: Factura, caea: string, puntoVenta: number, numero: number, generado: Date): Promise<string> {
  const tipo = Number(inv.tipo_comprobante);
  return detalleWsfe({ ...inv, invoice_items: inv.invoice_items ?? [] } as ComprobanteParaWsfe, {
    puntoVenta, tipoCbte: tipo, numero, asociado: await asociadoDe(inv), opcionales: opcionalesFce(tipo, inv),
    caea: { codigo: caea, generado },
  });
}

type Informe = { informados: number; rechazados: number; pendientes: number };

async function informar(orgId: string, incluirRechazados: boolean): Promise<Informe> {
  let q = supabase.from("invoices").select("*, invoice_items(*)")
    .eq("org_id", orgId).eq("codigo_autorizacion_tipo", "A").not("cae", "is", null).is("caea_informado_at", null);
  if (!incluirRechazados) q = q.is("caea_informe_error", null);
  const { data: facturas, error } = await q.order("punto_venta").order("tipo_comprobante").order("numero_afip").limit(LOTE);
  if (error) throw new Error("No se pudieron leer los comprobantes a informar");
  const r: Informe = { informados: 0, rechazados: 0, pendientes: 0 };
  if (!facturas?.length) return r;

  const conexion = conexionPerezosa(orgId, await credencialDe(orgId));
  // ARCA controla la numeración correlativa: si un comprobante de la serie no
  // se pudo informar, los siguientes esperan a la próxima corrida.
  const trabadas = new Set<string>();
  for (const inv of facturas as Factura[]) {
    const serie = `${inv.punto_venta}:${inv.tipo_comprobante}`;
    if (trabadas.has(serie)) { r.pendientes++; continue; }
    let detalle: string;
    try {
      detalle = await detalleCaea(inv, String(inv.cae), Number(inv.punto_venta), Number(inv.numero_afip),
        new Date(inv.afip_authorization_started_at ?? inv.updated_at));
    } catch (e) {
      await marcar(inv.id, false, e instanceof Error ? e.message : String(e));
      r.rechazados++; trabadas.add(serie); continue;
    }
    const cuerpo = `<ar:FeCAEARegInfReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${inv.punto_venta}</ar:PtoVta>` +
      `<ar:CbteTipo>${inv.tipo_comprobante}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq>${detalle}</ar:FeDetReq></ar:FeCAEARegInfReq>`;
    let c: Conexion;
    try {
      c = await conexion();
    } catch (e) {
      // Sin ticket no se puede informar nada: el resto espera a la próxima
      // corrida en vez de pedirle a WSAA un ticket por comprobante.
      console.error("[caea] sin ticket para informar", (e instanceof Error ? e.message : String(e)).slice(0, 200));
      r.pendientes += facturas.length - (r.informados + r.rechazados + r.pendientes);
      break;
    }
    try {
      const resp = leerInformeCaeaWsfe(await wsfeCall(c.url, "FECAEARegInformativo", cuerpo, c.auth));
      if (resp.resultado === "A" && !resp.errores.length) {
        await marcar(inv.id, true, null); r.informados++;
      } else if (resp.resultado === "R" || resp.errores.length) {
        await marcar(inv.id, false, resumen([...resp.errores, ...resp.observaciones]) || "ARCA rechazó el informe");
        r.rechazados++; trabadas.add(serie);
      } else {
        r.pendientes++; trabadas.add(serie);
      }
    } catch (e) {
      // Sin respuesta de ARCA: queda pendiente y se reintenta, no es un rechazo.
      console.error("[caea] informe sin respuesta", { invoice: inv.id, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
      r.pendientes++; trabadas.add(serie);
    }
  }
  return r;
}

async function marcar(invoiceId: string, ok: boolean, detalle: string | null) {
  const { error } = await supabase.rpc("afip_caea_informado", { p_invoice_id: invoiceId, p_ok: ok, p_detalle: detalle });
  if (error) console.error("[caea] no se registró el informe", { invoice: invoiceId, error: error.message });
}

/** Quincenas terminadas en las que el punto de venta CAEA no emitió nada. */
async function informarSinMovimiento(orgId: string): Promise<number> {
  const hoy = hoyArgentina();
  const { data: vencidos, error } = await supabase.from("afip_caea").select("*")
    .eq("org_id", orgId).is("sin_movimiento_informado_at", null).lt("vig_hasta", hoy).gte("tope_informe", hoy);
  if (error) throw new Error("No se pudieron leer los CAEA vencidos");
  if (!vencidos?.length) return 0;
  const { puntoVenta } = await contingenciaDe(orgId);
  if (!puntoVenta) return 0;

  const conexion = conexionPerezosa(orgId, await credencialDe(orgId));
  let informados = 0;
  for (const caea of vencidos) {
    const { count, error: e } = await supabase.from("invoices").select("id", { count: "exact", head: true })
      .eq("org_id", orgId).eq("codigo_autorizacion_tipo", "A").eq("cae", caea.caea).eq("punto_venta", puntoVenta);
    if (e || (count ?? 0) > 0) continue;
    const c = await conexion();
    const resp = leerSinMovimientoWsfe(await wsfeCall(c.url, "FECAEASinMovimientoInformar",
      `<ar:PtoVta>${puntoVenta}</ar:PtoVta><ar:CAEA>${caea.caea}</ar:CAEA>`, c.auth));
    if (resp.resultado === "A") {
      const { error: u } = await supabase.from("afip_caea").update({ sin_movimiento_informado_at: new Date().toISOString() })
        .eq("org_id", orgId).eq("environment", caea.environment).eq("periodo", caea.periodo).eq("orden", caea.orden);
      if (u) console.error("[caea] no se registró el sin movimiento", u.message);
      else informados++;
    } else {
      console.error("[caea] sin movimiento rechazado", { org: orgId, caea: caea.caea, errores: resumen(resp.errores) });
    }
  }
  return informados;
}

// ── Emitir ───────────────────────────────────────────────────────────────────

const MENSAJES_EMISION: Array<[RegExp, string]> = [
  [/pedido de CAE sin confirmar/i, "Esta factura tiene un pedido de CAE que ARCA todavía no confirmó. Esperá la verificación: si el CAE existe, emitirla en contingencia duplicaría el comprobante."],
  [/autorizacion en curso/i, "La factura se está autorizando en este momento. Esperá unos minutos."],
  [/no esta habilitada/i, "La contingencia CAEA no está habilitada. Activala en ARCA → Contingencia."],
  [/No hay un CAEA vigente/i, "No hay un CAEA vigente para la fecha de la factura. Nerqia lo pide antes de cada quincena; si recién activaste la contingencia, tocá «Pedir CAEA ahora»."],
  [/no es fiscal/i, "Este comprobante no es una factura fiscal."],
  [/Credito MiPyME/i, "La Factura de Crédito MiPyME no se emite en contingencia."],
  [/dueno o un administrador/i, "Sólo el dueño o un administrador pueden emitir en contingencia."],
];

const mensajeDeEmision = (m: string) => MENSAJES_EMISION.find(([re]) => re.test(m))?.[1] ?? "No se pudo emitir en contingencia. Probá de nuevo.";

async function emitir(orgId: string, invoiceId: string, userId: string) {
  const { data: inv, error } = await supabase.from("invoices").select("*, invoice_items(*)").eq("id", invoiceId).maybeSingle();
  if (error) return responder({ ok: false, error: "No se pudo leer la factura. Probá de nuevo." });
  if (!inv || inv.org_id !== orgId) return responder({ ok: false, error: "Factura no encontrada" }, 404);
  if (inv.cae) return responder({ ok: true, status: "authorized", idempotent: true, numero_afip: inv.numero_afip, punto_venta: inv.punto_venta });
  const tipo = Number(inv.tipo_comprobante);
  if (!tipo) return responder({ ok: false, error: mensajeDeEmision("no es fiscal") });
  if (FCE.has(tipo)) return responder({ ok: false, error: mensajeDeEmision("Credito MiPyME") });

  // Validar el comprobante completo antes de numerarlo: lo que ARCA rechazaría
  // al informarlo, mejor saberlo ahora que con la factura entregada.
  const { habilitada, puntoVenta, ambiente } = await contingenciaDe(orgId);
  if (!habilitada || !puntoVenta) return responder({ ok: false, error: mensajeDeEmision("no esta habilitada") });
  const { data: vigente } = await supabase.from("afip_caea").select("caea")
    .eq("org_id", orgId).eq("environment", ambiente)
    .lte("vig_desde", inv.issue_date).gte("vig_hasta", inv.issue_date).maybeSingle();
  if (!vigente?.caea) return responder({ ok: false, error: mensajeDeEmision("No hay un CAEA vigente") });
  try {
    await detalleCaea(inv, vigente.caea, puntoVenta, 1, new Date());
  } catch (e) {
    return responder({ ok: false, code: "comprobante_invalido", error: e instanceof Error ? e.message : String(e) });
  }

  const { data: emitida, error: rpcError } = await supabase.rpc("afip_caea_emitir", { p_invoice_id: invoiceId, p_requested_by: userId });
  if (rpcError) {
    console.error("[caea] emisión rechazada", rpcError.message);
    return responder({ ok: false, error: mensajeDeEmision(rpcError.message) }, rpcError.code === "42501" ? 403 : 200);
  }

  // Se intenta informar ya; si ARCA sigue sin responder, lo hace el cron.
  try {
    await informar(orgId, false);
  } catch (e) {
    console.error("[caea] informe inmediato no disponible", (e instanceof Error ? e.message : String(e)).slice(0, 200));
  }
  const { data: despues } = await supabase.from("invoices").select("caea_informado_at").eq("id", invoiceId).maybeSingle();
  return responder({ ...(emitida as Record<string, unknown>), informada: Boolean(despues?.caea_informado_at) });
}

// ── Entrada ──────────────────────────────────────────────────────────────────

async function ciclo() {
  const hoy = hoyArgentina();
  const [habilitadas, conCaea, pendientes] = await Promise.all([
    supabase.from("afip_credentials").select("org_id").eq("contingencia_caea", true),
    supabase.from("afip_caea").select("org_id").is("sin_movimiento_informado_at", null).lt("vig_hasta", hoy).gte("tope_informe", hoy),
    supabase.from("invoices").select("org_id").eq("codigo_autorizacion_tipo", "A").not("cae", "is", null)
      .is("caea_informado_at", null).is("caea_informe_error", null).limit(1000),
  ]);
  for (const r of [habilitadas, conCaea, pendientes]) if (r.error) throw new Error(r.error.message);
  const conContingencia = new Set((habilitadas.data ?? []).map(r => r.org_id as string));
  const orgs = new Set([...conContingencia, ...(conCaea.data ?? []).map(r => r.org_id as string), ...(pendientes.data ?? []).map(r => r.org_id as string)]);

  const resultado: Record<string, unknown> = {};
  for (const orgId of orgs) {
    const fila: Record<string, unknown> = {};
    // Cada paso por separado: que ARCA no otorgue un CAEA no frena los informes.
    if (conContingencia.has(orgId)) {
      try { fila.caea_obtenidos = (await solicitar(orgId)).length; } catch (e) { fila.error_caea = String(e instanceof Error ? e.message : e).slice(0, 200); }
    }
    try { Object.assign(fila, await informar(orgId, false)); } catch (e) { fila.error_informe = String(e instanceof Error ? e.message : e).slice(0, 200); }
    try { fila.sin_movimiento = await informarSinMovimiento(orgId); } catch (e) { fila.error_sin_movimiento = String(e instanceof Error ? e.message : e).slice(0, 200); }
    resultado[orgId] = fila;
  }
  return { ok: true, comercios: orgs.size, resultado };
}

function errorArca(e: unknown) {
  const mensaje = e instanceof Error ? e.message : String(e);
  console.error("[caea] fallo", mensaje.slice(0, 300));
  const tipo = clasificarRechazoWsaa(mensaje);
  if (tipo === "no_asociado") return responder({ ok: false, code: "servicio_no_asociado", error: "El certificado no está asociado a la facturación electrónica en ARCA." });
  if (tipo === "ticket_vigente") return responder({ ok: false, code: "ticket_vigente", error: "ARCA ya tiene una sesión abierta con este certificado. Probá de nuevo en unos minutos." });
  return responder({ ok: false, code: "no_disponible", error: /^\d+: /.test(mensaje) ? `ARCA respondió: ${mensaje}` : "ARCA no respondió. Probá de nuevo en unos minutos." });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return responder({ ok: false, error: "Método no permitido" }, 405);

  if (esLlamadaDeCron(req)) {
    try { return responder(await ciclo()); } catch (e) { return errorArca(e); }
  }

  const { user, response } = await requireUser(req, corsHeaders);
  if (response) return response;

  let body: { action?: string; org_id?: string; invoice_id?: string };
  try { body = await req.json(); } catch { return responder({ ok: false, error: "Pedido inválido" }, 400); }
  const orgId = String(body.org_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return responder({ ok: false, error: "Falta la organización" }, 400);

  const { data: miembro, error: miembroError } = await supabase.from("memberships").select("role")
    .eq("org_id", orgId).eq("user_id", user.id).in("role", ["owner", "admin"]).maybeSingle();
  if (miembroError) return responder({ ok: false, error: "No se pudo verificar tu rol. Probá de nuevo." });
  if (!miembro) return responder({ ok: false, error: "Sólo el dueño o un administrador manejan la contingencia." }, 403);

  try {
    switch (body.action) {
      case "solicitar": {
        const { habilitada } = await contingenciaDe(orgId);
        if (!habilitada) return responder({ ok: false, error: mensajeDeEmision("no esta habilitada") });
        return responder({ ok: true, obtenidos: await solicitar(orgId) });
      }
      case "emitir": {
        const invoiceId = String(body.invoice_id ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return responder({ ok: false, error: "Falta la factura" }, 400);
        return await emitir(orgId, invoiceId, user.id);
      }
      case "informar": {
        const r = await informar(orgId, true);
        return responder({ ok: true, ...r, sin_movimiento: await informarSinMovimiento(orgId) });
      }
      default:
        return responder({ ok: false, error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    return errorArca(e);
  }
});
