import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { KeyRound, CheckCircle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BrandLogo from '@/components/shared/BrandLogo';

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{ background: 'hsl(var(--background))' }}>
      <div className="absolute inset-x-0 top-0 h-[300px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 0%, hsl(38 82% 52% / 0.05) 0%, transparent 70%)' }} />
      <div className="w-full max-w-[380px] relative z-10">
        <BrandLogo eager className="mb-10 flex justify-center" markClassName="h-7 w-7" nameClassName="text-[15px] text-foreground/80" />
        {children}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      setIsRecovery(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast.error('La contraseña debe tener al menos 6 caracteres'); return; }
    if (password !== confirm) { toast.error('Las contraseñas no coinciden'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      toast.success('Contraseña actualizada correctamente');
      setTimeout(() => navigate('/'), 2000);
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar la contraseña');
    } finally {
      setLoading(false);
    }
  };

  if (!isRecovery) {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-[8px] bg-muted/50 border border-border/40 mx-auto mb-5">
            <KeyRound className="w-5 h-5 text-muted-foreground/60" />
          </div>
          <h1 className="font-display text-[1.25rem] font-bold tracking-tight mb-2">Enlace inválido</h1>
          <p className="text-[12px] text-muted-foreground/55 mb-6 leading-relaxed">
            Este enlace de recuperación no es válido o expiró.
          </p>
          <Button onClick={() => navigate('/')} variant="outline" className="w-full">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver al inicio
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (success) {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-[8px] bg-emerald-500/10 border border-emerald-500/20 mx-auto mb-5">
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          </div>
          <h1 className="font-display text-[1.25rem] font-bold tracking-tight mb-2">¡Contraseña actualizada!</h1>
          <p className="text-[12px] text-muted-foreground/55">Redirigiendo al sistema...</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div>
        <div className="mb-7">
          <div className="flex items-center justify-center w-10 h-10 rounded-[8px] bg-primary/10 border border-primary/20 mb-4">
            <KeyRound className="w-4 h-4 text-primary" />
          </div>
          <h1 className="font-display text-[1.5rem] font-bold tracking-tight leading-tight">
            Nueva contraseña
          </h1>
          <p className="text-[12px] text-muted-foreground/55 mt-1">
            Ingresá y confirmá tu nueva contraseña.
          </p>
        </div>

        <div className="rounded-[10px] border border-border/60 p-6 relative overflow-hidden"
          style={{ background: 'hsl(var(--card))' }}>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="kv-key mb-1.5 block">Nueva contraseña</label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
            <div>
              <label className="kv-key mb-1.5 block">Confirmar contraseña</label>
              <Input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Actualizando...' : 'Actualizar contraseña'}
            </Button>
          </form>
        </div>
      </div>
    </AuthShell>
  );
}
