export const LEGACY_PRIVATE_CACHES = ['supabase-api', 'supabase-storage'] as const;

export function canCachePublicSupabaseMedia(url: URL, request: Pick<Request, 'method'>): boolean {
  return request.method === 'GET'
    && url.protocol === 'https:'
    && url.hostname.endsWith('.supabase.co')
    && (url.pathname.startsWith('/storage/v1/object/public/')
      || url.pathname.startsWith('/storage/v1/render/image/public/'));
}

export async function clearLegacyPrivateCaches(storage: Pick<CacheStorage, 'delete'>): Promise<void> {
  await Promise.all(LEGACY_PRIVATE_CACHES.map(name => storage.delete(name)));
}
