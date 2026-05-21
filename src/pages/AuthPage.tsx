import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { LogIn, UserPlus, KeyRound, ArrowLeft, Mail } from 'lucide-react';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success('Te enviamos un email para restablecer tu contraseña');
        setMode('login');
      } else if (mode === 'login') {
        await signIn(email, password);
        toast.success('¡Bienvenido de vuelta!');
      } else {
        if (!name.trim()) { toast.error('Ingresá tu nombre'); setLoading(false); return; }
        if (password.length < 6) { toast.error('La contraseña debe tener al menos 6 caracteres'); setLoading(false); return; }
        await signUp(email, password, name);
        toast.success('Cuenta creada. Revisá tu email para confirmar.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (error) {
        if (/provider.*not enabled|unsupported provider/i.test(error.message)) {
          toast.error('Google aún no está habilitado. Contactá al administrador.', {
            description: 'Activar Google en Supabase → Authentication → Providers.',
          });
        } else if (/redirect/i.test(error.message)) {
          toast.error('URL de redirección no autorizada', {
            description: 'Agregá este dominio en Supabase → Authentication → URL Configuration.',
          });
        } else {
          toast.error(error.message || 'Error al conectar con Google');
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Error inesperado con Google');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex relative overflow-hidden"
      style={{ background: 'hsl(228 28% 4.5%)' }}
    >
      {/* Left decorative panel — hidden on mobile */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 border-r border-border/30 p-12 relative overflow-hidden">
        {/* Dot-grid texture */}
        <div className="absolute inset-0 dot-grid opacity-30" />
        {/* Gold glow top-left */}
        <div
          className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, hsl(38 82% 52% / 0.06) 0%, transparent 70%)' }}
        />

        {/* Brand mark */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div
              className="w-8 h-8 rounded-[6px] flex items-center justify-center"
              style={{ background: 'var(--gradient-gold)' }}
            >
              <span className="font-display font-black text-[13px] text-[hsl(225_22%_6%)]">G</span>
            </div>
            <span className="font-display font-semibold text-[15px] tracking-tight text-foreground/90">Gestiona</span>
          </div>

          <div className="space-y-1 mb-8">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/70">Sistema de gestión</p>
            <h2 className="font-display text-[2rem] font-bold leading-[1.1] tracking-tight text-foreground">
              Todo tu negocio,<br />en un solo lugar.
            </h2>
          </div>

          <div className="space-y-4">
            {[
              { label: 'Ventas & POS', desc: 'Control de caja, cuotas y medios de pago' },
              { label: 'Stock & Catálogo', desc: 'Productos, variantes y alertas de stock' },
              { label: 'Clientes & Fidelidad', desc: 'CRM, puntos y campañas de marketing' },
              { label: 'Reportes & Analytics', desc: 'Métricas en tiempo real con IA' },
            ].map(({ label, desc }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="mt-[3px] w-[3px] h-[14px] rounded-full bg-primary/60 shrink-0" />
                <div>
                  <p className="text-[12px] font-semibold text-foreground/80 leading-none">{label}</p>
                  <p className="text-[11px] text-muted-foreground/55 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <div className="section-rule mb-4" />
          <p className="text-[10px] text-muted-foreground/40">
            Gestiona © {new Date().getFullYear()} · Todos los derechos reservados
          </p>
        </div>
      </div>

      {/* Right — auth form */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
        {/* Subtle top-center glow */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[200px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, hsl(38 82% 52% / 0.05) 0%, transparent 70%)' }}
        />

        <div className="w-full max-w-[380px] relative z-10">

          {/* Mobile-only brand */}
          <div className="lg:hidden flex items-center justify-center gap-2.5 mb-10">
            <div
              className="w-7 h-7 rounded-[5px] flex items-center justify-center"
              style={{ background: 'var(--gradient-gold)' }}
            >
              <span className="font-display font-black text-[12px] text-[hsl(225_22%_6%)]">G</span>
            </div>
            <span className="font-display font-semibold text-[15px] tracking-tight text-foreground/90">Gestiona</span>
          </div>

          {mode === 'forgot' ? (
            /* ── Forgot password ─────────────────────────────── */
            <div>
              <button
                type="button"
                onClick={() => setMode('login')}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-6"
              >
                <ArrowLeft className="w-3 h-3" />
                Volver al login
              </button>

              <div className="mb-6">
                <div className="flex items-center justify-center w-10 h-10 rounded-[8px] bg-primary/10 border border-primary/20 mb-4">
                  <Mail className="w-4.5 h-4.5 text-primary" />
                </div>
                <h2 className="font-display font-semibold text-[1.25rem] tracking-tight">Recuperar contraseña</h2>
                <p className="text-[12px] text-muted-foreground/65 mt-1">
                  Ingresá tu email y te enviamos el enlace de recuperación.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="kv-key mb-1.5 block">Email</label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required />
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
                </Button>
              </form>
            </div>
          ) : (
            /* ── Login / Register ─────────────────────────────── */
            <>
              <div className="mb-7">
                <h1 className="font-display text-[1.5rem] font-bold tracking-tight leading-tight">
                  {mode === 'login' ? 'Bienvenido de vuelta' : 'Crear cuenta'}
                </h1>
                <p className="text-[12px] text-muted-foreground/60 mt-1">
                  {mode === 'login'
                    ? 'Ingresá con tu cuenta para continuar'
                    : 'Creá tu cuenta para empezar a gestionar tu negocio'}
                </p>
              </div>

              {/* Google */}
              <Button
                variant="outline"
                className="w-full mb-5 h-9 font-medium text-[13px]"
                onClick={handleGoogleLogin}
                disabled={loading}
              >
                <svg className="w-4 h-4 mr-2 shrink-0" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continuar con Google
              </Button>

              {/* Divider */}
              <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border/30" />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/45"
                    style={{ background: 'hsl(228 28% 4.5%)' }}>
                    o con email
                  </span>
                </div>
              </div>

              {/* Tab Switcher — underline style */}
              <div className="flex border-b border-border/40 mb-6">
                {(['login', 'register'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setMode(tab)}
                    className={[
                      'flex-1 pb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition-all duration-200',
                      'relative after:absolute after:bottom-[-1px] after:inset-x-0 after:h-[2px] after:rounded-full after:transition-transform after:duration-200',
                      mode === tab
                        ? 'text-foreground after:bg-primary after:scale-x-100'
                        : 'text-muted-foreground/50 hover:text-muted-foreground after:bg-primary after:scale-x-0',
                    ].join(' ')}
                  >
                    {tab === 'login' ? 'Iniciar Sesión' : 'Registrarse'}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                {mode === 'register' && (
                  <div>
                    <label className="kv-key mb-1.5 block">Nombre</label>
                    <Input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Tu nombre"
                      required
                    />
                  </div>
                )}
                <div>
                  <label className="kv-key mb-1.5 block">Email</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    required
                  />
                </div>
                <div>
                  <label className="kv-key mb-1.5 block">Contraseña</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>

                {mode === 'login' && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setMode('forgot')}
                      className="text-[11px] text-muted-foreground/55 hover:text-primary transition-colors"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                )}

                <div className="pt-1">
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    ) : mode === 'login' ? (
                      <><LogIn className="w-4 h-4 mr-2" />Ingresar</>
                    ) : (
                      <><UserPlus className="w-4 h-4 mr-2" />Crear Cuenta</>
                    )}
                  </Button>
                </div>
              </form>

              {/* Bottom hint */}
              <p className="text-center text-[11px] text-muted-foreground/40 mt-6">
                {mode === 'login' ? (
                  <>¿No tenés cuenta?{' '}
                    <button type="button" onClick={() => setMode('register')} className="text-primary/70 hover:text-primary transition-colors">
                      Registrate gratis
                    </button>
                  </>
                ) : (
                  <>¿Ya tenés cuenta?{' '}
                    <button type="button" onClick={() => setMode('login')} className="text-primary/70 hover:text-primary transition-colors">
                      Iniciá sesión
                    </button>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
