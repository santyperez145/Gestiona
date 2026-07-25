import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, BarChart3, Boxes, Brain, ShieldCheck, Sparkles, Zap, Check, ChevronRight } from 'lucide-react';

const FEATURES = [
  { icon: Boxes,      title: 'Stock multi-variante',  desc: 'Controlá inventario en tiempo real con alertas automáticas de bajo stock.' },
  { icon: BarChart3,  title: 'Reportes avanzados',    desc: 'Estado de resultados, rentabilidad por producto y proyección de caja.' },
  { icon: Brain,      title: 'IA integrada',           desc: 'Predicciones de ventas, insights y descripciones automáticas.' },
  { icon: Zap,        title: 'Catálogo público',       desc: 'Una URL para compartir con tus clientes, con carrito a WhatsApp.' },
  { icon: ShieldCheck,title: 'Multi-usuario y roles',  desc: 'Invitá a tu equipo con permisos granulares por sección.' },
  { icon: Sparkles,   title: 'Branding propio',        desc: 'Tu logo, tus colores y tu identidad en el catálogo público.' },
];

const CHECKS = ['Sin instalación', 'Multi-usuario', 'Soporte en español', 'Cancelás cuando quieras'];

export default function LandingPage() {
  return (
    <div className="min-h-screen text-foreground overflow-x-hidden" style={{ background: 'hsl(var(--background))' }}>

      {/* ── Nav ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-border/30 backdrop-blur-md"
        style={{ background: 'hsl(var(--background) / 0.85)' }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-[5px] flex items-center justify-center shrink-0"
              style={{ background: 'var(--gradient-gold)' }}
            >
              <span className="font-display font-black text-[12px]" style={{ color: 'hsl(var(--primary-foreground))' }}>G</span>
            </div>
            <span className="font-display font-semibold text-[15px] tracking-tight">Gestiona</span>
          </div>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-6">
            {[
              { href: '#features', label: 'Features' },
              { to: '/pricing',    label: 'Precios' },
            ].map(({ href, to, label }) =>
              href ? (
                <a key={label} href={href}
                  className="text-[13px] text-muted-foreground/70 hover:text-foreground transition-colors">
                  {label}
                </a>
              ) : (
                <Link key={label} to={to!}
                  className="text-[13px] text-muted-foreground/70 hover:text-foreground transition-colors">
                  {label}
                </Link>
              )
            )}
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/app">
              <Button variant="ghost" size="sm" className="text-[13px]">Iniciar sesión</Button>
            </Link>
            <Link to="/app">
              <Button size="sm" className="text-[12px]">
                Empezar gratis <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative max-w-6xl mx-auto px-6 pt-28 pb-36 text-center">
        {/* Background glow */}
        <div className="absolute inset-x-0 top-0 h-[500px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 80% 50% at 50% 0%, hsl(38 82% 52% / 0.07) 0%, transparent 70%)' }} />

        {/* Eyebrow */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-8"
          style={{
            background: 'hsl(38 82% 52% / 0.08)',
            border: '1px solid hsl(38 82% 52% / 0.2)',
            borderRadius: '5px',
          }}>
          <Sparkles className="w-3 h-3 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-primary/80">
            14 días gratis · Sin tarjeta
          </span>
        </div>

        <h1 className="font-display text-[3.2rem] md:text-[5rem] font-bold leading-[1.05] tracking-tight max-w-4xl mx-auto mb-6">
          El sistema de gestión que tu negocio
          <span className="text-gradient-gold"> realmente necesita</span>.
        </h1>

        <p className="text-[1rem] text-muted-foreground/70 max-w-[560px] mx-auto mb-10 leading-relaxed">
          Stock, ventas, clientes, deudas, métricas y catálogo público —
          todo en un solo lugar, con IA y multi-usuario.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link to="/app">
            <Button size="lg" className="px-8 h-11 text-[14px]">
              Empezar gratis <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </Link>
          <Link to="/pricing">
            <Button size="lg" variant="outline" className="px-8 h-11 text-[14px]">Ver planes</Button>
          </Link>
        </div>

        {/* Social proof strip */}
        <div className="flex items-center justify-center gap-6 mt-14">
          {[
            { val: '500+', label: 'negocios activos' },
            { val: '99.9%', label: 'uptime garantizado' },
            { val: '$0', label: 'costo de instalación' },
          ].map(({ val, label }) => (
            <div key={label} className="text-center">
              <div className="font-mono text-[1.4rem] font-bold text-foreground tracking-tight">{val}</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/45 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────── */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        {/* Section header */}
        <div className="mb-14">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary/70 mb-2">Funcionalidades</p>
          <h2 className="font-display text-[2.2rem] font-bold tracking-tight leading-tight max-w-xl">
            Todo lo que necesitás para vender más
          </h2>
          <p className="text-[13px] text-muted-foreground/60 mt-2">
            Sin instalación. Funciona en cualquier dispositivo.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-border/30 rounded-[12px] overflow-hidden border border-border/30">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="bg-muted/20 p-6 hover:bg-card/90 transition-colors duration-200 group relative"
            >
              {/* Number */}
              <div className="font-mono text-[9px] font-bold text-muted-foreground/25 mb-4 tracking-[0.1em]">
                {String(i + 1).padStart(2, '0')}
              </div>

              {/* Icon */}
              <div className="flex items-center gap-3 mb-3">
                <f.icon className="w-4 h-4 text-primary/70 group-hover:text-primary transition-colors" />
                <h3 className="font-display font-semibold text-[14px] tracking-tight">{f.title}</h3>
              </div>

              <p className="text-[12px] text-muted-foreground/60 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-24">
        <div className="relative overflow-hidden rounded-[12px] border border-primary/20 p-12"
          style={{ background: 'hsl(var(--card))' }}>

          {/* Inner top highlight */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, hsl(38 82% 52% / 0.3), transparent)' }} />

          {/* Corner glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 50% 0%, hsl(38 82% 52% / 0.08) 0%, transparent 70%)' }} />

          <div className="relative z-10 text-center max-w-2xl mx-auto">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary/70 mb-3">Empezá ahora</p>
            <h2 className="font-display text-[2.5rem] font-bold tracking-tight leading-tight mb-4">
              Probalo gratis por 14 días
            </h2>
            <p className="text-[13px] text-muted-foreground/60 mb-8 leading-relaxed">
              Todas las features disponibles desde el primer día. Sin tarjeta de crédito requerida.
            </p>

            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mb-8">
              {CHECKS.map(x => (
                <div key={x} className="flex items-center gap-1.5">
                  <div className="w-[3px] h-[12px] rounded-full bg-primary/60" />
                  <span className="text-[12px] text-foreground/70">{x}</span>
                </div>
              ))}
            </div>

            <Link to="/app">
              <Button size="lg" className="px-10 h-11">
                Probar Gestiona gratis <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="border-t border-border/30 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded-[3px] flex items-center justify-center"
              style={{ background: 'var(--gradient-gold)' }}
            >
              <span className="font-display font-black text-[9px]" style={{ color: 'hsl(var(--primary-foreground))' }}>G</span>
            </div>
            <span className="font-display font-semibold text-[13px] text-muted-foreground/60">Gestiona</span>
          </div>
          <p className="text-[11px] text-muted-foreground/35">
            © {new Date().getFullYear()} Gestiona · Todos los derechos reservados
          </p>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors">Privacidad</Link>
            <Link to="/terms" className="text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors">Términos</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
