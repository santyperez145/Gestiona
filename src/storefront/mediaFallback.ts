import type { SyntheticEvent } from "react";

/**
 * Un activo público puede desaparecer después de publicado: una URL heredada
 * puede apuntar a una página HTML, vencer o ser retirada por su dueño. El
 * navegador muestra un ícono de archivo roto por defecto, que degrada la
 * confianza y además tapa el fallback que cada superficie deja debajo.
 */
export function ocultarImagenRota(event: SyntheticEvent<HTMLImageElement>): void {
  const image = event.currentTarget;
  image.hidden = true;
  image.setAttribute("data-media-state", "error");
}

/**
 * La misma etiqueta puede volver a cargar al cambiar de banner, miniatura o
 * fuente responsive. Restituirla en `load` evita que un fallo anterior deje
 * oculto un activo que sí se recuperó.
 */
export function mostrarImagenValida(event: SyntheticEvent<HTMLImageElement>): void {
  const image = event.currentTarget;
  image.hidden = false;
  image.setAttribute("data-media-state", "ready");
}
