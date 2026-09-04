type VariantLike = {
  stock: number;
  variant_type?: string | null;
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

function articuloPara(etiqueta: string): "un" | "una" {
  return /^(variante|medida|presentación)$/.test(etiqueta) ? "una" : "un";
}
