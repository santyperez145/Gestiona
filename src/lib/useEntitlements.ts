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
  /**
   * El plan contratado NO rige porque nunca se llegó a cobrar.
   *
   * ⚠️ Encontrado el 2026-08-27: apretar contratar y cancelar el pago en
   * MercadoPago daba el plan igual, con 7 días de gracia. La gracia era para
   * «rebotó un cobro», no para «nunca se pagó».
   */
  planSinPagar: boolean;
  /**
   * Acciones de IA del mes.
   *
   * ⚠️ `null` en `cupo`/`restante` significa **sin tope** —el plan Business—,
   * no «sin cupo». Compararlos con `!` los hace iguales y deja al plan que más
   * paga sin IA.
   *
   * 📌 Es orientación para la pantalla: el corte real lo hace
   * `exigirBeneficio` en el servidor, que es donde se gasta la plata.
   */
  iaCupoMensual: number | null;
  iaUsado: number;
  iaRestante: number | null;
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

/**
 * Lo que devuelve `public.org_entitlements` — la autoridad.
 *
 * ⚠️ Esta interface refleja una función de la base, no una tabla: si se le
 * agrega un campo allá, se agrega acá.
 */
interface EntitlementsDeLaBase {
  vigente: boolean;
  motivo_de_corte: 'impago' | 'cancelado' | 'pausado' | null;
  dias_de_gracia: number;
  ia: boolean;
  backups: boolean;
  branding: boolean;
  max_products: number | null;
  max_users: number | null;
  max_sales_per_month: number | null;
  /** El plan contratado no rige porque nunca se cobró. */
  plan_sin_pagar?: boolean;
  /** `null` = sin tope. No es lo mismo que 0. */
  ia_cupo_mensual?: number | null;
  ia_usado?: number;
  ia_restante?: number | null;
}

/** La relación/función todavía no existe en esta base. */
function noExiste(code: string | undefined): boolean {
  return code === '42883' || code === 'PGRST202' || code === '42P01' || code === 'PGRST205';
}

export function useEntitlements(): Entitlements {
  const { activeOrg } = useOrg();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [servidor, setServidor] = useState<EntitlementsDeLaBase | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!activeOrg) { setPlan(null); setSub(null); setServidor(null); setLoading(false); return; }
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

    // La decisión la toma la base. Acá sólo se muestra.
    const { data: ent, error: entError } = await supabase
      .rpc('org_entitlements', { p_org: activeOrg.id });
    if (entError && !noExiste(entError.code)) {
      // No se traga: un fallo real tiene que verse. Igual se sigue —el corte
      // de verdad lo hace el servidor, así que el navegador puede errar del
      // lado generoso sin que eso habilite nada.
      console.error('org_entitlements falló', entError);
    }
    setServidor((ent as unknown as EntitlementsDeLaBase) ?? null);

    setSub(subData as Subscription | null);
    setPlan(planRow);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeOrg?.id]);

  /**
   * ── Cuándo se vuelve a leer ───────────────────────────────────────────────
   *
   * No hay realtime sobre `plans` ni `subscriptions`, y no hace falta: el corte
   * lo aplica el servidor en cada llamada, así que una pantalla desactualizada
   * no habilita nada. Lo que sí importa es **no dejar al comercio mirando un
   * cartel viejo en el momento en que acaba de pagar**.
   *
   * Dos disparadores, los dos baratos:
   *
   * 1. Volver a la pestaña. Cubre el caso real: el comercio se va a
   *    MercadoPago, paga, y vuelve. Sin esto, el banner le sigue diciendo
   *    «estamos confirmando» hasta que recargue a mano.
   * 2. Mientras la suscripción está **confirmándose** —`past_due` sin
   *    `current_period_end`, que es como nace— se relee cada 20 s. Es el único
   *    estado transitorio que depende de que llegue un webhook, y dura
   *    minutos. No se poletea nada más: un plan estable no cambia solo.
   */
  const confirmando = sub?.status === 'past_due' && !sub?.current_period_end;

  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
    /* eslint-disable-next-line */
  }, [activeOrg?.id]);

  useEffect(() => {
    if (!confirmando) return;
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [confirmando, activeOrg?.id]);

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
  const graciaLocal = sub?.status === 'past_due'
    ? Math.max(0, DIAS_DE_GRACIA - diasImpago)
    : 0;

  const motivoLocal: Entitlements['motivoDeCorte'] =
    sub?.status === 'canceled' ? 'cancelado'
    : sub?.status === 'paused' ? 'pausado'
    : sub?.status === 'past_due' && graciaLocal === 0 ? 'impago'
    : null;

  // La respuesta del servidor manda. El cálculo local es el respaldo para
  // cuando la función todavía no existe en esta base — el mismo patrón que
  // `publicDataSource.ts`, porque las migraciones se aplican a mano y el
  // cliente no puede asumir que la de su propio commit ya corrió.
  const diasDeGracia = servidor ? servidor.dias_de_gracia : graciaLocal;
  const motivoDeCorte = servidor ? servidor.motivo_de_corte : motivoLocal;
  const planVigente = servidor ? servidor.vigente : (!sub || motivoLocal === null);

  const conBeneficio = (delServidor: boolean | undefined, local: boolean | null | undefined) =>
    servidor ? !!delServidor : (planVigente && !!local);
  // El piso: lo mínimo con lo que se puede seguir operando sin perder nada.
  const limite = (
    delServidor: number | null | undefined,
    local: number | null | undefined,
    piso: number,
  ) => servidor
    ? (delServidor ?? null)
    : (planVigente ? (local ?? null) : Math.min(local ?? piso, piso));
  const trialDaysLeft = sub?.current_period_end
    ? Math.max(0, Math.ceil((new Date(sub.current_period_end).getTime() - Date.now()) / 86400000))
    : 0;

  return {
    loading,
    plan,
    subscription: sub,
    isTrialing,
    trialDaysLeft,
    canUseAI: conBeneficio(servidor?.ia, plan?.ai_enabled),
    canCustomBrand: conBeneficio(servidor?.branding, plan?.custom_branding),
    canUseBackups: conBeneficio(servidor?.backups, plan?.backups_enabled),
    productLimit: limite(servidor?.max_products, plan?.max_products, 50),
    userLimit: limite(servidor?.max_users, plan?.max_users, 1),
    salesLimit: limite(servidor?.max_sales_per_month, plan?.max_sales_per_month, 50),
    planVigente,
    motivoDeCorte,
    diasDeGracia,
    planSinPagar: Boolean(servidor?.plan_sin_pagar),
    // ⚠️ `?? null` y no `?? 0`: sin dato del servidor no se sabe el cupo, y
    // decir 0 le mostraría al comercio que se quedó sin IA cuando el problema
    // es que no se pudo leer. Son cosas distintas.
    iaCupoMensual: servidor?.ia_cupo_mensual ?? null,
    iaUsado: servidor?.ia_usado ?? 0,
    iaRestante: servidor === null ? null : (servidor.ia_restante ?? null),
    refresh: load,
  };
}