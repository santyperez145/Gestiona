import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { KeyRound, CheckCircle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BrandLogo from '@/components/shared/BrandLogo';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { authErrorForCustomer, checkPassword, MIN_PASSWORD_LENGTH, passwordValidationMessage } from '@/lib/passwordSecurity';
import { usePageTitle } from '@/hooks/usePageTitle';

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
  usePageTitle('Recuperar contraseña');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [linkValidationTimedOut, setLinkValidationTimedOut] = useState(false);
  const { session, loading: authLoading, passwordRecovery } = useAuth();
  const navigate = useNavigate();
  const passwordCheck = checkPassword(password);
  const linkSignalsRecovery = window.location.hash.includes('type=recovery')
    || new URLSearchParams(window.location.search).has('code');
  // Sólo PASSWORD_RECOVERY es autoridad. La presencia de `?code=` o un hash
  // se usa para mostrar “validando”, nunca para saltear la reautenticación: un
  // usuario ya logueado podría fabricar ese parámetro a mano.
  const recoveryReady = Boolean(session && passwordRecovery);

  useEffect(() => {
    if (!linkSignalsRecovery || recoveryReady) return;
    const timer = window.setTimeout(() => setLinkValidationTimedOut(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [linkSignalsRecovery, recoveryReady]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const passwordError = passwordValidationMessage(password);
    if (passwordError) { toast.error(passwordError); return; }
    if (password !== confirm) { toast.error('Las contraseñas no coinciden'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // Invalida el resto de las sesiones sin cerrar ésta, para que un enlace
      // robado no deje accesos antiguos activos después del cambio.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
      if (signOutError) console.error('password-recovery session cleanup:', signOutError);
      setSuccess(true);
      toast.success('Contraseña actualizada correctamente');
      setTimeout(() => navigate('/'), 2000);
    } catch (err: any) {
      console.error('password-recovery:', err);
      toast.error(authErrorForCustomer(err, 'No pudimos actualizar la contraseña. Solicitá un enlace nuevo e intentá otra vez.'));
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || (linkSignalsRecovery && !recoveryReady && !linkValidationTimedOut)) {
    return <AuthShell><p className="text-center text-sm text-muted-foreground">Validando el enlace seguro…</p></AuthShell>;
  }

  if (!recoveryReady) {
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
          <Button asChild variant="outline" className="w-full"><Link to="/login?mode=forgot">Solicitar un enlace nuevo</Link></Button>
          <Button onClick={() => navigate('/login')} variant="ghost" className="w-full mt-2"><ArrowLeft className="w-4 h-4 mr-2" />Volver al acceso</Button>
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
            Elegí una clave nueva. Al guardarla vamos a cerrar tus otras sesiones por seguridad.
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
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
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
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
              />
            </div>
            <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground" aria-live="polite">
              <span className={passwordCheck.checks.length ? 'text-emerald-600' : ''}>• {MIN_PASSWORD_LENGTH}+ caracteres</span>
              <span className={passwordCheck.checks.uppercase ? 'text-emerald-600' : ''}>• Una mayúscula</span>
              <span className={passwordCheck.checks.lowercase ? 'text-emerald-600' : ''}>• Una minúscula</span>
              <span className={passwordCheck.checks.number ? 'text-emerald-600' : ''}>• Un número</span>
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
