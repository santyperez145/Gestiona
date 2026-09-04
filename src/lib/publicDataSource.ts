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

/** Columnas extra que sólo expone `store_catalog_products`. */
const STORE_PRODUCT_COLUMNS =
  'id,org_id,user_id,name,brand,category,gender,description,image_url,image_urls,' +
  'sale_price_ars,discount_price_ars,price_2x_ars,payment_base_price,promo_price,stock,content_ml,total_sold,' +
  'featured,offer_expires_at,created_at';

/** Las mismas, más los precios de decant que sólo la vista puede calcular. */
const PRODUCT_COLUMNS_WITH_DECANTS =
  `${PRODUCT_COLUMNS},decant_price_10ml,decant_price_5ml,decant_price_2_5ml`;
const STORE_PRODUCT_COLUMNS_WITH_DECANTS =
  `${STORE_PRODUCT_COLUMNS},decant_price_10ml,decant_price_5ml,decant_price_2_5ml`;

export interface PgError { code?: string; message?: string; status?: number }

const PUBLIC_READ_RETRY_DELAYS_MS = [150, 450] as const;

/**
 * A public read may be retried when the transport failed, not when Supabase
 * answered with a permission, schema or validation error. Returning an empty
 * catalog for a brief network interruption is worse than spending two short
 * attempts to preserve the storefront.
 */
export function isTransientPublicError(error: PgError | null | undefined): boolean {
  if (!error) return false;

  const status = Number(error.status);
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;

  const code = String(error.code ?? "");
  if (/^(ECONNRESET|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|EAI_AGAIN)$/i.test(code)) return true;

  return /failed to fetch|fetch failed|network|timed out|timeout|connection (?:reset|closed|refused)|temporarily unavailable|service unavailable/i
    .test(error.message ?? "");
}

type PublicReadResult = { error?: PgError | null };

export type LecturaPublica<T> =
  | { ok: true; data: T }
  | { ok: false; error: PgError };

async function retryTransient<T extends PublicReadResult>(
  op: () => PromiseLike<T>,
  options: { delaysMs?: readonly number[]; maxAttempts?: number } = {},
): Promise<T> {
  const delays = options.delaysMs ?? PUBLIC_READ_RETRY_DELAYS_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? delays.length + 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await op();
      if (!isTransientPublicError(result.error) || attempt === maxAttempts - 1) return result;
    } catch (error) {
      if (!isTransientPublicError(error as PgError) || attempt === maxAttempts - 1) throw error;
    }

    const delay = delays[Math.min(attempt, Math.max(0, delays.length - 1))] ?? 0;
    if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
  }

  throw new Error("No se pudo completar la operación pública");
}

/** Retries only idempotent public reads; callers must never use it for writes. */
export async function retryPublicRead<T extends PublicReadResult>(
  read: () => PromiseLike<T>,
  options: { delaysMs?: readonly number[]; maxAttempts?: number } = {},
): Promise<T> {
  return retryTransient(read, options);
}

/**
 * Misma espera que una lectura, sólo para RPCs con clave de idempotencia.
 * Sin esa clave, un retry duplicaría la orden.
 */
export async function retryIdempotentWrite<T extends PublicReadResult>(
  write: () => PromiseLike<T>,
  options: { delaysMs?: readonly number[]; maxAttempts?: number } = {},
): Promise<T> {
  return retryTransient(write, {
    delaysMs: options.delaysMs ?? [300, 900],
    maxAttempts: options.maxAttempts ?? 3,
  });
}

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

/** Branding mínimo que puede dibujar el catálogo legado. Sin credenciales. */
export interface PublicCatalogBranding {
  id?: string;
  user_id?: string;
  org_id?: string;
  business_name?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  whatsapp_number?: string | null;
}

const PUBLIC_BRANDING_COLUMNS =
  'id,user_id,org_id,business_name,logo_url,primary_color,secondary_color,whatsapp_number';

/**
 * Productos de una organización, para la tienda online.
 * Ordenados con los destacados primero, igual que antes.
 *
 * A diferencia del catálogo por WhatsApp, acá **sí** vienen los agotados: la
 * ficha sigue existiendo (con su URL indexada) y ofrece avisar cuando vuelva.
 * Esconderlos pierde la visita, el lugar en Google y la señal de demanda. La
 * tienda los muestra al final y con el botón de compra cambiado.
 */
