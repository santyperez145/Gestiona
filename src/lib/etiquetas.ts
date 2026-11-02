/**
 * Etiquetas vinculadas a su campo (2026-11-02).
 *
 * 912 etiquetas de la app (`<Label>` y `<label>`) estaban al lado de su campo
 * sin `htmlFor`: un lector de pantalla anunciaba «campo de edición» sin decir
 * cuál, y tocar la etiqueta no llevaba al campo. Axe no lo marcaba porque casi
 * todos tienen placeholder. Esto las vincula solas, con una regla que no
 * adivina: sólo si el bloque que las contiene tiene exactamente una etiqueta
 * suelta y un control, y el control viene después de la etiqueta.
 */
const CONTROLES = [
  "input:not([type=hidden])",
  "select",
  "textarea",
  "[role=combobox]",
  "[role=switch]",
  "[role=checkbox]",
  "[role=radiogroup]",
  "[role=slider]",
].join(", ");

/** Hasta dónde se sube buscando el campo: etiqueta y campo en cajas hermanas. */
const NIVELES = 3;

let contador = 0;

function suelta(etiqueta: HTMLLabelElement): boolean {
  return !etiqueta.htmlFor && !etiqueta.control && !etiqueta.querySelector(CONTROLES);
}

/** Vincula una etiqueta con su campo si no hay ninguna duda; si no, no toca nada. */
export function vincularEtiqueta(etiqueta: HTMLLabelElement): boolean {
  if (!suelta(etiqueta)) return false;
  let caja = etiqueta.parentElement;
  for (let nivel = 0; caja && nivel < NIVELES; nivel++, caja = caja.parentElement) {
    const controles = Array.from(caja.querySelectorAll<HTMLElement>(CONTROLES)).filter(c => !c.closest("label"));
    if (controles.length === 0) continue;
    const etiquetas = Array.from(caja.querySelectorAll("label")).filter(suelta);
    if (controles.length !== 1 || etiquetas.length !== 1) return false;
    const control = controles[0];
    if (!(etiqueta.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
    contador += 1;
    if (!control.id) control.id = `campo-${contador}`;
    if (!etiqueta.id) etiqueta.id = `etiqueta-${contador}`;
    etiqueta.htmlFor = control.id;
    // `for` sólo nombra a input, select, textarea y button; un combobox hecho
    // con un div necesita aria-labelledby. Nunca pisa un nombre que ya tenga.
    if (!control.hasAttribute("aria-label") && !control.hasAttribute("aria-labelledby")) {
      control.setAttribute("aria-labelledby", etiqueta.id);
    }
    return true;
  }
  return false;
}

export function vincularEtiquetas(raiz: ParentNode = document): number {
  let vinculadas = 0;
  raiz.querySelectorAll<HTMLLabelElement>("label:not([for])").forEach(etiqueta => {
    if (vincularEtiqueta(etiqueta)) vinculadas += 1;
  });
  return vinculadas;
}

/** Mantiene vinculadas las etiquetas que React va montando, una vez por cuadro. */
export function vincularEtiquetasSiempre(): () => void {
  let pendiente = 0;
  const programar = () => {
    if (pendiente) return;
    pendiente = requestAnimationFrame(() => { pendiente = 0; vincularEtiquetas(); });
  };
  const observador = new MutationObserver(programar);
  observador.observe(document.body, { childList: true, subtree: true });
  programar();
  return () => { observador.disconnect(); if (pendiente) cancelAnimationFrame(pendiente); };
}
