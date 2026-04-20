import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

async function getThreshold(userId: string): Promise<number> {
  const { data } = await supabase.from('settings').select('low_stock_threshold').eq('user_id', userId).maybeSingle();
  return Number(data?.low_stock_threshold ?? 3);
}

export async function checkStockAfterSale(productId: string, productName: string, userId?: string) {
  const { data: product } = await supabase.from('products').select('stock, user_id').eq('id', productId).single();
  if (!product) return;

  const uid = userId || product.user_id;
  const threshold = uid ? await getThreshold(uid) : 3;

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
  const threshold = await getThreshold(userId);
  const { data: products } = await supabase
    .from('products')
    .select('name, stock')
    .eq('user_id', userId)
    .lte('stock', threshold)
    .order('stock', { ascending: true });

  return products || [];
}
