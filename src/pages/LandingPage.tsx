import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Check,
  ChevronRight,
  CircleDollarSign,
  CircleHelp,
  Layers3,
  Menu,
  PackageCheck,
  ScanLine,
  ShoppingCart,
  Sparkles,
  Store,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { useState } from 'react';
import BrandLogo from '@/components/shared/BrandLogo';

const CAPABILITIES = [
  {
    icon: Boxes,
    kicker: 'Business Core',
    title: 'Stock, costos y ventas hablan el mismo idioma.',
    description: 'Cada operación nace en una única fuente de verdad. Vendé en el mostrador, la tienda o un marketplace sin reconciliar planillas.',
    tone: 'gold',
  },
  {
    icon: CircleDollarSign,
    kicker: 'Margen real',
    title: 'No mires facturación. Entendé cuánto ganaste.',
    description: 'Costo de importación, comisión, envío e IVA en una sola lectura por producto, pedido y canal.',
    tone: 'teal',
  },
  {
    icon: Sparkles,
    kicker: 'Business Copilot',
    title: 'La IA encuentra el siguiente movimiento.',
    description: 'Detectá qué comprar, qué cliente se enfría y qué promo conviene ejecutar. Cada recomendación termina en una acción.',
    tone: 'violet',
  },
];

const OPERATING_LAYERS = [
  { icon: Store, title: 'Canales', description: 'POS, tienda online y marketplaces conectados.' },
  { icon: PackageCheck, title: 'Inventario', description: 'Stock único, trazabilidad y reposición.' },
  { icon: WalletCards, title: 'Finanzas', description: 'Caja, obligaciones y rentabilidad.' },
  { icon: Users, title: 'Relaciones', description: 'Clientes, equipo y acciones comerciales.' },
];

const CHECKS = ['14 días sin tarjeta', 'Importación asistida', 'Soporte en español'];

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <BrandLogo
      compact
      decorative
      eager
      className={`landing-brand-mark ${small ? 'is-small' : ''}`}
      markClassName={small ? 'h-[1.55rem] w-[1.55rem]' : 'h-8 w-8'}
    />
  );
}

