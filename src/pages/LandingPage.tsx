import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronRight,
  CircleDollarSign,
  Layers3,
  Menu,
  PackageCheck,
  ShoppingCart,
  Sparkles,
  Store,
  WalletCards,
  X,
} from 'lucide-react';
import BrandLogo from '@/components/shared/BrandLogo';

const CAPABILITIES = [
  {
    icon: Store,
    kicker: 'Tienda online',
    title: 'Vendé con una experiencia lista para crecer.',
    description: 'Catálogo, variantes, promociones, checkout, pagos, envíos y dominio propio en una tienda conectada desde el primer pedido.',
    tone: 'coral',
  },
  {
    icon: Boxes,
    kicker: 'Gestión',
    title: 'Operá cada pedido sin volver a cargar datos.',
    description: 'Productos, clientes, ventas, compras, stock y entregas comparten autoridad para que el equipo trabaje sobre la misma verdad.',
    tone: 'teal',
  },
  {
    icon: CircleDollarSign,
    kicker: 'Finance',
    title: 'Entendé el dinero detrás de cada venta.',
    description: 'Costo, comisión, envío e impuestos explican cuánto dejó cada producto, pedido y canal.',
    tone: 'yellow',
  },
] as const;

const OPERATING_LAYERS = [
  { icon: Store, title: 'Tienda online', description: 'Catálogo, checkout, pagos, envíos y dominio.' },
  { icon: PackageCheck, title: 'Gestión', description: 'Pedidos, stock, clientes y operación diaria.' },
  { icon: WalletCards, title: 'Finance', description: 'Documentos, caja, conciliación y margen.' },
  { icon: Sparkles, title: 'Inteligencia', description: 'Hallazgos accionables sobre la operación.' },
] as const;

const SURFACES = [
  {
    id: 'tienda',
    label: 'Tienda online',
    eyebrow: 'La puerta de entrada',
    title: 'Tu marca, tu dominio y una tienda preparada para vender.',
    description: 'Diseño, catálogo, variantes, promociones, checkout, pagos, envíos y medición nacen conectados con la operación real de tu comercio.',
    facts: ['Diseño y dominio propio', 'Checkout, pagos y envíos', 'Pedidos conectados al stock'],
    icon: Store,
    tone: 'coral',
  },
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

function StorefrontPreview() {
  return (
    <div className="landing-product-stage" aria-label="Vista de muestra de una tienda online conectada con Nerqia">
      <div className="landing-product-window">
        <div className="landing-product-window__topbar">
          <div className="landing-product-window__dots" aria-hidden="true"><i /><i /><i /></div>
          <span>Tienda de demostración · Contenido ilustrativo</span>
          <div className="landing-product-window__live"><b /> publicada</div>
        </div>
        <div className="landing-store-preview">
          <div className="landing-storefront">
            <div className="landing-storefront__nav">
              <strong>AUREA</strong>
              <div aria-hidden="true"><span>Novedades</span><span>Casa</span><span>Objetos</span></div>
              <span className="landing-storefront__cart"><ShoppingCart /> 2</span>
            </div>
            <div className="landing-storefront__hero">
              <div>
                <span>Nueva colección</span>
                <strong>Objetos que hacen bien todos los días.</strong>
                <p>Diseño simple, materiales nobles y envíos a todo el país.</p>
                <span className="landing-storefront__cta">Comprar ahora <ArrowRight /></span>
              </div>
              <img
                src="/landing/storefront-aurea.webp"
                alt="Colección ilustrativa de objetos de diseño para una tienda online"
                width="1600"
                height="1067"
                loading="eager"
              />
            </div>
          </div>
          <div className="landing-order-flow" aria-label="Flujo ilustrativo de un pedido conectado">
            <div className="landing-order-flow__event">
              <span>Pedido #1082</span>
              <strong>Nueva compra online</strong>
              <small>$ 84.500 · pagada</small>
            </div>
            <div className="landing-order-flow__surface landing-order-flow__surface--management">
              <span><PackageCheck /> Gestión</span>
              <strong>Stock actualizado</strong>
              <small>2 unidades reservadas</small>
            </div>
            <div className="landing-order-flow__surface landing-order-flow__surface--finance">
              <span><WalletCards /> Finance</span>
              <strong>Margen explicado</strong>
              <small>36,4% · dato ilustrativo</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [surfaceId, setSurfaceId] = useState<(typeof SURFACES)[number]['id']>('tienda');
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
            <a href="#tienda" onClick={() => setMobileOpen(false)}>Tienda online</a>
            <a href="#gestion" onClick={() => setMobileOpen(false)}>Gestión</a>
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
              <p className="landing-eyebrow"><span className="landing-eyebrow__dot" /> Tu tienda online, conectada de verdad</p>
              <h1><span>Nerqia</span>, tu tienda online conectada a todo tu negocio.</h1>
              <p className="landing-hero__lead">Creá una tienda preparada para vender y crecer. Cada pedido comparte productos, stock y clientes con Gestión, mientras Finance explica costos, cobros y margen real.</p>
              <div className="landing-hero__actions">
                <Link to="/login?mode=register" className="landing-button landing-button--primary">Crear mi tienda gratis <ArrowRight /></Link>
                <a href="#tienda" className="landing-button landing-button--outline">Ver cómo funciona <ChevronRight /></a>
              </div>
              <div className="landing-checks">{CHECKS.map(check => <span key={check}><Check /> {check}</span>)}</div>
            </div>
            <StorefrontPreview />
          </div>
          <div className="landing-hero__signal" aria-label="Canales conectados">
            <div className="landing-container">
              <span>Tienda online</span><i /><span>Gestión</span><i /><span>Finance</span><i /><span>Todos tus canales</span><i /><strong>Una sola operación</strong>
            </div>
          </div>
        </section>

        <section className="landing-proof" id="tienda">
          <div className="landing-container">
            <div className="landing-section-heading landing-section-heading--row">
              <div><p className="landing-eyebrow">Todo empieza por vender</p><h2>Una tienda atractiva por fuera. Un negocio conectado por dentro.</h2></div>
              <p>Publicá una experiencia propia sin separar el ecommerce de la operación. Cada pedido mueve inventario, conserva al cliente y explica el margen desde el mismo núcleo.</p>
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

        <section className="landing-operation" id="gestion">
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
