# Gestiona — contexto para Claude Code

**El sistema donde el negocio es uno solo, aunque venda por muchos lados.** El
mostrador, la tienda online y los marketplaces comparten el mismo stock, los
mismos clientes, los mismos costos y la misma verdad sobre cuánto se ganó.

En concreto: sistema de gestión completo (stock, POS, finanzas, multi-tienda,
canjes con influencers, marketing) **más** tiendas online que venden de verdad,
**más** un panel desde el que se administran todas las organizaciones y se cobra
comisión por venta.

⚠️ **La tienda no es el producto**, y describirlo como "alternativa a
Tiendanube" orienta mal las decisiones: lleva a competir donde se pierde. El
diferencial es que **el margen real por canal necesita cuatro datos a la vez**
—costo con aduana, comisión del medio de pago, envío e IVA— y acá están los
cuatro porque el proyecto nació importando. Un ecommerce no sabe el costo; un
ERP no sabe la comisión. Ver [docs/ESTRATEGIA.md](docs/ESTRATEGIA.md).

📌 **Lineamiento 2026-08-14:** Gestiona se piensa como **sistema operativo para
comercios omnicanal**, no como creador de tiendas. El corazón es el Business
Core —productos, órdenes, clientes, finanzas e inventario— y POS, tienda,
MercadoLibre, WhatsApp y futuras integraciones son canales alrededor de ese
núcleo. Si un módulo intenta inventar su propio stock, precio, margen, cobro o
cliente, va contra la arquitectura.

Cuatro superficies separadas, y esa separación es deliberada:

| Superficie | Ruta | Quién | Chrome |
|---|---|---|---|
| Organización | `/` | `memberships` | `AppLayout`, `--primary` violeta en claro / ámbar en oscuro |
| Finance | `/finance` | `memberships` **+ entitlement `finance` + permiso `finance.view`** | `FinanceLayout`, detrás de `FinanceProductGate` |
| Plataforma | `/platform` | `platform_admins` | `PlatformLayout`, acento violeta |
| Tienda pública | `/tienda/:slug` | comprador anónimo | `StoreLayout` |

Ser staff de plataforma **no** otorga permisos dentro de una organización. Ver
[docs/permisos.md](docs/permisos.md).

⚠️ **Finance no es un módulo de Gestión: es una superficie propia.** Comparte
deploy y base, pero tiene shell propio, gate propio y criterio de producto
propio — gestión de gastos corporativos, al estilo Mendel. Entrar a Gestión no
habilita Finance. El porqué, y cuándo justificaría otra aplicación física, en
[docs/ADR_001_FINANCE_PRODUCT_SURFACE.md](docs/ADR_001_FINANCE_PRODUCT_SURFACE.md).

⚠️ **Antes de tocar precios, datos de clientes o el panel de plataforma, leer
[docs/LEGAL.md](docs/LEGAL.md).** Es el relevamiento contra la normativa
argentina, requisito por requisito. El botón de arrepentimiento y el link a
Defensa del Consumidor ya están (sesión 108), y el generador de páginas legales
escribe la política de privacidad y los términos (sesión 109) — **falta que el
dueño cargue razón social, CUIT y domicilio, y publique**. Se generan como
borrador a propósito: publicar un texto legal por él sería firmarlo en su
nombre.

⚠️ **Antes de escribir código nuevo, leer
[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).** Fija los quince principios y los
límites de dominio que no hay que cruzar. El estado medido del 2026-08-21 vive
en [docs/COMPARACION.md](docs/COMPARACION.md): 282 tablas, 298 con `org_id`,
62 Edge Functions y 1.592 tests (`npm test -- --maxWorkers=1 --fileParallelism=false`, 2026-08-26). Idempotencia,
eventos con outbox y ledger financiero ya están construidos y verificados en
los commits H1–H3; no deben volver a tratarse como pendientes ni duplicarse.
El checkout público ya consume el orquestador P0.3.1: toda llamada a
`store-pay` prepara una intención y un intento server-side, conserva la clave
canónica del proveedor y el webhook reconcilia el resultado. La devolución
iniciada desde el Portal RMA ya consume el contrato P0.3.2/P0.3.3: valida el
monto y el tenant del RMA en la base, conserva una clave de MercadoPago, sólo el
servidor usa el token del comercio, el webhook puede reconciliar un timeout y
la recepción física enlaza RMA, `returns` y Kardex de forma idempotente. La
autorización ARCA ya tiene una reserva server-side por punto de venta/tipo de
comprobante y una transición única para éxito, rechazo y respuesta incierta;
un timeout queda `processing` para no duplicar el comprobante. Captura, factura
y recepción de compra todavía deben migrar al mismo contrato; no se declara
P0.3 completo hasta probar esos caminos y una matriz sandbox. El guard de ARCA
no se presenta como una factura emitida: falta la evidencia del organismo.

El orden siguiente es el plan canónico de `ROADMAP.md` §0.0: P0.1 catálogo
polimórfico, P0.2 identidad, P0.3 pagos, P0.4 ARCA y P0.5 segundo comercio.
`gestiona.txt` es el análisis que fundamenta ese orden, no permiso para saltar
las puertas de verificación.

**Primeros slices del Control Plane (2026-08-21):** `/platform/integraciones`
consume `platform_integration_registry`, un catálogo staff-only que describe
alcance, método de conexión, capacidades y lifecycle. El Resumen de
`/platform` consume además `platform_org_health`, `platform_org_activation` y
`platform_cron_health` para señales operativas con evidencia. Ninguna de las dos
superficies contiene tokens, certificados ni secretos y el catálogo no se debe
usar como sustituto de la salud de runtime. Si una integración nueva aparece en
UI, primero debe tener una fila en ese registro y una condición de salida
verificable; no se agregan nombres hardcodeados en varias pantallas.

**Identidad antes que deduplicación:** el slice P0.2.1 dejó las vistas protegidas
`product_identity_review` y `customer_identity_review` como fuente del
reporte. SKU/EAN, email y teléfono son llaves fuertes; nombre y marca sólo
proponen candidatos. Nunca fusionar por nombre, nunca backfillear datos reales
para que el reporte “dé limpio” y nunca crear un índice único antes de medir
colisiones por `org_id`. El importador CSV puede omitir una coincidencia por
llave fuerte, pero tiene que conservar homónimos con contactos diferentes.
La cola de completitud en Productos y Clientes sólo abre fichas existentes y
requiere edición humana: nunca inventa SKU/EAN/contactos ni fusiona perfiles.
El panel se mantiene compacto con tabs de resumen, pendientes y candidatos;
los listados largos llevan scroll interno y nunca deben convertir una página
operativa en una pared de tarjetas.
El Centro de calidad de datos en `/calidad-datos` concentra ese trabajo en tabs
de Catálogo y Clientes, con búsqueda, enlaces profundos a la ficha de origen y
exportación CSV interna. Toda exportación de datos operativos debe escapar
contenido CSV y neutralizar fórmulas que empiecen con `=`, `+`, `-` o `@`; el
archivo no es una vía para saltar permisos ni para ejecutar merges. La única
fuente de verdad sigue siendo la vista protegida y la edición humana en el
formulario del módulo correspondiente.
Medición actual (2026-08-21): 60 productos sin SKU/EAN, 33 clientes, 24 sin
email/teléfono, 0 colisiones exactas. El detalle verificable y el slice P0.2.2
están en `ROADMAP.md` §0.0.

**Contrato visual Figma 2026-08-22:** la renovación del frontend sigue los
patrones de CRM, eMarketplace y marketplace/admin kits compartidos por el
dueño, sin copiar assets ni convertir Gestiona en una tienda genérica. La
dirección canónica está en [docs/INTERFAZ.md](docs/INTERFAZ.md) y se aplica a
tres de las cuatro superficies: Business, Platform y Storefront. Finance queda
afuera a propósito — tiene su propio shell y su propio lenguaje, y mezclarlo con
el del workspace borraría la separación que el ADR 001 defiende.

- Usar `PageHeader`, el shell de la superficie y los primitives compartidos
  antes de crear CSS o navegación local.
- Una pantalla larga se divide por tareas relacionadas: `WorkspaceViewTabs`
  para vistas operativas compactas; Radix Tabs o un sidebar interno cuando hay
  contenido profundo; siempre con persistencia por organización si la vista es
  de un comercio.
- La lista/tabla y su acción primaria son el centro de trabajo. KPIs,
  insights, auditorías y configuración viven en una vista relacionada, no
  debajo de una pared de tarjetas.
- Los estados deben tener loading, vacío, error, permiso y datos desactualizados
  explícitos; color solo acompaña a una etiqueta legible.
- Mobile debe conservar búsqueda, filtros, tab activa y acciones críticas con
  scroll horizontal controlado; verificar 360, 768, 1024 y desktop antes de
  cerrar un slice.
- El rediseño no duplica Business Core, permisos, stock, precios ni clientes:
  cambia composición y jerarquía, no la fuente de verdad.

El primitive `WorkspaceViewTabs` ya conecta Productos (`Catálogo` / `Operación`)
y Ventas (`Ventas` / `Rendimiento`). Dashboard, Settings, Admin,
Integraciones, Reportes y Tienda deben conservar el mismo lenguaje de tokens,
densidad, foco y persistencia al evolucionar.

El Dashboard usa seis vistas persistidas por organización (`Resumen`,
`Rendimiento`, `Clientes`, `Stock`, `Caja y finanzas` e `Inteligencia`). No se
deben volver a mostrar como una sola columna larga: cada sección se monta bajo
su propia vista activa y conserva las acciones/modales existentes. Platform
mantiene un rail propio agrupado por `Workspace`, `Operaciones`, `Ingresos` y
`Gobierno`; los grupos sólo muestran los módulos permitidos por el rol real.

El shell compartido ya es parte del contrato, no sólo una capa estética:
`AppLayout` debe conservar la identidad del workspace en el topbar, breadcrumb,
búsqueda global, estado operativo y CTA; `PageHeader`, `MetricCard` y
`WorkspaceViewTabs` son los primitives de jerarquía para las rutas de negocio.
Platform usa `PlatformLayout` con contexto de consola central, rail violeta y
acciones de salida separadas. Si una pantalla nueva necesita inventar otro
header o tarjeta, primero hay que justificar por qué no puede extender estos
primitives.
Los enlaces públicos o favoritos que todavía usan `#dashboard-*` deben seguir
resolviendo la vista correspondiente, incluso si la organización tenía una
sección inválida persistida en el navegador.

**Paleta obligatoria del frontend claro:** usar el token `primary` violeta
`252 83% 62%` sobre canvas casi blanco, tarjetas blancas, turquesa para salud y
coral para atención. No reintroducir el azul apagado ni el dorado como color
global de la aplicación. El dorado sólo puede aparecer como branding específico
de un comercio o dentro de una preview histórica, nunca como token del
workspace. `App.tsx` inicia en tema claro; toda nueva pantalla se verifica con
ese tema en desktop y mobile.

