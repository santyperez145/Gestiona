import { supabase } from '@/integrations/supabase/client';

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

export type FinanceFocoItem = { to: string; label: string; detail: string };

/**
 * Pulse de Finance: como máximo cinco acciones, sólo si el snapshot tiene
 * evidencia. No inventa colas de política/tarjeta (eso es F5 / gate).
 */
export function financeFocoFromSnapshot(s: FinanceCoreSnapshot): FinanceFocoItem[] {
  const items: FinanceFocoItem[] = [];
  if (s.precursorOcrDocuments > 0) {
    items.push({
      to: "/finance/documentos",
      label: "Inspeccionar documentos",
      detail: `${s.precursorOcrDocuments} precursor${s.precursorOcrDocuments === 1 ? "" : "es"} OCR sin cadena de custodia`,
    });
  }
  if (s.openPurchaseOrders > 0) {
    items.push({
      to: "/ordenes-compra",
      label: "Cerrar órdenes de compra",
      detail: `${s.openPurchaseOrders} abierta${s.openPurchaseOrders === 1 ? "" : "s"} en el Core`,
    });
  }
  if (s.openPayablesCount > 0) {
    items.push({
      to: "/ordenes-compra",
      label: "Saldar obligaciones",
      detail: `${s.openPayablesCount} pendiente${s.openPayablesCount === 1 ? "" : "s"} · no se clona en Finance`,
    });
  }
  if (s.ledgerEntriesCount === 0 && s.suppliersCount > 0) {
    items.push({
      to: "/libro",
      label: "El libro todavía no tiene asientos",
      detail: "Hay proveedores en el Core y el ledger está vacío",
    });
  }
  return items.slice(0, 5);
}