export async function fetchStoreProducts(orgId: string): Promise<LecturaPublica<CatalogProduct[]>> {
  // `store_catalog_products` es igual a `catalog_products` pero sin exigir
  // stock. Si la migración todavía no está aplicada se cae a la vieja: la
  // tienda pierde los agotados, no los productos.
  //
  // ⚠️ Un error de red no es un catálogo vacío. Devolver `[]` hacía que la
  // home mostrara "0 productos" con la tienda llena — el mismo `?? []` que
  // este archivo existe para evitar.
  const view = await retryPublicRead(() => supabase
    .from('store_catalog_products')
    .select(STORE_PRODUCT_COLUMNS_WITH_DECANTS)
    .eq('org_id', orgId)
    .order('featured', { ascending: false })
    .order('name'));

  if (!view.error) return { ok: true, data: (view.data ?? []) as unknown as CatalogProduct[] };
  if (!isMissingRelation(view.error)) {
    console.error('[catálogo] error leyendo store_catalog_products:', view.error.message);
    return { ok: false, error: view.error };
  }

  warnFallback('store_catalog_products');
  const previa = await retryPublicRead(() => supabase
    .from('catalog_products')
    .select(PRODUCT_COLUMNS_WITH_DECANTS)
    .eq('org_id', orgId)
    .order('featured', { ascending: false })
    .order('name'));
  if (!previa.error) return { ok: true, data: (previa.data ?? []) as unknown as CatalogProduct[] };
  if (!isMissingRelation(previa.error)) {
    console.error('[catálogo] error leyendo catalog_products:', previa.error.message);
    return { ok: false, error: previa.error };
  }

  warnFallback('catalog_products');
  const raw = await retryPublicRead(() => supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('org_id', orgId)
    .gt('sale_price_ars', 0)
    .order('featured', { ascending: false })
    .order('name'));

  if (raw.error) {
    console.error('[catálogo] error leyendo products:', raw.error.message);
    return { ok: false, error: raw.error };
  }
  return { ok: true, data: (raw.data ?? []) as unknown as CatalogProduct[] };
}

/**
 * Productos de un usuario, para el catálogo por WhatsApp.
 *
 * En modo fallback no hay precios de decant: los calcula la vista para no tener
 * que bajar el costo del producto al navegador. El catálogo simplemente no
 * ofrece fraccionado hasta que la migración esté aplicada — preferible a
 * publicar la estructura de costos.
 */
export async function fetchCatalogProducts(userId: string): Promise<LecturaPublica<CatalogProduct[]>> {
  const view = await retryPublicRead(() => supabase
    .from('catalog_products')
    .select(PRODUCT_COLUMNS_WITH_DECANTS)
    .eq('user_id', userId)
    .gt('stock', 0)
    .order('category')
    .order('name'));

  if (!view.error) {
    const rows = (view.data ?? []) as unknown as CatalogProduct[];
    // Algunos links históricos se generaron con el id de organización. El
    // catálogo público es una frontera de compatibilidad: probamos ese scope
    // sólo cuando el scope de usuario no devolvió nada, sin mezclar tenants.
    if (rows.length > 0) return { ok: true, data: rows };
    const byOrg = await retryPublicRead(() => supabase
      .from('catalog_products')
      .select(PRODUCT_COLUMNS_WITH_DECANTS)
      .eq('org_id', userId)
      .gt('stock', 0)
      .order('category')
      .order('name'));
    if (!byOrg.error) return { ok: true, data: (byOrg.data ?? []) as unknown as CatalogProduct[] };
    if (!isMissingRelation(byOrg.error)) {
      console.error('[catálogo] error leyendo catalog_products por organización:', byOrg.error.message);
      return { ok: false, error: byOrg.error };
    }
    return { ok: true, data: [] };
  }
  if (!isMissingRelation(view.error)) {
    console.error('[catálogo] error leyendo catalog_products:', view.error.message);
    return { ok: false, error: view.error };
  }

  warnFallback('catalog_products');
  const raw = await retryPublicRead(() => supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('user_id', userId)
    .gt('stock', 0)
    .order('category')
    .order('name'));

  if (raw.error) {
    console.error('[catálogo] error leyendo products:', raw.error.message);
    return { ok: false, error: raw.error };
  }
  const rows = (raw.data ?? []) as unknown as CatalogProduct[];
  if (rows.length > 0) return { ok: true, data: rows };

  const rawByOrg = await retryPublicRead(() => supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('org_id', userId)
    .gt('stock', 0)
    .order('category')
    .order('name'));
  if (rawByOrg.error) {
    console.error('[catálogo] error leyendo products por organización:', rawByOrg.error.message);
    return { ok: false, error: rawByOrg.error };
  }
  return { ok: true, data: (rawByOrg.data ?? []) as unknown as CatalogProduct[] };
}