Y lo que ese documento dice que **no** hay que construir todavía —multi-store,
dominios propios, theme engine, headless, marketplace— importa tanto como lo que
sí: espera un segundo comercio, no una decisión de arquitectura.

¿Arrancando de cero? [docs/GUIA.md](docs/GUIA.md) explica la plataforma y el
código para alguien sin experiencia, con un orden de estudio y ejercicios sobre
los archivos de este repo.

📋 **¿Qué está construido, qué está probado y qué se usa de verdad?**
[docs/CAPACIDADES.md](docs/CAPACIDADES.md) — cuatro estados
(`built` / `verified` / `operated` / `adopted`) con la evidencia al lado, medido
contra la base el 2026-08-26. ⚠️ Existe porque "está construido" y "se probó
contra el organismo" se leen igual en un README, y de ahí salieron los dos bugs
más caros del proyecto.

📊 **¿Dónde estamos parados contra la competencia?**
[docs/COMPARACION.md](docs/COMPARACION.md) — medido contra la base el
2026-08-21, con fuentes y fechas para cada dato de un competidor. Incluye lo que
falta para operar como una empresa grande, en orden de cuánto duele que falte.

---

## ⚠️ Antes de escribir código

**Se trabaja desde dos PCs en paralelo.** El remoto avanza sin aviso.

```bash
git fetch origin
git log --oneline main..origin/main   # qué hay en el remoto que no tengo
git log --oneline origin/main..main   # qué tengo sin pushear
```

Si el remoto está adelante, **leer los títulos de los commits antes de
planificar**. Una vez se construyó un checkout completo de tienda online que ya
existía mejor hecho en el remoto, y hubo que descartarlo. Si el trabajo propio
colisiona, **preguntar cuál implementación sobrevive** — es decisión de producto,
no de merge.

---

## Cómo se trabaja acá

Esta sección existe para que cualquier sesión, en cualquier PC, arranque con el
mismo criterio. No es estilo: cada regla salió de algo que se rompió.

**No caer en "ERP feature factory".** El modo de falla de este proyecto no es
quedarse corto: es agregar. Antes de construir algo nuevo, ubicarlo en uno de
los cinco pilares del `ROADMAP.md`: productos/inventario, POS/caja, ecommerce,
clientes/ventas o inteligencia. Si no acerca a un segundo comercio real a su
primera venta, no fortalece el stock único, no muestra margen por canal, no
reduce riesgo o no mide uso/tracción, queda congelado aunque sea buena idea.

**La IA no es un chatbot decorativo.** El objetivo es Business Copilot: detectar
qué comprar, qué canal deja menos margen, qué clientes se enfrían y qué promo
conviene ejecutar. Cada recomendación útil debería tener una acción posible y,
después, una métrica de adopción (`AI Action Rate`). Generar descripciones es
comodity; operar con el grafo del negocio es el diferencial.

**Una feature no está hecha hasta que se probó contra la base real.** No hay
staging. El patrón, que ya encontró cinco bugs que ningún test unitario iba a
encontrar, está más abajo en "Verificación". La última fila del `SELECT` cuenta
los restos y tiene que dar `0`.

**El navegador se verifica contra `localhost`, no contra Vercel.** El deploy va
del `git push`, así que hasta que no se pushea, el sitio publicado tiene el
código viejo aunque las migraciones ya estén aplicadas. Verificar contra
`exentryimports.vercel.app` da falsos negativos garantizados.

⚠️ **Pero eso necesita un `.env`, y no está en las dos PCs.** Sin
`VITE_SUPABASE_URL` el cliente se construye con la URL vacía (ver
`src/integrations/supabase/client.ts`) y la app levanta pero no se conecta a
nada: la tienda pública dice "Tienda no encontrada" con la tienda activa en la
base. **Eso no es un bug, es la falta del archivo** — y confundirlo cuesta una
hora. Comprobar antes de planificar una verificación en navegador:

```bash
ls .env .env.local 2>/dev/null || echo "sin .env: el navegador no llega a la base"
```

Sin `.env`, lo único que el navegador prueba es que compila y que no hay errores
de consola. Todo lo demás se verifica contra la base, y conviene hacerlo
ejecutando como el rol real (`SET LOCAL ROLE anon` o `authenticated` con
`request.jwt.claims`) para que la RLS se evalúe de verdad y no como superusuario.

**No se toca dato real del negocio para verificar.** Ya pasó: para probar el
aviso de reposición se puso en cero el stock de un perfume y el valor original
se perdió — `stock_movements` no lo tenía. Si hace falta un producto agotado,
se crea uno `ZZ` y se borra; si no hay más remedio que tocar uno real, se
**guarda el valor antes** en la tabla temporal del test.

⚠️ **`xlsx` no se instala desde npm.** El paquete del registro está congelado en
0.18.5 a propósito —SheetJS movió la distribución a su CDN— y esa versión
arrastra contaminación de prototipo y ReDoS **en el parser**, que es lo que
corre sobre el archivo que sube el comercio. `package.json` apunta a
`cdn.sheetjs.com/xlsx-0.20.3`, el lock lo fija con hash de integridad, y
`xlsxSinVulnerabilidad.test.ts` falla si alguien lo devuelve al registro con un
`npm install xlsx` distraído. El costo es que un CDN caído rompe el build.

⚠️ **El rubro del comercio no se adivina.** `settings.industry_code` tenía
`DEFAULT 'perfumes'` desde que esto era la app de un solo negocio, y el
onboarding lo repetía en dos lugares. El rubro siembra tipos de producto y
atributos: elegir mal se descubre cuando ya hay productos cargados. Desde el
2026-08-25 no hay default en la columna ni preselección en la UI, y NULL
significa "todavía no eligió" — un estado real, como el NULL de
`products.tax_rate`.

⚠️ **Y la categoría del producto tampoco.** `products.category` era
`NOT NULL DEFAULT 'perfume_arabe'`, así que un comercio de cualquier rubro que
cargara un producto sin elegir categoría quedaba con perfumería escrita en su
base sin verlo. Desde `20260825000002_categoria_sin_rubro` la columna no tiene
default ni NOT NULL —NULL es "sin categoría"— y `ecommerce_categories.store_id`
es opcional, porque la categoría es del Business Core y la tienda sólo la
muestra: `get_store_categories` une por `org_id`, no por `store_id`. Sin eso,
"Crear una categoría…" **fallaba siempre** con un not-null, y 3 de las 4
organizaciones ni siquiera tienen tienda de la que sacar el id.

Para elegir o rotular una categoría se usan `CategorySelect` /
`useOrgCategories` (opciones + crear) y `useOrgCategoryNames` (sólo el nombre,
sin consultar `products`). `NOMBRES_HEREDADOS` en `storeCategories.ts` es
**rótulo de un slug ya cargado**, nunca una opción a ofrecer: sembrarlo hacía
que un comercio nuevo eligiera entre "Perfume Árabe" y "Vaper".
`categoriaSinRubroPorDefault.test.ts` es el guardia, con una allowlist que
enumera lo que todavía nombra un rubro, para que no crezca sin que nadie lo
note.

**Ninguna pantalla enumera categorías a mano (2026-08-26).** Había seis copias
de los mismos cuatro slugs; se fueron todas. La regla ahora:

- **Un filtro** (POS, Ventas, Toma Física) arma su lista con **los productos que
  ya tiene cargados** y rotula con `useOrgCategoryNames`. Una opción que
  devuelve cero resultados es peor que no estar, y no cuesta una consulta extra.
- **Una configuración** (el markup por categoría de Ajustes) lista las
  categorías de la organización **más las que ya tengan valor guardado**:
  `settings.category_pricing` sigue aplicándose desde `getCategoryMarkup`, así
  que esconder una entrada la deja cobrando sin que nadie pueda verla.
- `getCategoryLabel` en `supabaseStore.ts` ya no tiene mapa propio: delega en
  `nombreDeCategoria`. Es el **fallback sin organización** —helpers de módulo,
  PDFs, el catálogo público de `/catalogo/:userId`—; donde haya `orgId` va
  `useOrgCategoryNames`, que sí refleja un renombre.
- El color del badge sale de `colorDeCategoria(slug)`, un hash estable sobre una
  paleta. Antes sólo cuatro slugs tenían color y el resto salía sin badge.
- `ProductCategory` en `src/lib/types.ts` dejó de ser una unión cerrada. Ese
  archivo lo importa **sólo `seedData.ts`**: no era la raíz de nada.

⚠️ **Lo que queda en la allowlist no son listas: son features atadas a un
rubro** —ficha de perfume (`product_perfume_details`), subtipos de vaper,
campos de electrónica, venta por decant, estimación de peso por ml, plantillas
de marketing—. Sacarlas es el catálogo polimórfico (P0.1, `product_types` y sus
atributos), no reemplazar un slug por otro.

**El stock lo mueve la base, y sólo la base. El cliente nunca escribe
`products.stock`.** No es una preferencia de estilo: se rompió dos veces por lo
mismo. La segunda fue peor — `addSaleDB`, `addSaleWithVariantDB` y
`addPurchaseDB` ajustaban el stock **después** de insertar la fila, que ya había
disparado el trigger, así que **vender 3 unidades bajaba 6 y comprar 5 subía
10**, en el POS, en Ventas, en Presupuestos y en el chat de IA. Estuvo así
meses; se veía en el Kardex en negativo con el stock real positivo, porque los
números se venían corrigiendo a mano.

`trg_sale_stock_movement` y `trg_purchase_stock_movement` cubren INSERT, UPDATE
y DELETE, y `record_stock_movement` es el único lugar que toca `products.stock`,
`product_variants.stock` y `location_stock`. Para mover stock por un camino
nuevo, se llama a esa función — no se escribe la columna.

La regla general: **antes de tocar stock o totales, buscar el trigger.**

```bash
npm run db -- --sql "select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal"
```

Y **no tapar el resultado con `GREATEST(0, ...)` ni `Math.max(0, ...)`**: eso fue
lo que hizo que el descuento doble pasara desapercibido y lo que permitió que
una transferencia entre sucursales inventara 40 unidades. Un stock negativo es
un dato que hay que mirar. La vista `stock_negativo` tiene que estar vacía.

**Una vista nueva no reemplaza a una existente: convive con ella.** Cambiarle el
filtro por abajo a `catalog_products` habría afectado al catálogo por WhatsApp
y a la página pública. La tienda lee `store_catalog_products`, hermana y sin el
filtro de stock. Mismo criterio para los RPC.

