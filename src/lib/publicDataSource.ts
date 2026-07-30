import { supabase } from '@/integrations/supabase/client';

/**
 * Acceso a datos de las superficies públicas, tolerando la ventana de migración.
 *
 * El problema que resuelve: el código pasó a usar vistas y RPCs nuevos
 * (`catalog_products`, `get_public_payment_link`, `create_store_order` con
 * opción de envío) en el mismo commit que los crea. Si la migración todavía no
 * se aplicó a la base, la llamada falla y el `?? []` se traga el error: la
 * tienda muestra **cero productos** aunque haya cientos cargados, el link de
 * pago dice "no encontrado" y el checkout no puede crear la orden.
 *
 * Acá se intenta lo nuevo y, sólo si no existe todavía, se cae a la forma
 * anterior con **la misma lista de columnas seguras**: ni costos, ni márgenes,
 * ni credenciales. La degradación queda visible en consola y desaparece sola en
 * cuanto se aplica la migración.
 *
 * Todo el fallback vive en este archivo a propósito: `publicSurface.test.ts`
 * prohíbe leer tablas crudas desde las páginas públicas, y esa regla tiene que
 * seguir siendo estricta. Un único lugar auditado es mejor que la excepción
 * repartida por cinco pantallas.
 */

/** Columnas del catálogo que pueden salir al navegador. Sin costos. */
const PRODUCT_COLUMNS =
  'id,org_id,user_id,name,brand,category,gender,description,image_url,image_urls,' +
  'sale_price_ars,discount_price_ars,price_2x_ars,stock,content_ml,total_sold,' +
  'featured,offer_expires_at,created_at';

/** Las mismas, más los precios de decant que sólo la vista puede calcular. */
const PRODUCT_COLUMNS_WITH_DECANTS =
  `${PRODUCT_COLUMNS},decant_price_10ml,decant_price_5ml,decant_price_2_5ml`;

interface PgError { code?: string; message?: string }

/**
 * ¿El error es "esa relación no existe"? Sólo en ese caso se cae a la tabla:
 * un error de red o de permisos no debe activar el fallback silenciosamente.
 */
export function isMissingRelation(error: PgError | null): boolean {
  if (!error) return false;
  if (error.code === '42P01') return true;      // undefined_table (Postgres)
  if (error.code === 'PGRST205') return true;   // PostgREST: no está en el schema cache
  return /does not exist|could not find the table/i.test(error.message ?? '');
}

/**
 * ¿La función o esa firma de función no existen todavía? Cubre tanto un RPC
 * nuevo como un parámetro nuevo agregado a un RPC existente — PostgREST
 * responde PGRST202 cuando no encuentra una sobrecarga que matchee.
 */
export function isMissingFunction(error: PgError | null): boolean {
  if (!error) return false;
  if (error.code === '42883') return true;      // undefined_function (Postgres)
  if (error.code === 'PGRST202') return true;   // PostgREST: no encontró la función
  return /could not find the function|function .* does not exist/i.test(error.message ?? '');
}

function warnFallback(relation: string) {
  console.warn(
    `[catálogo] La vista ${relation} no existe todavía — leyendo la tabla con ` +
    `columnas seguras. Aplicá las migraciones (supabase db push) para cerrar ` +
    `el acceso público a la tabla cruda.`,
  );
}

export interface CatalogProduct {
  id: string;
  org_id?: string;
  user_id?: string;
  name: string;
  stock: number;
  sale_price_ars: number;
  discount_price_ars: number | null;
  decant_price_10ml?: number | null;
  decant_price_5ml?: number | null;
  decant_price_2_5ml?: number | null;
  [key: string]: unknown;
}

/**
 * Productos de una organización, para la tienda online.
 * Ordenados con los destacados primero, igual que antes.
 */
