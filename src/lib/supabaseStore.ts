import { supabase } from '@/integrations/supabase/client';
import { getActiveOrgId, requireActiveOrgId } from './orgContext';

/** Get the active org id, falling back to looking it up by user (for legacy callers). */
async function orgIdFor(_userId?: string): Promise<string> {
  const cached = getActiveOrgId();
  if (cached) return cached;
  if (!_userId) throw new Error('No active organization');
  const { data } = await supabase.from('memberships').select('org_id').eq('user_id', _userId).limit(1).maybeSingle();
  if (!data?.org_id) throw new Error('User has no organization');
  return data.org_id;
}

// ========= PRODUCTS =========
export async function getProductsDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('products').select('*').eq('org_id', orgId).order('name');
  if (error) throw error;
  return data || [];
}

export async function addProductDB(product: any) {
  const orgId = product.org_id || requireActiveOrgId();
  const { error } = await supabase.from('products').insert({ ...product, org_id: orgId });
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
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('purchases').select('*').eq('org_id', orgId).order('date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addPurchaseDB(purchase: any) {
  const orgId = purchase.org_id || requireActiveOrgId();
  const { error } = await supabase.from('purchases').insert({ ...purchase, org_id: orgId });
  if (error) throw error;
  // Skip stock update for scheduled (future) purchases — they aren't received yet
  if (purchase.product_id && !purchase.is_scheduled) {
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
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('sales').select('*').eq('org_id', orgId).order('date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addSaleDB(sale: any) {
  const orgId = sale.org_id || requireActiveOrgId();
  sale.org_id = orgId;
  const { error } = await supabase.from('sales').insert({ ...sale, org_id: orgId });
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
      org_id: orgId,
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
  // Fetch previous to detect status transition for sale sync
  const { data: prev } = await supabase.from('debts').select('*').eq('id', id).maybeSingle();
  const { error } = await supabase.from('debts').update(updates).eq('id', id);
  if (error) throw error;
  // Sync linked sale.paid based on debt status transition
  if (prev?.sale_id) {
    const newStatus = updates.status ?? prev.status;
    const becamePaid = newStatus === 'paid' && prev.status !== 'paid';
    const becameUnpaid = newStatus !== 'paid' && prev.status === 'paid';
    if (becamePaid) {
      await supabase.from('sales').update({ paid: true }).eq('id', prev.sale_id);
      await supabase.from('notifications').insert({
        user_id: prev.user_id,
        org_id: (prev as any).org_id || requireActiveOrgId(),
        title: 'Venta cobrada',
        message: `Se marcó como pagada la venta de ${prev.customer_name}`,
        type: 'venta_cobrada', entity_type: 'sale', entity_id: prev.sale_id,
      });
    } else if (becameUnpaid) {
      await supabase.from('sales').update({ paid: false }).eq('id', prev.sale_id);
    }
  }
}

export async function deleteDebtDB(id: string) {
  const { error } = await supabase.from('debts').delete().eq('id', id);
  if (error) throw error;
}

/** Register a debt payment and auto-sync sale status if fully paid. */
export async function addDebtPaymentDB(debtId: string, paymentARS: number) {
  const { data: debt } = await supabase.from('debts').select('*').eq('id', debtId).maybeSingle();
  if (!debt) throw new Error('Deuda no encontrada');
  const newPaid = Number(debt.paid_ars) + paymentARS;
  const newRemaining = Math.max(0, Number(debt.amount_ars) - newPaid);
  const newStatus = newRemaining <= 0.01 ? 'paid' : 'partial';
  await updateDebtDB(debtId, { paid_ars: newPaid, remaining_ars: newRemaining, status: newStatus });
  return { newPaid, newRemaining, newStatus, debt };
}

// ========= SETTINGS =========
export async function getSettingsDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data } = await supabase.from('settings').select('*').eq('org_id', orgId).maybeSingle();
  if (data) return data;
  const defaults: any = {
    org_id: orgId, user_id: userId, exchange_rate: 1695, customs_percent: 15, default_discount_percent: 20,
    tax_enabled: false, tax_iva_percent: 21, tax_iibb_percent: 3.5, tax_monotributo_monthly: 0,
  };
  await supabase.from('settings').insert(defaults);
  return defaults;
}

export async function saveSettingsDB(userId: string, settings: Record<string, any>) {
  const orgId = await orgIdFor(userId);
  const { error } = await supabase
    .from('settings')
    .upsert({ org_id: orgId, user_id: userId, ...settings } as any, { onConflict: 'org_id' });
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
  const { requireActiveOrgId } = await import('./orgContext');
  const orgId = requireActiveOrgId();
  const { error } = await supabase.from('influencer_exchanges').insert({ ...exchange, org_id: orgId });
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

// ========= SALES AGGREGATED (for auto-restock) =========
export async function getSalesAggregatedDB(userId: string, days: number = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from('sales')
    .select('product_id, product_name, quantity')
    .eq('user_id', userId)
    .gte('date', since.toISOString());
  if (error) throw error;
  const agg: Record<string, { product_id: string; product_name: string; total_qty: number }> = {};
  (data || []).forEach(s => {
    if (!s.product_id) return;
    if (!agg[s.product_id]) agg[s.product_id] = { product_id: s.product_id, product_name: s.product_name, total_qty: 0 };
    agg[s.product_id].total_qty += s.quantity;
  });
  return Object.values(agg).sort((a, b) => b.total_qty - a.total_qty);
}

// ========= CUSTOMERS =========
export async function getUniqueCustomersDB(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('sales').select('customer_name').eq('user_id', userId).not('customer_name', 'is', null);
  if (error) throw error;
  const names = [...new Set((data || []).map(d => d.customer_name).filter(Boolean))] as string[];
  return names.sort((a, b) => a.localeCompare(b, 'es'));
}

// ========= COUPONS =========
export async function getCouponsDB(userId: string) {
  const { data, error } = await supabase.from('coupons').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addCouponDB(coupon: any) {
  const { error } = await supabase.from('coupons').insert(coupon);
  if (error) throw error;
}

export async function updateCouponDB(id: string, updates: any) {
  const { error } = await supabase.from('coupons').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteCouponDB(id: string) {
  const { error } = await supabase.from('coupons').delete().eq('id', id);
  if (error) throw error;
}

export async function validateCouponDB(userId: string, code: string) {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('user_id', userId)
    .eq('code', code.toUpperCase().trim())
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { valid: false, reason: 'Cupón no encontrado' };
  if (data.max_uses && data.current_uses >= data.max_uses) return { valid: false, reason: 'Cupón agotado' };
  if (data.valid_from && new Date(data.valid_from) > new Date()) return { valid: false, reason: 'Cupón aún no vigente' };
  if (data.valid_until && new Date(data.valid_until) < new Date()) return { valid: false, reason: 'Cupón expirado' };
  return { valid: true, coupon: data };
}

export async function incrementCouponUse(id: string) {
  const { data } = await supabase.from('coupons').select('current_uses').eq('id', id).single();
  if (data) {
    await supabase.from('coupons').update({ current_uses: (data.current_uses || 0) + 1 }).eq('id', id);
  }
}

// ========= SELLER GOALS =========
export async function getSellerGoalsDB(ownerId: string) {
  const { data, error } = await supabase.from('seller_goals').select('*').eq('owner_id', ownerId).order('month', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertSellerGoalDB(goal: any) {
  const { error } = await supabase.from('seller_goals').upsert(goal, { onConflict: 'user_id,month' });
  if (error) throw error;
}

export async function getMyGoalsDB(userId: string) {
  const { data, error } = await supabase.from('seller_goals').select('*').eq('user_id', userId).order('month', { ascending: false }).limit(3);
  if (error) throw error;
  return data || [];
}

// ========= PRODUCT VARIANTS =========
export async function getVariantsDB(productId: string) {
  const { data, error } = await supabase.from('product_variants').select('*').eq('product_id', productId).order('variant_name');
  if (error) throw error;
  return data || [];
}

export async function getVariantsByUserDB(userId: string) {
  const { data, error } = await supabase.from('product_variants').select('*').eq('user_id', userId).eq('active', true).order('variant_name');
  if (error) throw error;
  return data || [];
}

export async function addVariantDB(variant: any) {
  const { error } = await supabase.from('product_variants').insert(variant);
  if (error) throw error;
}

export async function updateVariantDB(id: string, updates: any) {
  const { error } = await supabase.from('product_variants').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteVariantDB(id: string) {
  const { error } = await supabase.from('product_variants').delete().eq('id', id);
  if (error) throw error;
}

export async function syncProductStockFromVariants(productId: string) {
  const variants = await getVariantsDB(productId);
  const totalStock = variants.filter(v => v.active).reduce((s: number, v: any) => s + (v.stock || 0), 0);
  await supabase.from('products').update({ stock: totalStock }).eq('id', productId);
  return totalStock;
}

export async function addSaleWithVariantDB(sale: any, variantId?: string) {
  const { error } = await supabase.from('sales').insert(sale);
  if (error) throw error;
  if (variantId) {
    // Deduct variant stock
    const { data: variant } = await supabase.from('product_variants').select('stock, product_id').eq('id', variantId).single();
    if (variant) {
      const newStock = Math.max(0, variant.stock - sale.quantity);
      await supabase.from('product_variants').update({ stock: newStock }).eq('id', variantId);
      await syncProductStockFromVariants(variant.product_id);
    }
  } else if (sale.product_id) {
    const { data: prod } = await supabase.from('products').select('stock').eq('id', sale.product_id).single();
    if (prod) {
      const newStock = Math.max(0, prod.stock - sale.quantity);
      await supabase.from('products').update({ stock: newStock }).eq('id', sale.product_id);
    }
  }
  if (!sale.paid) {
    await supabase.from('debts').insert({
      user_id: sale.user_id,
      org_id: sale.org_id || requireActiveOrgId(),
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

/** Calculate decant price based on proportional cost + margin */
export function calculateDecantPrice(
  totalCostUSD: number, contentMl: number, decantMl: number,
  marginPercent: number, exchangeRate: number
) {
  if (contentMl <= 0 || decantMl <= 0) return 0;
  const costPropUSD = (totalCostUSD / contentMl) * decantMl;
  const priceARS = costPropUSD * exchangeRate * (1 + marginPercent / 100);
  return Math.round(priceARS);
}

/** Calculate wholesale price with profitability floor */
export function calculateWholesalePrice(
  discountPriceARS: number, salePriceARS: number,
  volumeDiscountPercent: number, totalCostUSD: number, exchangeRate: number
) {
  const basePrice = discountPriceARS || salePriceARS;
  const wholesalePrice = basePrice * (1 - volumeDiscountPercent / 100);
  const minPrice = totalCostUSD * exchangeRate * 1.20; // 20% min profit
  const finalPrice = Math.max(wholesalePrice, minPrice);
  const belowFloor = wholesalePrice < minPrice;
  return { wholesalePrice: Math.round(finalPrice), belowFloor, basePrice };
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

// ========= EXPENSES =========
export async function getExpensesDB(userId: string) {
  const { data, error } = await supabase.from('expenses' as any).select('*').eq('user_id', userId).order('date', { ascending: false });
  if (error) throw error;
  return (data as any[]) || [];
}

export async function addExpenseDB(expense: any) {
  const { error } = await supabase.from('expenses' as any).insert(expense);
  if (error) throw error;
}

export async function updateExpenseDB(id: string, updates: any) {
  const { error } = await supabase.from('expenses' as any).update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteExpenseDB(id: string) {
  const { error } = await supabase.from('expenses' as any).delete().eq('id', id);
  if (error) throw error;
}

export function getMonthlyExpenses(expenses: any[], year: number, month: number) {
  return expenses.filter(e => {
    const d = new Date(e.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

// Default fallback. Real categories come from settings.expense_categories per-user.
export const EXPENSE_CATEGORIES = [
  { value: 'alquiler', label: 'Alquiler', color: 'hsl(20, 70%, 50%)' },
  { value: 'servicios', label: 'Servicios', color: 'hsl(200, 60%, 50%)' },
  { value: 'marketing', label: 'Marketing', color: 'hsl(280, 60%, 50%)' },
  { value: 'sueldos', label: 'Sueldos', color: 'hsl(150, 60%, 40%)' },
  { value: 'logistica', label: 'Logística', color: 'hsl(40, 70%, 50%)' },
  { value: 'impuestos', label: 'Impuestos', color: 'hsl(0, 70%, 50%)' },
  { value: 'otros', label: 'Otros', color: 'hsl(220, 10%, 55%)' },
];

const PALETTE = [
  'hsl(20, 70%, 50%)', 'hsl(200, 60%, 50%)', 'hsl(280, 60%, 50%)',
  'hsl(150, 60%, 40%)', 'hsl(40, 70%, 50%)', 'hsl(0, 70%, 50%)',
  'hsl(220, 10%, 55%)', 'hsl(330, 60%, 50%)', 'hsl(180, 60%, 45%)',
];

/** Build user-facing expense categories from settings.expense_categories (string[]). */
export function buildExpenseCategories(settings: any): { value: string; label: string; color: string }[] {
  const list: string[] = Array.isArray(settings?.expense_categories) ? settings.expense_categories : [];
  if (!list.length) return EXPENSE_CATEGORIES;
  return list.map((slug, i) => {
    const def = EXPENSE_CATEGORIES.find(c => c.value === slug);
    return {
      value: slug,
      label: def?.label || slug.charAt(0).toUpperCase() + slug.slice(1),
      color: def?.color || PALETTE[i % PALETTE.length],
    };
  });
}

export function getExpenseCategoryLabel(cat: string, settings?: any) {
  const cats = settings ? buildExpenseCategories(settings) : EXPENSE_CATEGORIES;
  return cats.find(c => c.value === cat)?.label || cat;
}

// ========= CUSTOMER NOTES =========
export async function getCustomerNotesDB(userId: string) {
  const { data, error } = await supabase.from('customer_notes' as any).select('*').eq('user_id', userId);
  if (error) throw error;
  return (data as any[]) || [];
}

export async function upsertCustomerNoteDB(userId: string, customerName: string, notes: string) {
  const { error } = await supabase
    .from('customer_notes' as any)
    .upsert({ user_id: userId, customer_name: customerName, notes }, { onConflict: 'user_id,customer_name' });
  if (error) throw error;
}

// Seed products for a new user
export async function seedProductsForUser(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data: existing } = await supabase.from('products').select('id').eq('org_id', orgId).limit(1);
  if (existing && existing.length > 0) return;
  const { seedProductsList } = await import('./seedData');
  const products = seedProductsList.map(p => ({ ...p, user_id: userId, org_id: orgId, id: crypto.randomUUID() }));
  for (let i = 0; i < products.length; i += 50) {
    await supabase.from('products').insert(products.slice(i, i + 50));
  }
}