function DashboardPreview() {
  const bars = [42, 63, 48, 76, 58, 88, 72, 94, 66, 82, 78, 100];

  return (
    <div className="landing-product-stage" aria-label="Vista previa del centro de control de Nerqia">
      <div className="landing-product-glow" aria-hidden="true" />
      <div className="landing-product-window">
        <div className="landing-product-window__topbar">
          <div className="landing-product-window__dots"><i /><i /><i /></div>
          <span>nerqia / centro de control</span>
          <div className="landing-product-window__live"><b /> sincronizado</div>
        </div>
        <div className="landing-product-window__body">
          <aside className="landing-product-window__rail">
            <BrandMark small />
            {[BarChart3, ShoppingCart, Boxes, Users, Layers3].map((Icon, index) => (
              <span key={index} className={index === 0 ? 'is-active' : ''}><Icon /></span>
            ))}
            <span className="is-bottom"><CircleHelp /></span>
          </aside>
          <div className="landing-product-window__content">
            <div className="landing-preview-heading">
              <div><span className="landing-preview-eyebrow">Resumen operativo</span><strong>Buen día, equipo.</strong></div>
              <button type="button" aria-label="Crear una venta"><ArrowUpRight /></button>
            </div>
            <div className="landing-preview-kpis">
              <div><span>Ventas del mes</span><strong>$ 4.286.450</strong><small>+18,4% <ArrowUpRight /></small></div>
              <div><span>Margen promedio</span><strong>34,8%</strong><small>+4,2% <ArrowUpRight /></small></div>
              <div><span>Stock crítico</span><strong>12 <em>items</em></strong><small className="is-warning">Revisar ahora</small></div>
            </div>
            <div className="landing-preview-grid">
              <div className="landing-preview-chart">
                <div className="landing-preview-card-heading"><div><span>Rendimiento de ventas</span><strong>Últimos 30 días</strong></div><span className="landing-preview-filter">Todos los canales <ChevronRight /></span></div>
                <div className="landing-preview-bars">
                  {bars.map((height, index) => <i key={index} style={{ height: `${height}%` }} className={index > 8 ? 'is-current' : ''} />)}
                </div>
                <div className="landing-preview-chart-labels"><span>01 Jun</span><span>15 Jun</span><span>30 Jun</span></div>
              </div>
              <div className="landing-preview-activity">
                <div className="landing-preview-card-heading"><div><span>Actividad reciente</span><strong>Ahora</strong></div><ArrowUpRight /></div>
                <div className="landing-preview-activity-row"><b className="is-gold"><ShoppingCart /></b><div><strong>Nueva venta online</strong><span>Hace 4 minutos</span></div><em>$ 84.500</em></div>
                <div className="landing-preview-activity-row"><b className="is-teal"><PackageCheck /></b><div><strong>Compra recibida</strong><span>Hace 18 minutos</span></div><em>24 unidades</em></div>
                <div className="landing-preview-activity-row"><b className="is-violet"><Users /></b><div><strong>Cliente recuperado</strong><span>Hace 32 minutos</span></div><em>CRM</em></div>
              </div>
            </div>
            <div className="landing-preview-footer"><span><ScanLine /> Datos sincronizados con tu negocio</span><span>Actualizado hace 2 min</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <div className="landing-container landing-nav__inner">
          <Link to="/" className="landing-brand" aria-label="Nerqia inicio">
            <BrandMark />
            <span>Nerqia</span>
          </Link>

          <nav className={`landing-nav__links ${mobileOpen ? 'is-open' : ''}`} aria-label="Navegación principal">
            <a href="#producto" onClick={() => setMobileOpen(false)}>Producto</a>
            <a href="#operacion" onClick={() => setMobileOpen(false)}>Cómo funciona</a>
            <a href="#para-quien" onClick={() => setMobileOpen(false)}>Para quién</a>
            <Link to="/pricing" onClick={() => setMobileOpen(false)}>Precios</Link>
            <div className="landing-nav__mobile-actions">
              <Link to="/login" className="landing-button landing-button--ghost">Iniciar sesión</Link>
              <Link to="/login?mode=register" className="landing-button landing-button--dark">Empezar gratis <ArrowRight /></Link>
            </div>
          </nav>

          <div className="landing-nav__actions">
            <Link to="/login" className="landing-nav__login">Iniciar sesión</Link>
            <Link to="/login?mode=register" className="landing-button landing-button--dark">Empezar gratis <ArrowRight /></Link>
          </div>
          <button type="button" className="landing-menu-toggle" onClick={() => setMobileOpen(value => !value)} aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={mobileOpen}>
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-container landing-hero__grid">
            <div className="landing-hero__copy">
              <p className="landing-eyebrow"><span className="landing-eyebrow__dot" /> Sistema operativo para comercios omnicanal</p>
              <h1>Una sola verdad para todo lo que <span>vendés.</span></h1>
              <p className="landing-hero__lead">Gestioná stock, ventas, clientes y margen real desde un solo lugar. El mostrador, tu tienda online y tus marketplaces trabajan con la misma información.</p>
              <div className="landing-hero__actions">
                <Link to="/login?mode=register" className="landing-button landing-button--primary">Crear mi cuenta gratis <ArrowRight /></Link>
                <a href="#producto" className="landing-button landing-button--outline">Conocé el producto <ChevronRight /></a>
              </div>
              <div className="landing-checks">{CHECKS.map(check => <span key={check}><Check /> {check}</span>)}</div>
            </div>
            <DashboardPreview />
          </div>
          <div className="landing-container landing-hero__signal"><span>Una plataforma para operar con claridad</span><div /><span>Desde el primer producto hasta el margen final</span></div>
        </section>

        <section className="landing-proof" id="producto">
          <div className="landing-container">
            <div className="landing-section-heading landing-section-heading--row"><div><p className="landing-eyebrow">El Business Core</p><h2>Menos pantallas aisladas.<br /><span>Más decisiones conectadas.</span></h2></div><p>Nerqia no es otro canal de venta. Es la base que conecta cada operación de tu negocio para que puedas crecer sin perder el control.</p></div>
            <div className="landing-capability-grid">{CAPABILITIES.map(({ icon: Icon, kicker, title, description, tone }) => <article className={`landing-capability landing-capability--${tone}`} key={title}><div className="landing-capability__icon"><Icon /></div><p>{kicker}</p><h3>{title}</h3><span>{description}</span><ArrowUpRight className="landing-capability__arrow" /></article>)}</div>
          </div>
        </section>

        <section className="landing-operation" id="operacion">
          <div className="landing-container landing-operation__grid">
            <div className="landing-operation__copy"><p className="landing-eyebrow">El mapa completo</p><h2>Tu negocio no vive en una sola pestaña.</h2><p>Por eso Nerqia ordena la operación en capas que se alimentan entre sí. Cuando cambia el stock, cambia la disponibilidad. Cuando vendés, cambia la caja. Cuando conocés el margen, cambia tu próxima decisión.</p><Link to="/login?mode=register" className="landing-text-link">Ver cómo funciona <ArrowRight /></Link></div>
            <div className="landing-layers">{OPERATING_LAYERS.map(({ icon: Icon, title, description }, index) => <div className="landing-layer" key={title}><span className="landing-layer__number">0{index + 1}</span><span className="landing-layer__icon"><Icon /></span><div><strong>{title}</strong><span>{description}</span></div><ArrowUpRight /></div>)}</div>
          </div>
        </section>

        <section className="landing-quote" id="para-quien"><div className="landing-container landing-quote__inner"><div className="landing-quote__mark">“</div><blockquote>La pregunta no es cuánto vendiste.<br /><span>Es cuánto te quedó.</span></blockquote><div className="landing-quote__meta"><span className="landing-quote__avatar">EP</span><div><strong>Para negocios que importan, venden y quieren entender.</strong><span>Retail · Ecommerce · Distribuidores · Marcas</span></div></div></div></section>

        <section className="landing-cta"><div className="landing-container"><div className="landing-cta__panel"><div><p className="landing-eyebrow">Empezá con claridad</p><h2>Tu próximo movimiento<br /><span>empieza acá.</span></h2></div><div className="landing-cta__side"><p>Configurá tu negocio en minutos y empezá a tomar decisiones con la información que ya tenés.</p><Link to="/login?mode=register" className="landing-button landing-button--primary">Probar Nerqia gratis <ArrowRight /></Link><small>Sin tarjeta de crédito · Cancelás cuando quieras</small></div></div></div></section>
      </main>

      <footer className="landing-footer"><div className="landing-container landing-footer__inner"><Link to="/" className="landing-brand"><BrandMark small /><span>Nerqia</span></Link><span className="landing-footer__copy">Sistema operativo para comercios omnicanal</span><div className="landing-footer__links"><Link to="/privacidad">Privacidad</Link><Link to="/terminos">Términos</Link><Link to="/estado">Estado</Link><a href="mailto:hola@nerqia.app">Contacto</a></div></div></footer>
    </div>
  );
}
