/**
 * Un error que se serializa mal es un error perdido.
 *
 * El 2026-08-26, al instrumentar el resultado real de las invocaciones por
 * cron, apareció una respuesta 500 cuyo cuerpo entero era:
 *
 *     {"error":"[object Object]"}
 *
 * Sale de `String(err)` sobre algo que no es un `Error`. Y en este repo eso es
 * el caso **normal**, no el raro: un `PostgrestError` de supabase-js es un
 * objeto plano `{ message, details, hint, code }`, y `throw error` después de
 * `const { error } = await supabase...` es el patrón que usa todo el código.
 * `String({})` da `"[object Object]"`, así que el mensaje, el código y el hint
 * se pierden justo cuando hacían falta.
 *
 * `mensajeDeError` desarma los casos reales en vez de confiar en la coerción.
 */
export function mensajeDeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name || "Error sin mensaje";
  }
  if (typeof err === "string") return err;
  if (err === null || err === undefined) return "Error sin contenido";

  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    // PostgrestError y la mayoría de los errores de API: message + code.
    const partes: string[] = [];
    if (typeof e.message === "string" && e.message) partes.push(e.message);
    if (typeof e.error === "string" && e.error) partes.push(e.error);
    if (typeof e.details === "string" && e.details) partes.push(e.details);
    if (typeof e.hint === "string" && e.hint) partes.push(`sugerencia: ${e.hint}`);
    if (typeof e.code === "string" && e.code) partes.push(`[${e.code}]`);
    if (partes.length) return partes.join(" — ");

    // Último recurso: el JSON, que al menos conserva la forma. Acotado para no
    // devolver medio dump en una respuesta HTTP.
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json.slice(0, 500);
    } catch {
      // referencias circulares
    }
  }

  return String(err);
}