export async function fetchStoreProducts(orgId: string): Promise<CatalogProduct[]> {
  const view = await supabase
    .from('catalog_products')
    .select(PRODUCT_COLUMNS_WITH_DECANTS)
    .eq('org_id', orgId)
    .gt('stock', 0)
    .order('featured', { ascending: false })
    .order('name');

  if (!view.error) return (view.data ?? []) as unknown as CatalogProduct[];
  if (!isMissingRelation(view.error)) {
    console.error('[catálogo] error leyendo catalog_products:', view.error.message);
    return [];
  }

  warnFallback('catalog_products');
  const raw = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('org_id', orgId)
    .gt('stock', 0)
    .gt('sale_price_ars', 0)
    .order('featured', { ascending: false })
    .order('name');

  if (raw.error) {
    console.error('[catálogo] error leyendo products:', raw.error.message);
    return [];
  }
  return (raw.data ?? []) as unknown as CatalogProduct[];
}

/**
 * Productos de un usuario, para el catálogo por WhatsApp.
 *
 * En modo fallback no hay precios de decant: los calcula la vista para no tener
 * que bajar el costo del producto al navegador. El catálogo simplemente no
 * ofrece fraccionado hasta que la migración esté aplicada — preferible a
 * publicar la estructura de costos.
 */
export async function fetchCatalogProducts(userId: string): Promise<CatalogProduct[]> {
  const view = await supabase
    .from('catalog_products')
    .select(PRODUCT_COLUMNS_WITH_DECANTS)
    .eq('user_id', userId)
    .gt('stock', 0)
    .order('category')
    .order('name');

  if (!view.error) return (view.data ?? []) as unknown as CatalogProduct[];
  if (!isMissingRelation(view.error)) {
    console.error('[catálogo] error leyendo catalog_products:', view.error.message);
    return [];
  }

  warnFallback('catalog_products');
  const raw = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('user_id', userId)
    .gt('stock', 0)
    .order('category')
    .order('name');

  if (raw.error) {
    console.error('[catálogo] error leyendo products:', raw.error.message);
    return [];
  }
  return (raw.data ?? []) as unknown as CatalogProduct[];
}

export interface CatalogSettings {
  exchange_rate: number | null;
  volume_discount_threshold: number | null;
  volume_discount_percent: number | null;
}

/** Parámetros de precio que el catálogo muestra al comprador. */
export async function fetchCatalogSettings(userId: string): Promise<CatalogSettings | null> {
  const cols = 'exchange_rate,volume_discount_threshold,volume_discount_percent';

  const view = await supabase
    .from('catalog_settings').select(cols).eq('user_id', userId).maybeSingle();

  if (!view.error) return (view.data ?? null) as CatalogSettings | null;
  if (!isMissingRelation(view.error)) return null;

  warnFallback('catalog_settings');
  const raw = await supabase
    .from('settings').select(cols).eq('user_id', userId).maybeSingle();
  return (raw.data ?? null) as CatalogSettings | null;
}

// ── Link de pago público ────────────────────────────────────────────────────

/** Columnas del link que el pagador necesita ver. */
const PAYMENT_LINK_COLUMNS =
  'id,org_id,quote_number,customer_name,customer_phone,items,total_ars,' +
  'mp_link,status,paid_at,notes,expires_at,created_at';

/**
 * Un link de pago con los datos del comercio para poder transferir.
 *
 * Vía RPC: el uuid del link es el secreto, y así no se puede enumerar el resto.
 * Si el RPC todavía no existe, se leen las tablas como antes — que es lo que
 * hacía esta página hasta ayer.
 */
