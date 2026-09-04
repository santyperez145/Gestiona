import { useState } from 'react';
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
import BrandLogo from '@/components/shared/BrandLogo';

const CAPABILITIES = [
  {
    icon: ShoppingCart,
    kicker: 'Vendé',
    title: 'Todos los canales usan el mismo stock.',
    description: 'POS, tienda online y marketplaces descuentan del mismo inventario y alimentan una única historia de ventas.',
    tone: 'coral',
  },
  {
    icon: Boxes,
    kicker: 'Operá',
    title: 'Del producto al pedido, sin volver a cargar datos.',
    description: 'Catálogo, costos, clientes, compras y entregas quedan conectados para que el equipo trabaje sobre la misma verdad.',
    tone: 'teal',
  },
  {
    icon: CircleDollarSign,
    kicker: 'Decidí',
    title: 'Mirá margen real, no sólo facturación.',
    description: 'Costo, comisión, envío e impuestos explican cuánto dejó cada producto, pedido y canal.',
    tone: 'yellow',
  },
] as const;

const OPERATING_LAYERS = [
  { icon: Store, title: 'Canales', description: 'POS, ecommerce y marketplaces conectados.' },
  { icon: PackageCheck, title: 'Inventario', description: 'Stock único, trazabilidad y reposición.' },
  { icon: WalletCards, title: 'Finance', description: 'Documentos, caja, conciliación y margen.' },
  { icon: Sparkles, title: 'Inteligencia', description: 'Hallazgos accionables sobre la operación.' },
] as const;

