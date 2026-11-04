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
 * 4. Siete medios al mismo nivel. QR pide Mercado Pago, fiado no cobra y
 *    mayorista no es un cobro. En la primera visita sólo se muestran
 *    efectivo, transferencia y débito; el resto queda detrás de «Más medios».
 *
 * 2026-11-03: débito estaba escondido detrás de «Más medios». Un local con
 * posnet cobra con tarjeta desde el primer día y no encontraba cómo. Débito
 * cierra el ticket igual que efectivo: no pide Mercado Pago ni deja deuda.
 * El recibo además decía «El turno no hace falta para que cuente», jerga que
 * nadie había explicado, y la primera venta no se festejaba.
 */

import { posHandoffPath } from '@/lib/activationHandoff';

export type PosPayMethod = 'efectivo' | 'transferencia' | 'debito' | 'credito' | 'qr' | 'mayorista' | 'fiado' | string;

export const POS_FIRST_TICKET_METHODS = ['efectivo', 'transferencia', 'debito'] as const;

export type PosFirstTicketMethod = (typeof POS_FIRST_TICKET_METHODS)[number];

export function posIsFirstTicketMethod(method: string): boolean {
  return (POS_FIRST_TICKET_METHODS as readonly string[]).includes(method);
}

export function posShowAllPayMethods(input: {
  firstTicket: boolean;
  expanded: boolean;
  payMethod: string;
  splitMode: boolean;
}): boolean {
  if (!input.firstTicket) return true;
  if (input.expanded || input.splitMode) return true;
  return !posIsFirstTicketMethod(input.payMethod);
}

export function posVisiblePayMethods<T extends { value: string }>(
  all: T[],
  input: {
    firstTicket: boolean;
    expanded: boolean;
    payMethod: string;
    splitMode: boolean;
    allowQr: boolean;
  },
): T[] {
  const list = input.allowQr ? all : all.filter((method) => method.value !== 'qr');
  if (posShowAllPayMethods(input)) return list;
  return list.filter((method) => posIsFirstTicketMethod(method.value));
}

export function posFirstTicketPayCopy() {
  return {
    hint: 'Efectivo, transferencia o débito cierran el ticket. Crédito, QR y fiado están en «Más medios».',
    expandLabel: 'Más medios',
    collapseLabel: 'Sólo efectivo, transferencia y débito',
  };
}

export function posPayMethodCaution(method: string): string | null {
  if (method === 'fiado') {
    return 'Fiado no cobra. El ticket queda a cuenta.';
  }
  return null;
}

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

/**
 * 2026-11-03: `first` festeja la primera venta del asistente y `offline` no
 * promete que ya está en Ventas cuando todavía espera la conexión.
 */
export function posReceiptCopy(collected: boolean, opts?: { offline?: boolean; first?: boolean }) {
  if (collected) {
    return {
      title: opts?.first ? '¡Primera venta hecha!' : 'Venta cobrada',
      description: opts?.offline
        ? 'Quedó guardada en este dispositivo y pasa a Ventas cuando vuelva la conexión.'
        : 'Quedó guardada en Ventas.',
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
      description: 'La primera venta se cobra en el mostrador. Efectivo, transferencia o débito alcanzan; no hace falta cliente ni factura.',
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
