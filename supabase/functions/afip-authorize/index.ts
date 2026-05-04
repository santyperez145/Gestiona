/**
 * afip-authorize — Facturación Electrónica Argentina (AFIP WSFE)
 *
 * Flow:
 *   1. Load org AFIP credentials from settings
 *   2. Obtain / reuse Ticket de Acceso (WSAA)
 *   3. Get last authorized invoice number (FECompUltimoAutorizado)
 *   4. Request CAE (FECAESolicitar)
 *   5. Persist CAE + numero_afip on the invoice record
 *
 * Environments:
 *   homologacion → wsaahomo / wswhomo (testing)
 *   produccion   → wsaa    / servicios1 (live)
 *
 * Required org settings fields:
 *   afip_cuit, afip_certificate (PEM), afip_private_key (PEM),
 *   afip_punto_venta, afip_environment, afip_tipo_emisor
 */

// @ts-ignore
import forge from "https://esm.sh/node-forge@1.3.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/, "").trim();
    const { data: userData } = await supabase.auth.getUser(token);
    if (!userData?.user) return err("Unauthorized", 401);

    const { invoice_id } = await req.json() as { invoice_id: string };
    if (!invoice_id) return err("invoice_id required");

    // Load invoice
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoice_id)
      .single();
    if (invErr || !invoice) return err("Factura no encontrada");
    if (invoice.cae) return err("Esta factura ya tiene CAE: " + invoice.cae);

    // Verify user belongs to the invoice's org
    const { data: membership } = await supabase
      .from("memberships")
      .select("role")
      .eq("org_id", invoice.org_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!membership) return err("Sin acceso a esta organización");

    // Load AFIP settings for this org
    const { data: settings } = await supabase
      .from("settings")
      .select("*")
      .eq("org_id", invoice.org_id)
      .maybeSingle();

    if (!settings?.afip_cuit) return err("AFIP no configurado: falta CUIT");
    if (!settings?.afip_certificate) return err("AFIP no configurado: falta certificado PEM");
    if (!settings?.afip_private_key) return err("AFIP no configurado: falta clave privada PEM");

    const isProd = settings.afip_environment === "produccion";
    const wsaaUrl = isProd
      ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
      : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
    const wsfeUrl = isProd
      ? "https://servicios1.afip.gov.ar/wsfev1/service.asmx"
      : "https://wswhomo.afip.gov.ar/wsfev1/service.asmx";

    // ── Step 1: Get / refresh Ticket de Acceso ────────────────
    let token_ta: string;
    let sign_ta: string;

    const taExpires = settings.afip_ta_expires_at
      ? new Date(settings.afip_ta_expires_at)
      : null;
    const taStillValid = taExpires && taExpires > new Date(Date.now() + 5 * 60 * 1000);

    if (taStillValid && settings.afip_ta_token && settings.afip_ta_sign) {
      token_ta = settings.afip_ta_token;
      sign_ta = settings.afip_ta_sign;
    } else {
      const ta = await getTicketAcceso(
        wsaaUrl,
        settings.afip_certificate,
        settings.afip_private_key,
      );
      token_ta = ta.token;
      sign_ta = ta.sign;

      // Cache TA (valid 12h, refresh 30 min before expiry)
      await supabase
        .from("settings")
        .update({
          afip_ta_token: token_ta,
          afip_ta_sign: sign_ta,
          afip_ta_expires_at: ta.expiresAt,
        })
        .eq("org_id", invoice.org_id);
    }

    const cuit = settings.afip_cuit.replace(/[-\s]/g, "");
    const puntoVenta = settings.afip_punto_venta || 1;
    const tipoCbte = invoice.tipo_comprobante || defaultTipoCbte(settings.afip_tipo_emisor);

    // ── Step 2: Get last authorized number ───────────────────
    const lastNumber = await getUltimoAutorizado(
      wsfeUrl, token_ta, sign_ta, cuit, puntoVenta, tipoCbte,
    );
    const nextNumber = lastNumber + 1;

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

    // ── Step 4: Persist on invoice ────────────────────────────
    await supabase
      .from("invoices")
      .update({
        cae,
        cae_vencimiento: caeVencimiento,
        afip_status: "authorized",
        numero_afip: nextNumber,
        afip_error: null,
      })
      .eq("id", invoice_id);

    return ok({ cae, cae_vencimiento: caeVencimiento, numero_afip: nextNumber });
  } catch (e: any) {
    console.error("afip-authorize error:", e);
    return err(e.message || "Error interno", 500);
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
  const gen = new Date(now.getTime() - 60_000);
  const exp = new Date(now.getTime() + 12 * 3600_000);

  const loginTicketXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    "  <header>",
    `    <uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>`,
    `    <generationTime>${gen.toISOString().slice(0, 19)}-03:00</generationTime>`,
    `    <expirationTime>${exp.toISOString().slice(0, 19)}-03:00</expirationTime>`,
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
  if (!resp.ok) throw new Error(`WSAA HTTP ${resp.status}: ${xml.slice(0, 300)}`);

  const token = extractXml(xml, "token");
  const sign = extractXml(xml, "sign");
  if (!token || !sign) throw new Error("WSAA no devolvió Token/Sign. Respuesta: " + xml.slice(0, 500));

  return { token, sign, expiresAt: exp.toISOString() };
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
  const subtotal = round2(Number(invoice.subtotal));
  const ivaImporte = round2(Number(invoice.tax_amount));
  const total = round2(Number(invoice.total));
  const ivaPct = Number(invoice.tax_pct) || 0;

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

  const ivaBlock = ivaPct > 0 ? `
    <ar:Iva>
      <ar:AlicIva>
        <ar:Id>${ivaId}</ar:Id>
        <ar:BaseImp>${subtotal}</ar:BaseImp>
        <ar:Importe>${ivaImporte}</ar:Importe>
      </ar:AlicIva>
    </ar:Iva>` : "";

  const body = `
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
        ${ivaBlock}
      </ar:FECAEDetRequest>
    </ar:FeDetReq>`;

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

function extractXml(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`));
  return m ? m[1].trim() : null;
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

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
