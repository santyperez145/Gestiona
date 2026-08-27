/**
 * afip-authorize — Facturación Electrónica Argentina (AFIP WSFE)
 *
 * Flow:
 *   1. Load org AFIP credentials from `afip_credentials`
 *   2. Obtain / reuse Ticket de Acceso (WSAA)
 *   3. Get last authorized invoice number (FECompUltimoAutorizado)
 *   4. Request CAE (FECAESolicitar)
 *   5. Persist CAE + numero_afip on the invoice record
 *
 * Environments:
 *   homologacion → wsaahomo / wswhomo (testing)
 *   produccion   → wsaa    / servicios1 (live)
 *
 * Las credenciales viven en `afip_credentials`, una tabla con RLS y **cero
 * policies**: sólo se llega con `service_role`, o sea desde acá. Antes estaban
 * en `settings`, que tiene una policy SELECT para todos los miembros de la
 * organización — y RLS es a nivel de fila, no de columna, así que cualquier
 * empleado podía leer la clave privada con la que se firman las facturas.
 *
 * Campos: cuit, certificate (PEM), private_key (PEM), punto_venta,
 * environment, tipo_emisor.
 */

// @ts-ignore
import forge from "https://esm.sh/node-forge@1.3.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolverCredencialesAfip, guardarTicketAcceso } from "../_shared/afipCredenciales.ts";
import {
  extraerXml as extractXml, motivoDeWsaa, leerTicketWsaa,
} from "../_shared/wsaaRespuesta.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/**
 * Deja constancia de la verificación, y **avisa si no pudo**.
 *
 * Un `supabase.rpc()` que no mira `.error` convierte «no se guardó» en «listo».
 * Es la regla de CLAUDE.md —no tragarse errores— y acá costó una tarde:
 * `afip_marcar_delegacion` escribía `last_error`, la columna no existía, y
 * `verificar_delegacion` respondía `ok: true` sobre un UPDATE que había
 * fallado.
 */
async function marcarDelegacion(orgId: string, okDelegacion: boolean, detalle: string | null) {
  const { error } = await supabase.rpc("afip_marcar_delegacion", {
    p_org: orgId, p_ok: okDelegacion, p_detalle: detalle,
  });
  if (error) console.error("afip_marcar_delegacion falló:", error);
  return { error: error?.message ?? null };
}

/**
 * Guarda el Ticket de Acceso sin poder perderlo.
 *
 * ⚠️ Antes, si el guardado fallaba se lanzaba «No se pudo guardar el Ticket de
 * Acceso». Pero para ese momento **ARCA ya lo emitió**, y no entrega otro para
 * el mismo certificado hasta que venza (~12 h). O sea que un error de escritura
 * dejaba al comercio sin poder facturar durante medio día, con un mensaje que
 * suena a problema de configuración.
 *
 * Ahora el fallo se registra y la llamada sigue con el ticket que ya tiene en
 * memoria: se pierde el reuso, no la sesión.
 */
