import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEntitlements } from './useEntitlements';
import { useOrg } from './orgContext';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

export function usePlanLimits() {
  const { activeOrg } = useOrg();
  const { plan, productLimit, userLimit } = useEntitlements();
  const navigate = useNavigate();

  // Returns true if allowed to proceed, false if limit hit (shows toast)
  const checkProductLimit = useCallback(async (): Promise<boolean> => {
    if (!activeOrg || productLimit == null) return true;
    const { count, error } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.id);
    if (error) {
      toast.error('No se pudo verificar el límite de productos. Intentá de nuevo.');
      return false;
    }
    if ((count ?? 0) >= productLimit) {
      toast.error(`Límite de ${productLimit} productos alcanzado en tu plan ${plan?.name ?? ''}.`, {
        action: { label: 'Ver planes', onClick: () => navigate('/precios') },
        duration: 6000,
      });
      return false;
    }
    return true;
  }, [activeOrg, navigate, plan, productLimit]);

  const checkSalesLimit = useCallback(async (): Promise<boolean> => {
    if (!activeOrg) return true;
    // `sales` son renglones, no tickets. El RPC cuenta `sale_transactions`
    // en horario argentino y usa la misma autoridad que frena la inserción.
    const { data, error } = await supabase
      .rpc('get_sales_plan_usage', { p_org_id: activeOrg.id })
      .single();
    if (error) {
      toast.error('No se pudo verificar el límite de ventas. Intentá de nuevo.');
      return false;
    }
    if (data.max_sales_per_month != null && data.sales_used >= data.max_sales_per_month) {
      toast.error(`Límite de ${data.max_sales_per_month} ventas/mes alcanzado en tu plan ${plan?.name ?? ''}.`, {
        action: { label: 'Ver planes', onClick: () => navigate('/precios') },
        duration: 6000,
      });
      return false;
    }
    return true;
  }, [activeOrg, navigate, plan]);

  const checkUserLimit = useCallback(async (): Promise<boolean> => {
    if (!activeOrg || userLimit == null) return true;
    const { count, error } = await supabase
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.id);
    if (error) {
      toast.error('No se pudo verificar el límite de usuarios. Intentá de nuevo.');
      return false;
    }
    if ((count ?? 0) >= userLimit) {
      toast.error(`Límite de ${userLimit} usuario${userLimit !== 1 ? 's' : ''} alcanzado en tu plan ${plan?.name ?? ''}.`, {
        action: { label: 'Ver planes', onClick: () => navigate('/precios') },
        duration: 6000,
      });
      return false;
    }
    return true;
  }, [activeOrg, navigate, plan, userLimit]);

  // A paid extra can expire; operating the free Commerce Core does not.
  const subscriptionBlocked = false;

  return { checkProductLimit, checkSalesLimit, checkUserLimit, subscriptionBlocked };
}