**No tragarse errores.** Un `?? []` convierte "no tengo permiso" en "no hay
nada", y son problemas opuestos. Se distingue el error de relación inexistente
(`42P01`/`42883`/`PGRST205`/`PGRST202`, que sí justifica el fallback) de
cualquier otro, que se reporta.

**Las rutas salen de un solo archivo.** `src/app/routeManifest.ts` declara cada
ruta con su id estable, su módulo de permisos, sus roles, su página y sus
alias; `App.tsx`, el sidebar, el buscador y `moduleForRoute` derivan de ahí. La
misma decisión escrita en dos lugares ya divergió dos veces:

- **Permisos:** el fallback por sección de `moduleMap.ts` usaba nombres que la
  navegación había dejado de usar —coincidían 2 de 8— y **29 de 70 destinos**
  quedaban sin restricción, incluidos `/ventas` y `/ajustes`.
- **Roles:** el reparto admin/vendedor vivía en el manifest y en un
  `{isAdmin && ...}` del router. **5 rutas divergían** y el vendedor rebotaba
  al dashboard al tocarlas, incluido `/perfil`.

Por eso `module` es obligatorio y `null` exige `openReason` escrito: abrir una
ruta es una decisión con motivo, nunca un olvido. Lo único que `App.tsx`
declara a mano son las rutas con parámetros, los montajes de superficie y
`/login`. Las guardas están en `routeManifest.test.ts`.

**Los tests guardia mandan.** `publicSurface`, `edgeFunctionAuth` y
`moduleMap` no son burocracia: `edgeFunctionAuth` falló apenas apareció una
función nueva que manda emails, antes de que llegara a producción. Si uno falla,
se arregla el código o se documenta el motivo en la allowlist — nunca se afloja
el test.

**Se hace como lo hacen los que ya funcionan, no como se nos ocurre.** Antes de
inventar un flujo, mirar cómo lo resuelve alguien que ya opera con eso —
MercadoLibre, Tiendanube, Shopify, Stripe— y usar el mecanismo probado, no una
variante propia.

Casos concretos donde esto ya decidió el diseño:

- **AFIP se conecta por delegación**, no subiendo certificados. Un comercio que
  tiene que generar una clave con `openssl`, armar un CSR y subirlo a WSASS
  abandona ahí. El mecanismo real es el Administrador de Relaciones de ARCA, que
  el comercio ya usa.
- **La verificación le pregunta al organismo, no al usuario.** Un checkbox de
  "ya lo hice" hace que el panel diga "listo" y la primera factura falle. Se
  consulta `FECompUltimoAutorizado`, que es de sólo lectura y falla si la
  delegación no existe.
- **Idempotencia con clave del cliente**, como Stripe: misma clave y mismo
  contenido devuelve el mismo resultado; misma clave con contenido distinto es
  un error, no la respuesta vieja.
- **Webhooks con firma, reintento con backoff y descarte con evidencia**, como
  MercadoPago y Stripe. "Al menos una vez" con `event_id` para deduplicar, que
  es lo que existe de verdad sobre HTTP.
- **OAuth donde el proveedor lo ofrece.** Un token pegado a mano queda en una
  tabla que la UI lee, y MercadoPago además rechaza el `marketplace_fee`.

⚠️ **Y tecnologías reales, no aproximaciones.** Nada de simular una respuesta,
inventar un conteo de tokens ni dar por buena una conexión sin probarla. Si algo
no se puede verificar todavía, se dice — no se tapa con un número plausible. Ver
`sinSimulacion.test.ts`, que existe porque el chat de IA devolvía texto enlatado
y guardaba `Math.random()` como uso de tokens.

**Los números medidos van con la fecha o con el comando al lado.** Este repo es
público y su documentación se lee de afuera: un análisis externo citó "418 tests" (dato de 2026-08-11, hoy son otros)
unitarios" tomándolo de una línea vieja de `ROADMAP.md` cuando la suite ya era
mucho mayor. Un número sin fecha se convierte en el dato que otros repiten.

**Antes de afirmar algo sobre un competidor, verificarlo o marcarlo como no
verificado.** ⚠️ Y el ejemplo dejó de ser hipotético: **"Tiendanube no tiene POS"
es FALSO desde 2026** — tiene PDV, sincroniza stock en tiempo real y viene en
todos los planes, incluido el gratuito (verificado 2026-08-21). Era el argumento
central del pitch y hay que dejar de usarlo. El relevamiento completo, con
fuentes y fechas, está en [docs/COMPARACION.md](docs/COMPARACION.md). En `docs/ESTRATEGIA.md` cada afirmación va marcada ✅ medido, 📌 criterio
o ❓ sin verificar, y esa separación se mantiene.

**Los mensajes de commit son largos a propósito.** Explican *por qué* se hizo
así y *qué encontró la verificación*, no qué archivos cambiaron. El estado del
proyecto vive ahí y en `ROADMAP.md`; `git log --oneline -20` es el resumen.

**Pushear es una decisión explícita.** Se commitea siempre, se pushea cuando el
dueño lo pide: el push dispara el deploy de producción en Vercel.

**Trabajo en slices.** Cada slice es migración → verificación en producción →
UI → puerta completa (`typecheck` + `lint` + `test` + `build`) → navegador →
commit → `ROADMAP.md`. No se acumulan tres features sin commitear.

---

## Reglas del repo

**El CI es bloqueante.** Antes de cada commit:

```bash
NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck && npm run lint && npm test
```

**No usar `npx tsc --noEmit`.** El `tsconfig.json` raíz tiene `"files": []` y
sólo `references`, así que ese comando sale con éxito **sin chequear un solo
archivo** — daba verde siempre. Por eso llegaron a producción errores que
rompían páginas enteras (un `DialogFooter` sin importar dejó Productos en
pantalla blanca). `npm run typecheck` apunta a `tsconfig.app.json` y sí chequea;
el `NODE_OPTIONS` no es opcional, sin él se queda sin memoria a los 6 minutos
(`types.ts` tiene ~20 mil líneas).

`lint` tolera ~140 warnings de `exhaustive-deps`: son deuda conocida y **no se
tocan en masa** (provoca loops de refetch). Errores: cero.

**Los flujos se cubren con Playwright, los cálculos con vitest.** Los **1.592**
tests (`npm test`, 2026-08-26) verifican cuentas y contratos; los bugs que costaron plata fueron todos de
integración y ninguno los habría agarrado. Los E2E viven en `e2e/` y leen la
base de producción, así que son **de sólo lectura**: ninguno crea una orden.

```bash
npm run test:e2e            # chromium + un teléfono
npx playwright install      # la primera vez, baja el navegador
```

Corren contra `localhost` levantando el dev server solo. `E2E_BASE_URL` apunta
a otro lado si hace falta. Vitest sólo mira `src/**`, así que no se pisan.

**Los specs del panel necesitan un usuario de prueba.** Sin él se saltean y la
suite sigue verde — un test rojo por falta de configuración enseña a ignorar
los tests rojos. Para activarlos, crear un usuario en Supabase (Authentication
→ Add user, con "Auto Confirm"), darle membresía `owner` o `admin` en la
organización, y exportar:

```bash
export E2E_USER=pruebas@tudominio.com
export E2E_PASSWORD=...
```

`auth.setup.ts` inicia sesión **contra la API, no contra el formulario**, y
guarda la sesión en `e2e/.auth/usuario.json` para que el resto la reuse. Ese
archivo es un token válido y está en `.gitignore`: se trata como cualquier otro
secreto. La contraseña nunca se imprime, ni siquiera cuando el login falla.

Ese usuario es de prueba y ve datos reales de producción: conviene que no tenga
más permisos de los que el spec necesita.

**Los cálculos de plata van a funciones puras testeadas**, nunca inline:
`businessCalc.ts`, `shippingCalc.ts`, `paymentFees.ts`, `storeReadiness.ts`.
Cuando la misma cuenta existe en SQL (para que el servidor sea la autoridad), el
comentario de cada lado dice que son espejos.

**Las imágenes se suben por archivo, nunca por URL pegada.** `ImageUpload` es
el componente único: elegir, arrastrar o pegar, y comprime en el navegador
antes de subir — una foto de teléfono pesa 3 a 8 MB y un banner así arruina la
carga de la home. Las reglas puras viven en `imageUpload.ts` (`npm test -- imageUpload`).
Pedir una URL obliga a subir el archivo a otro lado primero y termina en
banners que apuntan a un Drive que alguien despublica.

⚠️ **El repo compila con `strictNullChecks: false`.** TypeScript no estrecha
uniones discriminadas por booleano: un `{ok:true} | {ok:false;motivo}` deja
`motivo` inaccesible en la rama del error. Usar un objeto con el campo
opcional.

**Nada de precios ni stock desde el cliente.** El checkout manda ids y
cantidades; precios, stock, cupones, envío y comisiones se recalculan en la base.

---

## Migraciones

### El procedimiento, en cuatro pasos y sin excepciones

Esto es lo único que hay que seguir. Lo que viene después es el historial que
explica **por qué** es así, y sirve para no repetir los errores — pero el
procedimiento es éste:

```bash
# 1. El número se elige DESPUÉS de traer el remoto, con 14 dígitos exactos.
git fetch origin && ls supabase/migrations | tail -5

# 2. Se aplica con db query --file. Nunca con db push.
npx supabase db query --linked --file supabase/migrations/2026XXXXXXXXXX_lo_que_sea.sql

# 3. Se anota en el libro en la misma sesión. Esto es lo que evita el pozo.
#    INSERT INTO supabase_migrations.schema_migrations (version, name)
#    VALUES ('2026XXXXXXXXXX', 'lo_que_sea') ON CONFLICT DO NOTHING;

# 4. Se comprueba la salud del libro.
npx supabase db push --linked --dry-run
# {"upToDate":true,"migrations":[],"message":"Remote database is up to date."}
```

⚠️ **`db push` se usa SÓLO con `--dry-run`, como chequeo de salud.** Nunca para
aplicar. No porque destruya —eso se arregló— sino porque `db query --file`
aplica y verifica en el mismo paso: permite correr los bloques `DO` de
verificación, que es donde este repo encontró los bugs que ningún test unitario
iba a encontrar.

Si el `--dry-run` del paso 4 devuelve migraciones en la lista o
`LegacyDbPushMissingLocalError`, el libro se desfasó: **leer el historial de
abajo antes de correr nada**, y en particular no usar
`migration repair --status reverted`, que es la peor salida posible.

---

### Historial: cómo se llegó hasta acá

#### `db push` volvió a servir — y hay que mantenerlo así

Durante meses fue un comando prohibido: el libro estaba 168 atrás y un `push`
habría corrido la migración que dropea tablas. Al 2026-08-02 está reconciliado:
**268 archivos, 268 registradas, brecha 0**, y el CLI lo confirma.

