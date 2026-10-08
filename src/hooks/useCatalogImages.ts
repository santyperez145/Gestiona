import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { mensajeDeEdgeFunction } from '@/lib/edgeErrors';

export interface CatalogImageCandidate {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  source_url: string;
  creator: string;
  license: string;
  license_url: string;
  license_version: string;
  match: { label: string; exact_product: false; brand_matched: boolean; model_matched: boolean };
}

export function useCatalogImages(orgId: string | null, productId: string | undefined, name: string, brand: string, enabled = true) {
  const { user, session } = useAuth();
  const key = JSON.stringify([user?.id, session?.user?.id, session?.user?.last_sign_in_at, session?.expires_at,
    orgId, productId, name.trim(), brand.trim(), enabled]);
  const current = useRef(key);
  current.current = key;
  const version = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState({ key, loading: false, error: '', candidates: [] as CatalogImageCandidate[] });
  const invalidate = useCallback(() => {
    controller.current?.abort();
    version.current++;
  }, []);
  const clear = useCallback(() => {
    invalidate();
    setState({ key: current.current, loading: false, error: '', candidates: [] });
  }, [invalidate]);
  useEffect(() => {
    invalidate();
    return invalidate;
  }, [key, invalidate]);

  const request = useCallback(async (action: 'search' | 'acquire', candidate?: CatalogImageCandidate) => {
    if (!enabled || !orgId || !user || session?.user?.id !== user.id || name.trim().length < 3) {
      setState({ key, loading: false, error: 'Ingresá primero un nombre de producto más específico.', candidates: [] });
      return null;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const revision = ++version.current;
    const isCurrent = () => current.current === key && revision === version.current;
    const timeout = setTimeout(() => abort.abort(), 30_000);
    setState(previous => ({ key, loading: true, error: '', candidates: previous.key === key ? previous.candidates : [] }));
    try {
      const { data, error } = await supabase.functions.invoke('search-product-images', {
        signal: abort.signal,
        body: { action, org_id: orgId, product_id: productId, query: name.trim(), brand: brand.trim(),
          ...(candidate ? { candidate_id: candidate.id, review_product: true, review_rights: true } : {}) },
      });
      if (!isCurrent()) return null;
      if (abort.signal.aborted) throw new Error('image_timeout');
      if (error || !data?.ok) {
        console.error('catalog image request failed', { action, failed: true });
        const message = await mensajeDeEdgeFunction(error, data);
        if (isCurrent()) setState(previous => ({ ...previous, loading: false, error: message }));
        return null;
      }
      if (action === 'search') {
        const candidates = Array.isArray(data.results) ? data.results as CatalogImageCandidate[] : [];
        setState({ key, loading: false, error: candidates.length ? '' : 'No encontramos imágenes utilizables. Podés cargar una propia.', candidates });
        return null;
      }
      const prefix = supabase.storage.from('product-images').getPublicUrl(`${orgId}/catalog/`).data.publicUrl;
      if (typeof data.url !== 'string' || !data.url.startsWith(prefix) || !/^[0-9a-f-]{36}\.webp$/.test(data.url.slice(prefix.length))) {
        throw new Error('invalid_image_copy');
      }
      setState(previous => ({ ...previous, loading: false, error: '' }));
      return data.url as string;
    } catch {
      if (!isCurrent()) return null;
      console.error('catalog image request failed', { action, timeout: abort.signal.aborted });
      setState(previous => ({ ...previous, loading: false, error: 'No pudimos completar la imagen. Reintentá o cargá una propia; tu ficha sigue intacta.' }));
      return null;
    } finally { clearTimeout(timeout); }
  }, [key, orgId, productId, name, brand, user, session?.user?.id, enabled]);
  return {
    loading: state.key === key && state.loading,
    error: state.key === key ? state.error : '',
    candidates: state.key === key ? state.candidates : [],
    search: useCallback(() => request('search'), [request]),
    acquire: useCallback((candidate: CatalogImageCandidate) => request('acquire', candidate), [request]),
    clear,
  };
}