// deno-lint-ignore no-explicit-any
async function guardarTicketSinPerderlo(cred: any, orgId: string, ta: any) {
  try {
    const r = await guardarTicketAcceso(supabase, cred, orgId, ta);
    if (r?.error) console.error("No se pudo guardar el Ticket de Acceso:", r.error);
  } catch (e) {
    console.error("No se pudo guardar el Ticket de Acceso:", e);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let invoiceId: string | null = null;
  let authorizationReserved = false;
  let providerResult: { cae: string; caeVencimiento: string } | null = null;
  let providerNumber: number | null = null;
  let providerEnvironment: string | null = null;
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/, "").trim();
    const { data: userData } = await supabase.auth.getUser(token);
    if (!userData?.user) return err("Unauthorized", 401);

    const body = await req.json().catch(() => ({})) as {
      action?: string;
      invoice_id?: string;
      org_id?: string;
    };

    // Una prueba de conexión real sólo pide un Ticket de Acceso a WSAA. No
    // crea una factura, no inventa un CAE y confirma que el certificado está
    // asociado al servicio wsfe del ambiente elegido.
    // ── Verificar la delegación ──────────────────────────────────────────
    //
    // `test_connection` prueba el CERTIFICADO: que WSAA entregue un Ticket de
    // Acceso. Eso no dice nada sobre si este comercio delegó `wsfe` a la
    // plataforma — el TA es por certificado y servicio, y **no menciona ningún
    // CUIT**.
    //
    // La delegación recién se ejerce al usar el CUIT del comercio en el
    // `<Auth>` de una llamada WSFE. Por eso acá se consulta
    // `FECompUltimoAutorizado`: es de sólo lectura, no crea nada, y falla si la
    // delegación no existe. Es la prueba más barata que sí prueba lo que dice.
    if (body.action === "verificar_delegacion") {
      if (!body.org_id) return err("org_id required");

      const { data: membership } = await supabase
        .from("memberships").select("role")
        .eq("org_id", body.org_id).eq("user_id", userData.user.id)
        .in("role", ["owner", "admin"]).maybeSingle();
      if (!membership) return err("Sólo el dueño o un administrador pueden verificar", 403);

      const resuelto = await resolverCredencialesAfip(supabase, body.org_id);
      if (resuelto.error) return err(resuelto.error);
      const cred = resuelto.cred;
      if (!cred) return err("No se pudo resolver la credencial de ARCA");

      const isProd = cred.environment === "produccion";
      const wsaaUrl = isProd
        ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
        : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
      const wsfeUrl = isProd
        ? "https://servicios1.afip.gov.ar/wsfev1/service.asmx"
        : "https://wswhomo.afip.gov.ar/wsfev1/service.asmx";

      // El TA vigente se reusa. WSAA rechaza pedir otro mientras el anterior
      // viva, y con certificado compartido eso choca apenas haya dos comercios
      // verificando el mismo día.
      const taExpira = cred.ta_expires_at ? new Date(cred.ta_expires_at) : null;
      const taVigente = taExpira && taExpira > new Date(Date.now() + 5 * 60 * 1000);

      let token = cred.ta_token, sign = cred.ta_sign;
      if (!taVigente || !token || !sign) {
        const ta = await getTicketAcceso(wsaaUrl, cred.certificate, cred.private_key);
        await guardarTicketSinPerderlo(cred, body.org_id, ta);
        token = ta.token; sign = ta.sign;
      }

      try {
        // Tipo 11 (Factura C) alcanza: lo que se prueba es que ARCA acepte el
        // CUIT, no el tipo de comprobante.
        await getUltimoAutorizado(
          wsfeUrl, token!, sign!, cred.cuit, cred.punto_venta ?? 1, 11);
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e);
        await marcarDelegacion(body.org_id, false, detalle);
        // Se devuelve lo que dijo ARCA, no un genérico. "El CUIT no está
        // autorizado" y "el punto de venta no existe" mandan a lugares
        // distintos, y confundirlos hace perder una tarde.
        return ok({ ok: false, error: detalle });
      }

      // ⚠️ Este resultado SÍ se mira. Antes era un `rpc` sin `.error`, y la
      // función escribía una columna que no existía: el UPDATE fallaba con
      // 42703, el fallo se tragaba y esto devolvía `ok: true` igual. ARCA había
      // aceptado de verdad, pero el panel seguía diciendo «falta conectar»
      // después de recargar, porque no había quedado constancia de nada.
      const marcado = await marcarDelegacion(body.org_id, true, null);
      if (marcado.error) {
        return ok({
          ok: false,
          error: "ARCA aceptó la conexión pero no se pudo guardar el resultado: "
            + marcado.error + ". Es un problema del lado de Gestiona.",
        });
      }
      return ok({ ok: true, environment: isProd ? "produccion" : "homologacion" });
    }

    if (body.action === "test_connection") {
      if (!body.org_id) return err("org_id required");

      const { data: membership } = await supabase
        .from("memberships")
        .select("role")
        .eq("org_id", body.org_id)
        .eq("user_id", userData.user.id)
        .in("role", ["owner", "admin"])
        .maybeSingle();
      if (!membership) return err("Sólo el dueño o un administrador pueden probar AFIP", 403);

      // C14: puede ser el certificado del comercio o el de la plataforma. La
      // decisión vive en un solo lugar, no repartida entre los dos caminos.
      const resuelto = await resolverCredencialesAfip(supabase, body.org_id);
      if (resuelto.error) return err(resuelto.error);
      const cred = resuelto.cred;
      if (!cred) return err("No se pudo resolver la credencial de ARCA");

      const isProd = cred.environment === "produccion";
      const wsaaUrl = isProd
        ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
        : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";

      // ⚠️ **Si ya hay un Ticket de Acceso vigente, se reusa y no se pide otro.**
      //
      // WSAA entrega un ticket por servicio y por unas 12 horas, y **rechaza el
      // pedido siguiente mientras el anterior siga vivo** ("El CEE ya posee un
      // TA valido para el acceso al WSN solicitado").
      //
      // La versión anterior pedía uno nuevo siempre. Consecuencia: la primera
      // prueba andaba y **la segunda fallaba**, con un error que suena a
      // credencial rota cuando en realidad la conexión estaba perfecta. Un
      // botón de diagnóstico que miente sobre el estado es peor que no tenerlo:
      // manda a revisar el certificado, que es lo único que no estaba mal.
      //
      // El camino de facturación ya hacía esto bien; el de prueba no.
      const taExpira = cred.ta_expires_at ? new Date(cred.ta_expires_at) : null;
      const taVigente = taExpira && taExpira > new Date(Date.now() + 5 * 60 * 1000);

      if (taVigente && cred.ta_token && cred.ta_sign) {
        return ok({
          ok: true,
          environment: isProd ? "produccion" : "homologacion",
          ticket_expires_at: cred.ta_expires_at,
          modo: cred.modo,
          reusado: true,
        });
      }

      const ta = await getTicketAcceso(wsaaUrl, cred.certificate, cred.private_key);

      // WSAA rechaza pedidos repetidos; conservar el ticket obtenido en la
      // prueba hace que la primera factura reutilice exactamente esa sesión.
      // En modo delegado se guarda en la fila de la plataforma, porque el TA es
      // uno solo para todos los comercios que comparten el certificado.
      await guardarTicketSinPerderlo(cred, body.org_id, ta);

      return ok({
        ok: true,
        environment: isProd ? "produccion" : "homologacion",
        ticket_expires_at: ta.expiresAt,
        modo: cred.modo,
      });
    }

    invoiceId = typeof body.invoice_id === "string" ? body.invoice_id : null;
    if (!invoiceId) return err("invoice_id required");

    // Load invoice
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) return err("Factura no encontrada");
    if (invoice.cae) {
      return ok({
        ok: true,
        status: "authorized",
        idempotent: true,
        cae: invoice.cae,
        cae_vencimiento: invoice.cae_vencimiento,
        numero_afip: invoice.numero_afip,
        environment: invoice.afip_environment,
      });
    }

    // Verify the same write role that the server-side reservation enforces.
    const { data: membership } = await supabase
      .from("memberships")
      .select("role")
      .eq("org_id", invoice.org_id)
      .eq("user_id", userData.user.id)
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (!membership) return err("Sólo el dueño o un administrador pueden autorizar facturas", 403);

    const resuelto = await resolverCredencialesAfip(supabase, invoice.org_id);
    if (resuelto.error) return err(resuelto.error);
    const cred = resuelto.cred;
    if (!cred) return err("No se pudo resolver la credencial de ARCA");

    const isProd = cred.environment === "produccion";
    const wsaaUrl = isProd
      ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
      : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
    const wsfeUrl = isProd
      ? "https://servicios1.afip.gov.ar/wsfev1/service.asmx"
      : "https://wswhomo.afip.gov.ar/wsfev1/service.asmx";

    const puntoVenta = cred.punto_venta || 1;
    const tipoCbte = invoice.tipo_comprobante || defaultTipoCbte(cred.tipo_emisor ?? "");
    providerEnvironment = isProd ? "produccion" : "homologacion";

    // FECompUltimoAutorizado is scoped by point of sale + receipt type. The
    // reservation is server-side and rechecks the role because this client
    // deliberately uses service_role to reach protected AFIP credentials.
    const { data: reservation, error: reservationError } = await supabase.rpc(
      "afip_autorizacion_reservar",
      {
        p_invoice_id: invoiceId,
        p_requested_by: userData.user.id,
        p_punto_venta: puntoVenta,
        p_tipo_cbte: tipoCbte,
        p_environment: providerEnvironment,
      },
    );
    if (reservationError) throw new Error("No se pudo reservar la autorización AFIP");

    const reserva = reservation as {
      status?: string;
      acquired?: boolean;
      [key: string]: unknown;
    } | null;
    if (reserva?.status === "authorized") return ok(reserva);
    if (!reserva?.acquired) {
      return ok({
        ok: true,
        status: "processing",
        message: "La factura ya tiene una autorización AFIP en curso. Esperá la verificación antes de reintentar.",
      }, 202);
    }
    authorizationReserved = true;

    // ── Step 1: Get / refresh Ticket de Acceso ────────────────
    let token_ta: string;
    let sign_ta: string;

    const taExpires = cred.ta_expires_at ? new Date(cred.ta_expires_at) : null;
    const taStillValid = taExpires && taExpires > new Date(Date.now() + 5 * 60 * 1000);

    if (taStillValid && cred.ta_token && cred.ta_sign) {
      token_ta = cred.ta_token;
      sign_ta = cred.ta_sign;
    } else {
      const ta = await getTicketAcceso(wsaaUrl, cred.certificate, cred.private_key);
      token_ta = ta.token;
      sign_ta = ta.sign;

      // El ticket dura 12 h; se guarda para no pedir uno por factura. WSAA
      // rechaza pedidos repetidos en poco tiempo, así que reusarlo no es sólo
      // una optimización. En modo delegado va a la fila de la plataforma: el TA
      // es del certificado, y el certificado es uno para todos.
      await guardarTicketSinPerderlo(cred, invoice.org_id, ta);
    }

    const cuit = String(cred.cuit).replace(/[-\s]/g, "");

    // ── Step 2: Get last authorized number ───────────────────
    const lastNumber = await getUltimoAutorizado(
      wsfeUrl, token_ta, sign_ta, cuit, puntoVenta, tipoCbte,
    );
    const nextNumber = lastNumber + 1;
    providerNumber = nextNumber;

    // ── Step 3: Request CAE ───────────────────────────────────
    const { cae, caeVencimiento } = await solicitarCAE({
      wsfeUrl,
      token: token_ta,
      sign: sign_ta,
      cuit,
      puntoVenta,
      tipoCbte,
      numero: nextNumber,
      invoice,
    });
    providerResult = { cae, caeVencimiento };

    // ── Step 4: Persist on invoice ────────────────────────────
    const { data: finalized, error: finalizeError } = await supabase.rpc(
      "afip_autorizacion_resultado",
      {
        p_invoice_id: invoiceId,
        p_status: "authorized",
        p_cae: cae,
        p_cae_vencimiento: caeVencimiento || null,
        p_numero_afip: nextNumber,
        p_environment: providerEnvironment,
        p_error: null,
      },
    );
    if (finalizeError) throw new Error("ARCA otorgó el CAE, pero no se pudo registrar la autorización");

    return ok(finalized || {
      ok: true,
      status: "authorized",
      cae,
      cae_vencimiento: caeVencimiento,
      numero_afip: nextNumber,
      environment: providerEnvironment,
    });
  } catch (e: any) {
    console.error("afip-authorize error:", e);

    // Classify error for better UX messages
    const msg: string = e.message || "Error interno";
    let userMsg = msg;
    let afipStatus = "error";

    if (msg.includes("AFIP rechazó") || msg.includes("Resultado") || msg.includes("ErrMsg")) {
      afipStatus = "rejected";
      userMsg = `AFIP rechazó la factura: ${msg}`;
    } else if (msg.includes("ARCA") || msg.includes("certificado") || msg.includes("Ticket de Acceso")) {
      // `motivoDeWsaa` ya devuelve una frase accionable y en castellano: se
      // pasa tal cual.
      //
      // ⚠️ Acá se le agregaba «Verificá el certificado y la clave privada en
      // Ajustes», y desde el 2026-08-27 eso manda a un lugar que no existe:
      // el comercio no sube certificados. El de la plataforma se administra en
      // /platform/afip y el suyo tampoco lo toca desde el panel.
      afipStatus = "config_error";
      userMsg = msg;
    } else if (msg.includes("certificate") || msg.includes("private key") || msg.includes("WSAA")) {
      afipStatus = "config_error";
      userMsg = `Error de credenciales AFIP: ${msg}`;
    } else if (msg.includes("HTTP 5") || msg.includes("timeout") || msg.includes("fetch")) {
      afipStatus = "network_error";
      userMsg = `Error de conexión con AFIP: ${msg}. Intentá de nuevo en unos minutos.`;
    } else if (msg.includes("Factura A requiere CUIT")) {
      afipStatus = "validation_error";
      userMsg = msg;
    }

    // Persist through the same guarded transition as the success path. A
    // timeout stays `processing`: the provider may have accepted the request
    // even though this invocation never received its response.
    if (invoiceId && authorizationReserved) {
      try {
        const persistStatus = providerResult
          ? "authorized"
          : afipStatus === "network_error" ? "processing" : afipStatus;
        const { data: persisted, error: persistError } = await supabase.rpc(
          "afip_autorizacion_resultado",
          {
            p_invoice_id: invoiceId,
            p_status: persistStatus,
            p_cae: providerResult?.cae || null,
            p_cae_vencimiento: providerResult?.caeVencimiento || null,
            p_numero_afip: providerNumber,
            p_environment: providerEnvironment,
            p_error: userMsg,
          },
        );
        if (persistError) console.error("afip authorization state persistence error:", persistError);
        if (!persistError && providerResult && persisted) return ok(persisted);
      } catch (persistException) {
        console.error("afip authorization state persistence exception:", persistException);
      }
    }

    return err(userMsg, afipStatus === "network_error" ? 503 : 422);
  }
});

