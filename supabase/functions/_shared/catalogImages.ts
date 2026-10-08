export const IMAGE_API = 'https://api.openverse.org/v1/images/';
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const IMAGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function catalogText(value: unknown, max = 180): string {
  return typeof value === 'string' ? value.replace(/[<>]/g, '').replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function publicHttps(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host.includes(':') || host.includes('[') || host.includes(']') || /^\d+[.\d]*$/.test(host)
      || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return null;
    return url.toString();
  } catch { return null; }
}

// Download destinations are independent of the provider's metadata and redirects.
export function allowedCatalogDownload(value: unknown): string | null {
  const safe = publicHttps(value);
  if (!safe) return null;
  const host = new URL(safe).hostname;
  return host === 'upload.wikimedia.org' || host === 'live.staticflickr.com'
    || host === 'www.flickr.com' || /^farm\d+\.staticflickr\.com$/.test(host) ? safe : null;
}

function tokens(value: string): string[] {
  return [...new Set(value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter(token => token.length > 1 && !['de', 'con', 'the', 'and', 'para', 'por'].includes(token));
}

export function imageMatch(name: string, brand: string, title: string) {
  const titleTokens = tokens(title);
  const names = tokens(name);
  const brands = tokens(brand);
  const models = names.filter(token => /\d/.test(token));
  const matched = names.filter(token => titleTokens.includes(token));
  const brandMatched = brands.length > 0 && brands.every(token => titleTokens.includes(token));
  const modelMatched = models.length > 0 && models.every(token => titleTokens.includes(token));
  return {
    score: matched.length / Math.max(names.length, 1) + (brandMatched ? .5 : 0) + (modelMatched ? .5 : 0),
    label: modelMatched ? 'Modelo en el titulo' : matched.length > 0 ? 'Nombre parcialmente coincidente' : 'Sin coincidencia de nombre',
    matched_tokens: matched, brand_matched: brandMatched, model_matched: modelMatched,
    exact_product: false,
  };
}

export function catalogCandidate(row: Record<string, unknown>, name: string, brand: string) {
  const id = catalogText(row?.id, 36);
  const url = allowedCatalogDownload(row?.url);
  const thumbnail = publicHttps(row?.thumbnail);
  const source = publicHttps(row?.foreign_landing_url);
  const licenseUrl = publicHttps(row?.license_url);
  const license = catalogText(row?.license, 20).toLowerCase();
  const width = Number(row?.width);
  const height = Number(row?.height);
  if (!IMAGE_UUID.test(id) || !url || !thumbnail || !source || !licenseUrl || row.watermarked || row.mature
    || !['cc0', 'pdm'].includes(license)) return null;
  return {
    id, title: catalogText(row.title) || 'Imagen sin titulo', url, thumbnail,
    source_url: source, license, license_url: licenseUrl,
    license_version: catalogText(row.license_version, 20), creator: catalogText(row.creator, 120),
    creator_url: publicHttps(row.creator_url), provider: catalogText(row.provider, 80),
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    match: imageMatch(name, brand, catalogText(row.title)),
  };
}

export async function boundedBytes(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body || Number(response.headers.get('content-length')) > max) {
    await response.body?.cancel();
    throw new Error('catalog_response_size');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error('catalog_response_size');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new Error('catalog_response_empty');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function fetchCatalogJson(endpoint: URL, signal: AbortSignal, fetcher = fetch) {
  if (endpoint.origin !== 'https://api.openverse.org' || !endpoint.pathname.startsWith('/v1/images/')) throw new Error('catalog_api_origin');
  const response = await fetcher(endpoint, { signal, redirect: 'error', headers: { 'User-Agent': 'Nerqia catalog assistant/2.0 (https://nerqia.app)' } });
  if (!response.ok) throw new Error(response.status === 429 ? 'catalog_rate_limit' : 'catalog_provider_error');
  return JSON.parse(new TextDecoder().decode(await boundedBytes(response, 256 * 1024)));
}

export async function fetchCatalogImage(rawUrl: string, signal: AbortSignal, fetcher = fetch) {
  let url = allowedCatalogDownload(rawUrl);
  for (let attempt = 0; url && attempt < 3; attempt++) {
    const response = await fetcher(url, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      url = location ? allowedCatalogDownload(new URL(location, url).toString()) : null;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('catalog_image_unavailable'); }
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime ?? '')) {
      await response.body?.cancel(); throw new Error('catalog_image_type');
    }
    return { bytes: await boundedBytes(response, MAX_IMAGE_BYTES), mime };
  }
  throw new Error('catalog_image_redirect');
}
