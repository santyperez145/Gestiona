/**
 * Leer lo que contesta WSAA. Lógica pura, testeada, fuera de la Edge Function.
 *
 * ── Por qué vive acá ──────────────────────────────────────────────────────
 *
 * Este parseo costó dos idas y vueltas contra ARCA en producción, con el
 * comercio mirando la pantalla:
 *
 *  1. El error se mostraba como `xml.slice(0, 300)` del SOAP crudo. Los
 *     primeros 300 caracteres de un Fault de Axis son el `<?xml?>`, cinco
 *     namespaces y el `<faultcode>` — **el `<faultstring>`, que es el único
 *     texto legible, empieza después del corte**. El reporte decía
 *     «ns1:xml.» y nada más.
 *
 *  2. Cuando ARCA por fin aceptó el pedido, la app igual falló: el ticket NO
 *     viene suelto, viene adentro de `<loginCmsReturn>` y **escapado como
 *     texto** (`&lt;token&gt;`). Buscar `<token>` derecho no encuentra nada, y
 *     el mensaje volvía a ser el XML cortado — o sea que ARCA había contestado
 *     bien y la pantalla decía que había fallado.
 *
 * Nada de esto se puede probar contra ARCA sin quemar un intento y un Ticket
 * de Acceso (WSAA no da otro hasta que el anterior vence, ~12 h). Por eso es
 * una función pura con test.
 */

/**
 * Un tag, con o sin prefijo de namespace y **con o sin atributos**.
 *
 * ⚠️ La versión anterior exigía `>` justo después del nombre, así que no veía
 * `<faultcode xmlns:ns1="http://xml.apache.org/axis/">` — que es exactamente
 * como Axis escribe el faultcode. La traducción de códigos de ARCA no habría
 * funcionado nunca, y el mensaje habría caído siempre al genérico. Lo encontró
 * el test, no producción.
 */
export function extraerXml(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(
    `<(?:[^:>\\s]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[^:>\\s]+:)?${tag}>`,
  ));
  return m ? m[1].trim() : null;
}

/**
 * Des-escapa un XML que viaja como texto adentro de otro XML.
 *
 * ⚠️ `&amp;` va ÚLTIMO. Si se reemplaza primero, un `&amp;lt;` legítimo se
 * convierte en `&lt;` y después en `<`, inventando una etiqueta que no estaba.
 *
 * ⚠️ Y las referencias numéricas cuentan: no todos los stacks SOAP escapan con
 * `&lt;`. Axis puede mandar `&#60;` o `&#x3c;` para lo mismo, y una versión que
 * sólo mira `&lt;` deja el XML sin des-escapar **sin fallar** — el resultado es
 * que no se encuentra `<token>` y parece que ARCA no lo mandó.
 */
