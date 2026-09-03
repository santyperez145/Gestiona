# ADR 003 — Nerqia como identidad y dominio canónicos

**Estado:** aceptado
**Fecha:** 2026-09-03

## Decisión

La marca pública del Commerce Operating System es **Nerqia** y su origen
canónico es **https://nerqia.app**. Los productos se presentan como Nerqia
Commerce, Nerqia Business, Nerqia Pay, Nerqia Finance y Nerqia Platform.

`www.nerqia.app` existe como alias y redirige permanentemente al dominio raíz.
La identidad oficial entregada por el dueño se versiona en dos activos: un
isotipo N/Q transparente para shells, favicon y PWA, y un wordmark horizontal
para piezas de marca. Las tiendas nunca heredan esos activos: el logo y nombre
del comercio permanecen aislados de la marca de la plataforma.

## Topología de producto y tiendas

La topología objetivo evita que una nueva URL se convierta en otro storefront:

| Host | Responsabilidad |
|---|---|
| `nerqia.app` | adquisición, pricing y contenido institucional de Nerqia |
| `app.nerqia.app` | Business, Finance y Platform autenticados |
| `<slug>.nerqia.app` | tienda pública canónica incluida |
| dominio propio verificado | tienda pública canónica del merchant |
| `/tienda/:slug` | compatibilidad y redirección, no segunda autoridad SEO |

Todos los hosts de tienda reutilizan `StorefrontPage`, `StoreContext`, carrito,
checkout, órdenes y RPC existentes. No se crea un router, catálogo, precio,
stock ni checkout paralelo. En un host de tienda las rutas son limpias
(`/producto/:slug`, `/carrito`, `/checkout`); en el host compartido se conserva
el prefijo `/tienda/:slug` durante la transición.

Los slugs `www`, `app`, `api`, `admin`, `platform`, `finance`, `auth`, `docs`,
`help`, `status`, `soporte`, `mail`, `cdn`, `assets` y `developer` quedan
reservados. Un hostname propio se normaliza y pasa por estados
`pending_verification`, `pending_dns`, `active`, `misconfigured` o
`provider_error`; `none` significa que no hay asociación y sólo `active` puede
ser canónico. La asociación es única, tenant-scoped y resuelta en servidor con
la menor superficie pública posible.

## Evidencia competitiva y tecnológica

- [Vercel for Platforms](https://vercel.com/changelog/introducing-vercel-for-platforms)
  documenta wildcard subdomains, routing por host, TLS y dominios propios sobre
  un único deploy. El wildcard requiere nameservers de Vercel y cada dominio
  propio debe verificarse antes de activarse.
- [Shopify](https://help.shopify.com/en/manual/domains/add-a-domain/connecting-domains/connect-vs-transfer)
  separa conectar de transferir un dominio y mantiene al comercio como dueño;
  Nerqia adopta ese límite y no se vuelve registrador.
- [Tiendanube](https://ayuda.tiendanube.com/es_AR/dominios/guia-configurar-el-dominio-de-la-tienda)
  ofrece subdominio incluido y dominio propio conectado: es la paridad local
  esperada, no una razón para duplicar la tienda.
- La [documentación de redirects de Supabase Auth](https://supabase.com/docs/guides/auth/redirect-urls)
  recomienda URLs exactas en producción. El login del SaaS queda en
  `app.nerqia.app`; la compra pública no depende de una sesión del panel.

El DNS observado el 2026-09-03 usa nameservers de Vercel y resuelve el wildcard,
pero eso no prueba por sí solo asociación de proyecto, certificado ni routing.
La cuota de dominios del plan de hosting, el token de Vercel, la verificación
DNS y el remitente de correo son gates operativos externos; jamás se marcan
activos por existir una fila en la base. El contrato implementado consulta las
recomendaciones DNS dinámicas de Vercel, porque el CNAME/IP no se hardcodea.

## Compatibilidad

El cambio de marca no justifica romper datos ni integraciones. Se conservan:

- códigos persistidos como `gestiona_pay` y `gestiona_envios`;
- claves de almacenamiento local que mantienen sesiones y preferencias;
- variables de entorno y headers publicados `X-Gestiona-*`;
- el origen Vercel anterior, sólo en las allowlists de transición.

Estos valores son namespace técnico heredado, no copy visible. Una versión
futura puede introducir aliases `X-Nerqia-*`, pero los anteriores no se retiran
sin versión, telemetría de adopción y ventana de migración.

## Configuración operativa

- Vercel sirve el dominio y emite TLS automáticamente.
- Supabase Auth usa `https://nerqia.app` como Site URL y permite los callbacks
  exactos de producción, `www`, previews y localhost.
- Los callbacks enviados por email desde un dominio propio vuelven al
  `<slug>.nerqia.app` incluido, que sí está declarado en Auth. Login con clave o
  código funciona sobre el dominio propio; no se agrega un wildcard de terceros
  que Supabase no puede acotar por tenant.
- `store-domain` es la única pieza que llama a Vercel. Exige usuario real y rol
  owner/admin; guarda sólo estados y registros sanitizados. `VERCEL_TOKEN` vive
  en secretos de Supabase, nunca en Vite ni en `ecommerce_stores`.
- Las Edge Functions reciben `PUBLIC_BASE_URL`, `PUBLIC_APP_URL` y
  `PLATFORM_ALLOWED_ORIGINS` con el origen nuevo.
- El remitente de correo pasa a `nerqia.app`, pero queda **no verificado** hasta
  publicar en DNS los registros que entregue Resend. Vercel no provee casillas.

## Guardas

`brandIdentity.test.ts` recorre las superficies activas y falla si reaparecen
la marca o dominios anteriores fuera de las excepciones técnicas declaradas.
También valida los dos activos oficiales, favicon/PWA, origen canónico,
redirect y configuración de Auth.
