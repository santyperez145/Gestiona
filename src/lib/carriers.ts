/**
 * Vocabulario de transportistas.
 *
 * Vive acá y no en cada pantalla porque el `CHECK` de `deliveries.carrier` lo
 * fija en la base: inventar un valor nuevo en la UI no da un desplegable con
 * una opción más, da un error de constraint al guardar. Ya pasó — la pantalla
 * de envíos de la tienda ofrecía `correo_argentino` cuando la base espera
 * `correo_arg`.
 *
 * Agregar uno es tocar este archivo **y** el `CHECK`, en ese orden.
 */
export const CARRIER_LABELS: Record<string, string> = {
  propio: "Envío propio",
  oca: "OCA",
  andreani: "Andreani",
  correo_arg: "Correo Argentino",
  mercado_envios: "Mercado Envíos",
  otro: "Otro",
};

/** Los ids válidos, en el orden en que conviene mostrarlos. */
export const CARRIER_IDS = Object.keys(CARRIER_LABELS);

/** Etiqueta legible, con el id crudo como último recurso. */
export const carrierLabel = (id: string | null | undefined) =>
  (id && CARRIER_LABELS[id]) || id || "Sin asignar";
