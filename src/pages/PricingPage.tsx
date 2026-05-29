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

const FALLBACK_FEATURES: Record<string, string[]> = {
  trial:    ['14 días gratis, sin tarjeta', 'Hasta 50 productos', '3 usuarios', 'Catálogo público', 'IA incluida'],
  starter:  ['Hasta 100 productos', '2 usuarios', 'Catálogo público', 'Soporte por email'],
  pro:      ['Hasta 1.000 productos', '5 usuarios', 'IA + descripciones automáticas', 'Branding personalizado', 'Backups semanales', 'Integraciones Tiendanube y MP'],
  business: ['Productos ilimitados', 'Usuarios ilimitados', 'Todas las features Pro', 'Soporte prioritario', 'API pública con rate limit alto', 'Onboarding dedicado'],
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active:   { label: 'Activo',         color: 'bg-success/15 text-success border-success/20' },
  trialing: { label: 'Trial activo',   color: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  past_due: { label: 'Pago pendiente', color: 'bg-warning/15 text-warning border-warning/20' },
  canceled: { label: 'Cancelado',      color: 'bg-destructive/15 text-destructive border-destructive/20' },
  paused:   { label: 'Pausado',        color: 'bg-muted text-muted-foreground border-border' },
};

const FAQ = [
  { q: '¿Puedo cambiar de plan en cualquier momento?', a: 'Sí. Podés subir o bajar de plan cuando quieras. Los cambios se aplican de forma inmediata (upgrade) o al final del período de facturación (downgrade).' },
  { q: '¿Qué pasa cuando termina el trial?', a: 'Te avisamos 3 días antes del vencimiento. Si no cargás una tarjeta, la cuenta se pausa y podés exportar tus datos. No se borran de forma automática.' },
  { q: '¿Puedo cancelar en cualquier momento?', a: 'Sí, sin costo. Cancelás desde Configuración → Facturación. El acceso continúa hasta el final del período ya pagado.' },
  { q: '¿Los precios son en dólares?', a: 'Sí, en USD. El cobro se realiza a través de Stripe con tarjeta de crédito o débito internacional.' },
  { q: '¿Hay descuento por pago anual?', a: 'Sí, 17% de descuento al pagar el año completo por adelantado.' },
];

const TRUST = ['Sin contrato', 'Datos 100% tuyos', 'Hosting en Argentina', 'Soporte en español', 'HTTPS incluido'];

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
    if (currentPlan && plan.price_usd_monthly > currentPlan.price_usd_monthly) return `Subir a ${plan.name}`;
    if (currentPlan && plan.price_usd_monthly < currentPlan.price_usd_monthly) return `Bajar a ${plan.name}`;
    return `Elegir ${plan.name}`;
  };

  const getFeatures = (p: Plan): string[] => {
    if (Array.isArray(p.features) && p.features.length > 0) return p.features;
    return FALLBACK_FEATURES[p.code] || [];
  };

  const subStatus = subscription?.status;

  return (
    <div className="min-h-screen text-foreground" style={{ background: 'hsl(228 28% 4.5%)' }}>

      {/* ── Nav ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-border/30 backdrop-blur-md"
        style={{ background: 'hsl(228 28% 4.5% / 0.85)' }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-[13px] font-display font-semibold text-muted-foreground/70 hover:text-foreground transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Gestiona
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
          subStatus === 'past_due' ? 'bg-warning/8 border-warning/20 text-warning' :
          subStatus === 'trialing' ? 'bg-blue-500/8 border-blue-500/20 text-blue-400' :
          'bg-success/8 border-success/20 text-success'
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
              const price = yearly ? p.price_usd_yearly : p.price_usd_monthly;
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
                    {p.price_usd_monthly === 0 ? (
                      <span className="font-mono text-[2.2rem] font-bold tracking-tight">Gratis</span>
                    ) : (
                      <div className="flex items-end gap-1">
                        <span className="font-mono text-[2.2rem] font-bold tracking-tight">${price}</span>
                        <span className="text-[11px] text-muted-foreground/50 pb-1.5">/ {yearly ? 'año' : 'mes'} USD</span>
                      </div>
                    )}
                    {yearly && p.price_usd_monthly > 0 && (
                      <p className="text-[11px] text-muted-foreground/45 mt-0.5 font-mono">
                        <span className="line-through">${p.price_usd_monthly * 12}/año</span>
                        {' '}→ ahorrás ${Math.round(p.price_usd_monthly * 12 - p.price_usd_yearly)} USD
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
        style={{ background: 'hsl(228 24% 6%)' }}>
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
              style={{ background: 'hsl(228 24% 7%)' }}>
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
        style={{ background: 'hsl(228 24% 6%)' }}>
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
