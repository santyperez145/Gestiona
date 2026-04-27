import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, BarChart3, Boxes, Brain, ShieldCheck, Sparkles, Zap, Check } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <header className="border-b border-border/50 sticky top-0 backdrop-blur-md bg-background/70 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold">G</div>
            <span className="font-display font-bold text-lg">Gestiona</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#features" className="text-muted-foreground hover:text-foreground">Features</a>
            <Link to="/pricing" className="text-muted-foreground hover:text-foreground">Precios</Link>
            <Link to="/app" className="text-muted-foreground hover:text-foreground">Iniciar sesión</Link>
          </nav>
          <Link to="/app"><Button size="sm">Empezar gratis</Button></Link>
        </div>
      </header>

      {/* HERO */}
      <section className="relative max-w-7xl mx-auto px-6 pt-24 pb-32 text-center">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.15),transparent_60%)]" />
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-6 animate-fade-in-up">
          <Sparkles className="w-3.5 h-3.5" /> Probá 14 días gratis · Sin tarjeta
        </div>
        <h1 className="text-5xl md:text-7xl font-display font-bold mb-6 leading-tight max-w-4xl mx-auto animate-fade-in-up">
          El sistema de gestión que tu negocio<span className="text-primary"> realmente necesita</span>.
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 animate-fade-in-up">
          Stock, ventas, clientes, deudas, métricas y catálogo público — todo en un solo lugar, con IA y multi-usuario.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-in-up">
          <Link to="/app"><Button size="lg" className="px-8">Empezar gratis <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>
          <Link to="/pricing"><Button size="lg" variant="outline" className="px-8">Ver planes</Button></Link>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-4xl font-display font-bold mb-3">Todo lo que necesitás para vender más</h2>
          <p className="text-muted-foreground">Sin instalación. Funciona en cualquier dispositivo.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            { i: Boxes, t: 'Stock multi-variante', d: 'Controlá inventario en tiempo real con alertas de bajo stock.' },
            { i: BarChart3, t: 'Reportes avanzados', d: 'Estado de resultados, rentabilidad por producto y proyección de caja.' },
            { i: Brain, t: 'IA integrada', d: 'Predicciones de ventas y descripciones automáticas.' },
            { i: Zap, t: 'Catálogo público', d: 'Una URL para compartir con tus clientes con carrito a WhatsApp.' },
            { i: ShieldCheck, t: 'Multi-usuario y roles', d: 'Invita a tu equipo con permisos granulares.' },
            { i: Sparkles, t: 'Branding propio', d: 'Tu logo, tus colores, tu identidad.' },
          ].map(f => (
            <div key={f.t} className="rounded-2xl border border-border bg-card p-6 hover:border-primary/50 transition">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                <f.i className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-display font-bold text-lg mb-1">{f.t}</h3>
              <p className="text-sm text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-24 text-center">
        <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-12">
          <h2 className="text-4xl font-display font-bold mb-4">Empezá hoy mismo</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">14 días gratis con todas las features. Sin tarjeta de crédito.</p>
          <ul className="flex flex-wrap justify-center gap-4 text-sm mb-8">
            {['Sin instalación', 'Multi-usuario', 'Soporte en español', 'Cancelás cuando quieras'].map(x => (
              <li key={x} className="flex items-center gap-1.5"><Check className="w-4 h-4 text-primary" />{x}</li>
            ))}
          </ul>
          <Link to="/app"><Button size="lg" className="px-10">Probar Gestiona gratis <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>
        </div>
      </section>

      <footer className="border-t border-border/50 py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Gestiona · Todos los derechos reservados
      </footer>
    </div>
  );
}