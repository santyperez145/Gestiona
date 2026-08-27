import { describe, it, expect } from "vitest";
import {
  extraerXml, desescaparXml, motivoDeWsaa, leerTicketWsaa,
} from "../../supabase/functions/_shared/wsaaRespuesta";

/**
 * Leer la respuesta de WSAA — la parte que falló dos veces en producción.
 *
 * No se puede probar contra ARCA sin quemar un intento: WSAA no entrega otro
 * Ticket de Acceso hasta que el anterior vence (~12 h). Por eso está acá, con
 * respuestas reales de ARCA como fixture.
 */

/** La respuesta buena: el ticket ESCAPADO adentro de `loginCmsReturn`. */
const ticketInterno = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<loginTicketResponse version=\"1.0\">",
  "<header>",
  "<source>CN=wsaahomo, O=AFIP, C=AR</source>",
  "<destination>SERIALNUMBER=CUIT 20446484436, CN=gestiona</destination>",
  "<uniqueId>1234567890</uniqueId>",
  "<generationTime>2026-08-27T09:09:34.000-03:00</generationTime>",
  "<expirationTime>2026-08-27T21:09:34.000-03:00</expirationTime>",
  "</header>",
  "<credentials><token>UEQ5eG1s</token><sign>ZmlybWE=</sign></credentials>",
  "</loginTicketResponse>",
].join("");

const escapar = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const respuestaOk = `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><LoginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><loginCmsReturn>${escapar(ticketInterno)}</loginCmsReturn></LoginCmsResponse></soapenv:Body></soapenv:Envelope>`;

const fault = (code: string, str: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body><soapenv:Fault><faultcode xmlns:ns1="http://xml.apache.org/axis/">ns1:${code}</faultcode><faultstring>${str}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;

describe("leerTicketWsaa", () => {
  it("saca token y sign de adentro del ticket escapado", () => {
    // ⚠️ Esto es lo que falló: buscar <token> derecho sobre la respuesta no
    // encuentra nada, porque en el XML dice `&lt;token&gt;`.
    const r = leerTicketWsaa(respuestaOk);
    expect(r.error).toBeUndefined();
    expect(r.token).toBe("UEQ5eG1s");
    expect(r.sign).toBe("ZmlybWE=");
  });

  it("usa la vigencia que informa ARCA, no una inventada", () => {
    // Guardar una más larga que la real hace que el reuso del ticket se
    // calcule mal y WSAA rechace el pedido siguiente por alreadyAuthenticated.
    const r = leerTicketWsaa(respuestaOk);
    expect(new Date(r.expiresAt!).toISOString()).toBe("2026-08-28T00:09:34.000Z");
  });

  it("si ARCA contestó bien pero no se puede leer, lo dice sin culpar al certificado", () => {
    const roto = respuestaOk.replace("&lt;token&gt;UEQ5eG1s&lt;/token&gt;", "");
    const r = leerTicketWsaa(roto);
    expect(r.token).toBeUndefined();
    expect(r.error).toContain("problema del lado de Gestiona");
    expect(r.error).not.toContain("certificado venció");
  });
});

describe("motivoDeWsaa", () => {
  it("traduce el código a algo accionable, no a XML crudo", () => {
    const m = motivoDeWsaa(fault("coe.alreadyAuthenticated", "El CEE ya posee un TA valido"));
    expect(m).toContain("ya entregó un Ticket de Acceso vigente");
    expect(m).toContain("coe.alreadyAuthenticated");
    expect(m).not.toContain("soapenv");
  });

  it("no confunde un ticket vivo con un certificado roto", () => {
    // Mandar a revisar el certificado por esto hace perder una tarde: el
    // certificado es lo único que no está mal.
    const m = motivoDeWsaa(fault("coe.alreadyAuthenticated", "x"));
    expect(m).not.toMatch(/certificado (venció|no|mal)/i);
  });

  it("con un código desconocido muestra el faultstring, que es lo legible", () => {
    // ⚠️ El reporte real terminaba en «ns1:xml.» porque el mensaje era los
    // primeros 300 caracteres del SOAP, donde el faultstring todavía no llegó.
    const m = motivoDeWsaa(fault("xml.algoNuevo", "El TRA no cumple con el esquema"));
    expect(m).toContain("El TRA no cumple con el esquema");
    expect(m).toContain("xml.algoNuevo");
  });

  it("una respuesta que no es ni fault ni login se muestra recortada", () => {
    expect(motivoDeWsaa("<html>502 Bad Gateway</html>")).toContain("502 Bad Gateway");
  });
});

describe("desescaparXml", () => {
  it("resuelve las cinco entidades", () => {
    expect(desescaparXml("&lt;a b=&quot;c&quot; d=&apos;e&apos;&gt;&amp;"))
      .toBe(`<a b="c" d='e'>&`);
  });

  it("⚠️ &amp; se resuelve ÚLTIMO: un &amp;lt; literal no inventa una etiqueta", () => {
    // Si `&amp;` se reemplazara primero, esto daría "<" — una etiqueta que el
    // documento original no tenía.
    expect(desescaparXml("&amp;lt;")).toBe("&lt;");
  });

  it("saca el CDATA cuando el ticket viene así", () => {
    expect(desescaparXml("<![CDATA[<token>x</token>]]>")).toBe("<token>x</token>");
  });
});

describe("extraerXml", () => {
  it("encuentra el tag con o sin prefijo de namespace", () => {
    expect(extraerXml("<ns1:token>a</ns1:token>", "token")).toBe("a");
    expect(extraerXml("<token>b</token>", "token")).toBe("b");
  });

  it("devuelve null si no está, en vez de string vacío", () => {
    // Un "" haría que `!token` sea true igual, pero null distingue "no vino"
    // de "vino vacío" cuando haga falta mirarlo.
    expect(extraerXml("<a>1</a>", "token")).toBeNull();
  });
});
