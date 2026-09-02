/**
 * Copy honesto de MercadoLibre en Integraciones.
 * Publicar es desde la ficha; órdenes se bajan con Traer y se importan a mano
 * cuando están cobradas. No prometemos sync automático que el panel no hace.
 */

export function meliDisconnectedSummary(): string {
  return "Conectá la cuenta, publicá desde la ficha del producto y bajá órdenes con Traer.";
}

export function meliListingsEmptyState(): {
  tone: "neutral";
  text: string;
  href: string;
  cta: string;
} {
  return {
    tone: "neutral",
    text: "Todavía no hay publicaciones enlazadas. Publicá desde la ficha de cada producto en Productos.",
    href: "/productos",
    cta: "Ir a Productos",
  };
}

export function meliOrdersEmptyState(): {
  text: string;
} {
  return {
    text: "Todavía no hay órdenes bajadas. Usá Traer órdenes; las cobradas se importan una a una como venta al stock y las finanzas.",
  };
}

/** El subtítulo desconectado no puede decir “automáticamente”. */
export function meliCopyIsHonest(source: string): boolean {
  const lower = source.toLowerCase();
  if (lower.includes("automáticamente") && lower.includes("órdenes")) return false;
  if (lower.includes("automaticamente") && lower.includes("ordenes")) return false;
  return true;
}