// ─────────────────────────────────────────────────────────────
// WSAA — Ticket de Acceso
// ─────────────────────────────────────────────────────────────
async function getTicketAcceso(
  wsaaUrl: string,
  certPem: string,
  keyPem: string,
): Promise<{ token: string; sign: string; expiresAt: string }> {
  const now = new Date();

  // ⚠️ `toISOString()` devuelve UTC. Escribir esa hora y firmarla con el
  // sufijo `-03:00` declara la hora UTC como si fuera hora argentina, o sea
  // **tres horas en el futuro**. ARCA valida la ventana del TRA contra su
  // propio reloj, así que se convierte el instante a hora argentina antes de
  // formatear.
  const ART = 3 * 3600_000;
  const enArgentina = (t: number) => new Date(t - ART).toISOString().slice(0, 19) + "-03:00";

  const gen = new Date(now.getTime() - 60_000);
  const exp = new Date(now.getTime() + 12 * 3600_000);

  const loginTicketXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    "  <header>",
    `    <uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>`,
    `    <generationTime>${enArgentina(gen.getTime())}</generationTime>`,
    `    <expirationTime>${enArgentina(exp.getTime())}</expirationTime>`,
    "  </header>",
    "  <service>wsfe</service>",
    "</loginTicketRequest>",
  ].join("\n");

  // Build PKCS7 / CMS signed message
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(loginTicketXml, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: now },
    ],
  });
  p7.sign();

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const cms = forge.util.encode64(der);

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <LoginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">
      <in0>${cms}</in0>
    </LoginCms>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  const resp = await fetch(wsaaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '""',
    },
    body: soapBody,
    signal: AbortSignal.timeout(30_000),
  });

  const xml = await resp.text();
  // El XML completo va al log de la función, donde sí sirve para diagnosticar.
  // A la pantalla va el motivo, que es lo que el comercio puede accionar.
  if (!resp.ok) {
    console.error("WSAA fault", resp.status, xml);
    throw new Error(motivoDeWsaa(xml));
  }

  // El parseo vive en `_shared/wsaaRespuesta.ts`, con test: el ticket viene
  // adentro de `loginCmsReturn` y escapado, y leerlo mal hacía que una
  // respuesta CORRECTA de ARCA se mostrara como si ARCA hubiera fallado.
  const ticket = leerTicketWsaa(xml);
  if (ticket.error || !ticket.token || !ticket.sign) {
    console.error("WSAA sin token/sign", xml);
    throw new Error(ticket.error || motivoDeWsaa(xml));
  }

  // La vigencia la decide ARCA. Si no la informó, se usa la calculada.
  return { token: ticket.token, sign: ticket.sign, expiresAt: ticket.expiresAt || exp.toISOString() };
}

