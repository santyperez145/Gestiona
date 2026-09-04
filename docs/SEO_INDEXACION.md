# SEO e indexación de Nerqia y sus tiendas

Última revisión: **2026-09-03**.

## Objetivo y límite honesto

El objetivo es que Google descubra, rastree e indexe `nerqia.app` y cada tienda
publicada, y que las consultas relevantes puedan encontrar una página que
responde de verdad a la intención de búsqueda. **El código no puede garantizar
la primera posición ni una fecha de aparición.** Google decide si indexa y cómo
ordena; incluso una solicitud manual puede tardar días o semanas y no garantiza
inclusión.

La medición del 2026-09-03 dio cero resultados útiles para `site:nerqia.app` y
`"Nerqia" software comercio`. Eso es línea de base externa, no un test fallido.
Se vuelve a medir luego de publicar, enviar el sitemap y dejar tiempo de rastreo.

### Evidencia productiva del 2026-09-03

- el deploy del commit `15124ccd` quedó `READY` en Vercel y conserva los alias
  `nerqia.app`, `www.nerqia.app` y `*.nerqia.app`;
- Googlebot recibió la home con 200, título descriptivo, canonical raíz,
  `index,follow`, H1 y 4.234 bytes de HTML; Google Inspection recibió
  `/precios` con canonical exacta y H1 propio;
- `/productos` respondió a Googlebot con canonical propia, meta y header
  `noindex,nofollow`; una persona siguió recibiendo la SPA;
- `/pricing` respondió 308 hacia `/precios`;
- el índice raíz enumeró `sitemap-platform.xml` y el sitemap de Exentry; el
  primero publicó home, precios y estado;
- la tienda Exentry conservó 200, título y canonical propios después del cambio.

En Google Search Console se creó y verificó la propiedad de dominio
`nerqia.app` con un TXT DNS aislado. El registro apareció en el nameserver
autoritativo de Vercel y en `8.8.8.8`; **no debe retirarse**, porque sostiene la
propiedad. El índice `https://nerqia.app/sitemap.xml` fue enviado y, después de
la primera lectura, quedó como **Índice de sitemaps · Correcto**. Las inspecciones
confirmaron la línea de base —Nerqia y Exentry todavía no estaban en Google y el
buscador no reconocía sus URLs— y aceptaron ambas homes en la cola prioritaria
de indexación. Search Console quedó procesando datos; aparición, cobertura e
impresiones siguen pendientes de evidencia posterior.

Fuentes oficiales:

