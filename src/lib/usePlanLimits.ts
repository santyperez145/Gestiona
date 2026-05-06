import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEntitlements } from './useEntitlements';
import { useOrg } from './orgContext';
import { toast } from 'sonner';

export function usePlanLimits() {
  const { activeOrg } = useOrg();
  const { plan, subscription } = useEntitlements();

  // Returns true if allowed to proceed, false if limit hit (shows toast)
  const checkProductLimit = useCallback(async (): Promise<boolean> => {
    if (!activeOrg || plan?.max_products == null) return true;
    const { count } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.id);
    if ((count ?? 0) >= plan.max_products) {
      toast.error(`Límite de ${plan.max_products} productos alcanzado en tu plan ${plan.name}.`, {
        action: { label: 'Ver planes', onClick: () => { window.location.href = '/precios'; } },
        duration: 6000,
      });
      return false;
    }
    return true;
  }, [activeOrg, plan]);

  const checkSalesLimit = useCallback(async (): Promise<boolean> => {
    if (!activeOrg || plan?.max_sales_per_month == null) return true;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('sales')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.id)
      .gte('created_at', startOfMonth.toISOString());
    if ((count ?? 0) >= plan.max_sales_per_month) {
      toast.error(`Límite de ${plan.max_sales_per_month} ventas/mes alcanzado en tu plan ${plan.name}.`, {
        action: { label: 'Ver planes', onClick: () => { window.location.href = '/precios'; } },
        duration: 6000,
      });
      return false;
    }
    return true;
  }, [activeOrg, plan]);

  const checkUserLimit = useCallback(async (): Promise<boolean> => {
    if (!activeOrg || plan?.max_users == null) return true;
    const { count } = await supabase
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.id);
    if ((count ?? 0) >= plan.max_users) {
      toast.error(`Límite de ${plan.max_users} usuario${plan.max_users !== 1 ? 's' : ''} alcanzado en tu plan ${plan.name}.`, {
        action: { label: 'Ver planes', onClick: () => { window.location.href = '/precios'; } },
        duration: 6000,
      });
      return false;
    }
    return true;
  }, [activeOrg, plan]);

  // Subscription is effectively blocked if canceled or past_due past the period end
  const subscriptionBlocked =
    subscription?.status === 'canceled' ||
    (subscription?.status === 'past_due' &&
      !!subscription.current_period_end &&
      new Date(subscription.current_period_end) < new Date());

  return { checkProductLimit, checkSalesLimit, checkUserLimit, subscriptionBlocked };
}
