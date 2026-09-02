import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowRight, Check, Globe2, LayoutDashboard, MonitorSmartphone, Sparkles } from 'lucide-react';
import type { ActivationGoal } from '@/lib/activationReadiness';
import BrandLogo from '@/components/shared/BrandLogo';
import {
  completeBusinessOnboarding,
  listBusinessProfilePresets,
  parseProductTypeTemplates,
  summarizeBusinessProfile,
} from '@/lib/businessProfile';
import { firstProductPath } from '@/lib/activationHandoff';
import { storeWizardFinishCopy } from '@/lib/storeFirstPublish';

type FinishDestination = 'pos' | 'online' | 'dashboard' | 'demo';

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return fallback;
}

export default function OnboardingPage() {
  const { activeOrg, refresh } = useOrg();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(activeOrg?.name?.replace(' Workspace', '') || '');
  const [industries, setIndustries] = useState<Awaited<ReturnType<typeof listBusinessProfilePresets>>>([]);
  const [rubrosError, setRubrosError] = useState('');
  const [cargandoRubros, setCargandoRubros] = useState(true);
  const [rubroCode, setRubroCode] = useState('');
  // Violeta del workspace, no el dorado de la perfumería: el dorado es branding
  // de un comercio puntual, nunca el color con el que arranca otro.
  const [color, setColor] = useState('#6E4DEE');
  const [savingDestination, setSavingDestination] = useState<FinishDestination | null>(null);

  useEffect(() => {
    if (activeOrg) setName((current) => current || activeOrg.name.replace(' Workspace', ''));
  }, [activeOrg]);

  const cargarRubros = useCallback(() => {
    setCargandoRubros(true);
    setRubrosError('');
    void listBusinessProfilePresets()
      .then((rows) => {
        setIndustries(rows);
        // A propósito NO se preselecciona ninguno: el rubro siembra tipos de
        // producto y atributos, y sembrar los equivocados es peor que pedir un
        // clic más.
      })
      .catch((error: unknown) => {
        // Sin rubros no se puede seguir de verdad: el servidor rechaza un
        // código vacío. Decir "continuá y corregilo en Ajustes" haría fallar
        // el último paso después de tres pantallas.
        setRubrosError(errorMessage(error, 'No se pudieron cargar los rubros.'));
      })
      .finally(() => setCargandoRubros(false));
  }, []);

  useEffect(() => { cargarRubros(); }, [cargarRubros]);

  const colorPalette = Array.from(new Set(industries.map((industry) => industry.default_color).concat(['#6E4DEE','#3B82F6','#10B981','#EF4444','#8B5CF6','#EC4899','#F59E0B','#D4A843'])));
  const selectedIndustry = industries.find((industry) => industry.code === rubroCode) || null;
  const selectedTemplates = parseProductTypeTemplates(selectedIndustry?.product_type_templates);
  const selectedProfileSummary = summarizeBusinessProfile(selectedTemplates);

  if (!activeOrg) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'hsl(var(--background))' }}>
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const finish = async (destination: FinishDestination) => {
    setSaving(true);
    setSavingDestination(destination);
    try {
      const businessName = name.trim();
      const onboardingGoal: ActivationGoal = destination === 'pos'
        ? 'pos'
        : destination === 'online'
          ? 'online'
          : 'explore';
      await completeBusinessOnboarding({
        orgId: activeOrg.id,
        businessName,
        primaryColor: color,
        industryCode: rubroCode,
        onboardingGoal,
      });

      let demoSeedFailed = false;
      if (destination === 'demo') {
        const { error: demoError } = await supabase.functions.invoke('seed-demo', { body: { orgId: activeOrg.id } });
        demoSeedFailed = Boolean(demoError);
      }

      await refresh();
      if (destination === 'pos') {
        toast.success('Ruta POS elegida. Ahora cargá tu primer producto y su stock real.');
        navigate('/productos?onboarding=1&goal=pos');
      } else if (destination === 'online') {
        toast.success(storeWizardFinishCopy().toast);
        navigate(firstProductPath('online'));
      } else if (destination === 'demo') {
        if (demoSeedFailed) {
          toast.warning(`El negocio ${businessName} quedó configurado, pero no pudimos cargar la demo. Podés reintentar desde el panel.`);
        } else {
          toast.success(`¡Listo, ${businessName}! Cargamos datos de ejemplo para explorar.`);
        }
        navigate('/');
      } else {
        toast.success(`¡Listo, ${businessName}! El panel te va a guiar con el siguiente paso.`);
        navigate('/');
      }
    } catch (error) {
      toast.error(errorMessage(error, 'No se pudo completar la configuración. Revisá tu conexión e intentá de nuevo.'));
    } finally {
      setSaving(false);
      setSavingDestination(null);
    }
  };

  const STEPS = ['Tu negocio', '¿Qué vendés?', 'Marca', 'Primer paso'];

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'hsl(var(--background))' }}>
      {/* Ambient glow */}
      <div className="fixed inset-x-0 top-0 h-[300px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% 0%, hsl(38 82% 52% / 0.05) 0%, transparent 70%)' }} />

      <div className="w-full max-w-[480px] relative z-10">
        {/* Brand header */}
        <BrandLogo eager className="mb-10 flex justify-center" markClassName="h-7 w-7" nameClassName="text-[15px] text-foreground/80" />

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((label, i) => {
            const s = i + 1;
            const done = step > s;
            const active = step === s;
            return (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className={[
                    'w-5 h-5 rounded-[4px] flex items-center justify-center text-[10px] font-bold transition-all',
                    done ? 'bg-primary/20 text-primary' : active ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground/30',
                  ].join(' ')}>
                    {done ? <Check className="w-3 h-3" /> : s}
                  </div>
                  {active && (
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-primary/80 hidden sm:block">
                      {label}
                    </span>
                  )}
                </div>
                {s < STEPS.length && (
                  <div className="flex-1 h-px bg-border/40" />
                )}
              </div>
            );
          })}
        </div>

        {/* Card */}
        <div className="rounded-[12px] border border-border/60 p-7 relative overflow-hidden"
          style={{ background: 'hsl(var(--card))' }}>
          {/* Inner top highlight */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />

          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/60 mb-1.5">Paso 1 de 4</p>
                <h1 className="font-display text-[1.5rem] font-bold tracking-tight leading-tight">
                  ¿Cómo se llama tu negocio?
                </h1>
                <p className="text-[12px] text-muted-foreground/55 mt-1.5">
                  Lo podés cambiar después en Ajustes.
                </p>
              </div>
              <div>
                <Label htmlFor="name">Nombre del negocio</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ej: Mi negocio"
                  className="mt-2"
                  autoFocus
                />
              </div>
              <Button onClick={() => setStep(2)} disabled={!name.trim()} className="w-full">
                Siguiente <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/60 mb-1.5">Paso 2 de 4</p>
                <h1 className="font-display text-[1.5rem] font-bold tracking-tight leading-tight">
                  ¿Qué vendés?
                </h1>
                <p className="text-[12px] text-muted-foreground/55 mt-1.5">
                  Esto personaliza el sistema para tu rubro. Elegí uno para seguir:
                  no venimos con ninguno puesto porque define cómo se estructura
                  tu catálogo.
                </p>
              </div>
              {rubrosError && (
                <div className="rounded-[8px] border border-destructive/30 bg-destructive/[0.06] p-3 space-y-2">
                  <p className="text-[11px] text-foreground/85">{rubrosError}</p>
                  <Button variant="outline" size="sm" onClick={cargarRubros} disabled={cargandoRubros}>
                    {cargandoRubros ? 'Reintentando…' : 'Reintentar'}
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {industries.map(r => (
                  <button
                    key={r.code}
                    onClick={() => { setRubroCode(r.code); setColor(r.default_color); }}
                    className={[
                      'p-3 rounded-[8px] border text-[13px] font-medium transition-all duration-150 text-left',
                      rubroCode === r.code
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border/50 hover:border-primary/30 hover:bg-muted/30 text-foreground/70',
                    ].join(' ')}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
              {selectedIndustry && selectedProfileSummary.typeCount > 0 && (
                <div className="rounded-[8px] border border-primary/20 bg-primary/[0.05] p-3">
                  <p className="text-[11px] font-semibold text-foreground/85">
                    Tu catálogo arranca preparado para {selectedIndustry.name.toLowerCase()}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    Vamos a crear {selectedProfileSummary.typeCount === 1 ? 'el tipo' : `${selectedProfileSummary.typeCount} tipos`} {selectedProfileSummary.typeNames.join(' y ')} con {selectedProfileSummary.attributeCount} atributos útiles: {selectedProfileSummary.attributeNames.join(', ')}.
                  </p>
                  <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground/70">
                    Es una estructura editable: no cambia precios, stock ni productos existentes.
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Atrás</Button>
                <Button onClick={() => setStep(3)} className="flex-1" disabled={!rubroCode}>
                  Siguiente <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/60 mb-1.5">Paso 3 de 4</p>
                <h1 className="font-display text-[1.5rem] font-bold tracking-tight leading-tight">
                  Color de marca
                </h1>
                <p className="text-[12px] text-muted-foreground/55 mt-1.5">
                  Aparece en botones, alertas y el catálogo público.
                </p>
              </div>

              <div className="grid grid-cols-7 gap-2">
                {colorPalette.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    style={{ background: c }}
                    className={[
                      'aspect-square rounded-[6px] border-2 transition-all duration-150 flex items-center justify-center',
                      color === c ? 'border-foreground scale-110 shadow-[0_2px_8px_rgba(0,0,0,0.4)]' : 'border-transparent opacity-70 hover:opacity-100',
                    ].join(' ')}
                  >
                    {color === c && <Check className="w-4 h-4 text-white drop-shadow" />}
                  </button>
                ))}
              </div>

              {/* Preview */}
              <div className="flex items-center gap-2 p-3 rounded-[7px] border border-border/40 bg-muted/20">
                <div className="w-6 h-6 rounded-[4px] shrink-0" style={{ background: color }} />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Vista previa del color</p>
                  <p className="text-[12px] font-mono">{color}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(2)} className="flex-1" disabled={saving}>Atrás</Button>
                  <Button onClick={() => setStep(4)} className="flex-1" disabled={saving}>
                    Siguiente <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Step 4 */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/60 mb-1.5">Paso 4 de 4</p>
                <h1 className="font-display text-[1.5rem] font-bold tracking-tight leading-tight">
                  Empezá por tu tienda
                </h1>
                <p className="text-[12px] text-muted-foreground/55 mt-1.5">
                  Publicá, cobrá y gestioná el mismo negocio. El mostrador queda a un paso si vendés en local.
                </p>
              </div>

              <button
                type="button"
                onClick={() => finish('online')}
                disabled={saving}
                className="w-full rounded-[9px] border border-primary/35 bg-primary/[0.07] p-4 text-left transition-colors hover:bg-primary/[0.11] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"><Globe2 className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">Publicar mi tienda online</span><span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">Catálogo, publicación, cobro con Mercado Pago, envío y páginas legales. El stock es el mismo del mostrador.</span></span>
                  {savingDestination === 'online' ? <span className="mt-2 text-[11px] text-primary">Guardando...</span> : <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-primary" />}
                </span>
              </button>

              <button
                type="button"
                onClick={() => finish('pos')}
                disabled={saving}
                className="w-full rounded-[9px] border border-border/60 p-4 text-left transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><MonitorSmartphone className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">Vender en mi local con POS</span><span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">Catálogo, stock, cobro en mostrador, ARCA y primera venta. Sin pedirte envío ni pasarela online.</span></span>
                  {savingDestination === 'pos' ? <span className="mt-2 text-[11px] text-muted-foreground">Guardando...</span> : <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />}
                </span>
              </button>

              <button
                type="button"
                onClick={() => finish('demo')}
                disabled={saving}
                className="w-full rounded-[9px] border border-border/60 p-4 text-left transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300"><Sparkles className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">Todavía quiero explorar</span><span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">Cargamos datos de ejemplo, pero no contaremos la organización como activada hasta que elijas un canal y vendas.</span></span>
                  {savingDestination === 'demo' ? <span className="mt-2 text-[11px] text-muted-foreground">Cargando...</span> : <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />}
                </span>
              </button>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(3)} className="flex-1" disabled={saving}>Atrás</Button>
                <Button variant="ghost" onClick={() => finish('dashboard')} className="flex-1" disabled={saving}>
                  {savingDestination === 'dashboard' ? 'Guardando...' : 'Ir al panel'} <LayoutDashboard className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-muted-foreground/30 mt-6">
          Gestiona · Creá tu tienda y gestioná el mismo negocio
        </p>
      </div>
    </div>
  );
}
