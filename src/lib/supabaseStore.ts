import { supabase } from '@/integrations/supabase/client';
import { getActiveOrgId, requireActiveOrgId } from './orgContext';
import type { Database } from '@/integrations/supabase/types';
import { resolveSaleAttribution } from './businessCalc';
import { nombreDeCategoria } from './storeCategories';
type SettingsUpdate = Database['public']['Tables']['settings']['Update'];

/** Get the active org id, falling back to looking it up by user (for legacy callers). */
async function orgIdFor(_userId?: string): Promise<string> {
  const cached = getActiveOrgId();
  if (cached) return cached;
  if (!_userId) throw new Error('No active organization');
  const { data } = await supabase.from('memberships').select('org_id').eq('user_id', _userId).limit(1).maybeSingle();
  if (!data?.org_id) throw new Error('User has no organization');
  return data.org_id;
}

// ========= FINANCIAL MOVEMENTS (Ledger) =========
/**
 * Espejo operativo heredado. El libro de partida doble es la autoridad; esta
 * tabla alimenta vistas antiguas de caja. Sus vocabularios reales son
 * `in|out`, un source acotado y un canal de cobro: no los nombres de pantalla.
 */
export async function recordFinancialMovement(params: {
  orgId: string;
  direction: 'income' | 'expense';
  sourceType: 'sale' | 'purchase' | 'expense' | 'adjustment';
  sourceId?: string | null;
  amountArs: number;
  description: string;
  counterparty?: string | null;
  paymentMethod?: string;
  channel?: string;
  affectsCash?: boolean;
  affectsBank?: boolean;
  cashSessionId?: string | null;
  happenedAt?: string;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const direction = params.direction === 'income' ? 'in' : 'out';
  const sourceType = params.sourceType === 'purchase'
    ? 'supplier_payment'
    : params.sourceType === 'adjustment'
      ? 'manual'
      : params.sourceType;
  const method = (params.paymentMethod ?? 'efectivo').toLowerCase();
  const channel = ['efectivo', 'cash'].includes(method)
    ? 'cash'
    : ['transferencia', 'deposito'].includes(method)
      ? 'bank'
      : ['credito', 'debito', 'tarjeta', 'mercado_pago', 'mercadopago', 'qr', 'modo'].includes(method)
        ? 'card'
        : ['fiado', 'cuenta_corriente'].includes(method)
          ? 'store_credit'
          : 'other';

  const { error } = await supabase.from('financial_movements').insert({
      org_id: params.orgId,
      direction,
      source_type: sourceType,
      source_id: params.sourceId ?? null,
      amount_ars: params.amountArs,
      description: params.description,
      counterparty: params.counterparty ?? null,
      payment_method: params.paymentMethod ?? 'efectivo',
      channel,
      affects_cash: params.affectsCash ?? true,
      affects_bank: params.affectsBank ?? false,
      cash_session_id: params.cashSessionId ?? null,
      happened_at: params.happenedAt ?? new Date().toISOString(),
      created_by: params.createdBy ?? null,
      metadata: (params.metadata ?? {}) as any,
    });
  if (error) {
    // La operacion principal ya puede estar confirmada, por eso deja evidencia
    // sin presentar el espejo heredado como una transaccion atomica.
    console.error('[financial_movements] No se pudo registrar el espejo operativo:', error);
  }
}

// ========= PRODUCTS =========
export async function getProductsDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('products').select('*').eq('org_id', orgId).order('name');
  if (error) throw error;
  return data || [];
}

/**
 * Fija el stock a un valor físico contado. La base calcula el delta y crea el
 * asiento en Kardex; ninguna pantalla debe actualizar `products.stock` sola.
 */
export async function setStockAbsoluteDB({
  productId,
  newStock,
  userId,
  orgId,
  variantId = null,
  locationId = null,
  notes,
}: {
  productId: string;
  newStock: number;
  userId?: string | null;
  orgId?: string;
  variantId?: string | null;
  locationId?: string | null;
  notes?: string | null;
}) {
  if (!Number.isInteger(newStock) || newStock < 0) {
    throw new Error('El stock debe ser un entero mayor o igual a cero');
  }
  const activeOrgId = orgId || requireActiveOrgId();
  let actorId = userId ?? null;
  if (!actorId) {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    actorId = authData.user?.id ?? null;
  }
  if (!actorId) throw new Error('Necesitás iniciar sesión para ajustar stock');

  const { error } = await supabase.rpc('adjust_stock', {
    p_org_id: activeOrgId,
    p_product_id: productId,
    p_variant_id: variantId,
    p_location_id: locationId,
    p_new_stock: newStock,
    p_notes: notes ?? null,
    p_created_by: actorId,
  });
  if (error) throw error;
}

