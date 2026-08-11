/**
 * Identidad fiscal — quién emite y quién recibe.
 *
 * ── Por qué hace falta ────────────────────────────────────────────────────
 *
 * Hasta acá el sistema sabía **cuánto** IVA tenía una orden pero no **quién**
 * la emite ni **a quién**. Y esas dos cosas son las que deciden si la venta
 * lleva Factura A, B o C, y si el IVA se discrimina o no.
 *
 * Se encontró midiendo, no leyendo: la organización está configurada como
 * `afip_tipo_emisor = 'monotributo'` y sus órdenes llevaban **$84.305 de IVA
 * discriminado sobre una orden de $485.760**. Un monotributista no discrimina
 * IVA — emite Factura C, donde el neto es el total y el IVA es cero. El trigger
 * tenía escrita la regla en un comentario y nunca leía la columna.
 *
 * ── La regla, en dos preguntas ────────────────────────────────────────────
 *
 * **1. ¿Se discrimina IVA?** Lo decide el EMISOR, y nada más que el emisor.
 * Sólo un responsable inscripto discrimina. Un monotributista o un exento
 * emiten comprobante clase C con IVA cero, cobren lo que cobren.
 *
 * **2. ¿Qué comprobante se emite?** Lo deciden los dos:
 *
 *   emisor monotributo o exento  → siempre C
 *   emisor responsable inscripto → A si el receptor es responsable inscripto
 *                                  B para todos los demás
 *
 * La A existe para que el receptor se tome el crédito fiscal. Un monotributista
 * o un consumidor final no pueden tomarlo, así que reciben B — no es una
 * preferencia, es para qué sirve cada clase.
 *
 * ⚠️ **Queda afuera la Factura M**, que ARCA le asigna a un responsable
 * inscripto recién inscripto o con comportamiento fiscal observado. Es una
 * condición que fija el organismo, no algo que el sistema pueda deducir.
 *
 * ── Esto no es asesoramiento fiscal ───────────────────────────────────────
 *
 * Es la codificación de reglas publicadas. Los códigos numéricos son los de
 * ARCA (ex AFIP) para el web service WSFE. El umbral de identificación
 * obligatoria lo fija una resolución que se actualiza, así que es
 * configuración y no una constante.
 */

// ── Condición frente al IVA ─────────────────────────────────────────────────

/**
 * Códigos de "condición IVA del receptor" de ARCA. Desde la RG 5.616 el
 * comprobante tiene que informarla, así que se guarda el código y no una
 * etiqueta.
 *
 * Se modela el subconjunto que le sirve a una tienda argentina. Los de
 * comercio exterior y los regímenes especiales existen y no se ofrecen: una
 * lista larga en un checkout hace que la gente elija cualquier cosa.
 */
export const CONDICIONES_IVA = {
  responsable_inscripto: { codigo: 1, label: "Responsable Inscripto" },
  exento: { codigo: 4, label: "IVA Sujeto Exento" },
  consumidor_final: { codigo: 5, label: "Consumidor Final" },
  monotributo: { codigo: 6, label: "Responsable Monotributo" },
} as const;

export type CondicionIva = keyof typeof CONDICIONES_IVA;

/** Las condiciones en las que puede estar quien emite. */
export type TipoEmisor = "responsable_inscripto" | "monotributo" | "exento";

export function esCondicionIva(v: unknown): v is CondicionIva {
  return typeof v === "string" && v in CONDICIONES_IVA;
}

/**
 * ¿Este emisor discrimina IVA?
 *
 * Sólo el responsable inscripto. Es la pregunta que el trigger de la orden
 * tenía que hacerse y no se hacía.
 *
 * Ante un valor desconocido devuelve `false`: no discriminar de más es el
 * error barato — discriminar IVA que no corresponde es facturar mal.
 */
export function discriminaIva(emisor: string | null | undefined): boolean {
  return emisor === "responsable_inscripto";
}

// ── Tipo de comprobante ─────────────────────────────────────────────────────

