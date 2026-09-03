import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, BarChart3, Boxes, Check, CircleDollarSign, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import BrandLogo from '@/components/shared/BrandLogo';

const SHOWCASE_ITEMS = [
  { icon: BarChart3, title: 'Ventas y margen', description: 'La señal que importa, al alcance del equipo.' },
  { icon: Boxes, title: 'Stock conectado', description: 'Una cantidad real para todos tus canales.' },
  { icon: CircleDollarSign, title: 'Costos completos', description: 'Importación, envío, comisión e IVA.' },
];

type AuthMode = 'login' | 'register' | 'forgot' | 'otp';

function AuthBrand() {
  return <Link to="/" className="auth-brand"><BrandLogo eager markClassName="h-8 w-8" nameClassName="text-[1.05rem]" /></Link>;
}

export default function AuthPage() {
  const { user, signIn, signUp, signInWithEmailOtp, verifyEmailOtp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>(() => searchParams.get('mode') === 'register' ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
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
      } else if (mode === 'otp') {
        if (!otpSent) {
          await signInWithEmailOtp(email);
          setOtpSent(true);
          toast.success('Te enviamos un enlace y un código a tu email');
        } else {
          if (!otpCode.trim()) { toast.error('Ingresá el código del email'); setLoading(false); return; }
          await verifyEmailOtp(email, otpCode);
          navigate('/', { replace: true });
          toast.success('¡Bienvenido de vuelta!');
        }
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
      const msg = err?.message || 'Error de autenticación';
      if (/signups not allowed|user not found|unable to validate/i.test(msg)) {
        toast.error('No hay una cuenta con ese email. Creá una cuenta primero.');
      } else {
        toast.error(msg);
      }
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
          toast.error('Google todavía no está habilitado en este entorno. Pedile al administrador que siga docs/GOOGLE_OAUTH_SETUP.md.');
        } else if (/redirect/i.test(error.message)) {
          toast.error('URL de redirección no autorizada. Revisá Redirect URLs en Supabase Auth.');
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

  const changeMode = (next: AuthMode) => {
    setMode(next);
    setPassword('');
    setOtpCode('');
    setOtpSent(false);
  };

  const heading = (() => {
    if (mode === 'forgot') {
      return {
        icon: true,
        eyebrow: 'Acceso a tu cuenta',
        title: 'Recuperar contraseña',
        lead: 'Ingresá tu email y te enviamos un enlace para volver a entrar.',
      };
    }
    if (mode === 'otp') {
      return {
        icon: true,
        eyebrow: 'Sin contraseña',
        title: otpSent ? 'Revisá tu email' : 'Entrar con email',
        lead: otpSent
          ? 'Abrí el enlace del correo o ingresá el código de un solo uso. El enlace vuelve a Nerqia.'
          : 'Te mandamos un enlace mágico y un código. No crea cuentas nuevas: sólo entra si ya existís.',
      };
    }
    return {
      icon: false,
      eyebrow: 'Tu workspace empieza acá',
      title: mode === 'login' ? 'Bienvenido de vuelta' : 'Creá tu cuenta',
      lead: mode === 'login' ? 'Ingresá para continuar con la operación.' : 'Probá todas las herramientas durante 14 días.',
    };
  })();

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
        <div className="auth-showcase__footer"><span>Nerqia · Operación conectada</span><span>01 / 03</span></div>
      </aside>

      <main className="auth-panel">
        <div className="auth-panel__top"><Link to="/" className="auth-back"><ArrowLeft /> Volver al inicio</Link><span>¿Necesitás ayuda?</span></div>
        <div className="auth-form-shell">
          <div className="auth-mobile-brand"><AuthBrand /></div>
          <div className="auth-form-heading">
            {heading.icon && <span className="auth-form-icon"><Mail /></span>}
            <p className="auth-eyebrow">{heading.eyebrow}</p>
            <h2>{heading.title}</h2>
            <p>{heading.lead}</p>
          </div>

          {mode === 'forgot' || mode === 'otp' ? (
            <form onSubmit={handleSubmit} className="auth-form">
              <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required autoComplete="email" disabled={mode === 'otp' && otpSent} /></label>
              {mode === 'otp' && otpSent && (
                <label>Código del email<input type="text" inputMode="numeric" autoComplete="one-time-code" value={otpCode} onChange={e => setOtpCode(e.target.value)} placeholder="123456" required minLength={6} maxLength={8} /></label>
              )}
              <Button type="submit" disabled={loading} className="auth-submit">
                {loading
                  ? 'Enviando...'
                  : mode === 'forgot'
                    ? 'Enviar enlace'
                    : otpSent
                      ? 'Confirmar código'
                      : 'Enviar enlace y código'}
                <ArrowRight />
              </Button>
              {mode === 'otp' && otpSent && (
                <button
                  type="button"
                  className="auth-muted-link"
                  disabled={loading}
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await signInWithEmailOtp(email);
                      toast.success('Te reenviamos el email');
                    } catch (err: any) {
                      toast.error(err?.message || 'No se pudo reenviar');
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Reenviar email
                </button>
              )}
              <button type="button" className="auth-muted-link" onClick={() => changeMode('login')}><ArrowLeft /> Volver al login</button>
            </form>
          ) : (
            <>
              <Button type="button" variant="outline" className="auth-google" onClick={handleGoogleLogin} disabled={loading}>
                <span className="auth-google__g">G</span> Continuar con Google
              </Button>
              <p className="auth-provider-hint">
                Si Google falla, el dueño debe habilitar el provider en Supabase y completar <code>docs/GOOGLE_OAUTH_SETUP.md</code> (Console + Redirect URLs).
              </p>
              <div className="auth-divider"><span>o con email</span></div>
              <div className="auth-tabs" role="tablist" aria-label="Acceso">
                <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => changeMode('login')}>Iniciar sesión</button>
                <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => changeMode('register')}>Crear cuenta</button>
              </div>
              <form onSubmit={handleSubmit} className="auth-form">
                {mode === 'register' && <label>Nombre<input value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" required /></label>}
                <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required autoComplete="email" /></label>
                <label>Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
                {mode === 'login' && (
                  <div className="auth-form__forgot">
                    <button type="button" onClick={() => changeMode('otp')}>Entrar con enlace o código</button>
                    <button type="button" onClick={() => changeMode('forgot')}>¿Olvidaste tu contraseña?</button>
                  </div>
                )}
                <Button type="submit" disabled={loading} className="auth-submit">{loading ? 'Procesando...' : mode === 'login' ? 'Entrar a Nerqia' : 'Crear mi workspace'} <ArrowRight /></Button>
              </form>
              <p className="auth-channel-note" role="note">
                El acceso por WhatsApp todavía no está disponible: Meta Cloud Messaging tiene que estar probado (`whatsapp_listo`) antes de ofrecer códigos por ese canal.
              </p>
              <p className="auth-legal">Al continuar aceptás los <Link to="/terminos">términos de uso</Link> y la <Link to="/privacidad">política de privacidad</Link>.</p>
            </>
          )}
        </div>
        <div className="auth-panel__footer"><ShieldCheck /> Tus datos se protegen con controles de acceso por organización.</div>
      </main>
    </div>
  );
}
