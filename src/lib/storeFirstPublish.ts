/**
 * La primera publicación no es un panel de analítica ni un aviso de Mercado Pago.
 *
 * Tres trampas del camino online:
 * 1. El wizard mandaba a Commerce con el toast «Publicá la tienda». POS manda
 *    a cargar el producto. Sin catálogo no hay nada que publicar.
 * 2. El overview abre con Revenue $0, un embudo en cero y «Activar Gestiona
 *    Pay». Transferencia ya cobra; el catálogo no está. Pay no es el primer clic.
 * 3. «Checkout iniciado» era `carritos_con_items * 0.37`. Un número plausible
 *    que nadie midió. `sinSimulacion` cubre el chat de IA; este embudo era el
 *    mismo vicio en otra pantalla.
 */

export type StoreCartSession = {
  status: string | null;
  items: unknown;
};

export type StoreFunnelStep = {
  label: string;
  value: number;
  pct: number;
  color: string;
};

export function storeWizardFinishCopy() {
  return {
    toast: 'Ruta online elegida. Cargá un producto con precio y stock; después publicás la tienda.',
  };
}

export function storeShouldShowPerformanceChrome(input: {
  sessionCount: number;
  orderCount: number;
}): boolean {
  return input.sessionCount > 0 || input.orderCount > 0;
}

export function storeShouldLeadWithPay(input: {
  fromWizard: boolean;
  publishedProducts: number;
  paymentConnected: boolean;
}): boolean {
  if (input.paymentConnected) return false;
  if (input.fromWizard && input.publishedProducts === 0) return false;
  return true;
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return parseFloat(((part / total) * 100).toFixed(1));
}

export function storeFunnelFromCarts(sessions: StoreCartSession[]): StoreFunnelStep[] {
  const total = sessions.length;
  const withItems = sessions.filter((row) => Array.isArray(row.items) && row.items.length > 0).length;
  const converted = sessions.filter((row) => row.status === 'converted').length;
  return [
    { label: 'Sesiones', value: total, pct: total > 0 ? 100 : 0, color: 'bg-blue-400' },
    { label: 'Con items en carrito', value: withItems, pct: pct(withItems, total), color: 'bg-indigo-400' },
    { label: 'Órdenes completadas', value: converted, pct: pct(converted, total), color: 'bg-emerald-400' },
  ];
}

export function storeAbandonedCartCount(sessions: StoreCartSession[]): number {
  return sessions.filter((row) => row.status === 'abandoned').length;
}