export type LetraComprobante = "A" | "B" | "C";

export interface Comprobante {
  letra: LetraComprobante;
  /** Código de tipo de comprobante de ARCA para factura. */
  codigoAfip: number;
  /** `true` si el comprobante lleva el IVA discriminado. */
  discriminaIva: boolean;
}

/** Códigos WSFE de factura. Nota de crédito y débito tienen los suyos. */
const FACTURA_AFIP: Record<LetraComprobante, number> = { A: 1, B: 6, C: 11 };

/**
 * Qué comprobante corresponde entre estos dos.
 *
 * Un emisor que no discrimina IVA emite C siempre, sin mirar al receptor: no
 * tiene A ni B disponibles. Recién si el emisor es responsable inscripto la
 * condición del receptor decide algo.
 */
export function tipoDeComprobante(
  emisor: string | null | undefined,
  receptor: string | null | undefined,
): Comprobante {
  if (!discriminaIva(emisor)) {
    return { letra: "C", codigoAfip: FACTURA_AFIP.C, discriminaIva: false };
  }
  // Sólo quien puede tomarse el crédito fiscal recibe A.
  const letra: LetraComprobante = receptor === "responsable_inscripto" ? "A" : "B";
  // La B lleva el IVA adentro del precio y no lo discrimina en el cuerpo, pero
  // el emisor sí liquida IVA por esa venta: el débito fiscal existe igual.
  return { letra, codigoAfip: FACTURA_AFIP[letra], discriminaIva: letra === "A" };
}

// ── Documento del receptor ──────────────────────────────────────────────────

/** Códigos de tipo de documento de ARCA. */
export const TIPO_DOC = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  /** Consumidor final no identificado. */
  SIN_IDENTIFICAR: 99,
} as const;

export type TipoDocumento = keyof typeof TIPO_DOC;

/**
 * Valida un CUIT/CUIL por su dígito verificador (módulo 11).
 *
 * Es la única validación que se puede hacer sin consultar al padrón, y agarra
 * casi cualquier error de tipeo. Un número con dígito correcto puede igual no
 * existir: para eso está `afip_padron_cache`.
 *
 * ⚠️ Cuando la cuenta da 10, el número **no es un CUIT válido**: ARCA no
 * asigna esos. Muchas implementaciones lo mapean a 9 y terminan aceptando un
 * número inexistente.
 */
export function validarCuit(valor: string | null | undefined): boolean {
  const limpio = String(valor ?? "").replace(/[^0-9]/g, "");
  if (limpio.length !== 11) return false;
  // Un CUIT con todos los dígitos iguales pasa el módulo 11 en algunos casos y
  // nunca es real.
  if (/^(\d)\1{10}$/.test(limpio)) return false;

  // Prefijos que asigna ARCA: 20/23/24/27 personas físicas, 30/33/34 jurídicas,
  // 50/51/55 regímenes especiales. Un 99 al frente es un tipeo, no un CUIT.
  const prefijo = limpio.slice(0, 2);
  if (!PREFIJOS_CUIT.has(prefijo)) return false;

  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(limpio[i]), 0);
  const resto = suma % 11;

  let dv: number;
  if (resto === 0) dv = 0;
  else if (resto === 1) return false; // daría 10: ARCA no lo asigna
  else dv = 11 - resto;

  return dv === Number(limpio[10]);
}

const PREFIJOS_CUIT = new Set([
  "20", "23", "24", "25", "26", "27", // personas físicas
  "30", "33", "34",                   // personas jurídicas
  "50", "51", "55",                   // regímenes especiales
]);

/** `20123456786` → `20-12345678-6`. Vacío si no tiene 11 dígitos. */
export function formatearCuit(valor: string | null | undefined): string {
  const limpio = String(valor ?? "").replace(/[^0-9]/g, "");
  if (limpio.length !== 11) return String(valor ?? "").trim();
  return `${limpio.slice(0, 2)}-${limpio.slice(2, 10)}-${limpio.slice(10)}`;
}

