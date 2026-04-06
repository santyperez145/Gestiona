import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const LOW_STOCK_THRESHOLD = 3;

export async function checkStockAfterSale(productId: string, productName: string) {
  const { data: product } = await supabase.from('products').select('stock').eq('id', productId).single();
  if (!product) return;

  if (product.stock === 0) {
    toast.error(`⚠️ ¡${productName} agotado!`, {
      description: 'El producto quedó sin stock. Reabastecé lo antes posible.',
      duration: 8000,
    });
  } else if (product.stock <= LOW_STOCK_THRESHOLD) {
    toast.warning(`📦 Stock bajo: ${productName}`, {
      description: `Quedan solo ${product.stock} unidades. Considerá hacer una nueva compra.`,
      duration: 6000,
    });
  }
}

export async function checkAllLowStock(userId: string): Promise<Array<{ name: string; stock: number }>> {
  const { data: products } = await supabase
    .from('products')
    .select('name, stock')
    .eq('user_id', userId)
    .lte('stock', LOW_STOCK_THRESHOLD)
    .order('stock', { ascending: true });

  return products || [];
}
