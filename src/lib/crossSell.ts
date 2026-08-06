/**
 * "Completá tu compra": qué ofrecer en el carrito.
 *
 * En la ficha ya hay "También te puede gustar", que es descubrimiento. Esto es
 * otra cosa: el comprador **ya decidió**, tiene la tarjeta en la mano, y es el
 * momento en que un agregado cuesta menos que en cualquier otro punto del
 * embudo. Tiendanube y MercadoLibre lo tienen; acá el carrito no ofrecía nada.
 *
 * ── La regla que lo hace distinto de una vidriera más ────────────────────
 *
 * **Primero lo que completa el envío gratis.** Si al comprador le faltan
 * $18.000 para el umbral, un producto de $20.000 no es "otra sugerencia": es
 * la que convierte $18.000 de gasto extra en algo que además le ahorra el
 * envío. Es el único caso donde agregar al carrito le conviene a los dos.
 *
 * No se sugiere cualquier cosa que pase el umbral: un producto que lo pasa por
 * cinco veces no completa nada, sólo parece un intento de vender más caro. El
 * tope está en 1,6× lo que falta.
 *
 * Después manda la afinidad —misma marca, misma categoría— y al final lo más
 * vendido, que es el desempate honesto cuando no se sabe nada más.
 */

export interface ProductoSugerible {
  id: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  stock?: number | null;
  total_sold?: number | null;
  image_url?: string | null;
}

export interface LineaDelCarrito {
  productId: string;
  price: number;
  qty: number;
}

export type MotivoSugerencia = "envio_gratis" | "misma_marca" | "misma_categoria" | "mas_vendido";

export interface Sugerencia<T extends ProductoSugerible = ProductoSugerible> {
  producto: T;
  precio: number;
  motivo: MotivoSugerencia;
  /** Sólo para `envio_gratis`: cuánto faltaba. Sirve para el texto. */
  faltaba?: number;
}

export const TEXTO_MOTIVO: Record<MotivoSugerencia, string> = {
  envio_gratis:     "Sumalo y tenés el envío gratis",
  misma_marca:      "De la misma marca",
  misma_categoria:  "Combina con lo que llevás",
  mas_vendido:      "De lo más vendido",
};

/** Cuánto puede exceder el faltante un producto para que "completarlo" tenga sentido. */
export const TOLERANCIA_ENVIO = 1.6;

interface Opciones<T extends ProductoSugerible> {
  cart: LineaDelCarrito[];
  productos: T[];
  /** Precio de venta vigente de cada producto. */
  precioDe: (p: T) => number;
  /** Cuánto falta para el envío gratis, o null si no aplica o ya se alcanzó. */
  faltaEnvioGratis?: number | null;
  limite?: number;
}

/**
 * Devuelve hasta `limite` sugerencias, sin repetir producto y sin ofrecer nada
 * que ya esté en el carrito ni sin stock.
 */
export function sugerenciasParaElCarrito<T extends ProductoSugerible>({
  cart, productos, precioDe, faltaEnvioGratis = null, limite = 3,
}: Opciones<T>): Sugerencia<T>[] {
  if (cart.length === 0) return [];

  const enCarrito = new Set(cart.map(l => l.productId));
  const marcas = new Set<string>();
  const categorias = new Set<string>();
  for (const l of cart) {
    const p = productos.find(x => x.id === l.productId);
    if (p?.brand) marcas.add(p.brand);
    if (p?.category) categorias.add(p.category);
  }

  const candidatos = productos.filter(p =>
    !enCarrito.has(p.id) && (Number(p.stock) || 0) > 0 && precioDe(p) > 0,
  );

  const falta = Number(faltaEnvioGratis) || 0;
  const elegidas: Sugerencia<T>[] = [];
  const yaElegido = new Set<string>();

  const agregar = (p: T, motivo: MotivoSugerencia, faltaba?: number) => {
    if (yaElegido.has(p.id) || elegidas.length >= limite) return;
    yaElegido.add(p.id);
    elegidas.push({ producto: p, precio: precioDe(p), motivo, faltaba });
  };

  // 1) Los que completan el envío gratis, del más barato que alcance.
  if (falta > 0) {
    candidatos
      .filter(p => {
        const precio = precioDe(p);
        return precio >= falta && precio <= falta * TOLERANCIA_ENVIO;
      })
      .sort((a, b) => precioDe(a) - precioDe(b))
      .forEach(p => agregar(p, "envio_gratis", falta));
  }

  // 2) Misma marca. Del más barato: es un agregado, no un reemplazo.
  candidatos
    .filter(p => p.brand && marcas.has(p.brand))
    .sort((a, b) => precioDe(a) - precioDe(b))
    .forEach(p => agregar(p, "misma_marca"));

  // 3) Misma categoría.
  candidatos
    .filter(p => p.category && categorias.has(p.category))
    .sort((a, b) => precioDe(a) - precioDe(b))
    .forEach(p => agregar(p, "misma_categoria"));

  // 4) Lo más vendido, que es el desempate honesto cuando no hay afinidad.
  [...candidatos]
    .sort((a, b) => (Number(b.total_sold) || 0) - (Number(a.total_sold) || 0))
    .forEach(p => agregar(p, "mas_vendido"));

  return elegidas.slice(0, limite);
}
