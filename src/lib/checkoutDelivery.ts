/** La opción de retiro no necesita domicilio; cualquier entrega sí. */
export interface CheckoutDeliveryOption {
  carrier: string;
}

/**
 * Antes de que llegue la cotización sólo se puede omitir el domicilio si el
 * comercio tiene retiro habilitado: ésa es la única opción que puede aparecer
 * sin provincia. Una vez elegida una opción, manda su carrier real.
 */
export function requiereDireccionDeEntrega(
  option: CheckoutDeliveryOption | null,
  pickupEnabled: boolean,
): boolean {
  if (option) return option.carrier !== "retiro";
  return !pickupEnabled;
}
