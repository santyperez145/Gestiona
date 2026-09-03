/**
 * Adaptador de dominio propio. Resuelve host → slug y monta exactamente el
 * mismo StorefrontPage; no contiene catálogo, carrito ni checkout alternativos.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import StorefrontPage from '@/pages/StorefrontPage';
import StorefrontSkeleton from '@/storefront/StorefrontSkeleton';
import StorefrontStatus from '@/storefront/StorefrontStatus';

export default function CustomDomainStorefrontPage({ hostname }: { hostname: string }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase.rpc('get_store_slug_by_host', { p_host: hostname });
    if (error) {
      console.error('[dominio tienda] no se pudo resolver el host', error);
      setSlug(null);
      setLoadError(true);
    } else {
      setSlug(typeof data === 'string' && data.trim() ? data.trim().toLowerCase() : null);
    }
    setLoading(false);
  }, [hostname]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <StorefrontSkeleton />;
  if (loadError) return <StorefrontStatus kind="error" onRetry={() => { void load(); }} />;
  if (!slug) return <StorefrontStatus kind="not-found" />;
  return <StorefrontPage hostedSlug={slug} basePath="" />;
}
