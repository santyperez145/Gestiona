/**
 * Qué hace falta para que un producto nuevo se pueda vender.
 *
 * El formulario nació como ficha de importador: costo en USD obligatorio y
 * stock en 0 “ya lleno”. Un comercio que eligió POS podía guardar un SKU
 * sin precio de venta útil y sin unidades, y el mostrador no tenía qué cobrar.
 * El costo alimenta el margen; no es la puerta de la primera venta.
 */

export interface ProductDraftInput {
  name: string;
  salePrice: number;
  resolvedCost: number;
  manejaStock: boolean;
  stockRaw: string;
  firstUse: boolean;
}

export function validateProductDraft(input: ProductDraftInput): { ok: boolean; error?: string } {
  if (!input.name.trim()) return { ok: false, error: 'El nombre es obligatorio' };
  if (!(input.salePrice > 0)) {
    return { ok: false, error: 'El precio de venta tiene que ser mayor a 0. Sin eso no hay nada que cobrar.' };
  }
  if (input.manejaStock) {
    const parsed = Number.parseInt(input.stockRaw, 10);
    if (input.stockRaw.trim() === '' || !Number.isInteger(parsed) || parsed < 0) {
      return { ok: false, error: 'Indicá cuántas unidades hay, o marcá que no lleva stock.' };
    }
    if (input.firstUse && parsed === 0) {
      return {
        ok: false,
        error: 'Sin unidades el mostrador no puede cobrar. Cargá el stock real o marcá que no lleva stock.',
      };
    }
  }
  return { ok: true };
}

export function productCostWarning(resolvedCost: number): string | null {
  if (resolvedCost > 0) return null;
  return 'Sin costo no se calcula el margen. El producto igual se puede vender.';
}

/** La ficha completa es la de siempre; la primera no puede empezar por foto y marca. */
export function firstProductFormIsCompact(firstUse: boolean, expanded: boolean): boolean {
  return firstUse && !expanded;
}

/** Los atributos del rubro no son la puerta de la primera venta. */
export function firstProductRequiresAttributes(firstUse: boolean): boolean {
  return !firstUse;
}

export function firstProductExpandCopy() {
  return {
    label: 'Cargar foto, marca y el resto',
    hint: 'Se puede completar después. El mostrador no lo necesita para cobrar.',
  };
}

export function firstProductSubmitLabel(input: {
  firstUse: boolean;
  uploading: boolean;
  editing: boolean;
  goal: 'pos' | 'online' | null;
}): string {
  if (input.uploading) return 'Subiendo imagen...';
  if (input.editing) return 'Guardar cambios';
  if (input.firstUse && input.goal === 'pos') return 'Crear y cobrar';
  if (input.firstUse && input.goal === 'online') return 'Crear y publicar';
  return 'Crear producto';
}
