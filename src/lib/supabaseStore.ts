import { supabase } from '@/integrations/supabase/client';

// ========= PRODUCTS =========
export async function getProductsDB(userId: string) {
  const { data, error } = await supabase.from('products').select('*').eq('user_id', userId).order('name');
  if (error) throw error;
  return data || [];
}

export async function addProductDB(product: any) {
  const { error } = await supabase.from('products').insert(product);
  if (error) throw error;
}

export async function updateProductDB(id: string, updates: any) {
  const { error } = await supabase.from('products').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteProductDB(id: string) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

// ========= PURCHASES =========
export async function getPurchasesDB(userId: string) {
  const { data, error } = await supabase.from('purchases').select('*').eq('user_id', userId).order('date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addPurchaseDB(purchase: any) {
  const { error } = await supabase.from('purchases').insert(purchase);
  if (error) throw error;
  // Update product stock
  if (purchase.product_id) {
    const { data: prod } = await supabase.from('products').select('stock').eq('id', purchase.product_id).single();
    if (prod) {
      await supabase.from('products').update({ stock: prod.stock + purchase.quantity }).eq('id', purchase.product_id);
    }
  }
}

export async function deletePurchaseDB(id: string) {
  const { error } = await supabase.from('purchases').delete().eq('id', id);
  if (error) throw error;
}

// ========= SALES =========
export async function getSalesDB(userId: string) {
  const { data, error } = await supabase.from('sales').select('*').eq('user_id', userId).order('date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addSaleDB(sale: any) {
  const { error } = await supabase.from('sales').insert(sale);
  if (error) throw error;
  // Reduce stock
  if (sale.product_id) {
    const { data: prod } = await supabase.from('products').select('stock').eq('id', sale.product_id).single();
    if (prod) {
      await supabase.from('products').update({ stock: Math.max(0, prod.stock - sale.quantity) }).eq('id', sale.product_id);
    }
  }
  // Auto-create debt if unpaid
  if (!sale.paid) {
    await supabase.from('debts').insert({
      user_id: sale.user_id,
      sale_id: sale.id,
      customer_name: sale.customer_name || 'Sin nombre',
      amount_ars: sale.total_ars,
      paid_ars: 0,
      remaining_ars: sale.total_ars,
      description: `Venta de ${sale.quantity}x ${sale.product_name}`,
      date: sale.date,
      status: 'pending',
    });
  }
}

export async function deleteSaleDB(id: string) {
  const { error } = await supabase.from('sales').delete().eq('id', id);
  if (error) throw error;
}

// ========= DEBTS =========
export async function getDebtsDB(userId: string) {
  const { data, error } = await supabase.from('debts').select('*').eq('user_id', userId).order('date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updateDebtDB(id: string, updates: any) {
  const { error } = await supabase.from('debts').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteDebtDB(id: string) {
  const { error } = await supabase.from('debts').delete().eq('id', id);
  if (error) throw error;
}

// ========= SETTINGS =========
export async function getSettingsDB(userId: string) {
  const { data } = await supabase.from('settings').select('*').eq('user_id', userId).single();
  if (data) return data;
  // Create default settings
  const defaults = { user_id: userId, exchange_rate: 1695, customs_percent: 15, default_discount_percent: 20 };
  await supabase.from('settings').insert(defaults);
  return defaults;
}

export async function saveSettingsDB(userId: string, settings: { exchange_rate: number; customs_percent: number; default_discount_percent: number }) {
  const { error } = await supabase.from('settings').upsert({ user_id: userId, ...settings });
  if (error) throw error;
}

// ========= MARKETING =========
export async function getMarketingPostsDB(userId: string) {
  const { data, error } = await supabase.from('marketing_posts').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addMarketingPostDB(post: any) {
  const { error } = await supabase.from('marketing_posts').insert(post);
  if (error) throw error;
}

export async function updateMarketingPostDB(id: string, updates: any) {
  const { error } = await supabase.from('marketing_posts').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteMarketingPostDB(id: string) {
  const { error } = await supabase.from('marketing_posts').delete().eq('id', id);
  if (error) throw error;
}

// ========= HELPERS =========
export function formatARS(n: number) { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n); }
export function formatUSD(n: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }

export function getCategoryLabel(cat: string) {
  const map: Record<string, string> = { perfume_arabe: 'Perfume Árabe', 'perfume_diseñador': 'Perfume Diseñador', vaper: 'Vaper', electronico: 'Electrónico' };
  return map[cat] || cat;
}

export function getGenderLabel(g: string) {
  const map: Record<string, string> = { masculino: 'Masculino', femenino: 'Femenino', unisex: 'Unisex' };
  return map[g] || g;
}

export function calculateProductProfits(costUSD: number, customsPercent: number, salePriceARS: number, exchangeRate: number) {
  const customsFee = costUSD * (customsPercent / 100);
  const totalCostUSD = costUSD + customsFee;
  const totalCostARS = totalCostUSD * exchangeRate;
  const profitPerUnitARS = salePriceARS - totalCostARS;
  const profitPerUnitUSD = profitPerUnitARS / exchangeRate;
  return { customsFee, totalCostUSD, totalCostARS, profitPerUnitARS, profitPerUnitUSD };
}

// Seed products for a new user
export async function seedProductsForUser(userId: string) {
  const { data: existing } = await supabase.from('products').select('id').eq('user_id', userId).limit(1);
  if (existing && existing.length > 0) return;

  const { seedProductsList } = await import('./seedData');
  const products = seedProductsList.map(p => ({ ...p, user_id: userId, id: crypto.randomUUID() }));
  
  // Insert in batches
  for (let i = 0; i < products.length; i += 50) {
    await supabase.from('products').insert(products.slice(i, i + 50));
  }
}
