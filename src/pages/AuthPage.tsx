import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, BarChart3, Boxes, Check, CircleDollarSign, Mail, ShieldCheck, Sparkles } from 'lucide-react';

const SHOWCASE_ITEMS = [
  { icon: BarChart3, title: 'Ventas y margen', description: 'La señal que importa, al alcance del equipo.' },
  { icon: Boxes, title: 'Stock conectado', description: 'Una cantidad real para todos tus canales.' },
  { icon: CircleDollarSign, title: 'Costos completos', description: 'Importación, envío, comisión e IVA.' },
];

function AuthBrand() {
  return <Link to="/" className="auth-brand"><span className="auth-brand__mark">G</span><span>Gestiona</span></Link>;
}

export default function AuthPage() {
  const { user, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(() => searchParams.get('mode') === 'register' ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  // `/login` is a public route, so it remains mounted after Supabase creates
  // the session unless we move away explicitly. This also covers opening the
  // login URL again in a tab that already has an active session.
  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        toast.success('Te enviamos un email para restablecer tu contraseña');
        setMode('login');
      } else if (mode === 'login') {
        await signIn(email, password);
        // Move immediately to ProtectedRoutes so MfaGate can request the code
        // in the same login flow instead of leaving the form visible.
        navigate('/', { replace: true });
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
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/`, queryParams: { access_type: 'offline', prompt: 'consent' } } });
      if (error) {
        if (/provider.*not enabled|unsupported provider/i.test(error.message)) toast.error('Google aún no está habilitado. Contactá al administrador.');
        else if (/redirect/i.test(error.message)) toast.error('URL de redirección no autorizada');
        else toast.error(error.message || 'Error al conectar con Google');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error inesperado con Google');
    } finally {
      setLoading(false);
    }
  };

  const changeMode = (next: 'login' | 'register') => {
    setMode(next);
    setPassword('');
  };

  return (
    <div className="auth-shell">
      <aside className="auth-showcase">
        <div className="auth-showcase__top"><AuthBrand /><span className="auth-showcase__status"><i /> Plataforma operativa</span></div>
        <div className="auth-showcase__content">
          <p className="auth-eyebrow"><Sparkles /> Sistema operativo para comercios</p>
          <h1>El control vuelve <span>a vos.</span></h1>
          <p className="auth-showcase__lead">Una plataforma para vender, operar y entender tu negocio sin saltar entre herramientas.</p>
          <div className="auth-showcase__items">{SHOWCASE_ITEMS.map(({ icon: Icon, title, description }) => <div className="auth-showcase__item" key={title}><span><Icon /></span><div><strong>{title}</strong><small>{description}</small></div><Check /></div>)}</div>
        </div>
        <div className="auth-showcase__footer"><span>Gestiona · Business Core</span><span>01 / 03</span></div>
      </aside>

      <main className="auth-panel">
        <div className="auth-panel__top"><Link to="/" className="auth-back"><ArrowLeft /> Volver al inicio</Link><span>¿Necesitás ayuda?</span></div>
        <div className="auth-form-shell">
          <div className="auth-mobile-brand"><AuthBrand /></div>
          {mode === 'forgot' ? (
            <div className="auth-form-heading"><span className="auth-form-icon"><Mail /></span><p className="auth-eyebrow">Acceso a tu cuenta</p><h2>Recuperar contraseña</h2><p>Ingresá tu email y te enviamos un enlace para volver a entrar.</p></div>
          ) : (
            <div className="auth-form-heading"><p className="auth-eyebrow">Tu workspace empieza acá</p><h2>{mode === 'login' ? 'Bienvenido de vuelta' : 'Creá tu cuenta'}</h2><p>{mode === 'login' ? 'Ingresá para continuar con la operación.' : 'Probá todas las herramientas durante 14 días.'}</p></div>
          )}

          {mode === 'forgot' ? (
            <form onSubmit={handleSubmit} className="auth-form">
              <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required /></label>
              <Button type="submit" disabled={loading} className="auth-submit">{loading ? 'Enviando...' : 'Enviar enlace'} <ArrowRight /></Button>
              <button type="button" className="auth-muted-link" onClick={() => setMode('login')}><ArrowLeft /> Volver al login</button>
            </form>
          ) : (
            <>
              <Button type="button" variant="outline" className="auth-google" onClick={handleGoogleLogin} disabled={loading}><span className="auth-google__g">G</span> Continuar con Google</Button>
              <div className="auth-divider"><span>o con email</span></div>
              <div className="auth-tabs" role="tablist" aria-label="Acceso">
                <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => changeMode('login')}>Iniciar sesión</button>
                <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => changeMode('register')}>Crear cuenta</button>
              </div>
              <form onSubmit={handleSubmit} className="auth-form">
                {mode === 'register' && <label>Nombre<input value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" required /></label>}
                <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required /></label>
                <label>Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required minLength={6} /></label>
                {mode === 'login' && <div className="auth-form__forgot"><button type="button" onClick={() => setMode('forgot')}>¿Olvidaste tu contraseña?</button></div>}
                <Button type="submit" disabled={loading} className="auth-submit">{loading ? 'Procesando...' : mode === 'login' ? 'Entrar a Gestiona' : 'Crear mi workspace'} <ArrowRight /></Button>
              </form>
              <p className="auth-legal">Al continuar aceptás los <Link to="/terminos">términos de uso</Link> y la <Link to="/privacidad">política de privacidad</Link>.</p>
            </>
          )}
        </div>
        <div className="auth-panel__footer"><ShieldCheck /> Tus datos se protegen con controles de acceso por organización.</div>
      </main>
    </div>
  );
}