function isMissingStockRpc(error: { code?: string; message?: string } | null) {
  return error?.code === '42883'
    || error?.code === 'PGRST202'
    || /record_member_stock_movement.*does not exist/i.test(error?.message ?? '');
}

/**
 * Registra retornos, notas de crédito y canjes con el actor de la sesión.
 * Mientras una base todavía no tenga la migración C11, sólo se vuelve al RPC
 * anterior si PostgREST informa específicamente que el nuevo no existe.
 */
export async function recordMemberStockMovementDB({
  orgId,
  productId,
  productName,
  variantId = null,
  variantName = null,
  movementType,
  quantity,
  referenceType = null,
  referenceId = null,
  unitCostUsd = null,
  unitPriceArs = null,
  notes = null,
  userId,
}: {
  orgId: string;
  productId: string;
  productName: string;
  variantId?: string | null;
  variantName?: string | null;
  movementType: 'return' | 'return_in' | 'invoice_credit_note' | 'influencer_exchange';
  quantity: number;
  referenceType?: string | null;
  referenceId?: string | null;
  unitCostUsd?: number | null;
  unitPriceArs?: number | null;
  notes?: string | null;
  userId?: string | null;
}) {
  if (!Number.isInteger(quantity) || quantity === 0) {
    throw new Error('La cantidad del movimiento debe ser un entero distinto de cero');
  }
  let actorId = userId ?? null;
  if (!actorId) {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    actorId = authData.user?.id ?? null;
  }
  if (!actorId) throw new Error('Necesitás iniciar sesión para mover stock');

  const payload = {
    p_org_id: orgId,
    p_product_id: productId,
    p_variant_id: variantId,
    p_movement_type: movementType,
    p_quantity: quantity,
    p_reference_type: referenceType,
    p_reference_id: referenceId,
    p_unit_cost_usd: unitCostUsd,
    p_unit_price_ars: unitPriceArs,
    p_notes: notes,
  };
  const { error } = await supabase.rpc('record_member_stock_movement', payload);
  if (!error) return;
  if (!isMissingStockRpc(error)) throw error;

  // Compatibilidad limitada al período en que el frontend puede llegar antes
  // que la migración. Ningún permiso ni otro error habilita este camino.
  const { error: legacyError } = await supabase.rpc('record_stock_movement', {
    ...payload,
    p_product_name: productName,
    p_variant_name: variantName,
    p_created_by: actorId,
  });
  if (legacyError) throw legacyError;
}

export async function addProductDB(product: any) {
  const orgId = product.org_id || requireActiveOrgId();
  const initialStock = product.stock === undefined ? 0 : Number(product.stock);
  if (!Number.isInteger(initialStock) || initialStock < 0) {
    throw new Error('El stock inicial debe ser un entero mayor o igual a cero');
  }
  const { stock: _stock, ...productFields } = product;
  // El default de la base crea el producto en cero y el ajuste siguiente queda
  // en el Kardex. El cliente no escribe `products.stock`, ni siquiera al alta.
  const { data: created, error } = await supabase
    .from('products')
    .insert({ ...productFields, org_id: orgId })
    .select('id')
    .single();
  if (error) throw error;
  if (initialStock === 0) return created;

  try {
    await setStockAbsoluteDB({
      productId: created.id,
      newStock: initialStock,
      userId: product.user_id,
      orgId,
      notes: 'Stock inicial al crear producto',
    });
  } catch (stockError) {
    // No dejamos un producto creado a medias si no se pudo registrar su
    // inventario. La eliminación es segura: todavía no hay ventas ni compras.
    const { error: cleanupError } = await supabase.from('products').delete().eq('id', created.id);
    if (cleanupError) {
      throw new Error(`No se pudo registrar el stock inicial ni revertir el producto: ${cleanupError.message}`);
    }
    throw stockError;
  }
  return created;
}

