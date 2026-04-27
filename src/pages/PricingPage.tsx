import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Check, Sparkles, ArrowLeft } from 'lucide-react';
import type { Plan } from '@/lib/useEntitlements';

const FEATURES: Record<string, string[]> = {
  trial: ['14 días gratis', 'Hasta 3 usuarios', 'Branding personalizado', 'IA incluida'],
  starter: ['Hasta 100 productos', '2 usuarios', 'Catálogo público', 'Soporte por email'],
  pro: ['Hasta 1.000 productos', '5 usuarios', 'IA + descripciones automáticas', 'Branding personalizado', 'Backups semanales'],
  business: ['Productos ilimitados', 'Usuarios ilimitados', 'Todas las features', 'Soporte prioritario', 'API dedicada'],
};

export default function PricingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearly, setYearly] = useState(false);

  useEffect(() => {
    supabase.from('plans').select('*').eq('active', true).order('sort_order').then(({ data }) => {
      setPlans((data || []) as Plan[]);
      setLoading(false);
    });
  }, []);

  const handleSelect = (code: string) => {
    if (!user) { navigate('/?signup=1'); return; }
    if (code === 'trial') { navigate('/'); return; }
    // TODO: trigger Stripe checkout
    navigate(`/ajustes?upgrade=${code}`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 sticky top-0 backdrop-blur-md bg-background/70 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" /> <span className="font-display font-bold text-lg">Gestiona</span>
          </Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Volver</Link>
        </div>
      </header>

      <section className="max-w-7xl mx-auto px-6 pt-16 pb-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-5">
          <Sparkles className="w-3.5 h-3.5" /> Planes simples, sin sorpresas
        </div>
        <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">Elegí el plan que se ajuste a tu negocio</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">Probá Gestiona 14 días gratis. Sin tarjeta. Cancelás cuando quieras.</p>

        <div className="inline-flex items-center gap-2 mt-8 p-1 rounded-xl bg-muted border border-border">
          <button onClick={() => setYearly(false)} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${!yearly ? 'bg-background shadow' : 'text-muted-foreground'}`}>Mensual</button>
          <button onClick={() => setYearly(true)} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${yearly ? 'bg-background shadow' : 'text-muted-foreground'}`}>Anual <span className="ml-1 text-xs text-primary">-17%</span></button>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-24 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
        {loading ? Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-6 h-96 animate-pulse" />
        )) : plans.map(p => {
          const price = yearly ? p.price_usd_yearly : p.price_usd_monthly;
          const isPro = p.code === 'pro';
          return (
            <div key={p.id} className={`relative rounded-2xl border p-6 flex flex-col ${isPro ? 'border-primary bg-primary/5 shadow-lg' : 'border-border bg-card'}`}>
              {isPro && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold">Más elegido</div>}
              <h3 className="font-display text-xl font-bold">{p.name}</h3>
              <p className="text-sm text-muted-foreground mt-1 min-h-[40px]">{p.description || ''}</p>
              <div className="my-6">
                <span className="text-4xl font-bold">${price}</span>
                <span className="text-sm text-muted-foreground"> / {yearly ? 'año' : 'mes'} USD</span>
              </div>
              <ul className="space-y-2.5 text-sm mb-6 flex-1">
                {(FEATURES[p.code] || []).map(f => (
                  <li key={f} className="flex items-start gap-2"><Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />{f}</li>
                ))}
              </ul>
              <Button onClick={() => handleSelect(p.code)} className="w-full" variant={isPro ? 'default' : 'outline'}>
                {p.code === 'trial' ? 'Empezar gratis' : `Elegir ${p.name}`}
              </Button>
            </div>
          );
        })}
      </section>
    </div>
  );
}