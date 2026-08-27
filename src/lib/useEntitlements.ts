import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';

export interface Plan {
  id: string;
  code: 'trial' | 'starter' | 'pro' | 'business' | string;
  name: string;
  // ⚠️ Los PESOS son el precio que se cobra: MercadoPago es el único medio
  // de pago de la suscripción y sólo cobra ARS (`mp-subscribe` arma el
  // preapproval con `currency_id: 'ARS'`). Los de dólares quedan como
  // referencia comercial; ninguna pantalla del comercio los muestra.
  //
  // Nullable a propósito: un plan sin precio en pesos NO se puede cobrar, y
  // eso tiene que poder verse en vez de taparse con una conversión inventada.
  price_ars_monthly: number | null;
  price_ars_yearly: number | null;
  price_usd_monthly: number;
  price_usd_yearly: number;
  max_products: number | null;
  max_sales_per_month: number | null;
  max_users: number | null;
  ai_enabled: boolean;
  backups_enabled: boolean;
  custom_branding: boolean;
  sort_order: number;
  description: string | null;
  features?: string[];
}

export interface Subscription {
  id: string;
  org_id: string;
  plan_id: string;
  stripe_subscription_id: string | null;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused';
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

interface Entitlements {
  loading: boolean;
  plan: Plan | null;
  subscription: Subscription | null;
  isTrialing: boolean;
  trialDaysLeft: number;
  canUseAI: boolean;
  canCustomBrand: boolean;
  canUseBackups: boolean;
  productLimit: number | null;
  userLimit: number | null;
  salesLimit: number | null;
  refresh: () => Promise<void>;
}

export function useEntitlements(): Entitlements {
  const { activeOrg } = useOrg();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!activeOrg) { setPlan(null); setSub(null); setLoading(false); return; }
    setLoading(true);
    const { data: subData } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('org_id', activeOrg.id)
      .maybeSingle();
    let planRow: Plan | null = null;
    if (subData?.plan_id) {
      const { data: p } = await supabase.from('plans').select('*').eq('id', subData.plan_id).maybeSingle();
      planRow = p as Plan | null;
    } else if (activeOrg.plan_id) {
      const { data: p } = await supabase.from('plans').select('*').eq('id', activeOrg.plan_id).maybeSingle();
      planRow = p as Plan | null;
    }
    setSub(subData as Subscription | null);
    setPlan(planRow);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeOrg?.id]);

  const isTrialing = sub?.status === 'trialing';
  const trialDaysLeft = sub?.current_period_end
    ? Math.max(0, Math.ceil((new Date(sub.current_period_end).getTime() - Date.now()) / 86400000))
    : 0;

  return {
    loading,
    plan,
    subscription: sub,
    isTrialing,
    trialDaysLeft,
    canUseAI: !!plan?.ai_enabled,
    canCustomBrand: !!plan?.custom_branding,
    canUseBackups: !!plan?.backups_enabled,
    productLimit: plan?.max_products ?? null,
    userLimit: plan?.max_users ?? null,
    salesLimit: plan?.max_sales_per_month ?? null,
    refresh: load,
  };
}