- [Site names en Google](https://developers.google.com/search/docs/appearance/site-names): `WebSite` en la home, nombre coherente y home rastreable.
- [Meta tags admitidos](https://developers.google.com/search/docs/crawling-indexing/special-tags): Google ignora `meta keywords`; no se agrega keyword stuffing invisible.
- [Construir y enviar un sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap): sólo URLs canónicas que queremos en resultados.
- [URL Inspection](https://support.google.com/webmasters/answer/9012289): sirve para probar y solicitar rastreo; no promete indexación.
- [Sitemaps en Search Console](https://support.google.com/webmasters/answer/7451001): el reporte exige propiedad verificada y permite observar lectura/errores.

## Arquitectura única

### Plataforma

- `src/lib/platformSeo.ts` es la fuente única de título, descripción, H1,
  texto semántico, indexabilidad y pertenencia al sitemap.
- Routing Middleware corre antes del `index.html` de la SPA y deriva crawlers a
  `api/platform-seo.ts`. El documento devuelto contiene contenido equivalente
  a la landing, enlaces reales, canonical y JSON-LD `WebSite`, `Organization` y
  `SoftwareApplication`.
- `PlatformSeoHead` mantiene title, description, canonical y robots después de
  una navegación humana por la SPA.
- El panel, login y recorridos privados reciben `noindex`; no se intenta rankear
  pantallas que exigen sesión.

### Tiendas

- No hay un segundo storefront SEO. El mismo slug/host y la misma fuente
  pública resuelven HTML, canonical, JSON-LD, sitemap y feed.
- Cada tienda publicada usa `<slug>.nerqia.app`; un dominio propio pasa a ser
  canonical sólo cuando su ciclo de verificación está activo.
- Home, categoría, ficha y página pública son indexables. Checkout, carrito,
  cuenta, pedido y seguimiento no lo son.
- Los datos estructurados de producto reflejan el precio y stock que el Core
  autoritativo expone al checkout; no inventan reviews, descuentos ni entrega.

## Descubrimiento

`https://nerqia.app/sitemap.xml` es un índice que apunta a:

1. `https://nerqia.app/sitemap-platform.xml` — home, precios y estado;
2. un sitemap canónico por cada tienda activa y publicada.

`robots.txt` declara el índice raíz y los sitemaps de tienda. Privacidad y
términos siguen públicamente enlazados, pero quedan fuera del sitemap y con
`noindex`: son obligaciones de acceso, no páginas de adquisición.

## Criterio competitivo

Las referencias verificadas al 2026-09-03 no dependen de una lista oculta de
palabras: tienen páginas públicas con una intención clara, títulos descriptivos,
H1 comprensibles, enlaces internos y contenido específico.

- [Tiendanube Punto de Venta](https://ayuda.tiendanube.com/es_AR/pdv/que-es-punto-de-venta-de-tiendanube) explica la venta física/online y el stock en una página dedicada.
- [Shopify POS](https://www.shopify.com/ar/pos/caracteristicas) describe inventario sincronizado, pagos y clientes con lenguaje de tarea.
- [Mendel producto](https://mendel.com/ar/producto/) separa gestión de gastos, medios de pago, ERP y aprobaciones en bloques rastreables.

Nerqia traduce ese patrón a su tesis real: sistema de gestión omnicanal,
software para comercios argentinos, stock único, punto de venta, tienda online,
clientes, caja y margen real por canal. Una futura página específica sólo entra
si aporta contenido y una intención distintos; no se clona la landing para
capturar otra keyword.

## Operación de Search Console

1. Publicar y comprobar desde afuera `robots.txt`, índice, sitemap de plataforma
   y HTML de Googlebot.
2. Validar JSON-LD con Schema Markup Validator y la URL viva con URL Inspection.
3. ~~Agregar/verificar la propiedad de dominio `nerqia.app` en Search Console.~~
   Hecho el 2026-09-03 mediante DNS.
4. ~~Enviar `https://nerqia.app/sitemap.xml`.~~ Correcto en la primera lectura.
5. ~~Solicitar indexación de la home.~~ Nerqia y la tienda activa quedaron en
   cola prioritaria; no gastar el cupo pidiendo todas las fichas.
6. Revisar lectura del sitemap, páginas indexadas/no indexadas, datos
   estructurados y acciones manuales.
7. Medir por semana: URLs conocidas/indexadas, impresiones, consultas, CTR,
   posición por consulta y conversiones orgánicas. La posición de marca se
   informa observada, nunca garantizada.

La propiedad usa el TXT DNS entregado por Google. Se conserva junto a
SPF/DKIM/DMARC; nunca se reemplaza toda la zona. La sesión pertenece al dueño y
no se copiaron ni buscaron credenciales del navegador.

## Definition of Done

- respuesta 200, canonical exacto, `index,follow` y H1 útil para cada URL pública;
- privados con `noindex,nofollow` y fuera de sitemaps;
- sitemap raíz y sitemaps hijos válidos, accesibles y sin URLs duplicadas;
- comprador humano conserva la SPA; crawler recibe semántica equivalente;
- build, guardas y prueba publicada sin regresión de Storefront;
- sitemap enviado/aceptado y home inspeccionada cuando haya acceso a Search Console;
- aparición e impresiones se cierran sólo con evidencia posterior de Google.
