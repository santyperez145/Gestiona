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
  /** El plan está pago (o en trial): los beneficios se aplican. */
  planVigente: boolean;
  /** Por qué se cortaron, si se cortaron. `null` cuando está todo bien. */
  motivoDeCorte: 'impago' | 'cancelado' | 'pausado' | null;
  /** Días de gracia que quedan antes de cortar por falta de pago. */
  diasDeGracia: number;
  refresh: () => Promise<void>;
}

/**
 * Cuánto se espera antes de cortar por falta de pago.
 *
 * MercadoPago reintenta un débito rechazado durante varios días, y `past_due`
 * es además el estado con el que nace toda suscripción recién contratada —
 * `mp-subscribe` la guarda así a propósito, y la activa el webhook cuando
 * confirma el primer cobro. Cortar en el primer rechazo dejaría sin sistema a
 * un comercio que puso la tarjeta hace cinco minutos.
 */
const DIAS_DE_GRACIA = 7;

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

  /**
   * ── Los beneficios se cortan cuando no se paga ──────────────────────────
   *
   * ⚠️ Hasta el 2026-08-27 esto devolvía los beneficios **sólo mirando el
   * plan**, sin consultar el estado de la suscripción: una organización en
   * `past_due` conservaba IA, branding, backups y todos los límites. No pagar
   * no costaba nada.
   *
   * 📌 Cortar NO borra ni bloquea datos: se cae al piso de límites y se apagan
   * los extras. El comercio sigue entrando, viendo lo suyo y pudiendo pagar —
   * dejarlo afuera de su propia información sería una manera de perder al
   * cliente, no de cobrarle.
   *
   * 📌 Una organización SIN fila de suscripción conserva sus beneficios. Es el
   * caso de los comercios anteriores al cobro, y cortarles algo que nunca se
   * les vendió sería romperles el sistema por una migración.
   */
  const vencidoHace = (fecha: string | null | undefined): number => {
    if (!fecha) return 0;
    return Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000);
  };

  const diasImpago = sub?.status === 'past_due'
    ? vencidoHace(sub.current_period_end)
    : 0;
  const diasDeGracia = sub?.status === 'past_due'
    ? Math.max(0, DIAS_DE_GRACIA - diasImpago)
    : 0;

  const motivoDeCorte: Entitlements['motivoDeCorte'] =
    sub?.status === 'canceled' ? 'cancelado'
    : sub?.status === 'paused' ? 'pausado'
    : sub?.status === 'past_due' && diasDeGracia === 0 ? 'impago'
    : null;

  const planVigente = !sub || motivoDeCorte === null;
  const conBeneficio = (activo: boolean | null | undefined) => planVigente && !!activo;
  // El piso: lo mínimo con lo que se puede seguir operando sin perder nada.
  const limite = (valor: number | null | undefined, piso: number) =>
    planVigente ? (valor ?? null) : Math.min(valor ?? piso, piso);
  const trialDaysLeft = sub?.current_period_end
    ? Math.max(0, Math.ceil((new Date(sub.current_period_end).getTime() - Date.now()) / 86400000))
    : 0;

  return {
    loading,
    plan,
    subscription: sub,
    isTrialing,
    trialDaysLeft,
    canUseAI: conBeneficio(plan?.ai_enabled),
    canCustomBrand: conBeneficio(plan?.custom_branding),
    canUseBackups: conBeneficio(plan?.backups_enabled),
    productLimit: limite(plan?.max_products, 50),
    userLimit: limite(plan?.max_users, 1),
    salesLimit: limite(plan?.max_sales_per_month, 50),
    planVigente,
    motivoDeCorte,
    diasDeGracia,
    refresh: load,
  };
}