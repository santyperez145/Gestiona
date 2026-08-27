import { supabase } from '@/integrations/supabase/client';
import { mensajeDeEdgeFunction } from '@/lib/edgeErrors';

/**
 * Llamar a una función de IA y quedarse con el motivo real cuando falla.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * `supabase.functions.invoke` **descarta el cuerpo de la respuesta** cuando el
 * status no es 2xx: `error.message` queda en un genérico
 * («Edge Function returned a non-2xx status code») y todo lo que la función se
 * tomó el trabajo de explicar se pierde.
 *
 * ⚠️ Eso se volvió un problema concreto el 2026-08-27, cuando las funciones de
 * IA empezaron a chequear el plan y a responder **402** con el motivo escrito
 * —«tu suscripción tiene un pago pendiente», «tu plan no incluye esta
 * función»—. Se midió: **11 de 13** pantallas que llaman IA lo tapaban con un
 * «Error al generar». El comercio veía un bug donde había una decisión de
 * producto, y no tenía forma de saber que se arreglaba pagando.
 *
 * 📌 Va en un solo lugar a propósito. La alternativa era repetir el mismo
 * `catch` en trece componentes, que es exactamente cómo este repo terminó con
 * el mapa de permisos y el reparto de roles divergiendo.
 */
// `invoke` devolvía `any` y las pantallas leen `data.content`, `data.title`,
// etc. sin tipar. Mantener `any` como default hace que este helper sea un
// reemplazo directo; tipar las siete respuestas de IA es otro trabajo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function llamarIA<T = any>(
  nombre: string,
  opciones: { body: unknown },
  fallback = 'No se pudo completar la operación de IA',
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nombre, opciones);

  if (error) {
    const motivo = await mensajeDeEdgeFunction(error, data);
    console.error(`${nombre} falló`, motivo || error);
    throw new Error(motivo || fallback);
  }

  // Varias de estas funciones responden 200 con `{ error }` adentro.
  if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
    const motivo = String((data as { error: string }).error);
    console.error(`${nombre} devolvió un error`, motivo);
    throw new Error(motivo);
  }

  return data as T;
}

/**
 * El motivo de una respuesta que no salió bien, cuando la función se llama con
 * `fetch` en vez de `invoke` — el chat usa SSE y necesita el stream crudo.
 *
 * Sin esto, un 402 se le muestra al comercio como el JSON entero
 * (`{"error":"Tu suscripción...","code":"suscripcion_impago"}`), que es
 * técnicamente el motivo y humanamente un error de programa.
 */
export async function motivoDeRespuesta(res: Response, fallback: string): Promise<string> {
  const texto = await res.text().catch(() => '');
  if (!texto) return fallback;
  try {
    const json = JSON.parse(texto);
    if (json && typeof json.error === 'string' && json.error) return json.error;
  } catch {
    // No era JSON: sirve el texto tal cual.
  }
  return texto;
}
