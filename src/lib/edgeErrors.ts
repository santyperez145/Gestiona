/**
 * El mensaje real de una Edge Function, no el genérico de Supabase.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * `supabase.functions.invoke()` devuelve `{ data, error }`. Cuando la función
 * responde con status ≥ 400, `error` es un `FunctionsHttpError` cuyo `.message`
 * es siempre el mismo texto:
 *
 *     "Edge Function returned a non-2xx status code"
 *
 * **El cuerpo de la respuesta no se pierde**: queda en `error.context`, que es
 * el `Response`. Pero hay que ir a buscarlo, y en este repo no lo hacía nadie:
 * medido el 2026-08-27, **47 archivos invocan Edge Functions y 30 lugares en 13
 * archivos le mostraban al usuario ese genérico**.
 *
 * O sea que todos los mensajes que las funciones escriben con cuidado —«El CUIT
 * no está autorizado», «el punto de venta no existe», «Sólo el dueño o un
 * administrador pueden verificar»— nunca llegaban a la pantalla. Y son mensajes
 * que mandan a lugares distintos: confundirlos hace perder una tarde.
 *
 * Se encontró porque el panel de AFIP decía «Falta delegar el servicio en ARCA»
 * para cualquier fallo, tapando lo que ARCA había contestado de verdad.
 */

/** Lo que puede venir en el cuerpo de una función de este repo. */
interface CuerpoDeError {
  error?: unknown;
  message?: unknown;
  detalle?: unknown;
  code?: unknown;
  public_message?: unknown;
  merchant_message?: unknown;
  operator_message?: unknown;
  reference?: unknown;
}

export interface DetalleDeEdgeFunction {
  message: string;
  code: string;
  reference: string;
}

export type AudienciaDeError = "platform" | "merchant" | "customer";

function textoDe(valor: unknown): string {
  return typeof valor === "string" && valor.trim() ? valor.trim() : "";
}

const MENSAJE_CLIENTE = "No pudimos completar esta acción en este momento. Intentá nuevamente en unos minutos.";
const MENSAJE_COMERCIO = "No se pudo completar la operación. Intentá nuevamente; si continúa, compartí la referencia con soporte.";
const TECNICO = /\b(resend|smtp|supabase|edge function|service[_ -]?role|anon[_ -]?key|api[_ -]?key|jwt|sqlstate|postgres|platform|superadmin|stack|trace|secret|token)\b/i;
const TECNICO_BASE = /\b(pgrst\d*|sql|database|schema|relation|column|constraint|row-level|rls|function public\.|invalid input syntax|duplicate key|null value|permission denied|uuid)\b/i;

/**
 * Conserva mensajes de negocio deliberadamente escritos para el comprador,
 * pero reemplaza cualquier diagnóstico de infraestructura/RPC por copy público.
 */
export function mensajeSeguroParaCliente(
  error: unknown,
  fallback = MENSAJE_CLIENTE,
): string {
  const candidato = textoDe((error as { message?: unknown } | null)?.message)
    .replace(/^.*?:\s*/, "");
  if (!candidato || TECNICO.test(candidato) || TECNICO_BASE.test(candidato)) return fallback;
  return candidato;
}

function mensajeSegunAudiencia(cuerpo: CuerpoDeError, audiencia: AudienciaDeError): string {
  const tieneError = [
    cuerpo.error,
    cuerpo.message,
    cuerpo.detalle,
    cuerpo.public_message,
    cuerpo.merchant_message,
    cuerpo.operator_message,
  ].some((valor) => textoDe(valor));
  if (!tieneError) return "";
  if (audiencia === "platform") {
    return textoDe(cuerpo.operator_message)
      || textoDe(cuerpo.detalle)
      || textoDe(cuerpo.error)
      || textoDe(cuerpo.message);
  }
  if (audiencia === "customer") {
    const explicito = textoDe(cuerpo.public_message);
    return explicito || MENSAJE_CLIENTE;
  }

  const explicito = textoDe(cuerpo.merchant_message);
  if (explicito) return explicito;
  const candidato = textoDe(cuerpo.error) || textoDe(cuerpo.message);
  return candidato && !TECNICO.test(candidato) ? candidato : MENSAJE_COMERCIO;
}

/**
 * Extrae el mensaje más específico disponible, en orden de utilidad:
 *
 *   1. `data.error` — una función que responde 200 con `{ ok:false, error }`
 *      para que el cliente pueda leerlo. Es el camino preferido y por eso va
 *      primero: no hay que tocar la red de nuevo.
 *   2. El cuerpo del `Response` que quedó en `error.context`, que es donde
 *      viven los mensajes de los no-2xx.
 *   3. `error.message`, que es el genérico. Último recurso a propósito.
 *
 * Devuelve `""` cuando no hubo error, para que el llamador pueda usar el
 * resultado como condición.
 */
export async function detalleDeEdgeFunction(
  error: unknown,
  data?: unknown,
  audiencia: AudienciaDeError = "merchant",
): Promise<DetalleDeEdgeFunction> {
  // 1. Respuesta 200 con el error adentro.
  const cuerpo = data as CuerpoDeError | null | undefined;
  const enData = cuerpo ? mensajeSegunAudiencia(cuerpo, audiencia) : "";
  const codigoEnData = textoDe(cuerpo?.code);
  const referenciaEnData = textoDe(cuerpo?.reference);
  if (enData) return { message: enData, code: codigoEnData, reference: referenciaEnData };

  if (!error) return { message: "", code: codigoEnData, reference: referenciaEnData };

  // 2. El cuerpo del no-2xx.
  const ctx = (error as { context?: unknown }).context;
  const leible = ctx && typeof ctx === "object" && typeof (ctx as Response).json === "function";
  if (leible) {
    try {
      // `clone()` porque el Response puede haber sido leído antes; si el
      // clone no está disponible se usa el original.
      const resp = ctx as Response;
      const fuente = typeof resp.clone === "function" ? resp.clone() : resp;
      const json = (await fuente.json()) as CuerpoDeError;
      const enCuerpo = mensajeSegunAudiencia(json, audiencia);
      if (enCuerpo) {
        return {
          message: enCuerpo,
          code: textoDe(json?.code) || codigoEnData,
          reference: textoDe(json?.reference) || referenciaEnData,
        };
      }
    } catch {
      // Cuerpo vacío, no-JSON o ya consumido: se sigue al genérico. Tragarse
      // esto es correcto — el objetivo es mejorar el mensaje, no reemplazar
      // el error por uno de parseo.
    }
  }

  // 3. El genérico.
  const fallback = textoDe((error as { message?: unknown }).message);
  return {
    message: audiencia === "platform"
      ? fallback || "Error desconocido"
      : audiencia === "customer"
      ? MENSAJE_CLIENTE
      : fallback && !TECNICO.test(fallback) ? fallback : MENSAJE_COMERCIO,
    code: codigoEnData,
    reference: referenciaEnData,
  };
}

export async function mensajeDeEdgeFunction(
  error: unknown,
  data?: unknown,
  audiencia: AudienciaDeError = "merchant",
): Promise<string> {
  const detalle = await detalleDeEdgeFunction(error, data, audiencia);
  return detalle.reference ? `${detalle.message} Referencia: ${detalle.reference}.` : detalle.message;
}
