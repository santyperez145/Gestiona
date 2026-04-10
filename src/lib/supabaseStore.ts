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
  if (sale.product_id) {
    const { data: prod } = await supabase.from('products').select('stock').eq('id', sale.product_id).single();
    if (prod) {
      const newStock = Math.max(0, prod.stock - sale.quantity);
      await supabase.from('products').update({ stock: newStock }).eq('id', sale.product_id);
    }
  }
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
  const defaults = {
    user_id: userId, exchange_rate: 1695, customs_percent: 15, default_discount_percent: 20,
    tax_enabled: false, tax_iva_percent: 21, tax_iibb_percent: 3.5, tax_monotributo_monthly: 0,
  };
  await supabase.from('settings').insert(defaults);
  return defaults;
}

export async function saveSettingsDB(userId: string, settings: Record<string, any>) {
  const { error } = await supabase
    .from('settings')
    .upsert({ user_id: userId, ...settings }, { onConflict: 'user_id' });
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

// ========= INFLUENCER EXCHANGES =========
export async function getExchangesDB(userId: string) {
  const { data, error } = await supabase.from('influencer_exchanges').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addExchangeDB(exchange: any) {
  const { error } = await supabase.from('influencer_exchanges').insert(exchange);
  if (error) throw error;
  // Deduct stock like a sale
  if (exchange.product_id) {
    const { data: prod } = await supabase.from('products').select('stock').eq('id', exchange.product_id).single();
    if (prod) {
      const newStock = Math.max(0, prod.stock - (exchange.quantity || 1));
      await supabase.from('products').update({ stock: newStock }).eq('id', exchange.product_id);
    }
  }
}

export async function updateExchangeDB(id: string, updates: any) {
  const { error } = await supabase.from('influencer_exchanges').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteExchangeDB(id: string) {
  const { error } = await supabase.from('influencer_exchanges').delete().eq('id', id);
  if (error) throw error;
}

// ========= SALES EDIT =========
export async function updateSaleDB(id: string, updates: any, oldSale?: any) {
  const { error } = await supabase.from('sales').update(updates).eq('id', id);
  if (error) throw error;
  // Adjust stock if product changed or quantity changed
  if (oldSale?.product_id && updates.quantity !== undefined) {
    const diff = (oldSale.quantity || 0) - (updates.quantity || 0);
    if (diff !== 0) {
      const { data: prod } = await supabase.from('products').select('stock').eq('id', oldSale.product_id).single();
      if (prod) await supabase.from('products').update({ stock: Math.max(0, prod.stock + diff) }).eq('id', oldSale.product_id);
    }
  }
}

// ========= PURCHASES EDIT =========
export async function updatePurchaseDB(id: string, updates: any, oldPurchase?: any) {
  const { error } = await supabase.from('purchases').update(updates).eq('id', id);
  if (error) throw error;
  if (oldPurchase?.product_id && updates.quantity !== undefined) {
    const diff = (updates.quantity || 0) - (oldPurchase.quantity || 0);
    if (diff !== 0) {
      const { data: prod } = await supabase.from('products').select('stock').eq('id', oldPurchase.product_id).single();
      if (prod) await supabase.from('products').update({ stock: Math.max(0, prod.stock + diff) }).eq('id', oldPurchase.product_id);
    }
  }
}

// ========= AUDIT LOGS =========
export async function getAuditLogsDB(limit = 50) {
  const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// ========= CUSTOMERS =========
export async function getUniqueCustomersDB(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('sales').select('customer_name').eq('user_id', userId).not('customer_name', 'is', null);
  if (error) throw error;
  const names = [...new Set((data || []).map(d => d.customer_name).filter(Boolean))] as string[];
  return names.sort((a, b) => a.localeCompare(b, 'es'));
}

// ========= HELPERS =========
export function formatARS(n: number) { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n); }
export function formatUSD(n: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }

/** Parse a date string safely for Argentina timezone display */
export function formatDateAR(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

/** Append noon time to a date-only string to avoid timezone offset issues */
export function dateToNoon(dateStr: string) {
  if (dateStr.includes('T')) return dateStr;
  return dateStr + 'T12:00:00';
}

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

/** Calculate tax deductions on profit */
export function calculateTaxes(profitARS: number, settings: any) {
  if (!settings?.tax_enabled) return { iva: 0, iibb: 0, monotributo: 0, totalTax: 0, netProfit: profitARS };
  const iva = profitARS * (Number(settings.tax_iva_percent || 21) / 100);
  const iibb = profitARS * (Number(settings.tax_iibb_percent || 3.5) / 100);
  const monotributo = Number(settings.tax_monotributo_monthly || 0);
  const totalTax = iva + iibb + monotributo;
  return { iva, iibb, monotributo, totalTax, netProfit: profitARS - totalTax };
}

// Seed products for a new user
export async function seedProductsForUser(userId: string) {
  const { data: existing } = await supabase.from('products').select('id').eq('user_id', userId).limit(1);
  if (existing && existing.length > 0) return;
  const { seedProductsList } = await import('./seedData');
  const products = seedProductsList.map(p => ({ ...p, user_id: userId, id: crypto.randomUUID() }));
  for (let i = 0; i < products.length; i += 50) {
    await supabase.from('products').insert(products.slice(i, i + 50));
  }
}
