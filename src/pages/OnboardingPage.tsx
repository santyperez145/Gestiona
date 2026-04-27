import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowRight, Check, Sparkles } from 'lucide-react';

const RUBROS = ['Perfumes', 'Vapers', 'Indumentaria', 'Tecnología', 'Cosmética', 'Alimentos', 'Otro'];
const COLORS = ['#D4A843', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#EC4899', '#F59E0B'];

export default function OnboardingPage() {
  const { activeOrg, refresh } = useOrg();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(activeOrg?.name?.replace(' Workspace', '') || '');
  const [rubro, setRubro] = useState('Perfumes');
  const [color, setColor] = useState('#D4A843');

  if (!activeOrg) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  const finish = async () => {
    setSaving(true);
    const { error: orgErr } = await supabase
      .from('organizations')
      .update({ name, primary_color: color })
      .eq('id', activeOrg.id);
    if (orgErr) { toast.error('Error guardando'); setSaving(false); return; }
    await supabase
      .from('settings')
      .update({ business_name: name, primary_color: color })
      .eq('org_id', activeOrg.id);
    await refresh();
    toast.success(`¡Bienvenido a Gestiona, ${name}!`);
    localStorage.setItem(`gestiona.onboarded.${activeOrg.id}`, '1');
    navigate('/');
    setSaving(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-xl p-8 animate-fade-in-up">
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map(s => (
            <div key={s} className={`flex-1 h-1.5 rounded-full transition-colors ${step >= s ? 'bg-primary' : 'bg-muted'}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Sparkles className="w-3 h-3" /> Paso 1 de 3
            </div>
            <h1 className="text-3xl font-display font-bold">¿Cómo se llama tu negocio?</h1>
            <p className="text-muted-foreground text-sm">Lo vas a poder cambiar después en Ajustes.</p>
            <div>
              <Label htmlFor="name">Nombre del negocio</Label>
              <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Perfumería Andrea" className="mt-2" />
            </div>
            <Button onClick={() => setStep(2)} disabled={!name.trim()} className="w-full">Siguiente <ArrowRight className="w-4 h-4 ml-1" /></Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">Paso 2 de 3</div>
            <h1 className="text-3xl font-display font-bold">¿Qué vendés?</h1>
            <div className="grid grid-cols-2 gap-2">
              {RUBROS.map(r => (
                <button key={r} onClick={() => setRubro(r)} className={`p-3 rounded-xl border text-sm font-medium transition ${rubro === r ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}>
                  {r}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Atrás</Button>
              <Button onClick={() => setStep(3)} className="flex-1">Siguiente <ArrowRight className="w-4 h-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">Paso 3 de 3</div>
            <h1 className="text-3xl font-display font-bold">Elegí tu color de marca</h1>
            <p className="text-muted-foreground text-sm">Lo vas a ver en botones, alertas y el catálogo público.</p>
            <div className="grid grid-cols-7 gap-2">
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} style={{ background: c }} className={`aspect-square rounded-xl border-2 transition flex items-center justify-center ${color === c ? 'border-foreground scale-110' : 'border-transparent'}`}>
                  {color === c && <Check className="w-5 h-5 text-white" />}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1" disabled={saving}>Atrás</Button>
              <Button onClick={finish} className="flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Empezar'} <ArrowRight className="w-4 h-4 ml-1" /></Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}