export interface CatalogSettings {
  exchange_rate: number | null;
  volume_discount_threshold: number | null;
  volume_discount_percent: number | null;
}

/**
 * Parámetros de precio que el catálogo muestra al comprador.
 *
 * ⚠️ Busca por **usuario**, no por comercio: este catálogo es la superficie
 * heredada (`/catalogo/:userId`) y precede a las organizaciones.
 *
 * Hasta el 2026-08-26 `settings.user_id` era ÚNICO, así que `.maybeSingle()`
 * no podía traer más de una fila. Ese índice se quitó —obligaba a una sola
 * configuración por usuario y dejaba sin ninguna al segundo comercio del mismo
 * dueño—, así que ahora un usuario puede tener varias.
 *
 * Se ordena por `created_at` y se toma la primera: la del comercio original,
 * que es el que corresponde a este link. Sin el `order`, `.maybeSingle()`
 * fallaría con "multiple rows" y el catálogo entero mostraría "no encontrado".
 */
export async function fetchCatalogSettings(userId: string): Promise<LecturaPublica<CatalogSettings | null>> {
  const cols = 'exchange_rate,volume_discount_threshold,volume_discount_percent';

  const view = await retryPublicRead(() => supabase
    .from('catalog_settings').select(cols).eq('user_id', userId)
    .order('org_id', { ascending: true }).limit(1).maybeSingle());

  if (!view.error && view.data) return { ok: true, data: view.data as CatalogSettings };
  if (!view.error) {
    const byOrg = await retryPublicRead(() => supabase
      .from('catalog_settings').select(cols).eq('org_id', userId)
      .order('org_id', { ascending: true }).limit(1).maybeSingle());
    if (!byOrg.error) return { ok: true, data: (byOrg.data ?? null) as CatalogSettings | null };
    if (!isMissingRelation(byOrg.error)) {
      console.error('[catálogo] error leyendo catalog_settings por organización:', byOrg.error.message);
      return { ok: false, error: byOrg.error };
    }
    return { ok: true, data: null };
  }
  if (!isMissingRelation(view.error)) {
    console.error('[catálogo] error leyendo catalog_settings:', view.error.message);
    return { ok: false, error: view.error };
  }

  warnFallback('catalog_settings');
  const raw = await retryPublicRead(() => supabase
    .from('settings').select(cols).eq('user_id', userId)
    .order('created_at', { ascending: true }).limit(1).maybeSingle());
  if (raw.error) {
    console.error('[catálogo] error leyendo settings:', raw.error.message);
    return { ok: false, error: raw.error };
  }
  if (raw.data) return { ok: true, data: raw.data as CatalogSettings };

  const rawByOrg = await retryPublicRead(() => supabase
    .from('settings').select(cols).eq('org_id', userId)
    .order('created_at', { ascending: true }).limit(1).maybeSingle());
  if (rawByOrg.error) {
    console.error('[catálogo] error leyendo settings por organización:', rawByOrg.error.message);
    return { ok: false, error: rawByOrg.error };
  }
  return { ok: true, data: (rawByOrg.data ?? null) as CatalogSettings | null };
}

/**
 * Branding público del catálogo, con la misma compatibilidad user/org que los
 * productos. Mantenerlo en esta frontera evita que una página anónima consulte
 * `settings` por su cuenta y hace visible un fallo de permisos o red.
 */
