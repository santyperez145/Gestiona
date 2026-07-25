import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowRight, Check } from 'lucide-react';
import { listIndustries } from '@/lib/marketingExtraDB';

export default function OnboardingPage() {
  const { activeOrg, refresh } = useOrg();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(activeOrg?.name?.replace(' Workspace', '') || '');
  const [industries, setIndustries] = useState<any[]>([]);
  const [rubroCode, setRubroCode] = useState('perfumes');
  const [color, setColor] = useState('#D4A843');
  const [loadDemo, setLoadDemo] = useState(false);

  useEffect(() => {
    listIndustries().then((rows) => {
      setIndustries(rows);
      const def = rows.find((r: any) => r.code === 'perfumes') || rows[0];
      if (def) { setRubroCode(def.code); setColor(def.default_color); }
    });
  }, []);

  const colorPalette = Array.from(new Set(industries.map((i: any) => i.default_color).concat(['#D4A843','#3B82F6','#10B981','#EF4444','#8B5CF6','#EC4899','#F59E0B'])));

  if (!activeOrg) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'hsl(var(--background))' }}>
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const finish = async (withDemo = false) => {
    setSaving(true);
    const ind = industries.find(i => i.code === rubroCode);
    const defaultSettings = ind?.default_settings || {};
    const aiTone = ind?.ai_tone || 'profesional rioplatense argentino';
    const { error: orgErr } = await supabase
      .from('organizations')
      .update({ name, primary_color: color })
      .eq('id', activeOrg.id);
    if (orgErr) { toast.error('Error guardando'); setSaving(false); return; }
    await supabase
      .from('settings')
      .update({ business_name: name, primary_color: color, industry_code: rubroCode, ai_tone: aiTone, ...defaultSettings })
      .eq('org_id', activeOrg.id);
    await supabase
      .from('organizations')
      .update({ onboarding_completed: true })
      .eq('id', activeOrg.id);
    localStorage.setItem(`gestiona.onboarded.${activeOrg.id}`, '1');
    if (withDemo) {
      setLoadDemo(true);
      await supabase.functions.invoke('seed-demo', { body: { orgId: activeOrg.id } });
      setLoadDemo(false);
    }
    await refresh();
    toast.success(`¡Bienvenido a Gestiona, ${name}!`);
    navigate('/');
    setSaving(false);
  };

  const STEPS = ['Tu negocio', '¿Qué vendés?', 'Branding'];

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'hsl(var(--background))' }}>
      {/* Ambient glow */}
      <div className="fixed inset-x-0 top-0 h-[300px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% 0%, hsl(38 82% 52% / 0.05) 0%, transparent 70%)' }} />

      <div className="w-full max-w-[480px] relative z-10">
        {/* Brand header */}
        <div className="flex items-center gap-2.5 mb-10 justify-center">
          <div className="w-7 h-7 rounded-[5px] flex items-center justify-center"
            style={{ background: 'var(--gradient-gold)' }}>
            <span className="font-display font-black text-[12px]" style={{ color: 'hsl(var(--primary-foreground))' }}>G</span>
          </div>
          <span className="font-display font-semibold text-[15px] tracking-tight text-foreground/80">Gestiona</span>
        </div>

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
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/60 mb-1.5">Paso 1 de 3</p>
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
                  placeholder="Ej: Perfumería Andrea"
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
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/60 mb-1.5">Paso 2 de 3</p>
                <h1 className="font-display text-[1.5rem] font-bold tracking-tight leading-tight">
                  ¿Qué vendés?
                </h1>
                <p className="text-[12px] text-muted-foreground/55 mt-1.5">
                  Esto personaliza el sistema para tu rubro.
                </p>
              </div>
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
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Atrás</Button>
                <Button onClick={() => setStep(3)} className="flex-1">
                  Siguiente <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/60 mb-1.5">Paso 3 de 3</p>
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
                  <Button onClick={() => finish(false)} className="flex-1" disabled={saving}>
                    {saving && !loadDemo ? 'Guardando...' : 'Empezar'} <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
                <Button
                  variant="outline"
                  onClick={() => finish(true)}
                  disabled={saving}
                  className="w-full text-[12px] border-dashed text-muted-foreground hover:text-foreground"
                >
                  {loadDemo ? 'Cargando datos de ejemplo...' : 'Cargar datos de ejemplo para explorar'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-muted-foreground/30 mt-6">
          Gestiona · Sistema de gestión profesional para tu negocio
        </p>
      </div>
    </div>
  );
}