```bash
npx supabase db push --linked --dry-run
# {"upToDate":true,"migrations":[],"message":"Remote database is up to date."}
```

✅ **Al 2026-08-26 el libro está sano de nuevo: `upToDate: true`, brecha 0.**
Vale contar cómo se resolvió, porque es el procedimiento funcionando.

Esa mañana el `--dry-run` abortaba con `LegacyDbPushMissingLocalError`: **418
registradas, 417 archivos**, y la que faltaba era `20260825000002
categoria_sin_rubro`. No estaba en ninguna rama, ni en la historia de git, ni
en el disco; la fila del libro tenía `statements` vacío; y comparando los 838
objetos de `public` contra el texto de las 417 migraciones que había ese día
(2026-08-26), los únicos dos sin
mención eran `unaccent_init` y `unaccent_lexize`, de la extensión.

⚠️ **Todo eso apuntaba a que el número no había dejado rastro — y era una
conclusión equivocada.** El archivo existía: lo tenía la otra PC sin commitear,
y llegó unas horas después con la limpieza del rubro del catálogo. "No encontré
rastro" nunca es "no existe".

📌 Lo que sí funcionó fue **no tocar el libro**. El CLI sugiere
`migration repair --status reverted`; haberlo corrido habría marcado como
revertida una migración aplicada, y el `push` siguiente habría querido correrla
de nuevo sobre una base que ya la tenía. La regla se sostiene: cuando falta un
archivo, **se espera a la PC que lo aplicó**.

⚠️ **Al 2026-08-05 se rompió por el mismo camino, con cinco.** Quedan acá porque
el diagnóstico de aquella vez fue el opuesto y sirve de contraste: ahí los
objetos **sí** estaban en la base y el trabajo **sí** estaba sin versionar.

    20260802000009  preguntas_producto
    20260802000010  salud_por_organizacion
    20260805000001  promo_llevando_2
    20260805000002  categorias_de_tienda
    20260805000003  menu_de_tienda

Los objetos **están en la base** —`product_questions`, `platform_org_health`,
`ecommerce_categories`, `store_promo_2x_discount` y sus RPC— pero los archivos no
están en `main` ni en ninguna rama del remoto. Se aplicaron con `db query --file`
y se anotaron, y nunca se commitearon.

Consecuencias, en orden de gravedad:

1. **Ese trabajo no está versionado.** Si la base se reconstruye, se pierde.
2. `db push` vuelve a abortar con `LegacyDbPushMissingLocalError`.
3. La sugerencia que imprime el CLI —`migration repair --status reverted`— es
   **la peor salida posible**: marcarlas como revertidas haría que un `push`
   las quiera correr de nuevo, y no hay archivo que correr.

La salida correcta es que la PC que las aplicó commitee los archivos. Si eso no
pasa, se reconstruyen desde el catálogo, pero conviene coordinarlo antes para no
terminar con dos versiones del mismo objeto con números distintos.

**Ese `--dry-run` es el chequeo de salud del libro.** Si algún día devuelve
migraciones en la lista, el libro se volvió a desfasar y hay que mirar por qué
antes de correr nada.

Se llegó ahí por tres caminos, y conviene saber cuál aplica a cada problema:

**1. Reconciliar lo aplicado sin registrar** —
`scripts/reconciliar-migraciones.mjs`:

```bash
node scripts/reconciliar-migraciones.mjs             # informe, no escribe
node scripts/reconciliar-migraciones.mjs --detalle   # + qué objeto falta
node scripts/reconciliar-migraciones.mjs --registrar # anota las confirmadas
```

Deduce si una migración está aplicada extrayendo del archivo los objetos que
crea y preguntándole al catálogo cuáles existen. Ignora lo que esté dentro de un
bloque `DO`: ahí el SQL se arma con `format()` y los nombres no están escritos,
así que buscarlos daría falsos negativos.

**2. Los nombres de archivo tienen que tener 14 dígitos exactos.** Es lo que
espera el CLI, y era el bloqueo real que quedaba después de reconciliar: con 8,
10 o 16 dígitos el archivo le resulta **invisible**, y entonces la versión que sí
está en el libro "no existe localmente" y aborta con
`LegacyDbPushMissingLocalError`. Se renombraron 12 preservando el orden
lexicográfico y actualizando el libro en la misma pasada.

**3. Lo que no va a correr nunca, se borra del repo.** Al 2026-08-02 había 13 migraciones que
creaban módulos sacados del producto (`sla_rules`, `elearning`,
`carbon_footprint`, `franchise_management`, `hr_portal`…). No estaban aplicadas
y sus 44 tablas no existen ni las usa ningún código, así que dejarlas sólo servía
para que un `db push` **resucitara** módulos muertos. Están en la historia de git
si alguna vez hacen falta.

**La destructiva se aplicó** (2026-08-02). Dropeó 57 tablas de módulos retirados
que entre todas tenían **0 filas**. La documentación decía "aplicarla sin backup
borra datos"; no había ninguno, y ese rótulo fue lo único que la frenó un año.
Se verificó antes que ningún código las referenciara, y después que el `CASCADE`
no se hubiera llevado nada de la tienda pública: las 15 relaciones y funciones
del storefront siguen ahí y `get_store_by_slug` responde como rol `anon`.

⚠️ **Que `db push` sirva no lo vuelve el camino por default.** Sigue siendo más
seguro `db query --file` para aplicar una migración y verificarla en el mismo
paso, sobre todo porque permite correr los bloques `DO` de verificación. Lo que
cambia es que ya no es un comando que destruye la base si alguien lo tipea.

