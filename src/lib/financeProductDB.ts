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
