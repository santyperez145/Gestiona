import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import { useEntitlements } from '@/lib/useEntitlements';
import { Button } from '@/components/ui/button';
import { Check, Sparkles, ArrowLeft, Loader2, Crown, AlertTriangle, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import type { Plan } from '@/lib/useEntitlements';
import BrandLogo from '@/components/shared/BrandLogo';

/**
 * Los renglones que se pueden escribir a mano, y sólo ésos.
 *
 * ⚠️ Antes esta lista también decía los límites, y **mentía**: prometía «hasta
 * 100 productos» en Starter cuando el plan permite 1000, y «hasta 1.000» en Pro
 * cuando es ilimitado. Un texto suelto al lado de una columna se desincroniza
 * el día que alguien toca la columna — y acá el texto es una promesa de venta.
 *
 * Los límites ahora salen de las columnas del plan (`limitesDelPlan`), así que
 * no pueden contradecirlo. Esto queda para lo que de verdad es texto de venta.
 */
const FALLBACK_FEATURES: Record<string, string[]> = {
  trial:    ['14 días gratis, sin tarjeta', 'Catálogo público'],
  starter:  ['Catálogo público', 'Soporte por email'],
  pro:      ['Integraciones Tiendanube y MercadoPago', 'Soporte por email'],
  business: ['Soporte prioritario', 'API pública con rate limit alto', 'Onboarding dedicado'],
};

/**
 * Lo que el plan permite, dicho desde sus propias columnas.
 *
 * Si el dueño cambia `max_products` en la consola, la landing lo dice sola: no
 * hay que acordarse de editar también un texto.
 */
function limitesDelPlan(p: Plan): string[] {
  const cantidad = (n: number | null | undefined, singular: string, plural: string) =>
    n == null ? `${plural} ilimitados` : `Hasta ${Number(n).toLocaleString('es-AR')} ${n === 1 ? singular : plural}`;

  const lineas = [
    cantidad(p.max_products, 'producto', 'productos'),
    cantidad(p.max_users, 'usuario', 'usuarios'),
  ];
  if (p.max_sales_per_month != null) {
    lineas.push(`${Number(p.max_sales_per_month).toLocaleString('es-AR')} ventas por mes`);
  } else {
    lineas.push('Ventas ilimitadas');
  }
  if (p.ai_enabled) lineas.push('Inteligencia artificial incluida');
  if (p.backups_enabled) lineas.push('Backups automáticos');
  if (p.custom_branding) lineas.push('Branding propio en la tienda');
  return lineas;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active:   { label: 'Activo',         color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
  trialing: { label: 'Trial activo',   color: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  past_due: { label: 'Pago pendiente', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20' },
  canceled: { label: 'Cancelado',      color: 'bg-destructive/15 text-destructive border-destructive/20' },
  paused:   { label: 'Pausado',        color: 'bg-muted text-muted-foreground border-border' },
};

const FAQ = [
  { q: '¿Puedo cambiar de plan en cualquier momento?', a: 'Sí. Podés subir o bajar de plan cuando quieras. Los cambios se aplican de forma inmediata (upgrade) o al final del período de facturación (downgrade).' },
  { q: '¿Qué pasa cuando termina el trial?', a: 'Te avisamos 3 días antes del vencimiento. Si no cargás una tarjeta, la cuenta se pausa y podés exportar tus datos. No se borran de forma automática.' },
  { q: '¿Puedo cancelar en cualquier momento?', a: 'Sí, sin costo. Cancelás desde Configuración → Facturación. El acceso continúa hasta el final del período ya pagado.' },
  // ⚠️ Este FAQ decía "Sí, en USD… a través de Stripe". Las dos mitades eran
  // falsas: la suscripción se cobra en PESOS y por MercadoPago (`mp-subscribe`
  // arma un preapproval con `currency_id: 'ARS'`). Prometer un precio en
  // dólares y cobrar otro en pesos es la clase de sorpresa que hace que alguien
  // dé de baja el primer mes.
  { q: '¿En qué moneda son los precios?', a: 'En pesos argentinos. El cobro es mensual o anual por MercadoPago, con la tarjeta o el saldo que ya usás.' },
  { q: '¿Hay descuento por pago anual?', a: 'Sí, 17% de descuento al pagar el año completo por adelantado.' },
];

const TRUST = ['Sin contrato', 'Datos 100% tuyos', 'Hosting en Argentina', 'Soporte en español', 'HTTPS incluido'];

// ⚠️ El precio que vale es el de PESOS: es el que cobra MercadoPago, que es
// el único medio con el que se puede pagar la suscripción, y el que lee
// `mp-subscribe`. Los de dólares quedan en la tabla como referencia
// comercial y NO se muestran: publicar USD y cobrar ARS es prometer un
// precio y cobrar otro.
//
// Un plan sin precio en pesos no se puede cobrar. Se devuelve 0 y la tarjeta
// lo muestra como "Sin precio" en vez de inventar una conversión.
const precioMensual = (p: { price_ars_monthly?: number | null }) => Number(p.price_ars_monthly) || 0;
const precioAnual = (p: { price_ars_yearly?: number | null }) => Number(p.price_ars_yearly) || 0;

const fmtARS = (n: number) => n.toLocaleString('es-AR');
export default function PricingPage() {
  const { user, session } = useAuth();
  const { activeOrg } = useOrg();
  const { plan: currentPlan, subscription, isTrialing, trialDaysLeft } = useEntitlements();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [yearly, setYearly] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  useEffect(() => {
    supabase.from('plans').select('*').eq('active', true).neq('code', 'trial').order('sort_order').then(({ data }) => {
      setPlans((data || []) as Plan[]);
      setLoading(false);
    });
  }, []);

  const handleSelect = async (plan: Plan) => {
    if (!user) { navigate('/?signup=1'); return; }
    if (plan.code === 'trial') { navigate('/'); return; }
    if (!activeOrg) { toast.error('Necesitás tener una organización activa para suscribirte.'); return; }
    if (currentPlan?.code === plan.code && subscription?.status === 'active') { toast.info('Ya estás en este plan.'); return; }
    setCheckingOut(plan.code);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { planCode: plan.code, orgId: activeOrg.id, yearly },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || !data?.url) { toast.error('No se pudo iniciar el pago. Intentá de nuevo.'); return; }
      window.location.href = data.url;
    } catch {
      toast.error('Error al conectar con el sistema de pagos.');
    } finally {
      setCheckingOut(null);
    }
  };

  const getButtonLabel = (plan: Plan) => {
    if (checkingOut === plan.code) return null;
    if (!user) return 'Empezar ahora';
    if (currentPlan?.code === plan.code) {
      if (subscription?.status === 'active') return 'Plan actual';
      if (subscription?.status === 'past_due') return 'Renovar ahora';
      if (subscription?.status === 'canceled') return 'Reactivar';
    }
    // ⚠️ Se compara por el precio que se COBRA (ARS). Comparar por el de
    //    dólares podía decir "Subir" para un plan más barato en pesos si las
    //    dos escalas dejaban de ser proporcionales — y lo son sólo por ahora.
    if (currentPlan && precioMensual(plan) > precioMensual(currentPlan)) return `Subir a ${plan.name}`;
    if (currentPlan && precioMensual(plan) < precioMensual(currentPlan)) return `Bajar a ${plan.name}`;
    return `Elegir ${plan.name}`;
  };

  // Primero lo que el plan PERMITE —derivado de sus columnas, así que siempre
  // cierto— y después lo que el dueño escribió como texto de venta.
  const getFeatures = (p: Plan): string[] => {
    const escritas = Array.isArray(p.features) && p.features.length > 0
      ? p.features
      : (FALLBACK_FEATURES[p.code] || []);
    return [...limitesDelPlan(p), ...escritas];
  };

  const subStatus = subscription?.status;

  return (
    <div className="min-h-screen text-foreground" style={{ background: 'hsl(var(--background))' }}>

      {/* ── Nav ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-border/30 backdrop-blur-md"
        style={{ background: 'hsl(var(--background) / 0.85)' }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-[13px] font-display font-semibold text-muted-foreground/70 hover:text-foreground transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> <BrandLogo markClassName="h-5 w-5" nameClassName="text-[13px]" />
          </Link>
          {user && (
            <Link to="/" className="text-[12px] text-muted-foreground/50 hover:text-foreground transition-colors">
              Volver al panel
            </Link>
          )}
        </div>
      </header>

      {/* Subscription status banner */}
      {user && subStatus && subStatus !== 'canceled' && (
        <div className={`border-b px-6 py-2 text-center text-[12px] flex items-center justify-center gap-1.5 ${
          subStatus === 'past_due' ? 'bg-yellow-500/8 border-yellow-500/20 text-yellow-400' :
          subStatus === 'trialing' ? 'bg-blue-500/8 border-blue-500/20 text-blue-400' :
          'bg-emerald-500/8 border-emerald-500/20 text-emerald-400'
        }`}>
          {subStatus === 'past_due' && <AlertTriangle className="w-3.5 h-3.5" />}
          {subStatus === 'trialing' && <Sparkles className="w-3.5 h-3.5" />}
          {subStatus === 'active' && <Crown className="w-3.5 h-3.5" />}
          <span>
            {subStatus === 'trialing' && `Trial activo — te quedan ${trialDaysLeft} días`}
            {subStatus === 'active' && `Plan ${currentPlan?.name || ''} activo`}
            {subStatus === 'past_due' && 'Tu pago está pendiente. Actualizá tu método de pago para continuar.'}
          </span>
        </div>
      )}

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative max-w-6xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="absolute inset-x-0 top-0 h-[300px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 0%, hsl(38 82% 52% / 0.06) 0%, transparent 70%)' }} />

        <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-6"
          style={{ background: 'hsl(38 82% 52% / 0.08)', border: '1px solid hsl(38 82% 52% / 0.2)', borderRadius: '5px' }}>
          <Sparkles className="w-3 h-3 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-primary/80">Planes simples, sin sorpresas</span>
        </div>

        <h1 className="font-display text-[2.8rem] md:text-[3.5rem] font-bold tracking-tight leading-tight mb-4 max-w-3xl mx-auto">
          Elegí el plan que se ajuste a tu negocio
        </h1>
        <p className="text-[13px] text-muted-foreground/60 max-w-xl mx-auto mb-8 leading-relaxed">
          Probá Gestiona 14 días gratis. Sin tarjeta. Cancelás cuando quieras.
        </p>

        {/* Billing toggle — underline style */}
        <div className="inline-flex border-b border-border/40">
          {[
            { val: false, label: 'Mensual' },
            { val: true, label: 'Anual', badge: '-17%' },
          ].map(({ val, label, badge }) => (
            <button
              key={label}
              onClick={() => setYearly(val)}
              className={[
                'px-6 pb-3 text-[11px] font-semibold uppercase tracking-[0.1em] transition-all duration-200',
                'relative after:absolute after:bottom-[-1px] after:inset-x-0 after:h-[2px] after:rounded-full after:transition-transform after:duration-200',
                yearly === val
                  ? 'text-foreground after:bg-primary after:scale-x-100'
                  : 'text-muted-foreground/50 hover:text-muted-foreground after:bg-primary after:scale-x-0',
              ].join(' ')}
            >
              {label}
              {badge && yearly === val && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-[3px] bg-primary/15 text-primary text-[9px] font-bold">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* ── Plans grid ───────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pb-16 grid md:grid-cols-3 gap-4">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-[10px] border border-border/50 bg-card p-6 h-96 animate-pulse" />
            ))
          : plans.map((p, idx) => {
              const price = yearly ? precioAnual(p) : precioMensual(p);
              const isPro = p.code === 'pro';
              const isCurrent = currentPlan?.code === p.code;
              const isLoading = checkingOut === p.code;
              const features = getFeatures(p);
              const btnLabel = getButtonLabel(p);
              const isCurrentActive = isCurrent && subscription?.status === 'active';

              return (
                <div
                  key={p.id}
                  className={[
                    'relative rounded-[10px] border p-6 flex flex-col overflow-hidden',
                    isCurrent
                      ? 'border-primary/40 bg-card/90'
                      : isPro
                      ? 'border-primary/25 bg-card'
                      : 'border-border/50 bg-muted/20',
                  ].join(' ')}
                >
                  {/* Inner top highlight */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/6 to-transparent" />

                  {/* Featured accent bar */}
                  {isPro && (
                    <div className="absolute left-0 inset-y-0 w-[3px] rounded-r-full"
                      style={{ background: 'var(--gradient-gold)' }} />
                  )}

                  {/* Badges row */}
                  <div className="flex items-center gap-2 mb-4 min-h-[22px]">
                    {isPro && !isCurrent && (
                      <span className="px-[5px] py-[2px] rounded-[3px] bg-primary/15 text-primary text-[10px] font-bold uppercase tracking-[0.08em] font-mono">
                        Más elegido
                      </span>
                    )}
                    {isCurrent && subStatus && (
                      <span className={`inline-flex items-center gap-1 px-[5px] py-[2px] rounded-[3px] text-[10px] font-bold uppercase tracking-[0.08em] border font-mono ${STATUS_LABEL[subStatus]?.color || ''}`}>
                        <Crown className="w-2.5 h-2.5" />
                        {STATUS_LABEL[subStatus]?.label || 'Tu plan'}
                      </span>
                    )}
                  </div>

                  {/* Plan name */}
                  <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/40 mb-1">
                    {String(idx + 1).padStart(2, '0')}
                  </p>
                  <h3 className="font-display text-[1.2rem] font-bold tracking-tight">{p.name}</h3>
                  <p className="text-[12px] text-muted-foreground/55 mt-1 mb-5 min-h-[36px]">{p.description || ''}</p>

                  {/* Price */}
                  <div className="mb-5">
                    {precioMensual(p) === 0 ? (
                      <span className="font-mono text-[2.2rem] font-bold tracking-tight">Gratis</span>
                    ) : (
                      <div className="flex items-end gap-1">
                        <span className="font-mono text-[2.2rem] font-bold tracking-tight">${price}</span>
                        <span className="text-[11px] text-muted-foreground/50 pb-1.5">/ {yearly ? 'año' : 'mes'}</span>
                      </div>
                    )}
                    {yearly && precioMensual(p) > 0 && (
                      <p className="text-[11px] text-muted-foreground/45 mt-0.5 font-mono">
                        <span className="line-through">${fmtARS(precioMensual(p) * 12)}/año</span>
                        {' '}→ ahorrás ${fmtARS(Math.round(precioMensual(p) * 12 - precioAnual(p)))}
                      </p>
                    )}
                  </div>

                  {/* Features */}
                  <ul className="space-y-2 mb-6 flex-1">
                    {features.map(f => (
                      <li key={f} className="flex items-start gap-2">
                        <div className="mt-[3px] w-[3px] h-[12px] rounded-full bg-primary/50 shrink-0" />
                        <span className="text-[12px] text-muted-foreground/70">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    onClick={() => handleSelect(p)}
                    className={`w-full ${isCurrentActive ? 'opacity-50 pointer-events-none' : ''}`}
                    variant={isPro || isCurrent ? 'default' : 'outline'}
                    disabled={!!checkingOut || isCurrentActive}
                  >
                    {isLoading ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Redirigiendo...</>
                    ) : btnLabel}
                  </Button>
                </div>
              );
            })}
      </section>

      {/* ── Trust strip ──────────────────────────────────────────── */}
      <section className="border-y border-border/30 py-8"
        style={{ background: 'hsl(var(--card))' }}>
        <div className="max-w-6xl mx-auto px-6 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/35 mb-5">
            Utilizado por negocios de perfumería, ropa, tecnología, gastronomía y más
          </p>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-2">
            {TRUST.map(f => (
              <div key={f} className="flex items-center gap-1.5">
                <div className="w-[3px] h-[10px] rounded-full bg-primary/50" />
                <span className="text-[12px] text-muted-foreground/55 font-medium">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-10">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/60 mb-2">FAQ</p>
          <h2 className="font-display text-[1.8rem] font-bold tracking-tight">Preguntas frecuentes</h2>
        </div>
        <div className="space-y-1">
          {FAQ.map((item, i) => (
            <div key={i} className="rounded-[8px] border border-border/40 overflow-hidden"
              style={{ background: 'hsl(var(--card))' }}>
              <button
                className="w-full text-left px-5 py-4 flex items-center justify-between gap-3 hover:bg-muted/20 transition-colors"
                onClick={() => setFaqOpen(faqOpen === i ? null : i)}
              >
                <span className="font-display font-medium text-[13px]">{item.q}</span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground/50 shrink-0 transition-transform duration-200 ${faqOpen === i ? 'rotate-180' : ''}`} />
              </button>
              {faqOpen === i && (
                <div className="px-5 pb-4 text-[12px] text-muted-foreground/60 border-t border-border/30 pt-3 leading-relaxed">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer CTA ───────────────────────────────────────────── */}
      <section className="border-t border-border/30 py-16 text-center"
        style={{ background: 'hsl(var(--card))' }}>
        <div className="max-w-md mx-auto px-6">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/60 mb-3">¿Tenés dudas?</p>
          <h2 className="font-display text-[1.6rem] font-bold tracking-tight mb-3">Estamos para ayudarte</h2>
          <p className="text-[12px] text-muted-foreground/55 mb-7 leading-relaxed">
            Escribinos por WhatsApp o email y te respondemos en menos de 24 horas.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {!user && (
              <Button onClick={() => navigate('/?signup=1')}>
                Empezar gratis — 14 días
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/">Volver al panel</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