export async function fetchCatalogBranding(
  userOrOrgId: string,
): Promise<LecturaPublica<PublicCatalogBranding | null>> {
  const view = await retryPublicRead(() => supabase
    .from('settings_public').select(PUBLIC_BRANDING_COLUMNS).eq('user_id', userOrOrgId)
    .order('org_id', { ascending: true }).limit(1).maybeSingle());

  if (!view.error && view.data) return { ok: true, data: view.data as PublicCatalogBranding };
  if (view.error && !isMissingRelation(view.error)) {
    console.error('[catálogo] error leyendo settings_public:', view.error.message);
    return { ok: false, error: view.error };
  }

  const byOrg = await retryPublicRead(() => supabase
    .from('settings_public').select(PUBLIC_BRANDING_COLUMNS).eq('org_id', userOrOrgId)
    .order('org_id', { ascending: true }).limit(1).maybeSingle());
  if (!byOrg.error) return { ok: true, data: (byOrg.data ?? null) as PublicCatalogBranding | null };
  if (!isMissingRelation(byOrg.error)) {
    console.error('[catálogo] error leyendo settings_public por organización:', byOrg.error.message);
    return { ok: false, error: byOrg.error };
  }

  warnFallback('settings_public');
  const raw = await retryPublicRead(() => supabase
    .from('settings').select(PUBLIC_BRANDING_COLUMNS).eq('user_id', userOrOrgId)
    .order('org_id', { ascending: true }).limit(1).maybeSingle());
  if (raw.error) {
    console.error('[catálogo] error leyendo settings:', raw.error.message);
    return { ok: false, error: raw.error };
  }
  if (raw.data) return { ok: true, data: raw.data as PublicCatalogBranding };

  const rawByOrg = await retryPublicRead(() => supabase
    .from('settings').select(PUBLIC_BRANDING_COLUMNS).eq('org_id', userOrOrgId)
    .order('org_id', { ascending: true }).limit(1).maybeSingle());
  if (rawByOrg.error) {
    console.error('[catálogo] error leyendo settings por organización:', rawByOrg.error.message);
    return { ok: false, error: rawByOrg.error };
  }
  return { ok: true, data: (rawByOrg.data ?? null) as PublicCatalogBranding | null };
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
 *
 * ⚠️ Un corte de red no es un link inexistente. Devolver `null` hacía que
 * `/pago/:id` dijera «Link no encontrado» con el presupuesto vivo.
 */
export async function fetchPublicPaymentLink(
  linkId: string,
): Promise<LecturaPublica<Record<string, unknown> | null>> {
  const rpc = await retryPublicRead(() =>
    supabase.rpc('get_public_payment_link', { p_id: linkId }));

  if (!rpc.error) {
    const rows = rpc.data as unknown;
    return {
      ok: true,
      data: (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | null,
    };
  }
  if (!isMissingFunction(rpc.error)) {
    console.error('[pago] error leyendo el link:', rpc.error.message);
    return { ok: false, error: rpc.error };
  }

  warnFallback('get_public_payment_link()');
  const tabla = await retryPublicRead(() => supabase
    .from('payment_links').select(PAYMENT_LINK_COLUMNS).eq('id', linkId).maybeSingle());
  if (tabla.error) {
    console.error('[pago] error leyendo payment_links:', tabla.error.message);
    return { ok: false, error: tabla.error };
  }
  if (!tabla.data) return { ok: true, data: null };
  // La lista de columnas es dinámica, así que TS no puede inferir la forma.
  const link = tabla.data as unknown as Record<string, unknown> & { org_id: string };

  const [{ data: st }, { data: org }] = await Promise.all([
    retryPublicRead(() => supabase.from('settings')
      .select('bank_cbu,bank_alias,bank_name,bank_holder,whatsapp_number,logo_url,business_name')
      .eq('org_id', link.org_id).maybeSingle()),
    retryPublicRead(() => supabase.from('organizations')
      .select('name').eq('id', link.org_id).maybeSingle()),
  ]);

  const s = (st ?? {}) as Record<string, string | null>;
  return {
    ok: true,
    data: {
      ...link,
      business_name: s.business_name || (org as { name?: string } | null)?.name || 'Tienda',
      logo_url: s.logo_url ?? null,
      whatsapp_number: s.whatsapp_number ?? null,
      bank_cbu: s.bank_cbu ?? null,
      bank_alias: s.bank_alias ?? null,
      bank_name: s.bank_name ?? null,
      bank_holder: s.bank_holder ?? null,
    } as Record<string, unknown>,
  };
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
  const { data, error } = await retryPublicRead(() => supabase.rpc('quote_store_shipping', {
    p_slug: args.slug,
    p_province: args.province,
    p_postal_code: args.postalCode,
    p_items: args.items,
  }));

  if (!error) return (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
  if (isMissingFunction(error)) {
    warnFallback('quote_store_shipping()');
    return null;
  }
  console.error('[envío] error cotizando:', error.message);
  throw new Error(error.message);
}

/** Slug de tienda activa. Si el RPC no está desplegado, no inventa cobro. */
export async function fetchPublishedStoreSlugForOrg(orgId: string): Promise<string | null> {
  const id = orgId.trim();
  if (!id) return null;
  const rpc = await retryPublicRead(() =>
    supabase.rpc('get_published_store_slug' as never, { p_org_id: id } as never));
  if (!rpc.error) {
    const value = rpc.data as unknown;
    if (typeof value === 'string' && value.trim()) return value.trim();
    return null;
  }
  if (isMissingFunction(rpc.error)) {
    warnFallback('get_published_store_slug()');
    return null;
  }
  console.error('[catálogo] no se pudo leer el slug de la tienda', rpc.error.message);
  return null;
}

export interface ActiveStoreCart {
  found: boolean;
  items: unknown[];
  updated_at: string | null;
  merged: boolean;
  source: "device" | "account" | "merged" | null;
}

export async function getActiveStoreCart(args: {
  slug: string;
  token: string;
}): Promise<{ data: ActiveStoreCart | null; error: PgError | null; supported: boolean }> {
  const result = await retryPublicRead(() => supabase.rpc(
    'get_store_cart' as never,
    { p_slug: args.slug, p_token: args.token } as never,
  ) as unknown as PromiseLike<{ data: unknown; error: PgError | null }>);

  if (!result.error) {
    return { data: (result.data as ActiveStoreCart | null) ?? null, error: null, supported: true };
  }
  if (isMissingFunction(result.error)) {
    warnFallback('get_store_cart()');
    return { data: null, error: null, supported: false };
  }
  console.error('[carrito] no se pudo recuperar la sesión activa:', result.error.message);
  return { data: null, error: result.error, supported: true };
}

export interface StoreCartSaveLine {
  productId: string;
  variantId?: string | null;
  name: string;
  price: number;
  qty: number;
  image: string | null;
}

export async function saveActiveStoreCart(args: {
  slug: string;
  token: string;
  lines: StoreCartSaveLine[];
  email: string | null;
}): Promise<{ data: unknown; error: PgError | null; supported: boolean }> {
  const references = args.lines.map((line) => ({
    product_id: line.productId,
    variant_id: line.variantId ?? null,
    quantity: line.qty,
  }));
  const canonical = await supabase.rpc('save_store_cart_v2' as never, {
    p_slug: args.slug,
    p_token: args.token,
    p_items: references,
    p_email: args.email,
  } as never) as unknown as { data: unknown; error: PgError | null };

  if (!canonical.error) return { ...canonical, supported: true };
  if (!isMissingFunction(canonical.error)) {
    console.error('[carrito] no se pudo sincronizar la sesión:', canonical.error.message);
    return { ...canonical, supported: true };
  }

  // Ventana de deploy: el RPC anterior sigue recibiendo el snapshot visual,
  // pero el checkout continúa recalculando precio y stock en el servidor.
  warnFallback('save_store_cart_v2()');
  const legacy = await supabase.rpc('save_store_cart', {
    p_slug: args.slug,
    p_token: args.token,
    p_items: args.lines.map((line) => ({
      product_id: line.productId,
      variant_id: line.variantId ?? null,
      name: line.name,
      quantity: line.qty,
      unit_price: line.price,
      image_url: line.image,
    })),
    p_email: args.email,
    p_subtotal: args.lines.reduce((sum, line) => sum + line.price * line.qty, 0),
  });
  return { data: legacy.data, error: legacy.error, supported: false };
}

/**
 * Registra la entrada al checkout sobre la misma sesión canónica del carrito.
 * La operación es idempotente y resuelve nuevamente las líneas en la base; el
 * timestamp no depende de GA/Meta ni de que un script de terceros haya cargado.
 */
export async function startStoreCheckout(args: {
  slug: string;
  token: string;
  lines: StoreCartSaveLine[];
}): Promise<{ data: unknown; error: PgError | null; supported: boolean }> {
  const payload = {
    p_slug: args.slug,
    p_token: args.token,
    p_items: args.lines.map((line) => ({
      product_id: line.productId,
      variant_id: line.variantId ?? null,
      quantity: line.qty,
    })),
    // El email se persiste por el flujo específico de recovery. Medir una
    // etapa no necesita sumar PII a la request.
    p_email: null,
  };
  const invoke = () => supabase.rpc(
    'start_store_checkout' as never,
    payload as never,
  ) as unknown as PromiseLike<{ data: unknown; error: PgError | null }>;

  let result = await invoke();
  if (result.error && isTransientPublicError(result.error)) {
    // Es seguro reintentar: el servidor usa COALESCE sobre el primer timestamp
    // y save_store_cart_v2 actualiza una sesión identificada por token.
    result = await invoke();
  }
  if (!result.error) return { ...result, supported: true };
  if (!isMissingFunction(result.error)) {
    console.error('[checkout] no se pudo registrar el inicio:', result.error.message);
    return { ...result, supported: true };
  }

  // Ventana de despliegue: conservar el carrito es más importante que medir la
  // etapa. El checkout continúa operativo y el panel no inventa el evento.
  warnFallback('start_store_checkout()');
  const fallback = await saveActiveStoreCart({
    slug: args.slug,
    token: args.token,
    lines: args.lines,
    email: null,
  });
  return { ...fallback, supported: false };
}

export interface CreateStoreOrderResult {
  data: unknown;
  error: PgError | null;
  cartLinked: boolean;
}

/**
 * Crea la orden. Si la firma con opción de envío todavía no está en la base, se
 * reintenta sin ese parámetro: mejor cobrar el envío plano que no poder vender.
 */
export async function createStoreOrder(
  params: Record<string, unknown>,
): Promise<CreateStoreOrderResult> {
  // Los tipos generados exigen la forma exacta del RPC; el checkout arma el
  // objeto y acá sólo se reintenta sin el parámetro nuevo si no existe aún.
  type OrderArgs = Parameters<typeof supabase.rpc<'create_store_order'>>[1];

  // H1 — primero el camino idempotente. Si el navegador reintenta el checkout
  // —timeout que en realidad completó, doble clic, un proxy— el envoltorio
  // devuelve la MISMA orden en vez de crear otra y reservar stock dos veces.
  //
  // Se cae al camino viejo sólo si la función todavía no está en la base, que
  // es el patrón de este archivo: el código no puede asumir que la migración
  // del mismo commit ya se aplicó.
  if (params.p_idempotency_key && params.p_cart_token) {
    const linked = await retryIdempotentWrite(() =>
      supabase.rpc('create_store_order_from_cart_idem' as never, params as never));
    if (!linked.error) {
      return { data: linked.data, error: null, cartLinked: true };
    }
    if (!isMissingFunction(linked.error)) {
      return { data: linked.data, error: linked.error, cartLinked: false } as CreateStoreOrderResult;
    }
    warnFallback('create_store_order_from_cart_idem()');
  }

  const { p_cart_token: _sinCarrito, ...sinCarrito } = params;
  params = sinCarrito;

  if (params.p_idempotency_key) {
    const idem = await retryIdempotentWrite(() =>
      supabase.rpc('create_store_order_idem' as never, params as never));
    if (!idem.error) return { data: idem.data, error: null, cartLinked: false };
    if (!isMissingFunction(idem.error)) {
      return { data: idem.data, error: idem.error, cartLinked: false } as CreateStoreOrderResult;
    }
    warnFallback('create_store_order_idem()');
  }

  const { p_idempotency_key: _sinClave, ...sinIdem } = params;
  params = sinIdem;
  const conOpcion = await supabase.rpc('create_store_order', params as OrderArgs);
  if (!conOpcion.error) return { data: conOpcion.data, error: null, cartLinked: false };
  if (!isMissingFunction(conOpcion.error)) {
    return { data: conOpcion.data, error: conOpcion.error, cartLinked: false };
  }

  warnFallback('create_store_order(… p_shipping_option)');
  const { p_shipping_option: _omitido, ...sinOpcion } = params;
  const legacy = await supabase.rpc('create_store_order', sinOpcion as OrderArgs);
  return { data: legacy.data, error: legacy.error, cartLinked: false };
}

export interface StoreOrderAccessRow {
  order_number: string;
  customer_name: string;
  customer_email: string;
  items: Array<{ name: string; quantity: number; unit_price: number; total: number; product_id?: string }>;
  subtotal: number;
  shipping_cost: number;
  total: number;
  payment_method: string;
  payment_status: string;
  fulfillment_status: string;
  shipping_address: Record<string, string>;
  created_at: string;
  access_token: string | null;
  /** Datos de cobro por transferencia (settings); null si no hay o legacy RPC. */
  bank_holder?: string | null;
  bank_name?: string | null;
  bank_cbu?: string | null;
  bank_alias?: string | null;
  carrier?: string | null;
  shipping_service?: string | null;
}

/**
 * Lee un pedido sólo con una capacidad, la cuenta compradora o numero + email.
 * El fallback existe exclusivamente para desplegar el cliente antes del corte
 * de base; desaparece de la ejecución apenas existe el RPC seguro.
 */
export async function getStoreOrderSecure(args: {
  slug: string;
  orderNumber: string;
  accessToken?: string | null;
  email?: string | null;
}): Promise<{ data: StoreOrderAccessRow | null; error: PgError | null; legacy: boolean }> {
  const secure = await retryPublicRead(() => supabase.rpc(
    'get_store_order_secure' as never,
    {
      p_slug: args.slug,
      p_order_number: args.orderNumber,
      p_access_token: args.accessToken ?? null,
      p_email: args.email ?? null,
    } as never,
  ) as unknown as PromiseLike<{ data: unknown; error: PgError | null }>);

  if (!secure.error) {
    const row = Array.isArray(secure.data) ? secure.data[0] : secure.data;
    return { data: (row as StoreOrderAccessRow | undefined) ?? null, error: null, legacy: false };
  }
  if (!isMissingFunction(secure.error)) {
    console.error('[pedido] error verificando acceso:', secure.error.message);
    return { data: null, error: secure.error, legacy: false };
  }

  console.warn('[pedido] get_store_order_secure() todavía no existe; usando el contrato anterior sólo durante el despliegue.');
  const legacy = await retryPublicRead(() => supabase.rpc(
    'get_store_order' as never,
    { p_slug: args.slug, p_order_number: args.orderNumber } as never,
  ) as unknown as PromiseLike<{ data: unknown; error: PgError | null }>);
  if (legacy.error) {
    console.error('[pedido] error en fallback:', legacy.error.message);
    return { data: null, error: legacy.error, legacy: true };
  }
  const row = Array.isArray(legacy.data) ? legacy.data[0] : legacy.data;
  return {
    data: row ? { ...(row as Omit<StoreOrderAccessRow, 'access_token'>), access_token: null } : null,
    error: null,
    legacy: true,
  };
}

/** Variantes de un producto publicado. */
export interface StoreVariant {
  id: string;
  product_id: string;
  variant_name: string;
  variant_type: string | null;
  stock: number;
  price_override: number | null;
  image_url: string | null;
  sku: string | null;
}

/**
 * Variantes de toda la tienda, en una sola llamada.
 *
 * La vitrina las necesita para la grilla y para la ficha, así que traerlas
 * juntas evita una consulta por producto. Devuelve `null` —no `[]`— cuando el
 * RPC todavía no existe, para que la tienda pueda distinguir "no hay
 * variantes" de "no puedo saberlo" y no oculte productos por error.
 */
export async function fetchStoreVariants(slug: string): Promise<StoreVariant[] | null> {
  const { data, error } = await retryPublicRead(() =>
    supabase.rpc('get_store_variants', { p_slug: slug }));
  if (!error) return (data ?? []) as unknown as StoreVariant[];
  if (isMissingFunction(error)) {
    warnFallback('get_store_variants');
    return null;
  }
  console.error('[tienda] error leyendo variantes:', error.message);
  return null;
}

export async function fetchCatalogVariants(productId: string) {
  const cols = 'id,variant_name,stock,image_url';

  const view = await retryPublicRead(() => supabase
    .from('catalog_product_variants').select(cols)
    .eq('product_id', productId).order('variant_name'));

  if (!view.error) return view.data ?? [];
  if (!isMissingRelation(view.error)) return [];

  warnFallback('catalog_product_variants');
  const raw = await retryPublicRead(() => supabase
    .from('product_variants').select(cols)
    .eq('product_id', productId).order('variant_name'));
  return raw.data ?? [];
}
