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
  active:   { label: 'Activo',           color: 'bg-green-500/15 text-green-400 border-green-500/20' },
  trialing: { label: 'Trial activo',     color: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  past_due: { label: 'Pago pendiente',   color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20' },
  canceled: { label: 'Cancelado',        color: 'bg-red-500/15 text-red-400 border-red-500/20' },
  paused:   { label: 'Pausado',          color: 'bg-muted text-muted-foreground border-border' },
};

const FAQ = [
  { q: '¿Puedo cambiar de plan en cualquier momento?', a: 'Sí. Podés subir o bajar de plan cuando quieras. Los cambios se aplican de forma inmediata (upgrade) o al final del período de facturación (downgrade).' },
  { q: '¿Qué pasa cuando termina el trial?', a: 'Te avisamos 3 días antes del vencimiento. Si no cargás una tarjeta, la cuenta se pausa y podés exportar tus datos. No se borran de forma automática.' },
  { q: '¿Puedo cancelar en cualquier momento?', a: 'Sí, sin costo. Cancelás desde Configuración → Facturación. El acceso continúa hasta el final del período ya pagado.' },
  { q: '¿Los precios son en dólares?', a: 'Sí, en USD. El cobro se realiza a través de Stripe con tarjeta de crédito o débito internacional.' },
  { q: '¿Hay descuento por pago anual?', a: 'Sí, 17% de descuento al pagar el año completo por adelantado.' },
];

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
    if (currentPlan?.code === plan.code && subscription?.status === 'active') {
      toast.info('Ya estás en este plan.');
      return;
    }

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
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/50 sticky top-0 backdrop-blur-md bg-background/70 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm font-display font-bold">
            <ArrowLeft className="w-4 h-4" /> Gestiona
          </Link>
          {user && (
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Volver al panel</Link>
          )}
        </div>
      </header>

      {/* Current subscription banner */}
      {user && subStatus && subStatus !== 'canceled' && (
        <div className={`border-b px-6 py-2 text-center text-sm ${
          subStatus === 'past_due' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' :
          subStatus === 'trialing' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
          'bg-green-500/10 border-green-500/20 text-green-400'
        }`}>
          {subStatus === 'past_due' && <AlertTriangle className="inline w-3.5 h-3.5 mr-1.5" />}
          {subStatus === 'trialing' && <Sparkles className="inline w-3.5 h-3.5 mr-1.5" />}
          {subStatus === 'active' && <Crown className="inline w-3.5 h-3.5 mr-1.5" />}
          {subStatus === 'trialing' && `Trial activo — te quedan ${trialDaysLeft} días`}
          {subStatus === 'active' && `Plan ${currentPlan?.name || ''} activo`}
          {subStatus === 'past_due' && 'Tu pago está pendiente. Actualizá tu método de pago para continuar.'}
        </div>
      )}

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 pt-16 pb-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-5">
          <Sparkles className="w-3.5 h-3.5" /> Planes simples, sin sorpresas
        </div>
        <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
          Elegí el plan que se ajuste a tu negocio
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Probá Gestiona 14 días gratis. Sin tarjeta. Cancelás cuando quieras.
        </p>

        {/* Billing toggle */}
        <div className="inline-flex items-center gap-2 mt-8 p-1 rounded-xl bg-muted border border-border">
          <button
            onClick={() => setYearly(false)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${!yearly ? 'bg-background shadow' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Mensual
          </button>
          <button
            onClick={() => setYearly(true)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${yearly ? 'bg-background shadow' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Anual
            <span className="px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-xs font-bold">-17%</span>
          </button>
        </div>
      </section>

      {/* Plans grid */}
      <section className="max-w-7xl mx-auto px-6 pb-16 grid md:grid-cols-3 gap-5">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-6 h-96 animate-pulse" />
            ))
          : plans.map(p => {
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
                  className={`relative rounded-2xl border p-6 flex flex-col ${
                    isCurrent
                      ? 'border-primary bg-primary/5 shadow-lg ring-1 ring-primary/20'
                      : isPro
                      ? 'border-primary/40 bg-card shadow-md'
                      : 'border-border bg-card'
                  }`}
                >
                  {/* Badges */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {isPro && !isCurrent && (
                        <span className="px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                          Más elegido
                        </span>
                      )}
                      {isCurrent && subStatus && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_LABEL[subStatus]?.color || ''}`}>
                          <Crown className="w-2.5 h-2.5" />
                          {STATUS_LABEL[subStatus]?.label || 'Tu plan'}
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 className="font-display text-xl font-bold">{p.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1 min-h-[36px]">{p.description || ''}</p>

                  <div className="my-5">
                    {p.price_usd_monthly === 0 ? (
                      <span className="text-4xl font-bold">Gratis</span>
                    ) : (
                      <div className="flex items-end gap-1">
                        <span className="text-4xl font-bold">${price}</span>
                        <span className="text-sm text-muted-foreground pb-1">/ {yearly ? 'año' : 'mes'} USD</span>
                      </div>
                    )}
                    {yearly && p.price_usd_monthly > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        <span className="line-through">${p.price_usd_monthly * 12}/año</span>
                        {' '}→ ahorrás ${Math.round(p.price_usd_monthly * 12 - p.price_usd_yearly)} USD
                      </p>
                    )}
                  </div>

                  <ul className="space-y-2 text-sm mb-6 flex-1">
                    {features.map(f => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    onClick={() => handleSelect(p)}
                    className={`w-full ${isCurrent && subscription?.status === 'active' ? 'opacity-60 pointer-events-none' : ''}`}
                    variant={isCurrent || isPro ? 'default' : 'outline'}
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

      {/* Social proof strip */}
      <section className="border-y border-border bg-muted/30 py-8">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p className="text-sm text-muted-foreground mb-4">Utilizado por negocios de perfumería, ropa, tecnología, gastronomía y más</p>
          <div className="flex flex-wrap justify-center gap-6 text-xs text-muted-foreground/60 font-medium">
            {['Sin contrato', 'Datos 100% tuyos', 'Hosting en Argentina', 'Soporte en español', 'HTTPS incluido'].map(f => (
              <span key={f} className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-primary" /> {f}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-display font-bold text-center mb-8">Preguntas frecuentes</h2>
        <div className="space-y-2">
          {FAQ.map((item, i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                className="w-full text-left px-5 py-4 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                onClick={() => setFaqOpen(faqOpen === i ? null : i)}
              >
                <span className="font-medium text-sm">{item.q}</span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${faqOpen === i ? 'rotate-180' : ''}`} />
              </button>
              {faqOpen === i && (
                <div className="px-5 pb-4 text-sm text-muted-foreground border-t border-border/50 pt-3">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer CTA */}
      <section className="border-t border-border bg-muted/20 py-12 text-center">
        <h2 className="text-2xl font-display font-bold mb-3">¿Tenés dudas?</h2>
        <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
          Escribinos por WhatsApp o email y te respondemos en menos de 24 horas.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {!user && (
            <Button onClick={() => navigate('/?signup=1')} className="gradient-gold text-primary-foreground">
              Empezar gratis — 14 días
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to="/">Volver al panel</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