Al aplicar una migración a mano, **anotarla** — es lo que evita volver al pozo:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260731000021', 'order_shipping') ON CONFLICT DO NOTHING;
```

Es lo único que frena que la brecha siga creciendo.

Lo que se usa en la práctica, y funciona sin credenciales extra porque el
proyecto ya está linkeado:

```bash
npx supabase db query --linked --file supabase/migrations/2026XXXX_lo_que_sea.sql
```

Sirve para aplicar la migración **y** para correr los bloques de verificación.
Cada archivo tiene que ser idempotente (`IF NOT EXISTS`, `DROP POLICY IF
EXISTS`, `CREATE OR REPLACE`) porque se corre más de una vez.

Alternativa manual: `supabase/00_diagnostico.sql` → `01_aplicar_pendientes.sql`
→ `02_verificar.sql` pegados en el SQL Editor, o `npm run db -- --file x.sql`.

**Consecuencia que ya causó un incidente en producción:** el código cliente
**no puede** asumir que la migración del mismo commit está aplicada. Se cambiaron
las lecturas a vistas nuevas y la tienda mostró cero productos teniendo cientos.
El patrón correcto está en [src/lib/publicDataSource.ts](src/lib/publicDataSource.ts):
intentar lo nuevo y caer a lo anterior **sólo** si la relación o la función no
existen (`42P01`/`42883`/`PGRST205`/`PGRST202`), nunca ante un error genérico. Y
**no tragarse errores con `?? []`**.

Al crear una tabla, **verificar que el nombre no exista ya**: `CREATE TABLE IF
NOT EXISTS` es un no-op silencioso y después falla el índice. Pasó con
`shipping_zones`/`shipping_rates`, que ya existían desde
`20260523000075_logistics.sql` con otra forma.

**El número de la migración se elige DESPUÉS de traer el remoto, no antes, y va
con 14 dígitos exactos.** Las dos PCs numeran a partir de lo que ven, así que dos
sesiones en paralelo eligen el mismo. Ya pasó: `20260731000013` salió dos veces,
una como `marketplace_fee` en el remoto y otra como `order_shipping` local. Se
arregla renombrando el archivo —el contenido es idempotente y ya aplicado, no
hace falta tocar la base— pero si además queda registrado en el libro con el
número viejo, hay que corregir las dos puntas. Antes de crear el archivo:

```bash
git fetch origin && ls supabase/migrations | tail -5
```

Los 14 dígitos no son estética: con 8, 10 o 16 el CLI no ve el archivo y
`db push` aborta con `LegacyDbPushMissingLocalError` diciendo que la versión del
libro no existe localmente. Pasó con 12 archivos y costó entender el mensaje,
que apunta a la parte equivocada del problema.

---

## Seguridad — invariantes con test

Este proyecto arrastraba políticas `USING (true)` de cuando era una app de un
solo negocio. Con la clave anónima (que va en el bundle) se leían los tokens de
MercadoPago y las contraseñas SMTP de **todas** las organizaciones. Está cerrado
(`20260731000001_rls_hardening.sql`) y hay guardas para que no vuelva:

- **`publicSurface.test.ts`** — falla si una página pública lee una tabla cruda o
  pide una columna de credencial, costo o margen. Cubre `src/pages/Public*` y
  todo `src/storefront/`.
- **`edgeFunctionAuth.test.ts`** — falla si una función que usa una API paga no
  exige usuario real. `verify_jwt` **no es una barrera**: la anon key es un JWT
  válido y público. Usar `_shared/requireUser.ts`.
- **`audit_policies_sin_tenant`** (vista SQL) — políticas de **lectura** sobre
  tablas con `org_id` que no acotan a nadie: ni al comercio (`org_id`,
  `is_org_member`, `has_org_role`), ni al staff, ni a la persona (`user_id`,
  `store_customer_id`, `auth.uid()`). Tiene que estar **vacía** (medido 0 el
  2026-08-26).

  ⚠️ Existe porque `rls_audit_open_policies` **no alcanzaba**: sólo detecta un
  `USING` literalmente `true`. Había cinco policies escritas como
  `active = true` sobre tablas con `org_id` —`brand_knowledge`,
  `exchange_configs`, `marketing_post_types`, `marketing_themes`,
  `story_templates`— que pasaban ese filtro y dejaban que cualquier usuario
  logueado leyera las filas de cualquier comercio. En `brand_knowledge` ya
  estaba conectado a la app: `marketingExtraDB.ts` inserta con `org_id`.

  Se cerró en `20260826000150` con
  `active = true AND (org_id IS NULL OR is_org_member(org_id, auth.uid()))`:
  el catálogo global se sigue leyendo entre todos, lo del comercio no.

  📌 **Una tabla con `org_id` cuya policy de lectura no nombra al tenant es un
  bug aunque hoy no tenga filas por comercio.** Se activa con el primer uso.

- **`rls_audit_open_policies`** (vista SQL) — lista políticas sin filtro de
  tenant. Debería tener **exactamente 3** (medido 2026-08-21), y las tres son
  catálogos públicos a propósito: `plans` (pricing), `payment_providers` y
  `payment_provider_fees` — un comercio tiene que poder ver qué proveedores hay
  y cuánto cobran **antes** de conectarse. Cualquier cuarta es un bug.
- **`moduleMap.test.ts`** — el vocabulario de módulos de permisos vive sólo en
  `src/lib/permissionModules.ts`; agregar uno es una edición, no tres.

El staff de plataforma pasa por `MfaGate` sin excepción: es la cuenta más
valiosa del sistema para un atacante.

**Tablas de credenciales: RLS habilitada y CERO policies, a propósito.**
`payment_connections`, `meli_connections` y `afip_padron_cache` sólo las tocan
las Edge Functions con `service_role`. La UI lee vistas `*_status` que exponen
si está conectado y con qué cuenta, nunca el token. Esas vistas van **sin**
`security_invoker`: con él corren con permisos de quien consulta, y como la
tabla de abajo no tiene policies devolvían siempre vacío — el panel decía "sin
conectar" con la cuenta vinculada. El control lo hace la cláusula `WHERE
is_org_member(...)` de la propia vista.

**Los compradores de una tienda no son usuarios del SaaS.** El trigger
`handle_new_user_create_org` le crea a cada alta una organización, rol `owner` y
un trial de 14 días. Los registros de tienda llegan marcados con
`account_type = 'store_customer'` en el metadata y el trigger los saltea. Sin
eso, cada cliente que compraba un perfume se volvía dueño de una organización y
ensuciaba las métricas.

---

## Credenciales: ninguna pasa por el navegador

El patrón ya está aplicado a las cuatro que había, y `noPastedCredentials.test.ts`
falla si alguna vuelve a aparecer en una pantalla.

**Lo que tiene OAuth, se conecta por OAuth.** MercadoPago (`mp-connect`),
MercadoLibre (`meli-oauth`) y Tiendanube lo tenían desde antes, pero
Integraciones seguía ofreciendo **en paralelo** un campo para pegar el token a
mano. Dos caminos para lo mismo, y el peor de los dos: un token pegado queda en
`settings`, que la UI lee, mientras que el de OAuth vive en tablas con RLS y
cero policies. Además MercadoPago **rechaza el `marketplace_fee`** con un token
pegado a mano, así que esa vía ni siquiera podía cobrar comisión.

**La API pública tampoco.** Hasta el 2026-08-24 la key vivía en texto plano en
`settings.api_key` —tabla que **todo miembro lee por RLS**— y se generaba en el
navegador. Convivía con otros dos sistemas que no autenticaban nada, uno de
ellos guardando `btoa(key)` como "hash": base64 es **reversible con `atob()`**.
Ahora la key la emite `api_key_emitir` en el servidor, se muestra **una sola
vez**, en la base queda sólo su SHA-256, y cada key lleva **scopes** — siete
reales, no catorce fantasma que ningún endpoint chequeaba. `cost_usd` sólo sale
con `costs:read`. La guarda es `apiPublicaEndurecida.test.ts`.

⚠️ **Un fallo de validación no puede trabar una clave de idempotencia.** Se
encontró verificando en vivo: el 404 de "producto inexistente" corría después de
reservar, y dejaba la clave `en_curso` 24 h para una request que nunca escribió.
Toda validación va **antes** de reservar.

**Lo que no tiene OAuth, no es que falte hacerlo.** Correo Argentino y Andreani
usan usuario y clave de contrato; AFIP usa un certificado X.509; Evolution API
una clave de instancia propia. Para AFIP lo más parecido al modelo marketplace
es que cada comercio delegue el servicio WSFE al CUIT de la plataforma desde
"Administrador de Relaciones" — ahí no sube ninguna clave.

**Para las que no la tienen, el secreto entra por Edge Function y nunca vuelve.**
`afip_credentials` es el ejemplo: RLS habilitada, cero policies, y la UI lee
`afip_connection_status`. Probado con el rol `authenticated` y el JWT del dueño:
la tabla devuelve **0 filas**.

⚠️ **RLS es por fila, no por columna.** `settings` tiene una policy `SELECT`
para todos los miembros de la organización, así que **cualquier secreto que se
guarde ahí lo puede leer cualquier empleado**. Ahí estaba la clave privada de
AFIP. Antes de agregar una columna a `settings`, preguntarse si es un secreto.

---

## Cron: sin dos secretos en el vault, fallan los 13 en silencio

Los cron jobs llaman Edge Functions vía `public.invoke_edge_function(nombre)`,
que lee `SUPABASE_URL` y `SUPABASE_ANON_KEY` del **vault de Supabase**. Si
faltan, **todos** fallan sin avisar: no corren alertas de stock, avisos de deuda,
reactivación, KPI diario, digest semanal, automatizaciones, campañas ni los
emails de las secuencias. Así estuvo hasta el 2026-07-29.

Ante cualquier "no me llegan las alertas / los emails", mirar **primero**
`cron.job_run_details` y el vault, no el código de la función:

```sql
SELECT j.jobname, d.status, d.end_time
FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
ORDER BY d.end_time DESC LIMIT 20;
```

Detalle en [docs/CRON.md](docs/CRON.md).
⚠️ **Y que un cron diga `succeeded` no significa que la función corrió.**
`invoke_edge_function` termina en `net.http_post`, que es **asíncrono**: el job
termina en 0,2 s sin esperar la respuesta. El 2026-08-26 los 20 jobs estaban en
verde con 0 fallas en 7 días mientras **4 respuestas daban error y 1 timeout
sobre 42** en la ventana de pg_net. El resultado real vive en
`platform_edge_invocation_health` y `edge_invocation_log`; el P95 de ahí mide
encolado → respuesta, **no** ejecución de la función. Detalle en
[docs/CRON.md](docs/CRON.md).

---

## Verificación: probar contra producción y limpiar

No hay entorno de staging. Lo que se hizo en estas sesiones y funciona: un
bloque `DO $$ ... $$` que inserta datos de prueba con prefijo `ZZ`, ejecuta el
camino real (RPC incluido), guarda los resultados en una tabla temporal, y
**borra todo antes de terminar**. La última fila del `SELECT` cuenta los restos,
que tienen que dar `0`.

Así aparecieron bugs que ningún test unitario iba a encontrar: un `CHECK` que
no contemplaba el canal `tienda_online` y hacía fallar toda venta online, y un
descuento de stock duplicado porque `trg_sale_stock_movement` ya lo hacía.
**Antes de descontar stock o tocar totales, revisar si hay un trigger que ya lo
haga.**

---

## Scripts

```bash
npm run deploy:functions        # todas las edge functions (65 al 2026-08-25)
npm run deploy:functions:sh     # lo mismo por Git Bash
npm run db -- --file x.sql      # SQL contra la base (necesita SUPABASE_DB_URL)
```

`deploy-functions` deriva la lista del filesystem: una función nueva no puede
quedar sin deployar. Va sin JWT **sólo** lo que esté en la allowlist explícita
del script. Si falla con `Import ... 521`, es esm.sh caído — reintentar.

---

## Estado y pendientes

El detalle vive en los mensajes de commit, que son largos a propósito. Para el
estado al día, `git log --oneline -20`.

⚠️ **Antes de elegir qué construir, leer `ROADMAP.md` §5 "El camino".** Los
bloques A–G son un **catálogo agrupado por tema**, no un plan, y agrupar por
tema hace que todo parezca igual de urgente. El plan son las cinco fases, cada
una con una condición de salida verificable, más la lista de lo **congelado** y
lo **bloqueado por fuera del código**.

La regla que ordena todo: **cada fase existe para destrabar la siguiente.** Hoy
la fase 0 es "que se le pueda vender a alguien" y está frenada por el
certificado de homologación de AFIP, que es un trámite gratis. Elegir un ítem
del bloque B porque parece divertido es exactamente lo que este orden viene a
evitar.

El análisis del 2026-08-14 traduce el norte en una regla práctica: los próximos
90 días tienen que producir **producto confiable y vendible**, no más amplitud.
Prioridad: AFIP real, base legal publicada, onboarding medible, MercadoLibre
completo, POS/panel con E2E, checkout sin fricción cuando haya tráfico para
medirlo, offline POS robusto, backups con restore probado, observabilidad de
webhooks/crons/pagos y métricas de plataforma (`G1–G8`).

⚠️ **Al cruzar los bloques aparecieron cuatro pares que eran el mismo trabajo
con dos letras** (C1/F15, D1/F16, D5/F17, D6/F8). Antes de agregar un ítem
nuevo, buscar si ya está con otro nombre.

Pendientes conocidos al 2026-07-31:

**Lo que espera al dueño, no al código:**

- **Cargar las tarifas de envío.** Hay 6 zonas activas y tarifas en **una
  sola**: CABA — verificado contra la base: 1 provincia de 24 tiene tarifa. El
  retiro en local **sí** está habilitado, así que lo que ve un comprador de las
  otras 23 no es "No hay envío disponible" sino una única opción: ir a
  buscarlo a CABA. Es peor de lo que suena, porque parece que el checkout
  funciona.

  Desde la sesión 93 hay un botón **"Completar el tarifario"** en Envíos →
  Zonas que estima las 6 zonas por distancia a partir de una tarifa de
  referencia, con vista previa de lo que va a crear y sin pisar lo ya cargado.
  Un precio aproximado vende; ninguna opción de envío no vende nunca. Lo que
  sigue esperando al dueño es **revisar esos números** contra la tarifa real
  del correo.
- **Cargar el peso de los productos.** 59 de 60 activos lo tienen en cero, así
  que `quote_store_shipping` cotiza con `default_item_weight_kg` (0,5 kg) y
  `prepare_order_shipment` declara ese mismo 0,5 en la etiqueta.

  ⚠️ **El error va en la dirección contraria a la intuitiva**, y esto se
  verificó midiendo: los 55 perfumes estiman **0,40 kg** y ninguno pasa de 0,5,
  así que la tienda cotiza **de más**, no de menos. No cuesta margen: cuesta
  ventas, porque el envío caro es de las primeras razones por las que se
  abandona un carrito. En el catálogo de hoy el efecto sobre el precio queda
  además tapado por el envío gratis desde $150.000, que se alcanza a las 3
  unidades — empieza a verse cuando haya tarifas con kg extra en el resto de
  las zonas.

  Desde la sesión 93 el botón **"Completar pesos"** en Productos los estima a
  partir del contenido en ml (los 60 lo tienen cargado) con vista previa y sin
  pisar lo cargado a mano. Sigue faltando **pesar una caja real** y corregir:
  el modelo es una estimación, no una balanza.
- **Diez productos publicados sin foto** y 33 con descripción de menos de 80
  caracteres. Están en el ranking de Productos → Calidad de las publicaciones,
  que ordena por impacto y no por cantidad.
- ~~Un certificado de AFIP de homologación~~ **hecho (sesión 114).** Cargado y
  verificado de punta a punta: CAE 86330773876924, Factura C 00000002 emitida
  desde el panel. Lo que sigue esperando al dueño es el certificado de
  **producción** y el alta del punto de venta como *Web Services*, que en
  homologación no hace falta.

- ~~Certificado de homologación~~ para verificar el ciclo de
  facturación. Es gratis y no emite comprobantes reales.
- **Contrato con Correo Argentino o Andreani** para la etiqueta por API.
- ⚠️ **Hay que contar el inventario físico y corregir el stock.** Durante meses
  cada venta descontó el doble y cada compra sumó el doble (arreglado en la
  sesión 91). Los números se venían corrigiendo a mano desde la pantalla, que no
  deja asiento, así que **el stock de la base no es confiable hoy**. Se ve
  comparando el Kardex contra el stock actual: 15 productos no coinciden y
  varios tienen el Kardex en negativo con el stock real positivo.

  ```sql
  SELECT p.name, u.stock_after AS kardex, p.stock, p.stock - u.stock_after AS dif
  FROM (SELECT DISTINCT ON (product_id) product_id, stock_after
          FROM public.stock_movements WHERE product_id IS NOT NULL
         ORDER BY product_id, created_at DESC, id DESC) u
  JOIN public.products p ON p.id = u.product_id
  WHERE p.stock <> u.stock_after ORDER BY abs(p.stock - u.stock_after) DESC;
  ```

  No se corrigió por código a propósito: reconstruirlo exige saber qué ventas
  pasaron por el camino duplicado y cuáles no (las de la tienda online van por
  `mark_store_order_paid`, que nunca duplicó). Se corrige contando.
  Incluye a **"AFNAN 9AM DIVE"**, que quedó en 7 tras una verificación del aviso
  de reposición y ese número tampoco es real.
- Hay un producto **"ZZ NO COMPRAR - Prueba de pago"** publicado en la tienda,
  con stock 1. Se creó para verificar el cobro real; borrarlo cuando no haga
  falta más.

**Lo que espera trabajo:**

- ~~La migración destructiva~~ **aplicada** (2026-08-02): 57 tablas huérfanas, 0 filas entre
  todas. Verificado al traerla: 269 archivos, 270 registradas.
- ~~El libro de migraciones desfasado~~ **resuelto**. Se mantiene así anotando
  cada migración al aplicarla — es lo único que frena que la brecha vuelva.
- Las APIs de Correo Argentino y Andreani siguen **sin verificar contra un
  contrato real**: los payloads siguen la documentación publicada.
- **AFIP: falta probarlo contra el organismo.** La estructura está y las
  credenciales ya no se pueden leer desde el cliente (`afip_credentials`, RLS
  con cero policies), y **ya emitió**: CAE 86330773876924 en homologación.
  Falta producción.
- **Etiqueta de envío: la imprimible ya está**, con seguimiento que el comprador
  ve con número de orden + email, sin cuenta. Lo que falta es pedirle la
  etiqueta por API al correo, y eso necesita contrato.
- MercadoLibre: falta el botón de publicar en la ficha, importar órdenes como
  ventas y el cron multi-organización (ver `docs/MERCADOLIBRE.md`).

**Regenerar los tipos después de cada migración**, o el typecheck reporta
errores fantasma en archivos que no se tocaron:

```bash
npx supabase gen types typescript --project-id hummeopatkniwkyrrhwc > src/integrations/supabase/types.ts
```

### Secretos sin los cuales hay features muertas

Ver [docs/CONFIGURACION.md](docs/CONFIGURACION.md). Los dos que más duelen:
`ANTHROPIC_API_KEY` (toda la IA responde error) y `RESEND_API_KEY` (los crons de
email corren, encuentran los destinatarios y no pueden enviar).

### Brechas contra Tiendanube / Empretienda

Lo que la tienda todavía no tiene, en orden de impacto:

1. **Revisar las tarifas de envío.** Hay 6 zonas y tarifas en una sola: 1
   provincia de 24, verificado. Con el retiro en local habilitado, las otras 23
   ven **una** opción —ir a buscarlo a CABA—, que parece un checkout que
   funciona. `Completar el tarifario` las genera estimadas por distancia;
   falta contrastarlas con la tarifa real del correo.
2. **AFIP probado contra el organismo.** La estructura está y las credenciales
   ya no se pueden leer desde el cliente, y el circuito **ya emitió** en
   homologación. Falta el certificado de producción y
   factura emitida.
3. **Etiqueta por API del correo.** La imprimible ya funciona; la de Correo
   Argentino y Andreani necesita un contrato para poder verificar el payload.

**El circuito de plata ya corrió entero.** Dos compras reales de $1 acreditadas,
con el `application_fee` de $0,05 derivado a la plataforma. Llegar hasta ahí
destapó cuatro bugs que ninguna lectura del código encontró — están en
`ROADMAP.md` §11, sesión 90. El más caro: **la firma del webhook de MercadoPago
nunca validaba**, así que toda compra quedaba pagada del lado de MercadoPago e
impaga del lado de la tienda, en silencio.

El despacho ya está: preparar el envío desde la orden, etiqueta imprimible, y
seguimiento que el comprador ve con número de orden + email, sin cuenta.

El CRM por `customer_id` tampoco es ya una brecha: `CustomersPage` lee por id
desde el commit 2a7d5c7. El cruce vive en `customerMatch.ts` (puro, `npm test -- customerMatch`) y
su `normalizeName` es espejo de `public.normalize_person_name` — si se toca una,
se toca la otra. Una fila **enlazada** se cruza sólo por id; una sin enlazar,
por nombre normalizado, porque no hay trigger que enlace lo viejo cuando se da
de alta un cliente nuevo y leer sólo por id le mostraría la ficha vacía.

**Ya no queda nada del CRM cruzando por nombre.** `quotes` y
`customer_communications` recibieron la columna en `20260802000001`, y `deals`
en `20260826000210`: `trg_sales_link_customer` sirve hoy a **seis** tablas
—`sales`, `quotes`, `debts`, `loyalty_points`, `customer_communications` y
`deals`—.

⚠️ Esta línea decía "cinco" y **estaba incompleta**: `deals` tenía
`customer_name text` sin columna ni trigger, y quedó afuera de aquella pasada
sin que nada avisara. Se encontró midiendo `pg_trigger` contra la afirmación,
no leyéndola. Al agregar una tabla al CRM hay que contar los triggers, no
confiar en el número escrito acá. Verificado forzando el caso: con el mismo cliente
escrito de tres formas, la lectura vieja mostraba **1 de 3** presupuestos y 1 de
3 comunicaciones.

Del lado del cliente el cruce va por `crmRowsForCustomer`, que hace **dos
consultas en vez de un `.or()`**: el `or` de PostgREST se arma concatenando en
una sola cadena, así que un nombre con coma o paréntesis —"Pérez, Juan", "Ana
(mayorista)"— rompe el filtro o lo convierte calladamente en otro.

**Las notas del cliente viven en `customers.notes`**, no en `customer_notes`.
Esa tabla es heredada y está vacía: los dos caminos de nota escribían ahí con
una constraint que no existe (`42P10`) y sin mirar `.error`, así que la UI decía
"Nota guardada" con cero filas guardadas. Se escribe con `appendCustomerNote`,
que lanza si falla.

`marketplace_fee` **cobra de verdad**, confirmado contra MercadoPago: se aplica
en `store-pay` desde el commit 85fa7b1, con `platform_commission_amount()` como
única fuente del número para que el checkout cobre exactamente lo que la
liquidación registra. Sólo se
aplica con credenciales OAuth — con un token pegado a mano MercadoPago rechaza
la preferencia.

✅ **Ya cobró.** Dos compras reales de $1, `approved`/`accredited`, con la
comisión de plataforma descontada — MercadoPago informa `application_fee: 0.05`
en las dos, con la regla que estaba vigente entonces. ⚠️ **Al 2026-08-25 la regla es de 0,5% y está INACTIVA** (`is_active = false`, `approval_status = 'draft'`), así que hoy no se cobra comisión: la nota anterior de este archivo —que decía 5%— quedó vieja el 22 de agosto. Si se reactiva:
la comisión se va a la cuenta de MercadoPago dueña de la aplicación
(`MP_APP_ID`). Conviene confirmar cuál es antes de escalar.

Cómo se derivó la comisión, porque no es obvio: MercadoPago **no necesita que le
digas la cuenta**. La deduce de quién emitió el token. El comercio autoriza la
app de la plataforma por OAuth, MP devuelve un token del vendedor emitido por
esa app, y al acreditar el pago el neto va al vendedor y el `marketplace_fee` al
dueño de la aplicación. Por eso con un token pegado a mano MP rechaza la
preferencia: no existe la relación marketplace.

**Lo que la tienda ganó en las sesiones 93–97**, y las decisiones que hay que
respetar al tocarlo:

- **Preguntas sobre el producto** (`product_questions`). Sólo se publican las
  **respondidas**: una tira de preguntas sin contestar dice que acá no atiende
  nadie. Preguntar pide cuenta pero **no** compra —esa es toda la diferencia con
  las reseñas, el que pregunta todavía no compró— con tope de 5 pendientes por
  persona.
- **Promo "llevando 2"** (`store_promo_2x_discount`). El ahorro se cuenta **por
  producto cruzando líneas**, no por línea: los productos con promo son vapers
  con 9 y 10 sabores, así que la compra real son dos líneas de una unidad y una
  regla por línea no dispararía nunca. Va como descuento y no bajando el
  subtotal —que tiene que seguir siendo la suma de los ítems— pero se resta
  **antes** del cupón: la promo es un precio, no una rebaja.
- **Categorías propias** (`ecommerce_categories`, `get_store_categories`). El
  nombre dejó de estar hardcodeado. `products.category` **sigue guardando el
  slug** y sigue siendo lo que usan el POS, los precios por categoría y las
  ofertas masivas: esta tabla le agrega nombre, orden y presentación a ese slug,
  no lo reemplaza. Renombrar no toca el slug.
- **Subcategorías** (`parent_id`). Lo que las hace servir es que **entrar al
  padre trae los productos de las hijas** (`slugsDeRama`): sin eso, tocar el
  padre da una página vacía. El menú lleva **sólo primer nivel**, contando la
  rama entera para que un padre sin productos propios entre igual.
- **Menú configurable** (`ecommerce_stores.nav_links`). **Vacío significa
  "armalo solo"**, no "menú vacío", y si todos los links quedaron rotos se
  vuelve al automático: el header no puede quedarse sin forma de llegar al
  catálogo. Sólo http(s) —un `javascript:` ahí es un XSS servido— validado al
  guardar **y** al mostrar.
- **Calidad de la publicación** y **Completar pesos** en Productos, y
  **Completar el tarifario** en Envíos. Los tres siguen el mismo patrón: el
  panel señala el problema, un botón lo arregla en masa con **vista previa**, y
  nunca pisa lo cargado a mano.
- **Cross-selling en el carrito** (`crossSell.ts`). Primero lo que **completa el
  envío gratis**, con tope de 1,6× lo que falta: un producto que pasa el umbral
  por cinco veces no completa nada.
- **Promociones en la tienda** (`store_promo_price`, espejo de `bestPromoPrice`).
  La promoción se resuelve **dentro del precio de la línea**, no como descuento
  aparte: una promoción es un precio, así que el volumen, el cupón y el medio de
  pago trabajan después sobre el número correcto. Quedan afuera las que tienen
  `coupon_code` (van por cupones), `buy_x_get_y`/`bundle`/`free_shipping`
  (necesitan lógica de carrito) y `applies_to = customers` (es de orden).

  ⚠️ **Van tres mecánicas de precio que una superficie ignoraba en silencio**
  —`price_2x_ars`, las categorías y las promociones—. Al agregar una nueva hay
  que revisar **las cuatro**: POS, catálogo interno, catálogo público y tienda
  online.
- **Descuento por cantidad** (`quantity_discounts`, `store_volume_discount`).
  "Llevando 3 o más, 15% off", con alcance todos/categoría/producto. **Por
  producto gana el mejor entre el 2x fijo y la mejor regla, nunca la suma**, y
  entre varias reglas gana la de mayor descuento. La cantidad se cuenta
  cruzando líneas. El carrito lo espeja con `get_store_quantity_discounts`:
  sin ese RPC el cliente mostraría menos de lo que se cobra.
- ⚠️ **La oferta y el descuento por medio de pago NO se acumulan: se cobra el
  mejor, nunca la suma** (`precioConMedioDePago`, espejo de
  `20260806000001_descuento_no_acumula.sql`). Se aplicaban uno sobre otro, así
  que un producto con 20% off pagado por transferencia con 20% terminaba con
  **36% de descuento real** y el precio tachado no correspondía a ningún
  porcentaje redondo. El descuento del medio se mide contra el precio de
  **lista**, por línea: si la oferta ya deja el precio por debajo, no descuenta
  nada más; si el medio es mejor que la oferta, gana el medio —publicar "20% OFF
  con transferencia" y cobrar el 10% de la oferta sería romper la promesa—. Para
  poder compararlo, la línea de `resolve_store_line` lleva `list_price`.

  ⚠️ **Pero "oferta" significa dos cosas distintas y el código no puede
  adivinar cuál.** Un 20% off puede ser "éste es el precio con transferencia"
  o una liquidación real sobre la que el 20% todavía corresponde. Lo decide el
  comercio: `ecommerce_stores.payment_discount_stacks` es la política y
  `products.offer_stacks_payment` la pisa por producto (NULL = usa la
  política). El default es **false** porque equivocarse hacia "no acumula"
  cobra de más y el comprador se queja, mientras que equivocarse hacia
  "acumula" regala margen en silencio. La vista `store_catalog_products`
  resuelve las dos en `payment_base_price` para que la tienda muestre el precio
  sin conocer la política ni cruzar dos tablas.
- **Negocio por comercio** en `/platform/negocio` (`platform_org_health`).
  Ordena por urgencia, no por facturación, y el KPI es el **GMV en riesgo**
  medido con el mes **anterior**: el que está en riesgo hoy factura cero.

**El dinero se redondea en un solo lugar** (`redondear_moneda` en SQL,
`rounding.ts` en el cliente). No hay más `round(x, 2)` sueltos para importes
nuevos: los decimales los define la moneda. Y el redondeo es media unidad
hacia arriba **en valor absoluto** — `Math.round(-0.5)` da `-0`, así que un
reintegro se redondeaba para el lado equivocado.

Cuando un total se reparte entre líneas, va por `prorratear()`: garantiza que
las partes sumen exactamente el total, con el resto a la última. Tres partes
iguales de $100 dejan un centavo colgado, y ese centavo es la diferencia entre
que una factura cierre y que no.

**El IVA es por producto** (`products.tax_rate`). **NULL significa "la de la
organización", no cero** — cero es exento, una tasa válida y distinta. Eso
también decide cómo se guarda desde la UI: `parseFloat('') || null` convertiría
un 0 legítimo en NULL y el exento pasaría a gravado.

⚠️ **Lo que se aprendió verificando, y cuesta caro repetir:**

- **Un bloque `DO $` corre como superusuario y bypassa la RLS.** Un test de
  permisos ahí da falsos positivos de agujero. Va con `SET ROLE anon` /
  `authenticated` de verdad.
- **Un subquery que le pasa un argumento a un RPC `SECURITY DEFINER` corre en el
  contexto del llamador.** `get_store_categories((SELECT slug FROM
  ecommerce_stores ...))` como anon recibe NULL, porque anon no lee esa tabla.
- **Para tocar una función grande, regenerarla desde `pg_get_functiondef` con un
  script**, insertando los cambios. Reescribir `create_store_order` (186 líneas)
  o `get_store_by_slug` de memoria es como casi se rompe `mark_store_order_paid`.
- **`{(a?.length || b?.length) && …}` con las dos vacías evalúa a `0`, y React
  imprime el cero.** Había un 0 suelto en la ficha de casi todos los productos.
- **Antes de dropear un RPC público, comprobar con grep quién lo llama** en
  `src`, `api` y las edge functions. Agregar una columna al **final** de la
  firma no rompe a quien lee por nombre de campo.
- **Antes de construir algo del ROADMAP, medirlo contra la base.** A10
  ("historial de precios") figuraba como faltante y estaba entero: 656 filas,
  627 con autor, trigger y gráfico en pantalla. Empezar por el código lo habría
  construido dos veces.
- **`LIKE '%_iva%'` matchea "inactiva".** El `_` es comodín de un carácter. Para
  buscar un nombre de columna que empieza con guión bajo hay que escaparlo.
- **Verificar en los dos sentidos.** Una búsqueda difusa que "encuentra" no
  sirve si encuentra todo: se prueba que traiga *y* que no traiga de más. Lo
  mismo para un permiso: que deje pasar a quien corresponde y frene al resto.

Ya resueltas (sesiones 87–91): reseñas de compra verificada, páginas de
contenido, banners con vigencia, filtro por rango de precio, lista de deseos,
aviso de reposición, CRM por `customer_id` **completo** (las cinco tablas),
despacho con etiqueta y seguimiento, la limpieza de credenciales, y las notas
de cliente, que decían guardarse y no guardaban nada.

---

## Lenguaje visual y rediseno (2026-08-14)

La UI de Gestiona toma de los kits de ecommerce la jerarquia, la densidad de informacion y la claridad de las acciones, pero no copia pantallas ni assets. El producto tiene que verse como un sistema operativo omnicanal, no como un template de tienda.

- La superficie de organizacion usa un workspace neutral con acciones en ambar; la superficie de plataforma conserva violeta para que nadie confunda tenant con staff.
- El modo claro es el punto de entrada para leer tablas, metricas y estados. El modo oscuro sigue siendo una opcion completa.
- Cada pantalla debe tener orientacion visible, busqueda global accesible y una accion primaria clara. El topbar de la organizacion es parte del sistema.
- Las tarjetas son herramientas de lectura o accion, con radio maximo de 8px, jerarquia de borde y sombra discreta. No se anidan tarjetas dentro de tarjetas.
- Los numeros se alinean y se comparan con periodo, canal, sucursal y variacion. Un KPI sin fecha o fuente no se presenta como verdad.
- El dashboard abre con cuatro metricas de Business Core y deja el resto en una segunda capa visual. Las tarjetas metricas viven en componentes reutilizables para que Ventas, Stock, Finanzas y Plataforma no inventen estilos paralelos.
- Mobile no es una version comprimida: tablas tienen scroll explicito, acciones llegan a 40px y la navegacion conserva Resumen, POS, Ventas, Productos y Clientes.
- Los kits de Figma son referencias de criterio. La implementacion vive en los componentes y tokens del repo para que todas las superficies evolucionen juntas.
- El shell de organizacion debe priorizar lectura y accion: sidebar silencioso, breadcrumb visible, busqueda global, estado operativo y una accion primaria. Las tarjetas metricas no son decoracion: deben tener una sola lectura y una fuente temporal clara.
- `PageHeader`, `MetricCard` y `KPICard` son la base compartida. Antes de crear una tarjeta, toolbar o encabezado nuevo, buscar si el componente existente puede resolverlo. Las tablas de Productos, Ventas y Plataforma deben conservar scroll horizontal en mobile y estados legibles sin depender del modo oscuro.
- Las referencias de ecommerce/admin se usan para jerarquia, densidad, filtros, tablas y composicion. No se copian assets ni pantallas: el contenido, los estados y el lenguaje tienen que responder al Business Core de Gestiona.
- Las paginas con muchas vistas internas deben usar un rail lateral sticky en desktop y tabs horizontales con scroll en mobile. La navegacion muestra solo el contexto necesario y deja el contenido activo en una sola columna.
- Reportes y Analytics pueden tener muchas lecturas, pero su selector no debe convertirse en una tira interminable: agrupar visualmente por superficie y mantener la vista activa legible.
- El Dashboard se recorre por seis destinos estables: Resumen, Ventas y metas, Clientes, Inventario, Finanzas e Inteligencia. Los anclajes son orientacion, no una segunda fuente de datos; si una seccion crece, se agrega al destino correcto antes de sumar otro bloque al flujo principal.
- En mobile, cualquier navegacion interna del Dashboard debe conservar scroll horizontal controlado, objetivos tactiles estables y el destino activo visible. No convertir la barra en un menu que tape el primer dato de la seccion.
- Ajustes usa un indice lateral de anclas para formularios independientes. No esconder un formulario con estado sin una razon clara ni duplicar su fuente.
- Ajustes ahora se organiza en tabs de dominio: Marca, Finanzas, Mensajeria, Precios, Suscripcion y Sistema. Cambiar de tab es una decision de lectura; los formularios pueden permanecer montados para conservar entradas, pero solo el dominio activo debe ocupar la superficie visible.
- Plataforma tiene chrome propio violeta y sidebar de control del SaaS; Administracion opera una organizacion y puede compartir el primitive de tabs, nunca permisos ni fuentes. Los KPIs globales de plataforma pertenecen a Resumen, no a cada pantalla operativa.
- El onboarding del Dashboard se calcula con señales reales de la organizacion. `SetupChecklist` debe conservar el contexto por `organizationId`, priorizar un siguiente paso accionable y mantener el detalle expandible; no agregar datos de demostracion ni tratar un estado de carga como tarea pendiente.
- Las preferencias de lectura que deben sobrevivir al cambio de modulo usan `usePersistedState` y `orgViewKey`: tabs, rail activo, filtros y periodos. La clave incluye la organizacion cuando la superficie es tenant. La URL manda para rutas compartibles; `localStorage` no guarda secretos, precios, stock, formularios de cobro ni resultados de negocio.
- La instrumentacion de plataforma se construye desde fuentes reales y protegidas. `platform_org_health` es la fuente para activacion, GMV y salud por organizacion; `platform_org_activation` es la fuente para publicacion y adopcion por canal; `src/lib/platformMetrics.ts` concentra los calculos puros y la pantalla `/platform/metricas` debe declarar que mide y que todavia no mide. `ecommerce_stores.published_at` solo se completa al publicar mediante el trigger de la migracion; una fecha historica NULL queda fuera de promedios. El POS debe persistir `sales.source = 'pos'` y la venta online se reconoce solo con una orden confirmada. Nunca presentar una aproximacion como adopcion omnicanal, publicacion de tienda o AI Action Rate sin un evento o vista que lo respalde.
- `platform_org_stock_accuracy` es la fuente protegida de G7. Compara el ultimo `stock_movements.stock_after` con el stock actual, valida cada variante contra su propio Kardex y contra el total del producto padre, cuenta negativos y expone por separado los productos sin movimiento. `precision_pct` se calcula solo sobre productos medidos: un producto sin evidencia no es una coincidencia. La vista exige `is_platform_admin(auth.uid())`; no reemplazarla por lecturas crudas con RLS de organizacion.
- La Toma Fisica es una operacion auditada, no un formulario de edicion. La UI debe llamar `abrir_conteo`, registrar cada producto con `registrar_conteo` y cerrar con `cerrar_conteo`; el cierre es quien llama `record_stock_movement`. Si falla una sesion parcial, se cancela el conteo abierto y se informa el error. Ningun componente puede actualizar `products.stock`, `product_variants.stock` o `location_stock` directamente.
- El esquema vigente de listas de precios es unico: las listas usan `discount_type`/`discount_value` e `is_active`, los overrides de producto usan `custom_price`/`discount_pct` y los tramos usan `min_quantity`. No volver a leer ni escribir `discount_pct` global, `price_ars` o `min_qty`; regenerar tipos y comprobar el flujo desde Settings, ficha de producto y POS juntos.
- Una navegacion interna es visual: no duplica consultas ni crea rutas nuevas si el problema es de orientacion dentro de la misma pagina.
- La tienda publica es una superficie propia, no una variante del panel: `StoreLayout` gobierna header, legal, footer y carrito; `StoreHome`, `StoreProducts` y `ProductCard` gobiernan la experiencia de compra. El panel administra la tienda, pero no debe imponerle su chrome.
- El storefront usa las variables `--st-*` y los temas de `src/storefront/theme.ts`. Un cambio visual no debe hardcodear una paleta que rompa `minimal`, `bold`, `luxury`, `sport`, `natural`, `noche` o `pastel`.
- La home publica debe llevar al producto real rapido: hero con identidad del comercio, prueba de confianza, categorias y productos destacados. No se agregan metricas, banners ni testimonios ficticios para llenar espacio.
- Las cards de producto son unidades repetibles: imagen, marca, nombre, precio, descuento, stock y accion. No se agrega informacion operativa del tenant como costo, margen, proveedor o credenciales.
- En mobile, el catalogo conserva busqueda, filtros, orden, carrito y acciones de producto; el filtro puede colapsar, pero nunca debe desaparecer sin una accion visible para recuperarlo. Las grillas deben mantener dimensiones estables y no producir saltos por nombres largos.
- La verificacion visual publica se hace contra el catalogo real despues del deploy. Sin `.env`, el panel autenticado solo se puede validar por compilacion, tests y pantalla de login; no se afirma que sus datos fueron inspeccionados en navegador.
- El POS es una herramienta de mostrador, no una pantalla administrativa comun: la busqueda debe tener foco y atajo, las categorias deben poder recorrerse horizontalmente, la grilla debe permitir escaneo rapido y el carrito debe mantener visible el total y la confirmacion.
- El rediseño del POS no puede esconder estados de negocio: stock, variantes, descuentos, deuda, cobro dividido, turno, offline y sincronizacion deben seguir siendo legibles. Una mejora estetica no justifica quitar una salvaguarda de venta.
- La superficie de checkout puede tener densidad propia, pero conserva botones con objetivos tactiles estables, scroll independiente para productos y carrito, y un carrito movil recuperable sin perder el contexto de la venta.
- El POS puede alternar su tema claro/oscuro local, pero sus tokens visuales y estados deben mantener contraste en ambos modos. Las clases `pos-*` viven en la capa visual y no reemplazan los estados ni la logica del componente.
- Clientes/CRM debe leerse como una ficha 360, no como una tabla plana: la lista hace visibles segmento, salud, deuda, valor y ultima actividad sin obligar a abrir cada registro.
- La ficha 360 se expande en contexto y mantiene sus acciones cerca del cliente. El detalle puede usar una segunda superficie visual, pero no se anidan tarjetas dentro de tarjetas ni se pierde la posicion en la lista.
- La busqueda y los filtros de CRM forman una toolbar estable; los segmentos guardados se leen como accesos rapidos y la barra de acciones masivas aparece solo cuando hay seleccion. El estado vacio, la carga y el error deben conservar la misma jerarquia.
- Las referencias de Figma para CRM, dashboards y marketplace orientan densidad, filtros, estados y responsive. No se copian assets ni layouts: el contenido debe seguir expresando el Business Core y las acciones reales de Gestiona.
- Ventas debe tener una secuencia de lectura estable: resumen de KPIs, insights de cobro/tendencia, presets de período, filtros y finalmente el detalle. No mezclar la toolbar con tarjetas de métricas ni esconder la acción primaria entre filtros.
- Los insights de Ventas pueden compartir una grilla equilibrada en desktop y pasar a una columna en mobile. Los gráficos compactos tienen que conservar fecha, período y leyenda suficiente para no presentar una barra como dato sin contexto.
- Las vistas agrupadas de Ventas (`lista`, `cliente`, `sesion`, `producto`, `fecha`) son modos de lectura del mismo dato; un cambio visual no puede duplicar consultas ni inventar totales alternativos.
- Las toolbars con muchos filtros deben tener ancho estable, scroll horizontal controlado para presets/vistas y controles táctiles legibles en mobile. El filtro activo debe seguir siendo visible cuando la lista cambia.
- Productos es un workspace de inventario: primero se leen cantidad, inversión, stock bajo, agotados y vencimientos; después se opera sobre cada ficha. Los KPIs no son decoración y cada alerta debe llevar a un filtro o acción existente.
- La tabla de Productos conserva scroll horizontal explícito, encabezado estable y columnas legibles para costo, venta, ganancia, stock, días restantes y movimiento. No ocultar un riesgo operativo para ganar espacio visual.
- La grilla y la tabla son dos vistas del mismo conjunto filtrado. Cambiar de vista no cambia el resultado, el orden, la selección ni las reglas de permisos.
- En mobile, los filtros se desplazan dentro de su propia toolbar y la barra de selección masiva no puede tapar el contenido ni dejar acciones fuera de alcance. Stock inline, umbral, oferta y eliminar mantienen sus salvaguardas actuales.

- El Dashboard debe abrir con `FocoDelDia`, `Business Core` y accesos operativos antes de los widgets secundarios. Si una seccion de analisis crece, se desplaza hacia abajo: no se sacrifica la primera lectura por mostrar todo al mismo nivel.
- El ritmo vertical del Dashboard se gobierna desde `.workspace-dashboard` con `gap`; los widgets no deben acumular `space-y` y margenes propios que generen saltos irregulares. Un nuevo bloque debe funcionar dentro de esa columna sin agregar compensaciones locales.
- `PageHeader` reserva espacio para titulo y descripcion antes de repartir acciones. Las toolbars largas envuelven en desktop y tienen scroll controlado en mobile; nunca deben empujar el titulo fuera de lectura.
- Las acciones visibles usan iconos del sistema (`lucide-react`) y texto corto. No usar emojis como parte del control porque rompen la consistencia entre modo claro, modo oscuro y densidades de pantalla.

El slice de rediseno se verifica con screenshot en desktop y mobile, typecheck, lint, test y build antes de avanzar a otra superficie.

---

## Acceso directo a la base

Es lo que convierte "creo que el esquema es así" en "lo miré". Sin esto se
escriben migraciones a ciegas, que fue lo que costó tres idas y vueltas en la
sesión 89.

Hay dos caminos, y conviene saber cuál está disponible **antes** de planificar:

**1. El runner del repo — el bueno, pero es por máquina.**

```bash
npm run db -- --sql "select count(*) from public.sales"
npm run db -- --file supabase/00_diagnostico.sql
```

Necesita dos variables de usuario: `SUPABASE_DB_URL` (pooler **session**,
`aws-1-us-east-1`, puerto 5432 — la conexión directa `db.<ref>.supabase.co`
**no responde**, es IPv6) y `SUPABASE_CA_CERT` apuntando a `prod-ca-2021.crt`,
que hace que el TLS se verifique de verdad en vez de usar `PGSSL_INSECURE=1`.

**Están puestas en una sola de las dos PCs.** Se trabaja desde dos, así que no
se puede dar por hecho: comprobar antes de contar con esto.

```powershell
[Environment]::GetEnvironmentVariable('SUPABASE_DB_URL','User')
```

Vacío ⇒ esta máquina no lo tiene. Si devuelve algo pero el shell no la ve, la
app arrancó antes de que se definieran, y alcanza con:

```powershell
$env:SUPABASE_DB_URL = [Environment]::GetEnvironmentVariable('SUPABASE_DB_URL','User')
```

Y si el runner falla con `Cannot find package 'pg'`, faltan dependencias:
`npm install`.

**2. El CLI de Supabase — anda en cualquier máquina, sin configurar nada**,
porque el proyecto ya está linkeado. Es lo que se usa para aplicar migraciones
y sirve igual para consultar, sólo que pide un archivo en vez de `--sql`:

```bash
npx supabase db query --linked --file consulta.sql
```

El runner **nunca imprime la credencial** y se niega a correr `DROP TABLE`,
`TRUNCATE`, `DROP COLUMN` o un `DELETE` sin `WHERE` salvo que se le pase
`--allow-destructive`. Para probar algo contra datos reales sin riesgo: envolver
en `BEGIN; ... ROLLBACK;` — así se verificaron los triggers de CRM.

---

## Arrancar una sesión nueva

```bash
git fetch origin && git log --oneline -20
```

Los mensajes de commit son el estado del proyecto. `ROADMAP.md` §5 tiene lo que
falta para la paridad con Tiendanube, en orden de impacto, y §11 el historial
por sesión.

Después: leer "Cómo se trabaja acá" arriba, elegir el primero de la lista de
brechas, y trabajarlo como slice.
