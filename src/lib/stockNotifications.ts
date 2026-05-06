import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { getActiveOrgId } from '@/lib/orgContext';

async function getThreshold(orgId: string): Promise<number> {
  const { data } = await supabase.from('settings').select('low_stock_threshold').eq('org_id', orgId).maybeSingle();
  return Number(data?.low_stock_threshold ?? 3);
}

export async function checkStockAfterSale(productId: string, productName: string, _userId?: string) {
  const { data: product } = await supabase.from('products').select('stock, org_id').eq('id', productId).single();
  if (!product) return;

  const orgId = (product as any).org_id || getActiveOrgId();
  const threshold = orgId ? await getThreshold(orgId) : 3;

  if (product.stock === 0) {
    toast.error(`⚠️ ¡${productName} agotado!`, {
      description: 'El producto quedó sin stock. Reabastecé lo antes posible.',
      duration: 8000,
    });
  } else if (product.stock <= threshold) {
    toast.warning(`📦 Stock bajo: ${productName}`, {
      description: `Quedan solo ${product.stock} unidades. Considerá hacer una nueva compra.`,
      duration: 6000,
    });
  }
}

export async function checkAllLowStock(userId: string): Promise<Array<{ name: string; stock: number }>> {
  const orgId = getActiveOrgId();
  if (!orgId) return [];
  const threshold = await getThreshold(orgId);
  const { data: products } = await supabase
    .from('products')
    .select('name, stock')
    .eq('org_id', orgId)
    .lte('stock', threshold)
    .order('stock', { ascending: true });

  return products || [];
}
