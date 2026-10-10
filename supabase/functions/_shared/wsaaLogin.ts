/**
 * Login a WSAA: firma el TRA (CMS/PKCS#7) para un servicio y devuelve el
 * Ticket de Acceso. Lo usan afip-authorize (wsfe) y arca-padron
 * (ws_sr_constancia_inscripcion). Guardar y compartir el ticket es de cada
 * llamador: WSAA no entrega otro para el mismo (certificado, servicio)
 * mientras el anterior viva.
 */
// @ts-ignore
import forge from "https://esm.sh/node-forge@1.3.1";
import { leerTicketWsaa, motivoDeWsaa } from "./wsaaRespuesta.ts";

export async function pedirTicketWsaa(
  wsaaUrl: string,
  certPem: string,
  keyPem: string,
  servicio = "wsfe",
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
    `  <service>${servicio}</service>`,
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
