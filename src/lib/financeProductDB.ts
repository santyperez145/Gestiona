import { supabase } from '@/integrations/supabase/client';
import { financeDocumentInspectPath } from '@/lib/financeDocumentInbox';

export type ProductAccessStatus = 'available' | 'requested' | 'enabled';

export interface ProductSurfaceAccess {
  productKey: 'finance';
  status: ProductAccessStatus;
  allowed: boolean;
  canRequest: boolean;
  blocker: 'product_not_enabled' | 'module_permission_denied' | null;
  requestedAt: string | null;
  decidedAt: string | null;
}

export interface FinanceCoreSnapshot {
  suppliersCount: number;
  openPurchaseOrders: number;
  openPayablesCount: number;
  openPayablesArs: number;
  ledgerEntriesCount: number;
  precursorOcrDocuments: number;
}

export async function getFinanceProductAccess(orgId: string): Promise<ProductSurfaceAccess> {
  const { data, error } = await supabase.rpc('product_surface_access', {
    p_org_id: orgId,
    p_product_key: 'finance',
  });
  if (error) throw error;

  const row = data?.[0];
  if (!row) throw new Error('La base no devolvió el estado del producto Finance.');

  return {
    productKey: 'finance',
    status: row.status as ProductAccessStatus,
    allowed: Boolean(row.allowed),
    canRequest: Boolean(row.can_request),
    blocker: (row.blocker || null) as ProductSurfaceAccess['blocker'],
    requestedAt: row.requested_at || null,
    decidedAt: row.decided_at || null,
  };
}

export async function requestFinanceProductAccess(orgId: string): Promise<void> {
  const { error } = await supabase.rpc('request_product_access', {
    p_org_id: orgId,
    p_product_key: 'finance',
  });
  if (error) throw error;
}

export async function getFinanceCoreSnapshot(orgId: string): Promise<FinanceCoreSnapshot> {
  const { data, error } = await supabase.rpc('finance_core_snapshot', { p_org_id: orgId });
  if (error) throw error;

  const row = data?.[0];
  if (!row) throw new Error('No hay un snapshot del Business Core disponible.');

  return {
    suppliersCount: Number(row.suppliers_count || 0),
    openPurchaseOrders: Number(row.open_purchase_orders || 0),
    openPayablesCount: Number(row.open_payables_count || 0),
    openPayablesArs: Number(row.open_payables_ars || 0),
    ledgerEntriesCount: Number(row.ledger_entries_count || 0),
    precursorOcrDocuments: Number(row.precursor_ocr_documents || 0),
  };
}

/**
 * precursor_ocr_documents (nombre histórico del RPC) = documentos Finance F3
 * abiertos (status ≠ approved). No es la tabla legacy ocr_documents.
 */
export type FinanceFocoItem = { to: string; label: string; detail: string };

export type FinanceFocoOptions = {
  /** Primer documento de la cola «Por revisar»; sin id se abre la bandeja. */
  nextReviewDocumentId?: string | null;
};

/** Destinos de las métricas del Resumen: cada señal abre la cola exacta (Mendel). */
export function financeMetricHref(
  key: keyof FinanceCoreSnapshot,
  snapshot: FinanceCoreSnapshot,
  opts?: FinanceFocoOptions,
): string | null {
  switch (key) {
    case 'precursorOcrDocuments':
      if (snapshot.precursorOcrDocuments <= 0) return '/finance/documentos';
      if (opts?.nextReviewDocumentId) {
        return financeDocumentInspectPath({
          documentId: opts.nextReviewDocumentId,
          view: 'revisar',
        });
      }
      return '/finance/documentos?vista=revisar';
    case 'openPurchaseOrders':
      return snapshot.openPurchaseOrders > 0 ? '/ordenes-compra' : null;
    case 'openPayablesCount':
    case 'openPayablesArs':
      return snapshot.openPayablesCount > 0 ? '/ordenes-compra' : null;
    case 'suppliersCount':
      return snapshot.suppliersCount > 0 ? '/proveedores' : '/proveedores';
    case 'ledgerEntriesCount':
      return '/libro';
    default:
      return null;
  }
}

/**
 * Pulse de Finance: como máximo cinco acciones, sólo si el snapshot tiene
 * evidencia. No inventa colas de política/tarjeta (eso es F5 / gate).
 */
export function financeFocoFromSnapshot(
  s: FinanceCoreSnapshot,
  opts?: FinanceFocoOptions,
): FinanceFocoItem[] {
  const items: FinanceFocoItem[] = [];
  if (s.precursorOcrDocuments > 0) {
    items.push({
      to: opts?.nextReviewDocumentId
        ? financeDocumentInspectPath({
          documentId: opts.nextReviewDocumentId,
          view: 'revisar',
        })
        : '/finance/documentos?vista=revisar',
      label: 'Revisar documentos pendientes',
      detail: `${s.precursorOcrDocuments} documento${s.precursorOcrDocuments === 1 ? '' : 's'} esperando revisión humana`,
    });
  }
  if (s.openPurchaseOrders > 0) {
    items.push({
      to: '/ordenes-compra',
      label: 'Cerrar órdenes de compra',
      detail: `${s.openPurchaseOrders} abierta${s.openPurchaseOrders === 1 ? '' : 's'} en Compras`,
    });
  }
  if (s.openPayablesCount > 0) {
    items.push({
      to: '/ordenes-compra',
      label: 'Atender saldos a proveedores',
      detail: `${s.openPayablesCount} obligación${s.openPayablesCount === 1 ? '' : 'es'} · se operan en el Core`,
    });
  }
  if (s.ledgerEntriesCount === 0 && s.suppliersCount > 0) {
    items.push({
      to: '/libro',
      label: 'El libro todavía no tiene asientos',
      detail: 'Hay proveedores y el mayor está vacío',
    });
  }
  if (items.length === 0 && s.suppliersCount === 0) {
    items.push({
      to: '/proveedores',
      label: 'Cargar el primer proveedor',
      detail: 'Sin proveedores no hay documentos ni obligaciones que revisar',
    });
  }
  return items.slice(0, 5);
}