// ─────────────────────────────────────────────────────────────
// WSFE — Último número autorizado
// ─────────────────────────────────────────────────────────────
async function getUltimoAutorizado(
  wsfeUrl: string,
  token: string,
  sign: string,
  cuit: string,
  puntoVenta: number,
  tipoCbte: number,
): Promise<number> {
  const soap = wsfeSoap(
    "FECompUltimoAutorizado",
    `<ar:PtoVta>${puntoVenta}</ar:PtoVta><ar:CbteTipo>${tipoCbte}</ar:CbteTipo>`,
    { token, sign, cuit },
  );

  const xml = await wsfeCall(wsfeUrl, soap, "FECompUltimoAutorizado");
  const nro = extractXml(xml, "CbteNro");
  return nro ? parseInt(nro) : 0;
}

// ─────────────────────────────────────────────────────────────
// WSFE — Solicitar CAE
// ─────────────────────────────────────────────────────────────
async function solicitarCAE(args: {
  wsfeUrl: string;
  token: string;
  sign: string;
  cuit: string;
  puntoVenta: number;
  tipoCbte: number;
  numero: number;
  invoice: any;
}): Promise<{ cae: string; caeVencimiento: string }> {
  const { wsfeUrl, token, sign, cuit, puntoVenta, tipoCbte, numero, invoice } = args;

  const fecha = invoice.issue_date.replace(/-/g, "");
  const total = round2(Number(invoice.total));

  // ⚠️ **Un comprobante clase C no lleva IVA discriminado.** ARCA lo rechaza:
  //
  //   10047: El campo ImpIVA para comprobantes tipo C debe ser igual a cero
  //   10048: ImpTotal debe ser igual a la suma de ImpNeto + ImpTrib
  //
  // Un monotributista o un exento emiten C, y para ARCA el total ES el neto —
  // la descomposición "subtotal + IVA" no significa nada ahí. No se está
  // ocultando un impuesto: se está representando lo que la clase C es.
  //
  // Verificado emitiendo contra homologación: con IVA la rechaza, sin IVA
  // devuelve CAE.
  const esClaseC = tipoCbte === 11 || tipoCbte === 12 || tipoCbte === 13;

  const subtotal = esClaseC ? total : round2(Number(invoice.subtotal));
  const ivaImporte = esClaseC ? 0 : round2(Number(invoice.tax_amount));
  const ivaPct = esClaseC ? 0 : (Number(invoice.tax_pct) || 0);

  if (esClaseC && round2(Number(invoice.tax_amount)) > 0) {
    // No se corta la emisión —la factura es correcta igual— pero que una C
    // traiga IVA cargado significa que algo aguas arriba lo calculó mal.
    console.warn(
      `Factura ${invoice.number}: es clase C y trae IVA ${invoice.tax_amount}. ` +
      `Se emite con ImpIVA 0, que es lo que corresponde. Revisar quién lo calculó.`,
    );
  }

  // Determine IVA aliquot ID: 3=0%, 4=10.5%, 5=21%, 6=27%
  const ivaId = ivaPct === 21 ? 5 : ivaPct === 10.5 ? 4 : ivaPct === 27 ? 6 : 3;

  // Determine DocTipo / DocNro
  const taxId = (invoice.customer_tax_id || "").replace(/[-\s]/g, "");
  let docTipo = 99; // Consumidor Final
  let docNro = 0;
  if (taxId.length === 11) { docTipo = 80; docNro = parseInt(taxId); } // CUIT
  else if (taxId.length === 7 || taxId.length === 8) { docTipo = 96; docNro = parseInt(taxId); } // DNI

  // For Factura A (tipo 1), DocTipo must be CUIT (80)
  if (tipoCbte === 1 && docTipo !== 80) {
    throw new Error("Factura A requiere CUIT del cliente");
  }

  // ⚠️ **RG 5.616: la condición frente al IVA del receptor es obligatoria.**
  // Sin este campo WSFE rechaza con 10246 y no autoriza nada. 5 = consumidor
  // final, que es lo que corresponde a una venta de tienda sin datos fiscales.
  const condicionIva = Number(invoice.condicion_iva_receptor) || 5;

  const ivaBlock = ivaPct > 0 ? `
    <ar:Iva>
      <ar:AlicIva>
        <ar:Id>${ivaId}</ar:Id>
        <ar:BaseImp>${subtotal}</ar:BaseImp>
        <ar:Importe>${ivaImporte}</ar:Importe>
      </ar:AlicIva>
    </ar:Iva>` : "";

  // ⚠️ **`FeCAEReq` envuelve a los dos bloques, y faltaba.** Sin él WSFE
  // responde «Tag <FeCAEReq> no fue ingresado» y **ninguna factura se autoriza
  // nunca**. Estuvo así desde que se escribió la función: no se notó porque no
  // se había emitido ni una. Lo encontró la primera emisión real contra
  // homologación.
  const body = `
    <ar:FeCAEReq>
    <ar:FeCabReq>
      <ar:CantReg>1</ar:CantReg>
      <ar:PtoVta>${puntoVenta}</ar:PtoVta>
      <ar:CbteTipo>${tipoCbte}</ar:CbteTipo>
    </ar:FeCabReq>
    <ar:FeDetReq>
      <ar:FECAEDetRequest>
        <ar:Concepto>1</ar:Concepto>
        <ar:DocTipo>${docTipo}</ar:DocTipo>
        <ar:DocNro>${docNro}</ar:DocNro>
        <ar:CbteDesde>${numero}</ar:CbteDesde>
        <ar:CbteHasta>${numero}</ar:CbteHasta>
        <ar:CbteFch>${fecha}</ar:CbteFch>
        <ar:ImpTotal>${total}</ar:ImpTotal>
        <ar:ImpTotConc>0</ar:ImpTotConc>
        <ar:ImpNeto>${subtotal}</ar:ImpNeto>
        <ar:ImpOpEx>0</ar:ImpOpEx>
        <ar:ImpIVA>${ivaImporte}</ar:ImpIVA>
        <ar:ImpTrib>0</ar:ImpTrib>
        <ar:MonId>PES</ar:MonId>
        <ar:MonCotiz>1</ar:MonCotiz>
        <ar:CondicionIVAReceptorId>${condicionIva}</ar:CondicionIVAReceptorId>
        ${ivaBlock}
      </ar:FECAEDetRequest>
    </ar:FeDetReq>
    </ar:FeCAEReq>`;

  const soap = wsfeSoap("FECAESolicitar", body, { token, sign, cuit });
  const xml = await wsfeCall(wsfeUrl, soap, "FECAESolicitar");

  // Check for errors in response
  const errMsg = extractXml(xml, "ErrMsg");
  const obsMsg = extractXml(xml, "Msg");
  const result = extractXml(xml, "Resultado");
  if (result === "R" || (!extractXml(xml, "CAE") && errMsg)) {
    throw new Error(errMsg || obsMsg || "AFIP rechazó la factura");
  }

  const cae = extractXml(xml, "CAE");
  const caeVto = extractXml(xml, "CAEFchVto");
  if (!cae) throw new Error("AFIP no devolvió CAE. Respuesta: " + xml.slice(0, 500));

  // Format CAEFchVto from YYYYMMDD to YYYY-MM-DD
  const caeVencimiento = caeVto
    ? `${caeVto.slice(0, 4)}-${caeVto.slice(4, 6)}-${caeVto.slice(6, 8)}`
    : "";

  return { cae, caeVencimiento };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function wsfeSoap(
  operation: string,
  body: string,
  auth: { token: string; sign: string; cuit: string },
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:${operation}>
      <ar:Auth>
        <ar:Token>${xmlEscape(auth.token)}</ar:Token>
        <ar:Sign>${xmlEscape(auth.sign)}</ar:Sign>
        <ar:Cuit>${auth.cuit}</ar:Cuit>
      </ar:Auth>
      ${body}
    </ar:${operation}>
  </soap:Body>
</soap:Envelope>`;
}

async function wsfeCall(url: string, soap: string, action: string): Promise<string> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `http://ar.gov.afip.dif.FEV1/${action}`,
    },
    body: soap,
    signal: AbortSignal.timeout(30_000),
  });
  const xml = await resp.text();
  if (!resp.ok) throw new Error(`WSFE HTTP ${resp.status}: ${xml.slice(0, 300)}`);
  return xml;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function defaultTipoCbte(tipoEmisor: string): number {
  // monotributista → 11 (Factura C), responsable inscripto → 6 (Factura B, default)
  return tipoEmisor === "responsable_inscripto" ? 6 : 11;
}

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