const SURFACES = [
  {
    id: 'gestion',
    label: 'Gestión',
    eyebrow: 'Business Core',
    title: 'Una operación ordenada de punta a punta.',
    description: 'Productos, POS, ventas, compras, clientes e inventario comparten autoridad. Cada movimiento actualiza el resto del sistema sin conciliaciones manuales.',
    facts: ['Stock por sucursal', 'Ventas y devoluciones', 'Clientes y proveedores'],
    icon: Layers3,
    tone: 'berry',
  },
  {
    id: 'tienda',
    label: 'Tienda',
    eyebrow: 'Commerce',
    title: 'Una tienda que vende con la verdad del negocio.',
    description: 'Catálogo, variantes, precios, promociones, checkout, pagos, envíos y pedidos nacen del mismo núcleo que usa el mostrador.',
    facts: ['Diseño publicable', 'Checkout y pedidos', 'Dominio y medición'],
    icon: Store,
    tone: 'coral',
  },
  {
    id: 'finance',
    label: 'Finance',
    eyebrow: 'Control financiero',
    title: 'Entendé el dinero detrás de cada movimiento.',
    description: 'Documentos, gastos, obligaciones, caja y conciliación se conectan con la operación sin duplicar ventas, clientes ni inventario.',
    facts: ['Bandeja documental', 'Caja y conciliación', 'Rentabilidad por canal'],
    icon: WalletCards,
    tone: 'teal',
  },
] as const;

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
  const bars = [38, 56, 44, 68, 52, 82, 66, 92, 61, 78, 73, 96];

  return (
    <div className="landing-product-stage" aria-label="Vista de muestra del centro de control de Nerqia">
      <div className="landing-product-window">
        <div className="landing-product-window__topbar">
          <div className="landing-product-window__dots" aria-hidden="true"><i /><i /><i /></div>
          <span>Centro de control · Datos ilustrativos</span>
          <div className="landing-product-window__live"><b /> sincronizado</div>
        </div>
        <div className="landing-product-window__body">
          <aside className="landing-product-window__rail" aria-label="Módulos de muestra">
            <BrandMark small />
            {[BarChart3, ShoppingCart, Boxes, Users, WalletCards].map((Icon, index) => (
              <span key={index} className={index === 0 ? 'is-active' : ''}><Icon /></span>
            ))}
            <span className="is-bottom"><CircleHelp /></span>
          </aside>
          <div className="landing-product-window__content">
            <div className="landing-preview-heading">
              <div>
                <span className="landing-preview-eyebrow">Resumen operativo</span>
                <strong>Todo tu negocio, hoy.</strong>
              </div>
              <div className="landing-preview-tabs" aria-hidden="true">
                <span className="is-active">Resumen</span><span>Ventas</span><span>Finance</span>
              </div>
              <button type="button" aria-label="Nueva venta de muestra"><ArrowUpRight /></button>
            </div>
            <div className="landing-preview-kpis">
              <div><span>Ventas del mes</span><strong>$ 4.286.450</strong><small>+18,4% <ArrowUpRight /></small></div>
              <div><span>Margen promedio</span><strong>34,8%</strong><small>+4,2% <ArrowUpRight /></small></div>
              <div><span>Stock crítico</span><strong>12 <em>ítems</em></strong><small className="is-warning">Revisar ahora</small></div>
            </div>
            <div className="landing-preview-grid">
              <div className="landing-preview-chart">
                <div className="landing-preview-card-heading">
                  <div><span>Rendimiento de ventas</span><strong>Últimos 30 días</strong></div>
                  <span className="landing-preview-filter">Todos los canales <ChevronRight /></span>
                </div>
                <div className="landing-preview-bars" aria-hidden="true">
                  {bars.map((height, index) => <i key={index} style={{ height: `${height}%` }} className={index > 8 ? 'is-current' : ''} />)}
                </div>
                <div className="landing-preview-chart-labels"><span>01 Jun</span><span>15 Jun</span><span>30 Jun</span></div>
              </div>
              <div className="landing-preview-activity">
                <div className="landing-preview-card-heading"><div><span>Actividad reciente</span><strong>Ahora</strong></div><ArrowUpRight /></div>
                <div className="landing-preview-activity-row"><b className="is-coral"><ShoppingCart /></b><div><strong>Nueva venta online</strong><span>Hace 4 minutos</span></div><em>$ 84.500</em></div>
                <div className="landing-preview-activity-row"><b className="is-teal"><PackageCheck /></b><div><strong>Compra recibida</strong><span>Hace 18 minutos</span></div><em>24 unidades</em></div>
                <div className="landing-preview-activity-row"><b className="is-yellow"><Users /></b><div><strong>Cliente recuperado</strong><span>Hace 32 minutos</span></div><em>CRM</em></div>
              </div>
            </div>
            <div className="landing-preview-footer"><span><ScanLine /> Operación conectada</span><span>Vista de demostración</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [surfaceId, setSurfaceId] = useState<(typeof SURFACES)[number]['id']>('gestion');
  const activeSurface = SURFACES.find(surface => surface.id === surfaceId) ?? SURFACES[0];
  const SurfaceIcon = activeSurface.icon;

  const moveSurfaceFocus = (key: string) => {
    const currentIndex = SURFACES.findIndex(surface => surface.id === surfaceId);
    const lastIndex = SURFACES.length - 1;
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? lastIndex
        : key === 'ArrowLeft'
          ? (currentIndex - 1 + SURFACES.length) % SURFACES.length
          : key === 'ArrowRight'
            ? (currentIndex + 1) % SURFACES.length
            : currentIndex;
    if (nextIndex === currentIndex && key !== 'Home' && key !== 'End') return;
    const nextId = SURFACES[nextIndex].id;
    setSurfaceId(nextId);
    requestAnimationFrame(() => document.getElementById(`landing-tab-${nextId}`)?.focus());
  };

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
            <a href="#commerce" onClick={() => setMobileOpen(false)}>Commerce</a>
            <a href="#finance" onClick={() => setMobileOpen(false)}>Finance</a>
            <Link to="/precios" onClick={() => setMobileOpen(false)}>Precios</Link>
            <div className="landing-nav__mobile-actions">
              <Link to="/login" className="landing-button landing-button--ghost">Iniciar sesión</Link>
              <Link to="/login?mode=register" className="landing-button landing-button--dark">Empezar gratis <ArrowRight /></Link>
            </div>
          </nav>

          <div className="landing-nav__actions">
            <Link to="/login" className="landing-nav__login">Iniciar sesión</Link>
            <Link to="/login?mode=register" className="landing-button landing-button--dark">Empezar gratis <ArrowRight /></Link>
          </div>
          <button
            type="button"
            className="landing-menu-toggle"
            onClick={() => setMobileOpen(value => !value)}
            aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-container landing-hero__inner">
            <div className="landing-hero__copy">
              <p className="landing-eyebrow"><span className="landing-eyebrow__dot" /> Commerce Operating System</p>
              <h1><span>Nerqia</span>, el sistema operativo de tu comercio.</h1>
              <p className="landing-hero__lead">Vendé, operá y entendé cuánto ganaste desde un solo lugar. Tu mostrador, tienda online y canales comparten stock, clientes, costos y margen real.</p>
              <div className="landing-hero__actions">
                <Link to="/login?mode=register" className="landing-button landing-button--primary">Crear mi cuenta gratis <ArrowRight /></Link>
                <a href="#producto" className="landing-button landing-button--outline">Explorar el producto <ChevronRight /></a>
              </div>
              <div className="landing-checks">{CHECKS.map(check => <span key={check}><Check /> {check}</span>)}</div>
            </div>
            <DashboardPreview />
          </div>
          <div className="landing-hero__signal" aria-label="Canales conectados">
            <div className="landing-container">
              <span>POS</span><i /><span>Tienda online</span><i /><span>Mercado Libre</span><i /><span>Finance</span><i /><strong>Una sola verdad</strong>
            </div>
          </div>
        </section>

        <section className="landing-proof" id="producto">
          <div className="landing-container">
            <div className="landing-section-heading landing-section-heading--row">
              <div><p className="landing-eyebrow">El núcleo de Nerqia</p><h2>Un comercio conectado funciona distinto.</h2></div>
              <p>Dejá de reconstruir la operación entre plataformas. Cada venta mueve inventario, registra su costo y explica el margen desde el mismo Business Core.</p>
            </div>
            <div className="landing-capability-grid">
              {CAPABILITIES.map(({ icon: Icon, kicker, title, description, tone }) => (
                <article className={`landing-capability landing-capability--${tone}`} key={title}>
                  <div className="landing-capability__top"><span className="landing-capability__icon"><Icon /></span><p>{kicker}</p></div>
                  <h3>{title}</h3>
                  <span>{description}</span>
                  <ArrowUpRight className="landing-capability__arrow" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-operation" id="commerce">
          <div className="landing-container landing-operation__grid">
            <div className="landing-operation__copy">
              <p className="landing-eyebrow">El mapa completo</p>
              <h2>La tienda es la puerta. El negocio conectado es la ventaja.</h2>
              <p>Cuando vendés, baja el stock. Cuando comprás, cambia el costo. Cuando cobrás, se actualiza la caja. Y cuando todo eso se conecta, aparece el margen que realmente podés usar para decidir.</p>
              <Link to="/login?mode=register" className="landing-text-link">Empezar con mi negocio <ArrowRight /></Link>
            </div>
            <div className="landing-layers">
              {OPERATING_LAYERS.map(({ icon: Icon, title, description }, index) => (
                <div className="landing-layer" key={title}>
                  <span className="landing-layer__number">0{index + 1}</span>
                  <span className="landing-layer__icon"><Icon /></span>
                  <div><strong>{title}</strong><span>{description}</span></div>
                  <ArrowUpRight />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-surfaces" id="finance">
          <div className="landing-container">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">Tres superficies, un negocio</p>
              <h2>Entrá por la tarea. <span>Nerqia conecta el resto.</span></h2>
            </div>
            <div className="landing-surface-tabs" role="tablist" aria-label="Superficies de Nerqia">
              {SURFACES.map(({ id, label, icon: TabIcon }) => (
                <button
                  key={id}
                  id={`landing-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={id === surfaceId}
                  aria-controls="landing-surface-panel"
                  className={id === surfaceId ? 'is-active' : ''}
                  onClick={() => setSurfaceId(id)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    moveSurfaceFocus(event.key);
                  }}
                  tabIndex={id === surfaceId ? 0 : -1}
                >
                  <TabIcon />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div
              id="landing-surface-panel"
              role="tabpanel"
              aria-labelledby={`landing-tab-${activeSurface.id}`}
              className={`landing-surface-panel landing-surface-panel--${activeSurface.tone}`}
            >
              <div className="landing-surface-panel__copy">
                <span className="landing-surface-panel__icon"><SurfaceIcon /></span>
                <p>{activeSurface.eyebrow}</p>
                <h3>{activeSurface.title}</h3>
                <span>{activeSurface.description}</span>
              </div>
              <div className="landing-surface-panel__facts">
                {activeSurface.facts.map((fact, index) => (
                  <div key={fact}><span>0{index + 1}</span><strong>{fact}</strong><Check /></div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="landing-audience" id="para-quien">
          <div className="landing-container landing-audience__inner">
            <p className="landing-eyebrow">Hecho para operar de verdad</p>
            <h2>Para comercios que venden hoy y quieren crecer sin perder el control.</h2>
            <div className="landing-audience__tags" aria-label="Tipos de comercio">
              <span>Retail</span><span>Ecommerce</span><span>Distribuidores</span><span>Importadores</span><span>Marcas</span>
            </div>
          </div>
        </section>

        <section className="landing-cta">
          <div className="landing-container landing-cta__inner">
            <div><p className="landing-eyebrow">Tu operación, conectada</p><h2>Empezá a vender con una sola verdad.</h2></div>
            <div className="landing-cta__side">
              <p>Configurá tu negocio, importá tus productos y conectá el siguiente canal sin volver a empezar.</p>
              <Link to="/login?mode=register" className="landing-button landing-button--primary">Probar Nerqia gratis <ArrowRight /></Link>
              <small>14 días sin tarjeta de crédito</small>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer__inner">
          <Link to="/" className="landing-brand"><BrandMark small /><span>Nerqia</span></Link>
          <span className="landing-footer__copy">Commerce Operating System</span>
          <div className="landing-footer__links"><Link to="/privacidad">Privacidad</Link><Link to="/terminos">Términos</Link><Link to="/estado">Estado</Link><a href="mailto:hola@nerqia.app">Contacto</a></div>
        </div>
      </footer>
    </div>
  );
}
