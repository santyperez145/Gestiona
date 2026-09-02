/**
 * El primer ticket tiene que verse cobrado, y Ventas tiene que apuntar al
 * mostrador — no a un formulario paralelo.
 *
 * Tres trampas del camino actual:
 * 1. Al abrir el POS, «¿Quién atiende hoy?» tapa la grilla. El vendedor es
 *    opcional; la venta se guarda igual sin nombre.
 * 2. El recibo de una venta ya cobrada ofrece «Generar link Mercado Pago».
 *    El comentario del QR ya lo sabía: un segundo cobro duplica. Efectivo y
 *    transferencia son el mismo caso.
 * 3. Ventas vacío abre SaleForm («Nueva Venta»). Eso no es el POS. El
 *    segundo comercio que eligió mostrador cobra en `/caja`.
 */

import { posHandoffPath } from '@/lib/activationHandoff';

export type PosPayMethod = 'efectivo' | 'transferencia' | 'debito' | 'credito' | 'qr' | 'mayorista' | 'fiado' | string;

export function posShouldAutoPromptSeller(fromWizard: boolean, sellerName: string | null | undefined): boolean {
  if (fromWizard) return false;
  return !String(sellerName ?? '').trim();
}

export function posPaymentAlreadyCollected(input: {
  payMethod: PosPayMethod;
  splitMode: boolean;
  splitMethod1?: string;
  splitMethod2?: string;
}): boolean {
  if (input.splitMode) {
    return input.splitMethod1 !== 'fiado' && input.splitMethod2 !== 'fiado';
  }
  return input.payMethod !== 'fiado';
}

export function posReceiptCopy(collected: boolean) {
  if (collected) {
    return {
      title: 'Venta cobrada',
      description: 'El ticket quedó en Ventas. El turno no hace falta para que cuente.',
    };
  }
  return {
    title: 'Venta a cuenta',
    description: 'Quedó registrada, pero el cobro sigue pendiente. El link de pago es para eso, no para una venta ya cobrada.',
  };
}

export function ticketSalesPath(saleId: string | null | undefined): string {
  if (!saleId) return '/ventas';
  return `/ventas?sale=${saleId}`;
}

export type SalesListEmptyKind = 'none' | 'filtered';

export function salesListEmptyKind(input: {
  saleCount: number;
  filteredCount: number;
}): SalesListEmptyKind | null {
  if (input.filteredCount > 0) return null;
  if (input.saleCount === 0) return 'none';
  return 'filtered';
}

export function salesListEmptyCopy(kind: SalesListEmptyKind) {
  if (kind === 'none') {
    return {
      workspaceKind: 'empty-first-use' as const,
      title: 'Todavía no hay un ticket',
      description: 'La primera venta se cobra en el mostrador. Efectivo o transferencia alcanzan; no hace falta cliente ni factura.',
      actionLabel: 'Cobrar en el POS',
      href: posHandoffPath(),
    };
  }
  return {
    workspaceKind: 'empty-filtered' as const,
    title: 'Ninguna venta coincide',
    description: 'Hay ventas, pero los filtros o el período las esconden.',
    actionLabel: 'Limpiar filtros',
    href: null as string | null,
  };
}
