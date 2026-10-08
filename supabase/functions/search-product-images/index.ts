import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { checkRateLimit } from '../_shared/rateLimiter.ts';
import { getAuthedUser } from '../_shared/requireUser.ts';
import { IMAGE_API, IMAGE_UUID, boundedBytes, catalogText, catalogCandidate, fetchCatalogJson, fetchCatalogImage } from '../_shared/catalogImages.ts';
import { prepareCatalogImage } from '../_shared/catalogImageTransform.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export async function handleCatalogImages(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ merchant_message: 'Metodo no permitido.' }, 405);
  try {
    const user = await getAuthedUser(req);
    if (!user) return json({ merchant_message: 'Inicia sesion para buscar imagenes.' }, 401);
    // Bound both IP abuse and per-identity bursts even when a caller forges IP headers.
    const identityRequest = new Request(req.url, { headers: { 'cf-connecting-ip': user.id } });
    if (checkRateLimit(req, 'search-product-images', { max: 20, windowMs: 60_000 })
      || checkRateLimit(identityRequest, 'catalog-image-user', { max: 10, windowMs: 60_000 })) {
      return json({ merchant_message: 'Espera un minuto antes de volver a buscar o copiar imagenes.' }, 429);
    }
    let body: Record<string, unknown>;
    try { body = JSON.parse(new TextDecoder().decode(await boundedBytes(new Response(req.body, { headers: req.headers }), 4096))); }
    catch { return json({ merchant_message: 'No pudimos leer la busqueda.' }, 400); }
    if (!body || Array.isArray(body) || typeof body !== 'object') return json({ merchant_message: 'Busqueda invalida.' }, 400);
    const orgId = catalogText(body.org_id, 36);
    const action = body.action ?? 'search';
    const productId = body.product_id == null ? null : catalogText(body.product_id, 36);
    const productName = catalogText(body.query, 120);
    const brand = catalogText(body.brand, 80);
    if (!IMAGE_UUID.test(orgId) || (productId !== null && !IMAGE_UUID.test(productId))
      || !['search', 'acquire'].includes(String(action)) || productName.length < 3) {
      return json({ merchant_message: 'Ingresa un nombre de producto mas especifico.' }, 400);
    }
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) throw new Error('catalog_server_configuration');
    const client = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: membership, error: membershipError } = await client.from('memberships').select('role')
      .eq('org_id', orgId).eq('user_id', user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !['owner', 'admin'].includes(String(membership.role))) {
      return json({ merchant_message: 'Solo el dueno o un administrador puede completar imagenes del catalogo.' }, 403);
    }
    for (const permission of ['view', productId ? 'edit' : 'create']) {
      const { data: allowed, error } = await client.rpc('has_permission', { p_org_id: orgId, p_module: 'products', p_action: permission });
      if (error) throw error;
      if (allowed !== true) return json({ merchant_message: 'No tenes permiso para completar las imagenes de este producto.' }, 403);
    }
    if (productId) {
      const { data: product, error } = await client.from('products').select('id').eq('id', productId).eq('org_id', orgId).maybeSingle();
      if (error) throw error;
      if (!product) return json({ merchant_message: 'No encontramos ese producto en tu catalogo.' }, 404);
    }
    const signal = AbortSignal.timeout(20_000);
    const query = `${brand} ${productName}`.replace(/\s+/g, ' ').trim();
    if (action === 'search') {
      const endpoint = new URL(IMAGE_API);
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('page_size', '20');
      endpoint.searchParams.set('license_type', 'commercial');
      endpoint.searchParams.set('license', 'cc0,pdm');
      endpoint.searchParams.set('mature', 'false');
      const payload = await fetchCatalogJson(endpoint, signal);
      const rows = Array.isArray(payload?.results) ? payload.results : [];
      const results = rows.map((row: Record<string, unknown>) => catalogCandidate(row, productName, brand))
        .filter(Boolean).sort((a: NonNullable<ReturnType<typeof catalogCandidate>>, b: NonNullable<ReturnType<typeof catalogCandidate>>) => b.match.score - a.match.score)
        .slice(0, 8);
      return json({ ok: true, query, results, policy: { auto_apply: false, requires_review: true } });
    }
    const providerId = catalogText(body.candidate_id, 36);
    if (!IMAGE_UUID.test(providerId) || body.review_product !== true || body.review_rights !== true) {
      return json({ merchant_message: 'Confirma la identidad del articulo y sus derechos de uso antes de copiarlo.' }, 400);
    }
    // Only a provider ID is accepted. Client URLs, MIME and license claims have no authority.
    const detail = await fetchCatalogJson(new URL(`${IMAGE_API}${providerId}/`), signal);
    const candidate = catalogCandidate(detail, productName, brand);
    if (!candidate || candidate.id !== providerId) return json({ merchant_message: 'La imagen ya no cumple las condiciones de uso. Busca otra o carga una propia.' }, 422);
    const original = await fetchCatalogImage(candidate.url, signal);
    const prepared = await prepareCatalogImage(original.bytes, original.mime!);
    const admin = createClient(url, serviceKey);
    const { data: previous, error: previousError } = await admin.from('catalog_image_sources').select('storage_path')
      .eq('org_id', orgId).eq('provider_id', providerId).eq('sha256', prepared.sha256).maybeSingle();
    if (previousError) throw previousError;
    if (previous) {
      return json({ ok: true, url: admin.storage.from('product-images').getPublicUrl(previous.storage_path).data.publicUrl, source: candidate });
    }
    const storagePath = `${orgId}/catalog/${crypto.randomUUID()}.webp`;
    const { error: uploadError } = await admin.storage.from('product-images').upload(storagePath, prepared.bytes, {
      contentType: 'image/webp', cacheControl: '31536000', upsert: false,
    });
    if (uploadError) throw uploadError;
    const { error: sourceError } = await admin.from('catalog_image_sources').insert({
      org_id: orgId, provider_id: providerId, source_url: candidate.source_url,
      license: candidate.license, license_url: candidate.license_url,
      provenance: { title: candidate.title, creator: candidate.creator, creator_url: candidate.creator_url,
        provider: candidate.provider, license_version: candidate.license_version, origin_url: candidate.url,
        processing: 'webp-1600-strip-v1', review_product: true, review_rights: true },
      storage_path: storagePath, sha256: prepared.sha256, width: prepared.width, height: prepared.height,
      byte_size: prepared.bytes.length, reviewed_by: user.id,
    });
    if (sourceError) {
      const { error: cleanupError } = await admin.storage.from('product-images').remove([storagePath]);
      if (cleanupError) console.error('catalog-image compensation', { code: cleanupError.name });
      if (sourceError.code === '23505') {
        const { data: raced, error } = await admin.from('catalog_image_sources').select('storage_path')
          .eq('org_id', orgId).eq('provider_id', providerId).eq('sha256', prepared.sha256).maybeSingle();
        if (error) throw error;
        if (raced) return json({ ok: true, url: admin.storage.from('product-images').getPublicUrl(raced.storage_path).data.publicUrl, source: candidate });
      }
      throw sourceError;
    }
    return json({ ok: true, url: admin.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl, source: candidate });
  } catch (error) {
    console.error('search-product-images failed', { code: error && typeof error === 'object' && 'code' in error ? error.code : error instanceof Error ? error.message : 'catalog_error' });
    return json({ merchant_message: 'No pudimos completar la imagen. Reintenta o carga una propia; tu producto no se modifico.' }, 502);
  }
}
Deno.serve(handleCatalogImages);
