import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/lib/orgContext';
import {
  getInfluencerProductAccess,
  requestInfluencerProductAccess,
  type ProductSurfaceAccess,
} from '@/lib/influencerProductDB';

export function useInfluencerProductAccess() {
  const { activeOrg } = useOrg();
  const [access, setAccess] = useState<ProductSurfaceAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeOrg?.id) {
      setAccess(null);
      setError('No hay una organización activa.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setAccess(await getInfluencerProductAccess(activeOrg.id));
    } catch (cause) {
      setAccess(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo verificar el acceso a Influencer Marketing.');
    } finally {
      setLoading(false);
    }
  }, [activeOrg?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const requestAccess = useCallback(async () => {
    if (!activeOrg?.id) return false;
    setRequesting(true);
    setError(null);
    try {
      await requestInfluencerProductAccess(activeOrg.id);
      await refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar la solicitud.');
      return false;
    } finally {
      setRequesting(false);
    }
  }, [activeOrg?.id, refresh]);

  return { access, loading, requesting, error, refresh, requestAccess };
}