export async function fetchPublicPaymentLink(linkId: string) {
  const rpc = await supabase.rpc('get_public_payment_link', { p_id: linkId });

  if (!rpc.error) {
    const rows = rpc.data as unknown;
    return (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | null;
  }
  if (!isMissingFunction(rpc.error)) {
    console.error('[pago] error leyendo el link:', rpc.error.message);
    return null;
  }

  warnFallback('get_public_payment_link()');
  const { data: link } = await supabase
    .from('payment_links').select(PAYMENT_LINK_COLUMNS).eq('id', linkId).maybeSingle();
  if (!link) return null;

  const [{ data: st }, { data: org }] = await Promise.all([
    supabase.from('settings')
      .select('bank_cbu,bank_alias,bank_name,bank_holder,whatsapp_number,logo_url,business_name')
      .eq('org_id', (link as { org_id: string }).org_id).maybeSingle(),
    supabase.from('organizations')
      .select('name').eq('id', (link as { org_id: string }).org_id).maybeSingle(),
  ]);

  const s = (st ?? {}) as Record<string, string | null>;
  return {
    ...link,
    business_name: s.business_name || (org as { name?: string } | null)?.name || 'Tienda',
    logo_url: s.logo_url ?? null,
    whatsapp_number: s.whatsapp_number ?? null,
    bank_cbu: s.bank_cbu ?? null,
    bank_alias: s.bank_alias ?? null,
    bank_name: s.bank_name ?? null,
    bank_holder: s.bank_holder ?? null,
  } as Record<string, unknown>;
}

/**
 * Informa una transferencia. Devuelve false si el link ya no estaba esperando
 * el pago, para que la página lo diga en vez de fingir que salió bien.
 */
export async function confirmPaymentLinkTransfer(linkId: string): Promise<boolean> {
  const rpc = await supabase.rpc('confirm_payment_link_transfer', { p_id: linkId });
  if (!rpc.error) return rpc.data === true;
  if (!isMissingFunction(rpc.error)) throw new Error(rpc.error.message);

  warnFallback('confirm_payment_link_transfer()');
  const { error } = await supabase
    .from('payment_links')
    .update({ status: 'pending_confirmation' })
    .eq('id', linkId)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
  return true;
}

// ── Checkout de la tienda ───────────────────────────────────────────────────

/**
 * Cotiza el envío. Devuelve `null` — distinto de `[]` — cuando el RPC todavía no
 * existe, para que el checkout sepa que no debe mostrar un error al comprador y
 * simplemente use el costo plano de la tienda.
 */
export async function quoteStoreShipping(args: {
  slug: string;
  province: string | null;
  postalCode: string | null;
  items: Array<{ product_id: string; quantity: number }>;
}): Promise<Array<Record<string, unknown>> | null> {
  const { data, error } = await supabase.rpc('quote_store_shipping', {
    p_slug: args.slug,
    p_province: args.province,
    p_postal_code: args.postalCode,
    p_items: args.items,
  });

  if (!error) return (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
  if (isMissingFunction(error)) {
    warnFallback('quote_store_shipping()');
    return null;
  }
  console.error('[envío] error cotizando:', error.message);
  throw new Error(error.message);
}

/**
 * Crea la orden. Si la firma con opción de envío todavía no está en la base, se
 * reintenta sin ese parámetro: mejor cobrar el envío plano que no poder vender.
 */
export async function createStoreOrder(params: Record<string, unknown>) {
  const conOpcion = await supabase.rpc('create_store_order', params);
  if (!conOpcion.error) return conOpcion;
  if (!isMissingFunction(conOpcion.error)) return conOpcion;

  warnFallback('create_store_order(… p_shipping_option)');
  const { p_shipping_option: _omitido, ...sinOpcion } = params;
  return supabase.rpc('create_store_order', sinOpcion);
}

/** Variantes de un producto publicado. */
export async function fetchCatalogVariants(productId: string) {
  const cols = 'id,variant_name,stock,image_url';

  const view = await supabase
    .from('catalog_product_variants').select(cols)
    .eq('product_id', productId).order('variant_name');

  if (!view.error) return view.data ?? [];
  if (!isMissingRelation(view.error)) return [];

  warnFallback('catalog_product_variants');
  const raw = await supabase
    .from('product_variants').select(cols)
    .eq('product_id', productId).order('variant_name');
  return raw.data ?? [];
}
