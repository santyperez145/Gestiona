/**
 * Padrones de alícuotas de Ingresos Brutos (2026-10-22): de ahí sale la
 * percepción que un agente aplica a cada cliente.
 *
 * Diseños de registro tomados de los organismos (campos separados por «;»):
 *   - ARBA, «Régimen de recaudación por sujeto — nuevo diseño de registro de
 *     padrones» (PadronRGSPerMMAAAA.txt):
 *     régimen (P/R); publicación; vigencia desde; hasta (DDMMAAAA); CUIT;
 *     tipo (C/D); alta-baja (S/N/B); cambio de alícuota (S/N); alícuota
 *     (9,99); grupo.
 *   - AGIP (CABA), «Diseño de registro de padrón unificado»:
 *     publicación; vigencia desde; hasta; CUIT; tipo (C/D); alta (S/N/B);
 *     marca alícuota; alícuota de percepción (9,99); alícuota de retención;
 *     grupo percepción; grupo retención; razón social.
 *
 * Los archivos pesan cientos de megas: se leen por partes en el navegador y
 * sólo se guardan los CUIT de los clientes del comercio.
 */

export type Jurisdiccion = "ARBA" | "AGIP";

export interface RegistroPadron {
  cuit: string;
  alicuota: number;
  vigenciaDesde: string;
  vigenciaHasta: string;
  /** El sujeto se dio de baja del padrón: no corresponde percibirle con esa alícuota. */
  baja: boolean;
}

const fechaIso = (ddmmaaaa: string): string | null => {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(ddmmaaaa.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const alicuota = (texto: string): number | null => {
  const n = Number(texto.trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

/** ARBA empieza con la letra del régimen; AGIP con la fecha de publicación. */
export function formatoDePadron(linea: string): Jurisdiccion | null {
  const t = linea.trimStart();
  if (/^[PR];\d{8};\d{8};\d{8};\d{11};/.test(t)) return "ARBA";
  if (/^\d{8};\d{8};\d{8};\d{11};/.test(t)) return "AGIP";
  return null;
}

/**
 * Una línea del padrón, del régimen pedido: percepción (P, por defecto) o
 * retención (R, desde 2026-10-22, para el agente que retiene al pagar). ARBA
 * publica cada régimen en su archivo y marca la línea con la letra: una del
 * otro régimen se ignora. AGIP trae las dos alícuotas en la misma línea.
 */
export type Regimen = "P" | "R";

export function leerLineaPadron(linea: string, formato: Jurisdiccion, regimen: Regimen = "P"): RegistroPadron | null {
  const c = linea.replace(/\r$/, "").split(";");
  if (formato === "ARBA") {
    if (c.length < 9 || c[0] !== regimen) return null;
    const desde = fechaIso(c[2]), hasta = fechaIso(c[3]), a = alicuota(c[8]);
    if (!desde || !hasta || a === null || !/^\d{11}$/.test(c[4])) return null;
    return { cuit: c[4], alicuota: a, vigenciaDesde: desde, vigenciaHasta: hasta, baja: c[6] === "B" };
  }
  if (c.length < (regimen === "R" ? 9 : 8)) return null;
  const desde = fechaIso(c[1]), hasta = fechaIso(c[2]), a = alicuota(c[regimen === "R" ? 8 : 7]);
  if (!desde || !hasta || a === null || !/^\d{11}$/.test(c[3])) return null;
  return { cuit: c[3], alicuota: a, vigenciaDesde: desde, vigenciaHasta: hasta, baja: c[5] === "B" };
}

/** Recorre líneas y se queda con las de los CUIT pedidos (clientes o proveedores). */
export function filtrarPadron(lineas: Iterable<string>, cuits: ReadonlySet<string>, formato: Jurisdiccion, regimen: Regimen = "P") {
  const encontrados = new Map<string, RegistroPadron>();
  let leidas = 0, invalidas = 0;
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    leidas++;
    const r = leerLineaPadron(linea, formato, regimen);
    if (!r) { invalidas++; continue; }
    if (cuits.has(r.cuit)) encontrados.set(r.cuit, r);
  }
  return { encontrados, leidas, invalidas };
}

/**
 * Lee un archivo grande por partes, sin cargarlo entero. Detecta ARBA o AGIP
 * con la primera línea válida. `alAvanzar` recibe la fracción leída (0 a 1).
 */
export async function leerPadronDeArchivo(
  archivo: Blob,
  cuits: ReadonlySet<string>,
  alAvanzar?: (fraccion: number) => void,
  regimen: Regimen = "P",
): Promise<{ formato: Jurisdiccion | null; encontrados: Map<string, RegistroPadron>; leidas: number; invalidas: number }> {
  const decoder = new TextDecoder("windows-1252");
  const BLOQUE = 4 * 1024 * 1024;
  let resto = "";
  let formato: Jurisdiccion | null = null;
  let leidos = 0;
  const encontrados = new Map<string, RegistroPadron>();
  let leidas = 0, invalidas = 0;
  const procesar = (lineas: string[]) => {
    for (const linea of lineas) {
      if (!linea.trim()) continue;
      if (!formato) formato = formatoDePadron(linea);
      if (!formato) { invalidas++; continue; }
      const r = filtrarPadron([linea], cuits, formato, regimen);
      leidas += r.leidas; invalidas += r.invalidas;
      for (const [k, v] of r.encontrados) encontrados.set(k, v);
    }
  };
  // En bloques de 4 MB con `slice`: anda en todos los navegadores y nunca
  // carga el archivo entero en memoria.
  for (let desde = 0; desde < archivo.size; desde += BLOQUE) {
    const value = new Uint8Array(await leerBloque(archivo.slice(desde, desde + BLOQUE)));
    leidos += value.byteLength;
    const texto = resto + decoder.decode(value, { stream: true });
    const lineas = texto.split("\n");
    resto = lineas.pop() ?? "";
    procesar(lineas);
    alAvanzar?.(archivo.size ? Math.min(1, leidos / archivo.size) : 1);
  }
  procesar([resto + decoder.decode()]);
  return { formato, encontrados, leidas, invalidas };
}

function leerBloque(bloque: Blob): Promise<ArrayBuffer> {
  if (typeof bloque.arrayBuffer === "function") return bloque.arrayBuffer();
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(lector.result as ArrayBuffer);
    lector.onerror = () => rechazar(lector.error ?? new Error("No se pudo leer el archivo"));
    lector.readAsArrayBuffer(bloque);
  });
}

/** La alícuota vigente para una fecha, o null si el registro no aplica. */
export function alicuotaVigente(r: RegistroPadron | null | undefined, fecha: string): number | null {
  if (!r || r.baja) return null;
  return fecha >= r.vigenciaDesde && fecha <= r.vigenciaHasta ? r.alicuota : null;
}
