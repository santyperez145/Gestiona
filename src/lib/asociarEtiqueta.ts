/**
 * Muchas pantallas ponen la etiqueta como hermana del campo —`<label>Desde</label>`
 * y debajo `<Input>`— sin `htmlFor`: se lee, pero el lector de pantalla no la
 * asocia y tocarla no enfoca el campo (axe `label`, barrido del 2026-10-22).
 * Si la etiqueta inmediatamente anterior no apunta a nada ni contiene otro
 * campo, se la asocia a este. React no pisa el atributo: esa etiqueta nunca
 * tuvo `htmlFor` propio.
 */
export function asociarEtiquetaAnterior(input: HTMLInputElement | HTMLTextAreaElement | null, contenedor?: Element | null): void {
  if (!input || input.labels?.length || input.getAttribute("aria-label") || input.getAttribute("aria-labelledby")) return;
  const anterior = (contenedor ?? input).previousElementSibling;
  if (!(anterior instanceof HTMLLabelElement) || anterior.htmlFor || anterior.querySelector("input, select, textarea, button")) return;
  anterior.htmlFor = input.id;
}