export async function updateProductDB(id: string, updates: any) {
  if (Object.prototype.hasOwnProperty.call(updates ?? {}, 'stock')) {
    throw new Error('El stock se ajusta mediante Kardex, no al editar el producto');
  }
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
  // El stock lo mueve `trg_purchase_stock_movement`. Acá había un ajuste manual
  // que lo sumaba OTRA vez: comprar 5 unidades subía el stock 10. El trigger
  // además respeta `is_scheduled`, así que la mercadería entra cuando llega y
  // no cuando se programa el pedido — que es lo que este bloque intentaba y no
  // lograba, porque el trigger sumaba igual.
  // Ledger entry
  if (!purchase.is_scheduled) {
    await recordFinancialMovement({
      orgId,
      direction: 'expense',
      sourceType: 'purchase',
      sourceId: purchase.id ?? null,
      amountArs: purchase.total_ars ?? 0,
      description: `Compra: ${purchase.product_name ?? purchase.supplier_name ?? 'Proveedor'}`,
      counterparty: purchase.supplier_name ?? null,
      paymentMethod: purchase.payment_method ?? 'efectivo',
      channel: 'purchase',
      happenedAt: purchase.date ? new Date(purchase.date + 'T12:00:00').toISOString() : undefined,
      createdBy: purchase.user_id ?? null,
      metadata: { quantity: purchase.quantity, product_name: purchase.product_name },
    });
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

/**
 * Registra un ticket comercial completo. La base crea su padre, aplica el
 * cupo mensual por ticket y recién después inserta los renglones que mueven
 * Kardex. El navegador nunca escribe `sales` directamente.
 */
export async function addSalesDB(sales: any[], source?: string) {
  if (!sales.length) throw new Error('La venta necesita al menos un renglón');

  const orgId = sales[0].org_id || requireActiveOrgId();
  if (sales.some((sale) => sale.org_id && sale.org_id !== orgId)) {
    throw new Error('Todos los renglones de una venta deben pertenecer a la misma organización');
  }

  const transactionSource = source || sales[0].source || 'manual';
  const prepared: Array<{ sale: any; attributedExchangeId: string | null }> = [];

  for (const originalSale of sales) {
    const sale = { ...originalSale, org_id: orgId, source: transactionSource };
    let attributedExchangeId: string | null = null;

    // Si el cupón usado coincide con el código de un canje, la línea conserva
    // su atribución para que el ROI no se pierda al pasar por el RPC.
    if (sale.coupon_code) {
      const { data: exch } = await supabase
        .from('influencer_exchanges')
        .select('id')
        .eq('org_id', orgId)
        .eq('discount_code', sale.coupon_code)
        .limit(1)
        .maybeSingle();
      attributedExchangeId = exch?.id ?? null;
      const attribution = resolveSaleAttribution(sale.coupon_code, !!exch);
      if (attribution === 'influencer' || !sale.attribution_source) sale.attribution_source = attribution;
    }

    prepared.push({ sale, attributedExchangeId });
  }

  // C12 / F2 — el servidor recalcula el dinero y conserva la evidencia de
  // cobro en el mismo commit.
  //
  // Hasta la sesión 116 esta llamada mandaba precio, costo y ganancia desde el
  // navegador y la base los guardaba tal cual. Verificado contra producción:
  // un producto de USD 20 que se vende a $100.000 se guardaba con precio 1,
  // costo 0 y ganancia 999999 si el cliente lo pedía así.
  //
  // `create_sales_transaction_v2` acepta el precio —el cajero necesita poder
  // descontar, y el override queda registrado— pero **pisa el costo y la
  // ganancia siempre**. No hay operación legítima que necesite decidirlos
  // desde acá.
  //
  // Se cae a la anterior sólo si la función todavía no está en la base, que es
  // el patrón del repo: el cliente no puede asumir que la migración del mismo
  // commit ya se aplicó.
  const args = {
    p_org_id: orgId,
    p_sales: prepared.map(({ sale, attributedExchangeId }) => ({
      ...sale,
      influencer_exchange_id: attributedExchangeId,
    })),
    p_source: transactionSource,
  };

  // v3 envuelve esa autoridad y agrega `payment_transactions`: efectivo y
  // transferencia quedan como costo cero probado; tarjeta queda pendiente de
  // su liquidación real. Si el commit de la migración todavía no llegó a la
  // base, el fallback conserva el despliegue desacoplado habitual del repo.
  let { data, error } = await supabase.rpc(
    'create_sales_transaction_v3' as never, args as never) as
    { data: unknown; error: { code?: string; message: string } | null };

  if (error && ['42883', 'PGRST202'].includes(String(error.code))) {
    console.warn('[POS] create_sales_transaction_v3 no existe todavía; se usa v2');
    ({ data, error } = await supabase.rpc('create_sales_transaction_v2' as never, args as never) as
      { data: unknown; error: { code?: string; message: string } | null });
  }
  if (error && ['42883', 'PGRST202'].includes(String(error.code))) {
    console.warn('[POS] create_sales_transaction_v2 no existe todavía; se usa la anterior');
    ({ data, error } = await supabase.rpc('create_sales_transaction', args) as
      { data: unknown; error: { code?: string; message: string } | null });
  }
  if (error) throw error;

  // Deuda, uso de cupon y atribucion ya forman parte del mismo commit que el
  // ticket. Hacerlos aca dejaba operaciones partidas si se cerraba la pestaña
  // o se perdia la respuesta, y los repetia al sincronizar la cola offline.

  return data;
}

export async function addSaleDB(sale: any) {
  return addSalesDB([sale], sale.source);
}

export async function deleteSaleDB(id: string) {
  const { error } = await supabase.from('sales').delete().eq('id', id);
  if (error) throw error;
}

// ========= DEBTS =========
export async function getDebtsDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('debts').select('*').eq('org_id', orgId).order('date', { ascending: false });
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
        org_id: prev.org_id || requireActiveOrgId(),
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
export async function addDebtPaymentDB(
  debtId: string,
  paymentARS: number,
  opts?: { paymentMethod?: string; userId?: string; notes?: string },
) {
  const { data: debt } = await supabase.from('debts').select('*').eq('id', debtId).maybeSingle();
  if (!debt) throw new Error('Deuda no encontrada');
  const newPaid = Number(debt.paid_ars) + paymentARS;
  const newRemaining = Math.max(0, Number(debt.amount_ars) - newPaid);
  const newStatus = newRemaining <= 0.01 ? 'paid' : 'partial';
  await updateDebtDB(debtId, { paid_ars: newPaid, remaining_ars: newRemaining, status: newStatus });
  // Ledger del pago: sin esto se perdía el medio de pago elegido.
  await supabase.from('debt_payments').insert({
    org_id: debt.org_id,
    debt_id: debtId,
    amount_ars: paymentARS,
    payment_method: opts?.paymentMethod ?? null,
    user_id: opts?.userId ?? null,
    notes: opts?.notes ?? null,
  });
  return { newPaid, newRemaining, newStatus, debt };
}

// ========= SETTINGS =========
// ⚠️ Esta función **leía y de paso escribía**. Si no encontraba fila, insertaba
// una con `exchange_rate: 1695, customs_percent: 15, default_discount_percent:
// 20` — los valores del importador de perfumes de cuando esto era la app de un
// solo negocio. Un `getSettings` que crea configuración es una sorpresa, y
// además le fijaba a cada comercio nuevo una cotización que nunca eligió.
//
// Desde `20260826000010` el trigger `trg_organizacion_tiene_settings` le crea la
// fila a toda organización, y `audit_org_sin_settings` devuelve **0** (medido
// 2026-08-26). O sea que esa rama no se ejecutaba nunca — pero seguía siendo una
// mina: bastaba una carrera para plantar los defaults de otro rubro.
//
// Ahora sólo lee. Si de verdad no hay fila, es un problema que hay que ver, no
// uno que se tapa inventando la configuración.
export async function getSettingsDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('settings').select('*').eq('org_id', orgId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function saveSettingsDB(userId: string, settings: Record<string, any>) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase
    .from('settings')
    .update(settings as SettingsUpdate)
    .eq('org_id', orgId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error('No se encontró la configuración de esta organización o no tenés permiso para modificarla.');
  }
}

// ========= MARKETING =========
//
// El contenido social vive en `social_posts` desde el 2026-08-26. Antes había
// dos modelos para lo mismo: Marketing escribía en `marketing_posts` y el
// planner de redes en `social_posts`, cada uno con su esquema y su pantalla.
//
// La que sobrevive es `social_posts` porque tiene programación, métricas y
// multi-plataforma, que reconstruir del otro lado sería rehacer lo que ya está.
// Se le agregó `ai_generated`, la única columna de la otra que sí se usaba.
//
// ⚠️ Las dos formas difieren en dos campos y la traducción vive acá, en un solo
// lugar, para que las pantallas no tengan que conocerla:
//
//   image_url (una)  ←→  media_urls (arreglo)
//   scheduled_at     ←→  scheduled_for
//
// `user_id` se deja ir a propósito: la publicación es del comercio, no de la
// persona que la escribió, y `social_posts` es org-scoped.

/** Lo que la UI de Marketing espera, desde una fila de `social_posts`. */
function postDesdeSocial(fila: Record<string, unknown>) {
  const medios = Array.isArray(fila.media_urls) ? fila.media_urls as string[] : [];
  return {
    ...fila,
    image_url: medios[0] ?? null,
    scheduled_at: fila.scheduled_for ?? null,
  };
}

/** Lo que `social_posts` espera, desde lo que escribe la UI de Marketing. */
function postHaciaSocial(post: Record<string, unknown>) {
  const { image_url, scheduled_at, user_id: _user, product_ids: _prod, ...resto } = post as
    Record<string, unknown> & { image_url?: string | null; scheduled_at?: string | null };
  return {
    ...resto,
    ...(image_url ? { media_urls: [image_url] } : {}),
    ...(scheduled_at ? { scheduled_for: scheduled_at } : {}),
  };
}

export async function getMarketingPostsDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('social_posts').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(f => postDesdeSocial(f as Record<string, unknown>));
}

export async function addMarketingPostDB(post: any) {
  const orgId = post.org_id || requireActiveOrgId();
  const { error } = await supabase.from('social_posts').insert({ ...postHaciaSocial(post), org_id: orgId } as never);
  if (error) throw error;
}

export async function updateMarketingPostDB(id: string, updates: any) {
  const { error } = await supabase.from('social_posts').update(postHaciaSocial(updates) as never).eq('id', id);
  if (error) throw error;
}

export async function deleteMarketingPostDB(id: string) {
  const { error } = await supabase.from('social_posts').delete().eq('id', id);
  if (error) throw error;
}

// ========= INFLUENCER EXCHANGES =========
export async function getExchangesDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('influencer_exchanges').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addExchangeDB(exchange: any) {
  const orgId = exchange.org_id || requireActiveOrgId();
  const { data: created, error } = await supabase
    .from('influencer_exchanges')
    .insert({ ...exchange, org_id: orgId })
    .select('id')
    .single();
  if (error) throw error;
  // Entregar un canje es una salida de inventario: la función de base actualiza
  // stock y Kardex en la misma operación, sin calcular un "antes" en el cliente.
  if (exchange.product_id) {
    const qty = Number(exchange.quantity ?? 1);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error('La cantidad del canje debe ser un entero positivo');
    }
    await recordMemberStockMovementDB({
      orgId,
      productId: exchange.product_id,
      productName: exchange.product_name || 'Producto',
      movementType: 'influencer_exchange',
      quantity: -qty,
      referenceType: 'influencer_exchange',
      referenceId: created.id,
      notes: `Canje con influencer${exchange.influencer_name ? ': ' + exchange.influencer_name : ''}`,
      userId: exchange.user_id ?? null,
    });
  }
  return created;
}

