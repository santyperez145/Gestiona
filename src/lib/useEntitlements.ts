import { conRegistro } from "@/lib/registroDeErrores";
import { useQuery } from '@tanstack/react-query';
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
  ai_monthly_credits?: number | null;
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
  motivoDeCorte: 'impago' | 'pausado' | 'sin_pagar' | 'prueba_finalizada' | null;
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
  motivo_de_corte: Entitlements['motivoDeCorte'];
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

interface LecturaDeEntitlements {
  sub: Subscription | null;
  plan: Plan | null;
  servidor: EntitlementsDeLaBase | null;
}

/**
 * Una lectura por negocio, compartida (2026-10-31). El hook se usa en 11
 * componentes y cada instancia hacía tres consultas en serie: el barrido con
 * datos midió `subscriptions`, `plans` y `org_entitlements` dos veces por
 * pantalla. Con React Query todos leen la misma entrada; la suscripción y la
 * decisión del servidor se piden en paralelo.
 */
async function leerEntitlements(orgId: string, planDeLaOrg: string | null | undefined): Promise<LecturaDeEntitlements> {
  const [{ data: subData }, { data: ent, error: entError }] = await Promise.all([
    conRegistro(supabase.from('subscriptions').select('*').eq('org_id', orgId).maybeSingle()),
    // La decisión la toma la base. Acá sólo se muestra.
    supabase.rpc('org_entitlements', { p_org: orgId }),
  ]);
  if (entError && !noExiste(entError.code)) {
    // No se traga: un fallo real tiene que verse. Igual se sigue —el corte
    // de verdad lo hace el servidor, así que el navegador puede errar del
    // lado generoso sin que eso habilite nada.
    console.error('org_entitlements falló', entError);
  }
  const planId = (subData as Subscription | null)?.plan_id ?? planDeLaOrg ?? null;
  let plan: Plan | null = null;
  if (planId) {
    const { data: p } = await conRegistro(supabase.from('plans').select('*').eq('id', planId).maybeSingle());
    plan = p as Plan | null;
  }
  return { sub: subData as Subscription | null, plan, servidor: (ent as unknown as EntitlementsDeLaBase) ?? null };
}

export function useEntitlements(): Entitlements {
  const { activeOrg } = useOrg();

  /**
   * ── Cuándo se vuelve a leer ───────────────────────────────────────────────
   *
   * No hay realtime sobre `plans` ni `subscriptions`, y no hace falta: el corte
   * lo aplica el servidor en cada llamada, así que una pantalla desactualizada
   * no habilita nada. Lo que sí importa es **no dejar al comercio mirando un
   * cartel viejo en el momento en que acaba de pagar**.
   *
   * 1. Volver a la pestaña (`refetchOnWindowFocus`): el comercio se va a
   *    MercadoPago, paga, y vuelve.
   * 2. Mientras la suscripción está **confirmándose** —`past_due` sin
   *    `current_period_end`, que es como nace— se relee cada 20 s. Es el único
   *    estado transitorio que depende de que llegue un webhook.
   */
  const { data, isPending, refetch } = useQuery({
    queryKey: ['entitlements', activeOrg?.id ?? '', activeOrg?.plan_id ?? ''],
    queryFn: () => leerEntitlements(activeOrg!.id, activeOrg?.plan_id),
    enabled: !!activeOrg,
    staleTime: 60_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: q => {
      const s = q.state.data?.sub;
      return s?.status === 'past_due' && !s?.current_period_end ? 20_000 : false;
    },
  });
  const sub = activeOrg ? data?.sub ?? null : null;
  const plan = activeOrg ? data?.plan ?? null : null;
  const servidor = activeOrg ? data?.servidor ?? null : null;
  const loading = activeOrg ? isPending : false;

  const isTrialing = sub?.status === 'trialing' && Boolean(sub.current_period_end && new Date(sub.current_period_end) > new Date());

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
    // Una baja vuelve sola al plan Inicial (gratis): sólo se corta lo que
    // corta el plan gratis, es decir, los extras cuando la prueba terminó.
    sub?.status === 'canceled' ? ((!activeOrg?.trial_ends_at || new Date(activeOrg.trial_ends_at) <= new Date()) ? 'prueba_finalizada' : null)
    : sub?.status === 'paused' ? 'pausado'
    : sub?.status === 'past_due' && graciaLocal === 0 && plan?.code !== 'trial' ? 'impago'
    : plan?.code === 'trial' && (!activeOrg?.trial_ends_at || new Date(activeOrg.trial_ends_at) <= new Date()) ? 'prueba_finalizada'
    : null;

  // La respuesta del servidor manda. El cálculo local es el respaldo para
  // cuando la función todavía no existe en esta base — el mismo patrón que
  // `publicDataSource.ts`, porque las migraciones se aplican a mano y el
  // cliente no puede asumir que la de su propio commit ya corrió.
  const diasDeGracia = servidor ? servidor.dias_de_gracia : graciaLocal;
  const motivoDeCorte = servidor ? servidor.motivo_de_corte : motivoLocal;
  const planVigente = servidor ? servidor.vigente : ((!sub || motivoLocal === null) && motivoLocal !== 'prueba_finalizada');

  const conBeneficio = (delServidor: boolean | undefined, local: boolean | null | undefined) =>
    servidor ? !!delServidor : (planVigente && !!local);
  // El piso: lo mínimo con lo que se puede seguir operando sin perder nada.
  const limite = (
    delServidor: number | null | undefined,
    local: number | null | undefined,
  ) => servidor
    ? (delServidor ?? null)
    : (planVigente ? (local ?? null) : null);
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
    productLimit: limite(servidor?.max_products, plan?.max_products),
    userLimit: limite(servidor?.max_users, plan?.max_users),
    salesLimit: limite(servidor?.max_sales_per_month, plan?.max_sales_per_month),
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
    refresh: async () => { await refetch(); },
  };
}
