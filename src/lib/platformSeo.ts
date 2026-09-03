import { BRAND_MARK_SRC, BRAND_NAME, BRAND_ORIGIN } from './brand.js';

export interface PlatformSeoSection {
  heading: string;
  text: string;
}

export interface PlatformSeoPage {
  path: string;
  title: string;
  description: string;
  heading: string;
  eyebrow?: string;
  sections: PlatformSeoSection[];
  indexable: boolean;
  sitemap: boolean;
}

/**
 * Contrato SEO público de Nerqia.
 *
 * Vive fuera de React para que el navegador, Routing Middleware, el handler
 * semántico y el sitemap describan la misma página. No hay una lista de
 * keywords escondida: Google no la usa. Los términos que buscamos resolver
 * aparecen en títulos y texto que una persona también puede leer.
 */
export const PLATFORM_SEO_PAGES = [
  {
    path: '/',
    title: 'Nerqia | Sistema de gestión omnicanal, POS y tienda online',
    description: 'Software de gestión para comercios argentinos: unificá stock, punto de venta, tienda online, clientes, costos, caja y margen real por canal.',
    eyebrow: 'Sistema operativo para comercios omnicanal',
    heading: 'Una sola verdad para todo lo que vendés.',
    sections: [
      {
        heading: 'Stock único para el mostrador y la tienda online',
        text: 'Productos, variantes e inventario comparten una sola fuente entre el punto de venta, el ecommerce y los canales conectados.',
      },
      {
        heading: 'Ventas, caja y pedidos conectados',
        text: 'Nerqia reúne el POS, los pedidos online, los clientes y la operación diaria para que el negocio no dependa de planillas aisladas.',
      },
      {
        heading: 'Margen real por canal',
        text: 'Costos, medios de pago, envíos e impuestos se combinan para mostrar cuánto deja cada venta y ayudar a decidir con evidencia.',
      },
      {
        heading: 'Nerqia Commerce y Nerqia Finance',
        text: 'La tienda online vende sobre el mismo Business Core. Finance organiza documentos, controles y aprobaciones sin duplicar compras, proveedores ni contabilidad operativa.',
      },
    ],
    indexable: true,
    sitemap: true,
  },
  {
    path: '/precios',
    title: 'Planes y precios de Nerqia | Gestión comercial en Argentina',
    description: 'Conocé los planes de Nerqia en pesos argentinos para gestionar ventas, stock, clientes, tienda online y operación omnicanal. Probá 14 días sin tarjeta.',
    eyebrow: 'Planes simples, sin sorpresas',
    heading: 'Elegí el plan que se ajuste a tu negocio.',
    sections: [
      {
        heading: 'Empezá sin tarjeta',
        text: 'La prueba gratuita dura 14 días. Los límites y prestaciones visibles se leen de la configuración vigente de cada plan.',
      },
      {
        heading: 'Pagos en pesos argentinos',
        text: 'La suscripción se contrata por Mercado Pago y podés elegir una modalidad mensual o anual desde la misma plataforma.',
      },
    ],
    indexable: true,
    sitemap: true,
  },
  {
    path: '/estado',
    title: 'Estado del servicio | Nerqia',
    description: 'Consultá las señales públicas de disponibilidad de Nerqia, sus tareas automáticas y la integridad de respaldos, sin exponer datos de comercios.',
    eyebrow: 'Transparencia operativa',
    heading: 'Estado de Nerqia.',
    sections: [
      {
        heading: 'Señales verificables',
        text: 'Una señal sin evidencia se informa como desconocida; Nerqia no presenta disponibilidad por defecto cuando no puede medirla.',
      },
    ],
    indexable: true,
    sitemap: true,
  },
  {
    path: '/privacidad',
    title: 'Política de Privacidad | Nerqia',
    description: 'Cómo Nerqia trata y protege los datos de las cuentas, organizaciones y operaciones comerciales.',
    heading: 'Política de Privacidad.',
    sections: [],
    indexable: false,
    sitemap: false,
  },
  {
    path: '/terminos',
    title: 'Términos y Condiciones | Nerqia',
    description: 'Condiciones de uso del sistema de gestión comercial Nerqia.',
    heading: 'Términos y Condiciones.',
    sections: [],
    indexable: false,
    sitemap: false,
  },
] as const satisfies readonly PlatformSeoPage[];

export function normalizePlatformPath(path: string): string {
  const clean = (path.split('?')[0] || '/').replace(/\/{2,}/g, '/');
  if (clean === '/') return '/';
  return clean.replace(/\/$/, '');
}

