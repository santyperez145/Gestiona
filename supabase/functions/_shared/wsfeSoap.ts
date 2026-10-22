/**
 * WSFEv1 para las funciones que no son afip-authorize: el sobre SOAP, la
 * llamada y el Ticket de Acceso.
 *
 * ⚠️ **El ticket sale del mismo lugar y con el mismo candado que en
 * afip-authorize** (`afip:ta:<org|plataforma>`, guardado con
 * `guardarTicketAcceso`). WSAA entrega un ticket por certificado y servicio y
 * rechaza otro mientras el anterior viva: si esta función lo pidiera por su
 * lado, la siguiente factura del comercio quedaría medio día sin poder
 * autorizarse. `src/test/caea.test.ts` verifica que las dos claves coincidan.
 *
 * afip-authorize conserva su copia porque sus pruebas ejecutan el archivo con
 * las dependencias inyectadas.
 */
import { guardarTicketAcceso, resolverCredencialesAfip, type CredencialesAfip } from "./afipCredenciales.ts";
import { pedirTicketWsaa } from "./wsaaLogin.ts";

export type Ambiente = "produccion" | "homologacion";

export const WSAA_URL: Record<Ambiente, string> = {
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
};

export const WSFE_URL: Record<Ambiente, string> = {
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
};

export type AuthWsfe = { token: string; sign: string; cuit: string };

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function wsfeSoap(operation: string, body: string, auth: AuthWsfe): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:${operation}>
      <ar:Auth>
        <ar:Token>${xmlEscape(auth.token)}</ar:Token>
        <ar:Sign>${xmlEscape(auth.sign)}</ar:Sign>
        <ar:Cuit>${auth.cuit.replace(/\D/g, "")}</ar:Cuit>
      </ar:Auth>
      ${body}
    </ar:${operation}>
  </soap:Body>
</soap:Envelope>`;
}

export async function wsfeCall(url: string, operation: string, body: string, auth: AuthWsfe): Promise<string> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `http://ar.gov.afip.dif.FEV1/${operation}` },
    body: wsfeSoap(operation, body, auth),
    signal: AbortSignal.timeout(30_000),
  });
  const xml = await resp.text();
  if (!resp.ok) {
    console.error("[ARCA] WSFE HTTP error", { operation, status: resp.status, body: xml.slice(0, 300) });
    throw new Error(`WSFE HTTP ${resp.status}`);
  }
  return xml;
}

/** El ticket de wsfe del comercio: el guardado si vive, o uno nuevo pedido de a uno. */
export async function ticketWsfe(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  cred: CredencialesAfip,
  orgId: string,
): Promise<AuthWsfe> {
  const vigente = (exp: string | null) => !!exp && new Date(exp) > new Date(Date.now() + 5 * 60 * 1000);
  const auth = (token: string, sign: string) => ({ token, sign, cuit: cred.cuit });
  if (vigente(cred.ta_expires_at) && cred.ta_token && cred.ta_sign) return auth(cred.ta_token, cred.ta_sign);

  const clave = `afip:ta:${cred.modo === "propio" ? orgId : "plataforma"}`;
  const { data: gane } = await supabase.rpc("afip_ta_lease_tomar", { p_clave: clave, p_segundos: 45 });
  if (!gane) {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const c = (await resolverCredencialesAfip(supabase, orgId)).cred;
      if (c && vigente(c.ta_expires_at) && c.ta_token && c.ta_sign) return auth(c.ta_token, c.ta_sign);
    }
    console.error("ticketWsfe: el lease no se liberó a tiempo, se pide igual");
  }
  try {
    const ambiente: Ambiente = cred.environment === "produccion" ? "produccion" : "homologacion";
    const ta = await pedirTicketWsaa(WSAA_URL[ambiente], cred.certificate, cred.private_key, "wsfe");
    try {
      const r = await guardarTicketAcceso(supabase, cred, orgId, ta);
      if (r?.error) console.error("No se pudo guardar el Ticket de Acceso:", r.error);
    } catch (e) {
      console.error("No se pudo guardar el Ticket de Acceso:", e);
    }
    return auth(ta.token, ta.sign);
  } finally {
    try {
      const { error } = await supabase.rpc("afip_ta_lease_soltar", { p_clave: clave });
      if (error) console.error("ticketWsfe: no se soltó el lease del ticket", error);
    } catch (e) {
      console.error("ticketWsfe: no se soltó el lease del ticket", e);
    }
  }
}
