/**
 * Qué puede cobrar el mostrador, y por qué la grilla está vacía.
 *
 * Hasta este recorte el POS escondía `stock === 0` salvo `allow_negative_stock`.
 * Un servicio (`maneja_stock = false`) vive en 0 a propósito: no se descuenta.
 * El recorte del primer producto deja pasar “No lleva stock”; sin esta regla
 * esa ficha desaparecía al llegar a `/caja`.
 *
 * “Sin resultados” también mezclaba tres problemas opuestos: no hay catálogo,
 * hay catálogo pero nada cobrable, o la búsqueda no matchea.
 */

import { firstProductEmptyCopy, firstProductPath, type HandoffGoal } from '@/lib/activationHandoff';

export { commerceHandoffPath, posHandoffPath } from '@/lib/activationHandoff';

export type PosStockFlags = {
  stock?: number | null;
  allow_negative_stock?: boolean | null;
  maneja_stock?: boolean | null;
};

export type PosCatalogEmptyKind = 'loading' | 'none' | 'no-stock' | 'filtered';

/** El turno no es la puerta de la venta. El E2E sigue buscando “Gestionar turno”. */
export const POS_CLOSED_SHIFT_CART = 'Caja cerrada · se puede cobrar igual';
export const POS_CLOSED_SHIFT_TOPBAR = 'Caja cerrada';

export const POS_FIRST_SALE_BANNER = {
  title: 'Tocá el producto y cobrá',
  description:
    'Efectivo o transferencia. El turno se puede abrir después: sirve para conciliar el efectivo, no para vender.',
};

export function posProductIsSellable(p: PosStockFlags): boolean {
  if (p.maneja_stock === false) return true;
  return Number(p.stock) > 0 || Boolean(p.allow_negative_stock);
}

export function posProductIsOutOfStock(p: PosStockFlags): boolean {
  return !posProductIsSellable(p);
}

export function posCatalogEmptyKind(input: {
  loading: boolean;
  productCount: number;
  sellableCount: number;
  visibleCount: number;
  narrowed: boolean;
}): PosCatalogEmptyKind | null {
  if (input.loading) return 'loading';
  if (input.visibleCount > 0) return null;
  if (input.productCount === 0) return 'none';
  if (input.sellableCount === 0) return 'no-stock';
  return 'filtered';
}

export function posCatalogEmptyCopy(kind: Exclude<PosCatalogEmptyKind, 'loading'>, goal: HandoffGoal | null) {
  if (kind === 'none') {
    const copy = firstProductEmptyCopy(goal ?? 'pos');
    return {
      workspaceKind: 'empty-first-use' as const,
      title: copy.title,
      description: copy.description,
      actionLabel: copy.actionLabel,
      href: firstProductPath(goal ?? 'pos'),
    };
  }
  if (kind === 'no-stock') {
    return {
      workspaceKind: 'empty-first-use' as const,
      title: 'Hay productos, pero ninguno se puede cobrar',
      description: 'El mostrador oculta lo que no tiene unidades. Cargá stock o marcá que no lleva stock.',
      actionLabel: 'Ir a Productos',
      href: '/productos',
    };
  }
  return {
    workspaceKind: 'empty-filtered' as const,
    title: 'Ningún producto coincide',
    description: 'Probá otra búsqueda o categoría. El catálogo no está vacío.',
    actionLabel: 'Limpiar filtros',
    href: null as string | null,
  };
}