export function platformSeoPage(path: string): PlatformSeoPage | null {
  const normalized = normalizePlatformPath(path);
  const canonical = normalized === '/pricing' ? '/precios' : normalized;
  return PLATFORM_SEO_PAGES.find(page => page.path === canonical) ?? null;
}

export function platformCanonicalUrl(path: string): string {
  const page = platformSeoPage(path);
  return `${BRAND_ORIGIN}${page?.path === '/' ? '/' : page?.path ?? normalizePlatformPath(path)}`;
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]!));

const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

function structuredData(page: PlatformSeoPage) {
  const websiteId = `${BRAND_ORIGIN}/#website`;
  const organizationId = `${BRAND_ORIGIN}/#organization`;
  const graph: Array<Record<string, unknown>> = [
    {
      '@type': 'WebSite',
      '@id': websiteId,
      url: `${BRAND_ORIGIN}/`,
      name: BRAND_NAME,
      alternateName: 'Nerqia Commerce OS',
      inLanguage: 'es-AR',
      publisher: { '@id': organizationId },
    },
    {
      '@type': 'Organization',
      '@id': organizationId,
      name: BRAND_NAME,
      url: `${BRAND_ORIGIN}/`,
      logo: {
        '@type': 'ImageObject',
        url: `${BRAND_ORIGIN}${BRAND_MARK_SRC}`,
      },
    },
  ];

  if (page.path === '/') {
    graph.push({
      '@type': 'SoftwareApplication',
      '@id': `${BRAND_ORIGIN}/#software`,
      name: BRAND_NAME,
      url: `${BRAND_ORIGIN}/`,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'es-AR',
      description: page.description,
      publisher: { '@id': organizationId },
    });
  } else {
    graph.push({
      '@type': 'WebPage',
      '@id': `${platformCanonicalUrl(page.path)}#webpage`,
      url: platformCanonicalUrl(page.path),
      name: page.title,
      description: page.description,
      inLanguage: 'es-AR',
      isPartOf: { '@id': websiteId },
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

export function renderPlatformSeoHtml(page: PlatformSeoPage): string {
  const canonical = platformCanonicalUrl(page.path);
  const robot = page.indexable ? 'index,follow' : 'noindex,nofollow';
  const sections = page.sections.map(section => `
<section>
  <h2>${escapeHtml(section.heading)}</h2>
  <p>${escapeHtml(section.text)}</p>
</section>`).join('');

  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<meta name="robots" content="${robot}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<link rel="sitemap" type="application/xml" href="${BRAND_ORIGIN}/sitemap.xml">
<link rel="icon" href="${BRAND_MARK_SRC}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND_NAME}">
<meta property="og:locale" content="es_AR">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(page.title)}">
<meta property="og:description" content="${escapeHtml(page.description)}">
<meta property="og:image" content="${BRAND_ORIGIN}${BRAND_MARK_SRC}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(page.title)}">
<meta name="twitter:description" content="${escapeHtml(page.description)}">
<meta name="twitter:image" content="${BRAND_ORIGIN}${BRAND_MARK_SRC}">
<script type="application/ld+json">${safeJson(structuredData(page))}</script>
</head>
<body>
<header>
  <a href="${BRAND_ORIGIN}/" aria-label="Nerqia, inicio"><img src="${BRAND_MARK_SRC}" width="96" height="96" alt=""><span>${BRAND_NAME}</span></a>
  <nav aria-label="Navegación principal"><a href="${BRAND_ORIGIN}/">Producto</a> <a href="${BRAND_ORIGIN}/precios">Precios</a> <a href="${BRAND_ORIGIN}/login">Iniciar sesión</a></nav>
</header>
<main>
  ${page.eyebrow ? `<p>${escapeHtml(page.eyebrow)}</p>` : ''}
  <h1>${escapeHtml(page.heading)}</h1>
  <p>${escapeHtml(page.description)}</p>${sections}
  <p><a href="${BRAND_ORIGIN}/login?mode=register">Crear mi cuenta gratis</a></p>
</main>
<footer><a href="${BRAND_ORIGIN}/privacidad">Privacidad</a> <a href="${BRAND_ORIGIN}/terminos">Términos</a> <a href="${BRAND_ORIGIN}/estado">Estado</a></footer>
</body>
</html>`;
}

export function renderPrivatePlatformSeoHtml(path: string): string {
  const canonical = platformCanonicalUrl(path);
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><title>Acceso privado | ${BRAND_NAME}</title><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="${escapeHtml(canonical)}"></head><body><h1>Acceso privado de ${BRAND_NAME}</h1><p>Esta pantalla requiere una cuenta y no se publica en buscadores.</p></body></html>`;
}
