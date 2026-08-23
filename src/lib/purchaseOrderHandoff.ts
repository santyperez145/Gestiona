export type PurchaseOrderHandoffAction = 'view' | 'receive';

export interface PurchaseOrderHandoff {
  orderId: string;
  action: PurchaseOrderHandoffAction;
  source: 'finance' | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildPurchaseOrderHandoffPath(
  orderId: string,
  action: PurchaseOrderHandoffAction = 'view',
): string {
  if (!UUID_PATTERN.test(orderId)) return '/ordenes-compra';
  const params = new URLSearchParams({ purchaseOrder: orderId, action, source: 'finance' });
  return `/ordenes-compra?${params.toString()}`;
}

export function parsePurchaseOrderHandoff(params: URLSearchParams): PurchaseOrderHandoff | null {
  const orderId = params.get('purchaseOrder')?.trim() || '';
  if (!UUID_PATTERN.test(orderId)) return null;
  return {
    orderId,
    action: params.get('action') === 'receive' ? 'receive' : 'view',
    source: params.get('source') === 'finance' ? 'finance' : null,
  };
}

export function isPurchaseOrderReceivable(status: string): boolean {
  return status === 'confirmed' || status === 'partially_received';
}