/** DNI: 7 u 8 dígitos. No tiene dígito verificador que se pueda chequear. */
export function validarDni(valor: string | null | undefined): boolean {
  const limpio = String(valor ?? "").replace(/[^0-9]/g, "");
  return limpio.length >= 7 && limpio.length <= 8 && Number(limpio) > 0;
}

// ── Qué se le exige al comprador ────────────────────────────────────────────

export interface ExigenciaDocumento {
  /** `true` si sin documento no se puede emitir el comprobante. */
  obligatorio: boolean;
  /** Qué documento corresponde pedir. */
  tipo: TipoDocumento;
  /** Por qué, para poder decírselo al comprador. */
  motivo?: "factura_a" | "condicion_declarada" | "monto";
}

/**
 * Qué documento hace falta para esta venta.
 *
 * Tres razones distintas, en orden de dureza:
 *
 * 1. **Factura A**: sin CUIT no existe. No es una preferencia del comercio.
 * 2. **El receptor declaró una condición que no es consumidor final**: un
 *    monotributista o un exento se identifican con CUIT.
 * 3. **El monto**: arriba de cierto importe hay que identificar al comprador
 *    aunque sea consumidor final. El umbral lo fija una resolución que se
 *    actualiza por inflación, así que entra por configuración. `null` = el
 *    comercio no lo cargó y no se exige por monto.
 *
 * ⚠️ Ese `null` es una decisión con consecuencia: si el comercio no configura
 * el umbral, el sistema no lo exige. Se prefiere eso a hornear un número que
 * en seis meses está viejo y hace fallar checkouts legítimos.
 */
export function documentoRequerido(
  condicionReceptor: string | null | undefined,
  letra: LetraComprobante,
  total: number,
  umbralIdentificacion: number | null | undefined,
): ExigenciaDocumento {
  if (letra === "A") {
    return { obligatorio: true, tipo: "CUIT", motivo: "factura_a" };
  }

  if (condicionReceptor && condicionReceptor !== "consumidor_final") {
    return { obligatorio: true, tipo: "CUIT", motivo: "condicion_declarada" };
  }

  const umbral = Number(umbralIdentificacion);
  const importe = Number(total);
  if (Number.isFinite(umbral) && umbral > 0
      && Number.isFinite(importe) && importe >= umbral) {
    return { obligatorio: true, tipo: "DNI", motivo: "monto" };
  }

  return { obligatorio: false, tipo: "SIN_IDENTIFICAR" };
}

/** El código de ARCA que corresponde al documento efectivamente cargado. */
export function tipoDocAfip(
  tipo: TipoDocumento | null | undefined,
  numero: string | null | undefined,
): number {
  const limpio = String(numero ?? "").replace(/[^0-9]/g, "");
  if (limpio === "") return TIPO_DOC.SIN_IDENTIFICAR;
  if (tipo === "CUIT" || tipo === "CUIL") return TIPO_DOC[tipo];
  if (tipo === "DNI") return TIPO_DOC.DNI;
  // Sin tipo declarado se deduce por longitud: 11 dígitos sólo puede ser CUIT.
  return limpio.length === 11 ? TIPO_DOC.CUIT : TIPO_DOC.DNI;
}

/**
 * El mensaje que ve el comprador cuando falta el documento. Sin jerga fiscal:
 * "sujeto pasivo" no le dice nada a nadie.
 */
export function mensajeDocumentoFaltante(e: ExigenciaDocumento): string | null {
  if (!e.obligatorio) return null;
  switch (e.motivo) {
    case "factura_a":
      return "Para emitir factura A necesitamos tu CUIT";
    case "condicion_declarada":
      return "Ingresá tu CUIT para emitir la factura con la condición que elegiste";
    case "monto":
      return "Por el monto de la compra necesitamos tu DNI para la factura";
    default:
      return "Necesitamos tu documento para emitir la factura";
  }
}
