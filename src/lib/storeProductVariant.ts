type VariantLike = {
  stock: number;
  variant_type?: string | null;
};

type PricedVariantLike = VariantLike & {
  id: string;
  price_override?: number | null;
};

const LABELS: Record<string, string> = {
  sabor: "Sabor",
  color: "Color",
  talle: "Talle",
  medida: "Medida",
  tamano: "Tamaño",
  tamaño: "Tamaño",
  presentacion: "Presentación",
  presentación: "Presentación",
};

export function etiquetaTipoVariante(tipo: string | null | undefined): string {
  const normalizado = String(tipo ?? "").trim().toLocaleLowerCase("es-AR");
  return LABELS[normalizado] ?? "Variante";
}

export function textoDisponibilidadProducto({
  variants,
  selected,
  productStock,
}: {
  variants: VariantLike[];
  selected: VariantLike | null;
  productStock: number;
}): string {
  if (variants.length > 0 && !selected) {
    const etiqueta = etiquetaTipoVariante(variants[0]?.variant_type).toLocaleLowerCase("es-AR");
    return `Elegí ${articuloPara(etiqueta)} ${etiqueta} para ver disponibilidad.`;
  }

  const stock = selected ? Number(selected.stock) : Number(productStock);
  if (stock <= 0) return selected ? "Esta variante está agotada." : "Sin stock";
  if (stock === 1) return "¡Última unidad!";
  if (stock <= 3) return `¡Últimas ${stock} unidades!`;
  return "En stock";
}

export function textoCtaVariante(tipo: string | null | undefined): string {
  const etiqueta = etiquetaTipoVariante(tipo).toLocaleLowerCase("es-AR");
  return `Elegí ${articuloPara(etiqueta)} ${etiqueta}`;
}

/**
 * Precio efectivo de una variante en la tienda. Es la misma regla que usa el
 * carrito y la ficha: un override positivo reemplaza al precio promocional del
 * producto; sin override, hereda ese precio. La orden vuelve a calcularlo en
 * `resolve_store_line`, que sigue siendo la autoridad.
 */
export function precioDeVariante(
  precioProducto: number,
  variante: Pick<PricedVariantLike, "price_override"> | null | undefined,
): number {
  const override = Number(variante?.price_override);
  return override > 0 ? override : Number(precioProducto);
}

/**
 * Una card informa precio y disponibilidad sin convertirse en otra ficha de
 * producto. Toda decisión de SKU se deriva a la PDP, donde también se pueden
 * elegir las agotadas para pedir reposición.
 */
export function resumenVariantesParaCard<T extends PricedVariantLike>(
  variantes: T[],
  precioProducto: number,
) {
  const disponibles = variantes.filter(variante => Number(variante.stock) > 0);
  const agotadas = variantes.length - disponibles.length;
  const candidatasDePrecio = disponibles.length > 0 ? disponibles : variantes;
  const precios = candidatasDePrecio.map(variante => precioDeVariante(precioProducto, variante));
  const precio = precios.length > 0 ? Math.min(...precios) : Number(precioProducto);

  return {
    disponibles,
    agotadas,
    precio,
    desde: new Set(precios).size > 1,
    stockDisponible: disponibles.reduce((total, variante) => total + Number(variante.stock), 0),
  };
}

function articuloPara(etiqueta: string): "un" | "una" {
  return /^(variante|medida|presentación)$/.test(etiqueta) ? "una" : "un";
}
