import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { LogIn, UserPlus, KeyRound, Sparkles } from 'lucide-react';

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
        // Provider-disabled error from Supabase: "provider is not enabled"
        if (/provider.*not enabled|unsupported provider/i.test(error.message)) {
          toast.error('Google aún no está habilitado. Contactá al administrador.', {
            description: 'El administrador debe activar el provider Google en Supabase → Authentication → Providers.',
          });
        } else if (/redirect/i.test(error.message)) {
          toast.error('URL de redirección no autorizada', {
            description: 'Agregá este dominio en Supabase → Authentication → URL Configuration.',
          });
        } else {
          toast.error(error.message || 'Error al conectar con Google');
        }
      }
      // success: Supabase redirects automatically, no manual handling needed
    } catch (err: any) {
      toast.error(err.message || 'Error inesperado con Google');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse at 50% 0%, hsl(40, 72%, 52%, 0.08) 0%, hsl(225, 22%, 6%) 50%), hsl(225, 22%, 6%)',
      }}
    >
      {/* Decorative elements */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full opacity-[0.03]"
        style={{ background: 'radial-gradient(circle, hsl(40, 72%, 52%), transparent 70%)' }} />

      <div className="w-full max-w-[420px] relative z-10">
        {/* Logo */}
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl gradient-gold shadow-gold mb-4">
            <Sparkles className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="font-display text-3xl font-bold text-gradient-gold tracking-wide mb-1">Gestiona</h1>
          <p className="text-muted-foreground text-sm">Sistema de Gestión Integral</p>
        </div>

        {/* Card */}
        <div className="glass border border-border/50 rounded-2xl p-7 shadow-elevated animate-scale-in"
          style={{ animationDelay: '0.1s', animationFillMode: 'both' }}
        >
          {mode === 'forgot' ? (
            <>
              <div className="text-center mb-5">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-3">
                  <KeyRound className="w-5 h-5 text-primary" />
                </div>
                <h2 className="font-display font-semibold text-lg">Recuperar Contraseña</h2>
                <p className="text-sm text-muted-foreground mt-1">Te enviaremos un email con instrucciones</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required className="bg-secondary/50 border-border/50 mt-1.5 h-11 focus:ring-2 focus:ring-primary/30" />
                </div>
                <Button type="submit" disabled={loading} className="w-full gradient-gold text-primary-foreground font-semibold h-11 shadow-gold hover:shadow-lg transition-shadow">
                  {loading ? 'Enviando...' : 'Enviar Enlace'}
                </Button>
                <button type="button" onClick={() => setMode('login')} className="w-full text-sm text-muted-foreground hover:text-primary transition-colors">
                  ← Volver al login
                </button>
              </form>
            </>
          ) : (
            <>
              {/* Google Sign In */}
              <Button variant="outline" className="w-full mb-5 h-11 font-medium border-border/50 hover:bg-secondary/50" onClick={handleGoogleLogin} disabled={loading}>
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Ingresar con Google
              </Button>

              <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/30" /></div>
                <div className="relative flex justify-center text-xs"><span className="bg-transparent px-3 text-muted-foreground/60 backdrop-blur-sm">o con email</span></div>
              </div>

              {/* Tab Switch */}
              <div className="flex mb-6 bg-secondary/50 rounded-xl p-1 border border-border/30">
                <button onClick={() => setMode('login')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${mode === 'login' ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25' : 'text-muted-foreground hover:text-foreground'}`}>Iniciar Sesión</button>
                <button onClick={() => setMode('register')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${mode === 'register' ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25' : 'text-muted-foreground hover:text-foreground'}`}>Registrarse</button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <div className="animate-fade-in">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nombre</label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" className="bg-secondary/50 border-border/50 mt-1.5 h-11" required />
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required className="bg-secondary/50 border-border/50 mt-1.5 h-11" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contraseña</label>
                  <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} className="bg-secondary/50 border-border/50 mt-1.5 h-11" />
                </div>
                {mode === 'login' && (
                  <div className="text-right">
                    <button type="button" onClick={() => setMode('forgot')} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                )}
                <Button type="submit" disabled={loading} className="w-full gradient-gold text-primary-foreground font-semibold h-11 shadow-gold hover:shadow-lg transition-shadow">
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  ) : mode === 'login' ? (
                    <><LogIn className="w-4 h-4 mr-2" />Ingresar</>
                  ) : (
                    <><UserPlus className="w-4 h-4 mr-2" />Crear Cuenta</>
                  )}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-[11px] text-muted-foreground/40 mt-8">
          Gestiona © {new Date().getFullYear()} · Todos los derechos reservados
        </p>
      </div>
    </div>
  );
}
