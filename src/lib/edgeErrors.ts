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
}

function textoDe(valor: unknown): string {
  return typeof valor === "string" && valor.trim() ? valor.trim() : "";
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
export async function mensajeDeEdgeFunction(error: unknown, data?: unknown): Promise<string> {
  // 1. Respuesta 200 con el error adentro.
  const cuerpo = data as CuerpoDeError | null | undefined;
  const enData = textoDe(cuerpo?.error) || textoDe(cuerpo?.message);
  if (enData) return enData;

  if (!error) return "";

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
      const enCuerpo = textoDe(json?.error) || textoDe(json?.message);
      if (enCuerpo) return enCuerpo;
    } catch {
      // Cuerpo vacío, no-JSON o ya consumido: se sigue al genérico. Tragarse
      // esto es correcto — el objetivo es mejorar el mensaje, no reemplazar
      // el error por uno de parseo.
    }
  }

  // 3. El genérico.
  return textoDe((error as { message?: unknown }).message) || "Error desconocido";
}
