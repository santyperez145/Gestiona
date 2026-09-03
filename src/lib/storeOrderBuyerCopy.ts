/**
 * Copy de confirmación: retiro ≠ envío.
 *
 * El recorte 126 separó la cola del comercio (Square/Shopify: pickup no se
 * despacha). La página de gracias y el mail al comprador seguían diciendo
 * «preparando tu envío» con carrier=retiro. Estas frases son el espejo de
 * `esPedidoRetiro`: un solo criterio, dos superficies.
 */

export function introPedidoPagado(esRetiro: boolean): string {
  return esRetiro
    ? "Te avisamos cuando el pedido esté listo para retirar."
    : "Ya estamos preparando tu envío. Te avisamos cuando salga.";
}

export function etiquetaCostoEntrega(esRetiro: boolean): string {
  return esRetiro ? "Retiro" : "Envío";
}

export function etiquetaDireccionEntrega(esRetiro: boolean): string {
  return esRetiro ? "Retiro en" : "Envío a";
}