export function desescaparXml(s: string): string {
  const sinCdata = s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return sinCdata
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Qué forma tenía la respuesta, para poder diagnosticar sin ver el contenido.
 *
 * ⚠️ **No incluye ningún valor**: sólo nombres de etiqueta, longitudes y qué
 * marcadores de escapado aparecieron. El `token` y el `sign` son credenciales
 * —con ellos se factura— así que no pueden ir a un toast, a un log de negocio
 * ni a un mensaje de error.
 *
 * Existe porque este parseo ya falló dos veces contra producción y cada intento
 * cuesta un Ticket de Acceso que ARCA no renueva por ~12 h. Sin esto, el
 * intento siguiente vuelve a ser una suposición.
 */
export function reporteDeForma(xml: string): string {
  const interno = extraerXml(xml, "loginCmsReturn");
  const fuente = interno ?? xml;
  const tags = [...new Set(
    [...fuente.matchAll(/&(?:lt|#60|#x3c);\/?\s*([a-zA-Z][\w.-]*)|<\/?\s*([a-zA-Z][\w.-]*)/g)]
      .map(m => m[1] || m[2]),
  )].slice(0, 12);

  return [
    `respuesta ${xml.length} ch`,
    interno ? `loginCmsReturn ${interno.length} ch` : "sin loginCmsReturn",
    `&lt; ${fuente.includes("&lt;") ? "sí" : "no"}`,
    `&#60; ${/&#(60|x3c);/i.test(fuente) ? "sí" : "no"}`,
    `CDATA ${fuente.includes("<![CDATA[") ? "sí" : "no"}`,
    `etiquetas: ${tags.join(",") || "ninguna"}`,
  ].join(" · ");
}

/** Los códigos que documenta ARCA, y qué hacer con cada uno. */
const CODIGOS: Record<string, string> = {
  "coe.alreadyAuthenticated":
    "ARCA ya entregó un Ticket de Acceso vigente para este certificado y no da otro hasta que venza (dura ~12 h). "
    + "No es un problema de configuración: esperá o volvé a intentar más tarde.",
  "coe.notAuthorized":
    "El certificado no tiene autorizado el servicio wsfe. Hay que asociarlo desde el Administrador de Relaciones de ARCA.",
  "cms.cert.untrusted":
    "ARCA no reconoce el certificado: no lo emitió su autoridad certificante, o es de producción usándose en homologación (o al revés).",
  "cms.cert.expired": "El certificado venció. Hay que generar uno nuevo en ARCA.",
  "cms.cert.notFound": "El pedido no incluyó el certificado.",
  "cms.sign.invalid": "La firma no valida: el certificado y la clave privada no son del mismo par.",
  "cms.bad": "ARCA no pudo leer el mensaje firmado (CMS mal formado).",
  "wsaa.unavailable": "El servicio de ARCA no está disponible en este momento.",
  "wsaa.internalError": "Error interno de ARCA. No es algo de este lado.",
};

/** Qué pasó, en castellano y accionable. */
export function motivoDeWsaa(xml: string): string {
  const code = (extraerXml(xml, "faultcode") || "").replace(/^\w+:/, "");
  const detalle = extraerXml(xml, "faultstring") || "";

  const explicado = CODIGOS[code];
  if (explicado) return `${explicado} (código de ARCA: ${code})`;

  if (detalle) return `ARCA respondió: ${detalle}${code ? ` (código ${code})` : ""}`;
  if (code) return `ARCA respondió con el código ${code}`;

  // ⚠️ Ni fault ni código: ARCA contestó BIEN y el problema es de este lado.
  // Decir «error de ARCA» acá manda a revisar el certificado, que es lo único
  // que no está mal.
  if (/LoginCmsResponse/i.test(xml)) {
    return "ARCA autorizó el pedido pero no se pudo leer el ticket de la respuesta. "
      + "Es un problema del lado de Nerqia, no de tu configuración ni de ARCA.";
  }
  return `Respuesta inesperada de ARCA: ${xml.slice(0, 300)}`;
}

/**
 * El Ticket de Acceso, o el motivo por el que no lo hay.
 *
 * ⚠️ Objeto con campos opcionales y no una unión discriminada: el repo compila
 * con `strictNullChecks: false` y TypeScript no estrecha por booleano, así que
 * `{ok:true} | {ok:false; error}` dejaría `error` inaccesible.
 */
export interface TicketWsaa {
  token?: string;
  sign?: string;
  /** ISO. La vigencia la decide ARCA. */
  expiresAt?: string;
  error?: string;
}

export function leerTicketWsaa(xml: string): TicketWsaa {
  // ⚠️ Se prueban varias formas a propósito. La respuesta de WSAA llegó ya de
  // dos maneras distintas en producción, cada intento fallido cuesta un Ticket
  // de Acceso que ARCA no renueva por ~12 h, y adivinar cuál es «la buena» ya
  // salió mal dos veces. Se intentan todas y gana la que encuentre el ticket.
  const interno = extraerXml(xml, "loginCmsReturn");
  const candidatos = [
    interno ? desescaparXml(interno) : null, // lo normal: escapado adentro
    interno,                                 // por si vino sin escapar
    desescaparXml(xml),                      // por si no hay loginCmsReturn
    xml,                                     // crudo
  ].filter(Boolean) as string[];

  let ticketXml: string | null = null;
  let token: string | null = null;
  let sign: string | null = null;
  for (const c of candidatos) {
    const t = extraerXml(c, "token");
    const s = extraerXml(c, "sign");
    if (t && s) { ticketXml = c; token = t; sign = s; break; }
  }

  if (!token || !sign) {
    // El reporte de forma va PEGADO al motivo: sin él, el intento siguiente
    // vuelve a ser una suposición y cuesta otras 12 h.
    return { error: `${motivoDeWsaa(xml)} [${reporteDeForma(xml)}]` };
  }

  // La vigencia la decide ARCA, no nosotros. Guardar una inventada hace que el
  // reuso se calcule mal: si la de ARCA es más corta, se pide otro antes de
  // tiempo y WSAA lo rechaza con `coe.alreadyAuthenticated`.
  // `ticketXml` no puede ser null acá —se asigna en el mismo `break` que token
  // y sign— pero el `?? xml` deja el invariante escrito en vez de afirmarlo con
  // un `!`, que es lo mismo que pedirle a TypeScript que confíe.
  const expDeArca = extraerXml(ticketXml ?? xml, "expirationTime");
  const parseada = expDeArca ? new Date(expDeArca) : null;
  const expiresAt = parseada && !isNaN(parseada.getTime()) ? parseada.toISOString() : undefined;

  return { token, sign, expiresAt };
}
