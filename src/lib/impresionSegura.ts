/**
 * Ventanas de impresión seguras (2026-11-04).
 *
 * Remitos, fichas, estados de cuenta, etiquetas y recibos se arman como HTML y
 * se escriben en una ventana nueva con `document.write`. Esa ventana comparte
 * origen con el panel: si un dato escrito por alguien de afuera llegaba sin
 * escapar —el nombre de un comprador de la tienda, que queda como cliente—,
 * un `<img onerror=…>` corría con la sesión del comercio y podía robarla. Se
 * encontró en la ficha del cliente, el estado de cuenta y el listado de deudas.
 *
 * Dos capas:
 *   1. Cada plantilla escapa lo que interpola (`escaparHtml`).
 *   2. Toda ventana de impresión pasa por `escribirParaImprimir`, que le pone
 *      una política que prohíbe cualquier script. Aunque mañana una plantilla
 *      se olvide de escapar un campo, el código inyectado no corre. Imprimir lo
 *      dispara el panel (`w.print()`), no un script adentro de la ventana.
 *
 * `src/test/impresionSegura.test.ts` impide escribir en una ventana sin pasar
 * por acá.
 */

/** Escapa un valor para meterlo en HTML (texto o atributo entre comillas). */
export function escaparHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Sin scripts de ningún tipo (ni inline, ni eventos, ni externos). Imágenes y
 * estilos sí: los remitos llevan logo, QR y su CSS.
 */
export const CSP_DE_IMPRESION =
  "default-src 'none'; script-src 'none'; img-src data: blob: https: 'self'; style-src 'unsafe-inline' 'self'; font-src data: 'self'";

/** Inserta la política al principio del documento, antes que cualquier otro contenido. */
export function conCspDeImpresion(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP_DE_IMPRESION}">`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return doctype[0] + meta + html.slice(doctype[0].length);
  return meta + html;
}

/** La única forma de llenar una ventana de impresión. */
export function escribirParaImprimir(ventana: Window, html: string): void {
  ventana.document.open();
  ventana.document.write(conCspDeImpresion(html));
  ventana.document.close();
}