export async function updateExchangeDB(id: string, updates: any) {
  const { error } = await supabase.from('influencer_exchanges').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteExchangeDB(id: string) {
  const { error } = await supabase.from('influencer_exchanges').delete().eq('id', id);
  if (error) throw error;
}

export function generateInfluencerCode(influencerName: string): string {
  const slug = influencerName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'INF';
  const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4).padEnd(4, '0');
  return `INF-${slug}-${rand}`;
}

export async function findExchangeByCode(code: string): Promise<any | null> {
  // Return the most recent exchange for this influencer code (all their canjes share one code)
  const { data } = await supabase
    .from('influencer_exchanges')
    .select('*')
    .ilike('discount_code', code.trim())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

// ========= SALES EDIT =========
// `oldSale` queda en la firma para no tocar los seis llamadores: ya no se usa
// para el stock, que lo reacomoda `trg_sale_stock_movement` en el UPDATE.
// Hacerlo en la base cubre además el cambio de producto, de variante y de
// sucursal, que el ajuste por diferencia de acá no contemplaba.
export async function updateSaleDB(id: string, updates: any, _oldSale?: any) {
  const { error } = await supabase.from('sales').update(updates).eq('id', id);
  if (error) throw error;
}

// ========= PURCHASES EDIT =========
// Igual que `updateSaleDB`: el stock lo reacomoda el trigger, que además
// entiende la transición de compra programada a recibida — el ajuste por
// diferencia que estaba acá no la cubría, así que marcar una compra como
// recibida no sumaba nada.
export async function updatePurchaseDB(id: string, updates: any, _oldPurchase?: any) {
  const { error } = await supabase.from('purchases').update(updates).eq('id', id);
  if (error) throw error;
}

// ========= AUDIT LOGS =========
export async function getAuditLogsDB(limit = 50) {
  const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// ========= SALES AGGREGATED (for auto-restock) =========
export async function getSalesAggregatedDB(userId: string, days: number = 30) {
  const orgId = await orgIdFor(userId);
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from('sales')
    .select('product_id, product_name, quantity')
    .eq('org_id', orgId)
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
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('sales').select('customer_name').eq('org_id', orgId).not('customer_name', 'is', null);
  if (error) throw error;
  const names = [...new Set((data || []).map(d => d.customer_name).filter(Boolean))] as string[];
  return names.sort((a, b) => a.localeCompare(b, 'es'));
}

// ========= COUPONS =========
export async function getCouponsDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('coupons').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addCouponDB(coupon: any) {
  const orgId = coupon.org_id || requireActiveOrgId();
  const { error } = await supabase.from('coupons').insert({ ...coupon, org_id: orgId });
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
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('org_id', orgId)
    .eq('code', code.toUpperCase().trim())
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { valid: false, reason: 'Cupón no encontrado' };
  if (data.max_uses && data.current_uses >= data.max_uses) return { valid: false, reason: 'Cupón agotado' };
  if (data.valid_from && new Date(data.valid_from) > new Date()) return { valid: false, reason: 'Cupón aún no vigente' };
  if (data.valid_until && new Date(data.valid_until) < new Date()) return { valid: false, reason: 'Cupón expirado' };
  const percentage = Number(data.discount_percent || 0);
  const fixed = Number(data.discount_fixed_ars || 0);
  return {
    valid: true,
    coupon: {
      ...data,
      // POS y Ventas consumen un modelo comun; la tabla historica conserva
      // dos columnas. Esta normalizacion evita que un cupon valido calcule NaN.
      discount_type: percentage > 0 ? 'percentage' : 'fixed',
      discount_value: percentage > 0 ? percentage : fixed,
    },
  };
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
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('product_variants').select('*').eq('org_id', orgId).eq('active', true).order('variant_name');
  if (error) throw error;
  return data || [];
}

export async function addVariantDB(variant: any) {
  const orgId = variant.org_id || requireActiveOrgId();
  const initialStock = variant.stock === undefined ? 0 : Number(variant.stock);
  if (!Number.isInteger(initialStock) || initialStock < 0) {
    throw new Error('El stock inicial de la variante debe ser un entero mayor o igual a cero');
  }
  const { stock: _stock, ...variantFields } = variant;
  const { data: created, error } = await supabase
    .from('product_variants')
    .insert({ ...variantFields, org_id: orgId })
    .select('id, product_id')
    .single();
  if (error) throw error;
  if (initialStock === 0) return created;

  try {
    await setStockAbsoluteDB({
      productId: created.product_id,
      variantId: created.id,
      newStock: initialStock,
      userId: variant.user_id,
      orgId,
      notes: 'Stock inicial al crear variante',
    });
  } catch (stockError) {
    const { error: cleanupError } = await supabase.from('product_variants').delete().eq('id', created.id);
    if (cleanupError) {
      throw new Error(`No se pudo registrar el stock inicial ni revertir la variante: ${cleanupError.message}`);
    }
    throw stockError;
  }
  return created;
}

export async function updateVariantDB(id: string, updates: any) {
  if (Object.prototype.hasOwnProperty.call(updates ?? {}, 'stock')) {
    throw new Error('El stock de una variante se ajusta mediante Kardex');
  }
  const { error } = await supabase.from('product_variants').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteVariantDB(id: string) {
  const { error } = await supabase.from('product_variants').delete().eq('id', id);
  if (error) throw error;
}

export async function addSaleWithVariantDB(sale: any, variantId?: string) {
  return addSaleDB({ ...sale, variant_id: sale.variant_id ?? variantId ?? null });
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

/**
 * Rótulo de un slug de categoría, sin conocer la organización.
 *
 * Tenía su propio `Record` con los cuatro nombres de la perfumería original,
 * duplicando letra por letra el `NOMBRES_HEREDADOS` de `storeCategories.ts`.
 * Ahora delega: idéntico resultado para esos cuatro, y para cualquier otro slug
 * devuelve algo legible —`ropa_interior` → "Ropa interior"— en vez del slug
 * crudo, que era lo que veía un comercio de otro rubro en Reportes, el catálogo
 * y la ficha pública.
 *
 * ⚠️ Es un **fallback**, no la fuente: no conoce las categorías del comercio,
 * así que no refleja un renombre. Donde haya `orgId` a mano —y en casi todas
 * las pantallas lo hay— va `useOrgCategoryNames`, que sí lee
 * `ecommerce_categories`.
 */
export function getCategoryLabel(cat: string) {
  return nombreDeCategoria(cat);
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

/**
 * Impuestos del período. IVA e IIBB se calculan sobre las VENTAS (no sobre la
 * ganancia, como se hacía antes: eso los subestimaba fuerte).
 *
 * - IVA: en retail argentino el precio de lista ya incluye IVA, así que el
 *   débito fiscal se EXTRAE del total: total × 21/121 (no total × 21%).
 *   Si la org carga precios sin IVA, poner `tax_prices_include_iva: false`
 *   en settings y se calcula por encima.
 *   Nota: es el IVA débito. El IVA a pagar real descuenta el crédito fiscal
 *   de las compras, que hoy no se registra discriminado.
 * - IIBB: Ingresos Brutos — por definición sobre la facturación.
 * - Monotributo: monto fijo mensual.
 *
 * `netProfit` sigue siendo la ganancia menos los impuestos.
 */
export function calculateTaxes(revenueARS: number, profitARS: number, settings: any) {
  if (!settings?.tax_enabled) {
    return { iva: 0, iibb: 0, monotributo: 0, totalTax: 0, netProfit: profitARS };
  }
  const revenue = Number(revenueARS) || 0;
  const ivaRate = Number(settings.tax_iva_percent ?? 21);
  const iibbRate = Number(settings.tax_iibb_percent ?? 3.5);
  const pricesIncludeIva = settings.tax_prices_include_iva !== false; // default: sí

  const iva = pricesIncludeIva
    ? revenue * (ivaRate / (100 + ivaRate))   // extraído del precio final
    : revenue * (ivaRate / 100);              // agregado sobre el neto
  const iibb = revenue * (iibbRate / 100);
  const monotributo = Number(settings.tax_monotributo_monthly || 0);
  const totalTax = iva + iibb + monotributo;
  return { iva, iibb, monotributo, totalTax, netProfit: profitARS - totalTax };
}

// ========= EXPENSES =========
export async function getExpensesDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('expenses').select('*').eq('org_id', orgId).order('date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addExpenseDB(expense: any) {
  const orgId = expense.org_id || requireActiveOrgId();
  const { error } = await supabase.from('expenses').insert({ ...expense, org_id: orgId });
  if (error) throw error;
  // Ledger entry
  await recordFinancialMovement({
    orgId,
    direction: 'expense',
    sourceType: 'expense',
    sourceId: expense.id ?? null,
    amountArs: expense.amount_ars ?? expense.amount ?? 0,
    description: expense.description || `Gasto: ${expense.category ?? 'General'}`,
    counterparty: expense.vendor ?? null,
    paymentMethod: expense.payment_method ?? 'efectivo',
    channel: 'expense',
    happenedAt: expense.date ? new Date(expense.date + 'T12:00:00').toISOString() : undefined,
    createdBy: expense.user_id ?? null,
    metadata: { category: expense.category, vendor: expense.vendor },
  });
}

export async function updateExpenseDB(id: string, updates: any) {
  const { error } = await supabase.from('expenses').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteExpenseDB(id: string) {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
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
// `customer_notes` es una tabla heredada y hoy está vacía. La nota que el CRM
// muestra vive en `customers.notes` — la escribe `appendCustomerNote` en
// CustomersPage. Esto se conserva sólo para que el backup de Configuración
// siga exportando la tabla si alguna organización tuviera filas viejas.
//
// El `upsertCustomerNoteDB` que estaba acá se borró en vez de arreglarse: no lo
// llamaba nadie y escribía con `onConflict: 'org_id,customer_name'`, una
// constraint que no existe (la real es `user_id,customer_name`), así que fallaba
// con 42P10. Aun arreglado habría guardado en una tabla que el CRM no lee, que
// es el bug que se acaba de sacar de CustomersPage.
export async function getCustomerNotesDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase.from('customer_notes').select('*').eq('org_id', orgId);
  if (error) throw error;
  return data || [];
}

// ========= CUSTOMERS (perfil completo) =========
export async function getCustomersDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('org_id', orgId)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function createCustomerDB(userId: string, customer: {
  name: string; company?: string; email?: string; phone?: string; address?: string;
  birthday?: string; tags?: string[]; notes?: string;
  instagram_handle?: string; whatsapp_number?: string; buys_vapers?: boolean; scent_preferences?: string[];
  custom_fields?: Record<string, any>;
}) {
  const orgId = await orgIdFor(userId);
  const { data, error } = await supabase
    .from('customers')
    .insert({ ...customer, user_id: userId, org_id: orgId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCustomerDB(id: string, updates: Partial<{
  name: string; company: string; email: string; phone: string; address: string;
  birthday: string; tags: string[]; notes: string;
  instagram_handle: string; whatsapp_number: string; buys_vapers: boolean; scent_preferences: string[];
  custom_fields: Record<string, any>;
}>) {
  const { error } = await supabase
    .from('customers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteCustomerDB(id: string) {
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
}

export async function getOrgMembersWithProfilesDB(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data: members, error } = await supabase
    .from('memberships')
    .select('user_id, role')
    .eq('org_id', orgId);
  if (error) throw error;
  if (!members || members.length === 0) return [];
  const userIds = members.map((m: any) => m.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, display_name')
    .in('user_id', userIds);
  const profileMap: Record<string, string> = {};
  (profiles || []).forEach((p: any) => { if (p.display_name) profileMap[p.user_id] = p.display_name; });
  return members.map((m: any) => ({
    user_id: m.user_id,
    role: m.role,
    display_name: profileMap[m.user_id] || `Usuario ${m.user_id.slice(0, 6)}`,
  }));
}

// Seed products for a new user
export async function seedProductsForUser(userId: string) {
  const orgId = await orgIdFor(userId);
  const { data: existing } = await supabase.from('products').select('id').eq('org_id', orgId).limit(1);
  if (existing && existing.length > 0) return;
  const { seedProductsList } = await import('./seedData');
  const products = seedProductsList.map((p: any) => ({ ...p, user_id: userId, org_id: orgId, id: crypto.randomUUID() }));
  for (let i = 0; i < products.length; i += 50) {
    await supabase.from('products').insert(products.slice(i, i + 50));
  }
}

// ========= LOYALTY POINTS =========
export async function addSupplierPaymentDB(
  debtId: string,
  amount: number,
  opts: { paymentMethod?: string; note?: string } = {},
) {
  const { data: debt } = await supabase
    .from('supplier_debts')
    .select('org_id, paid_ars, amount_ars, remaining_ars')
    .eq('id', debtId)
    .single();
  if (!debt) throw new Error('Deuda no encontrada');

  const newPaid = Number(debt.paid_ars) + amount;
  const isFullyPaid = newPaid >= Number(debt.amount_ars) - 0.01;

  await supabase.from('supplier_payments').insert({
    org_id: debt.org_id,
    supplier_debt_id: debtId,
    amount_ars: amount,
    method: opts.paymentMethod || 'transferencia',
    note: opts.note || null,
  });

  const { error } = await supabase.from('supplier_debts').update({
    paid_ars: newPaid,
    status: isFullyPaid ? 'paid' : 'partial',
  }).eq('id', debtId);

  if (error) throw error;
}

// ========= CRM SEGMENTS (DB-persisted) =========
export type SavedCRMSegment = { id: string; name: string; segment: string };

export async function getCRMSegmentsDB(userId: string): Promise<SavedCRMSegment[]> {
  const orgId = await orgIdFor(userId);
  const { data } = await supabase.from('settings').select('crm_segments').eq('org_id', orgId).maybeSingle();
  if (!data?.crm_segments) return [];
  return data.crm_segments as SavedCRMSegment[];
}

export async function saveCRMSegmentsDB(userId: string, segments: SavedCRMSegment[]): Promise<void> {
  const orgId = await orgIdFor(userId);
  await supabase.from('settings').upsert({ org_id: orgId, user_id: userId, crm_segments: segments as any } as any, { onConflict: 'org_id' });
}
