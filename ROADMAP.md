# Gestiona — estado y plan

Este documento dice qué es el producto, qué funciona hoy y qué sigue.
Lo que está acá tiene que ser verificable: nada de porcentajes inventados ni de
mercados a los que no vamos.
---
## 0.1 Lenguaje visual y experiencia

El rediseño visual acompana la tesis del sistema operativo omnicanal: la interfaz debe ayudar a operar, comparar y decidir. Los kits de Figma se usan como referencia de jerarquia y densidad, no como una copia de pantallas.

- La organizacion abre en workspace claro y neutral, con ambar para acciones y violeta reservado al panel de plataforma; dark mode sigue disponible.
- El shell mantiene orientacion visible, busqueda global, accion primaria y estado operativo en todas las superficies.
- Las tarjetas tienen radio de hasta 8px, sombra discreta y una sola responsabilidad. No se agregan bloques decorativos que compitan con ventas, stock, margen o caja.
- El dashboard prioriza Business Core: ventas, margen real, stock, caja y tareas de hoy. Cada cifra lleva periodo o fuente.
- Mobile conserva los cinco accesos criticos: Resumen, POS, Ventas, Productos y Clientes. Las tablas se desplazan sin romper la pagina.

**Slice de rediseno 1 (2026-08-14):** tokens visuales, modo claro por defecto, topbar operativo de organizacion, headers de pagina y chrome de plataforma. La salida se valida con screenshots desktop/mobile y la puerta completa del repo.

---

## 1. Qué es

Una plataforma para comercios argentinos, con tres partes:

1. **Gestión** — stock con variantes, POS con caja, ventas, compras, clientes,
   deudas, finanzas, canjes con influencers y marketing. Es el núcleo y lo más
   maduro.
2. **Tienda online** — cada organización tiene su vitrina que vende de verdad,
   con carrito, cupones, envíos, cobro y cuentas de comprador.
3. **Plataforma** — el panel desde donde se administran todas las
   organizaciones del SaaS.

El caso de uso que lo originó y lo sigue guiando: **importación y venta de
perfumes y vapers**. Cuando una decisión de producto está en duda, gana la que
sirve a ese negocio.

📌 **Tesis 2026-08-14.** Gestiona no es una alternativa a Tiendanube: es el
**sistema operativo para comercios que venden en múltiples canales**. La tienda
es una superficie. El producto es el núcleo que une inventario, ventas,
clientes, pagos, costos, impuestos y margen en una sola verdad operativa.

---

## 2. Contra quién compite

⚠️ **Esta sección estuvo mal planteada y se corrigió en la sesión 111.** El
posicionamiento, la competencia real y qué habría que medir viven ahora en
**[docs/ESTRATEGIA.md](docs/ESTRATEGIA.md)**, que separa lo medido de lo
supuesto. Acá queda sólo lo que afecta decisiones de código.

**Lo que hay que dejar de decir: "Tiendanube no tiene POS".** Según un análisis
externo lo lanzó en Argentina en 2026, y **no se pudo verificar desde acá**.
Hasta chequearlo, no se usa como argumento: un dato viejo tira abajo la
credibilidad de todo lo demás.

**La categoría ya existe.** Hay varios productos argentinos haciendo "ERP +
tienda" —Contabilium, VentaWeb, Axon, Max24, sin verificar—. Eso es buena
noticia: no hay que convencer a nadie de que el problema es real. Y es mala:
**"gestión + tienda" ya no alcanza como diferencial**.

Dónde este sistema es realmente distinto, y por qué es difícil de copiar:

| | Acá | Plataforma de ecommerce | ERP / sistema de gestión |
|---|---|---|---|
| **Costo real de la mercadería** (USD, aduana, tipo de cambio) | ✅ `total_cost_usd` | ❌ no lo conoce | ✅ |
| **Comisión del medio de pago y del marketplace** | ✅ | ✅ | ❌ no la conoce |
| **Costo de envío por zona** | ✅ | ✅ | parcial |
| **IVA por producto** | ✅ desde A8 | parcial | ✅ |
| **→ Margen real por canal** | ✅ **tiene los cuatro términos** | ❌ le falta el costo | ❌ le faltan las comisiones |

Ese es el punto: **el margen real por canal necesita las cuatro cosas a la vez**,
y cada familia de producto tiene dos o tres. Acá están las cuatro porque el
proyecto nació importando. Es el ítem **E4**.

---

## 3. Las tres superficies

| Superficie | Ruta | Quién entra | Aislamiento |
|---|---|---|---|
| Gestión | `/` | miembros de una org (`memberships`) | RLS por `org_id` |
| Plataforma | `/platform` | staff del SaaS (`platform_admins`) | no da permisos dentro de una org |
| Tienda pública | `/tienda/:slug` | comprador anónimo o con cuenta | RPCs `security definer` con columnas saneadas |

La separación es deliberada y está testeada. Ver [docs/permisos.md](docs/permisos.md).

### Brújula de producto

El análisis externo del 2026-08-14 dejó una advertencia útil: el riesgo no es
quedarse corto, es convertirse en una **ERP feature factory**. A partir de acá,
una mejora entra al ROADMAP sólo si fortalece uno de estos cinco pilares:

1. **Productos + inventario** — un stock, reservas claras, costos reales.
2. **POS + caja** — vender aunque internet falle, sincronizar sin duplicar.
3. **Ecommerce** — la tienda vende de verdad, pero no manda sobre el negocio.
4. **Clientes + ventas** — una ficha de cliente entre local, web y canales.
5. **Inteligencia** — no "tener IA"; decir qué hacer y medir si se hizo.

El corazón técnico se llama **Business Core**: productos, órdenes, clientes,
finanzas e inventario. POS, tienda y marketplaces son canales que escriben y
leen de ese núcleo; ninguno inventa su propio stock, precio, margen o cobro.

Antes de agregar un ítem nuevo, tiene que responder al menos una pregunta:

- ¿Acerca a un segundo comercio real a su primera venta?
- ¿Hace más confiable el stock único entre POS, tienda y marketplaces?
- ¿Hace visible el margen real por canal?
- ¿Reduce riesgo legal, fiscal, de seguridad o de operación?
- ¿Mide activación, uso omnicanal, GMV, salud, retención o una acción de IA?

Si la respuesta es "no", va a **Congelado** aunque sea una buena idea.

---

## 4. Estado real por módulo

Sin porcentajes: **anda**, **parcial** (funciona pero le falta algo concreto) o
**falta**.

| Módulo | Estado | Qué le falta |
|---|---|---|
| Stock y productos | Anda | — |
| Variantes | Anda | — |
| POS y caja | Anda | — |
| Ventas y reportes | Anda | — |
| Compras y proveedores | Anda | — |
| Clientes y CRM | Anda | — |
| Deudas y cuotas | Anda | — |
| Finanzas y P&L | Anda | — |
| Tienda online | Anda | Ver §5 |
| Cobro online (MercadoPago OAuth) | Anda | — (`marketplace_fee` ya se aplica; sólo con OAuth, no con token pegado a mano) |
| Envíos por zona / Correo Argentino / Andreani | Parcial | **Los payloads siguen la doc publicada, sin verificar contra un contrato real.** Falta etiqueta y tracking |
| Cuentas de comprador | Anda | — |
| Carritos abandonados | Anda | Requiere `RESEND_API_KEY` |
| Email marketing | Parcial | Motor y crons listos; **sin `RESEND_API_KEY` no envía nada** |
| WhatsApp | Parcial | Requiere Evolution API configurada |
| IA (chat, descripciones, insights, OCR) | Parcial | **Sin `ANTHROPIC_API_KEY` responde error** |
| Permisos por módulo | Anda | Es barrera de interfaz; el límite real es la RLS |
| MFA | Anda | — |
| Auditoría | Anda | — |
| Export y supresión de datos (Ley 25.326) | Anda | — |
| MercadoLibre | Parcial | Falta publicar desde la ficha, importar órdenes y cron multi-org |
| Tiendanube | Parcial | Requiere `TIENDANUBE_CLIENT_SECRET` |
| **AFIP** | **Falta** | **Sin factura no hay venta formal. Gap crítico.** |
| Multi-sucursal | Anda | Stock por sucursal, transferencias validadas y recepción de OC por depósito |
| Tests | Anda | **811 unitarios** (`npm test`, 2026-08-13) + 16 E2E de la tienda. Falta E2E del POS y el panel |

Lo que dice "requiere una clave" no está roto: está construido y esperando un
secreto. Ver [docs/CONFIGURACION.md](docs/CONFIGURACION.md).

---

## 5. Paridad con Tiendanube / Empretienda

### Ya está

Home con secciones · listado con filtros y orden en la URL · ficha con galería y
perfil olfativo · **variantes** con precio y stock propios · carrito persistente ·
cupones · **envío por zona, Correo Argentino y Andreani** · retiro en local ·
**cobro con MercadoPago por OAuth** (cada comercio conecta su cuenta con un
clic) · comisiones descontadas del margen · cuentas de comprador con historial ·
carritos abandonados con recuperación · emails transaccionales · SEO con Open
Graph y sitemap servidos a los bots · **píxeles de Meta, GA4 y TikTok** ·
**reseñas de compra verificada** · **páginas de contenido** (devoluciones,
FAQ, términos) con plantillas argentinas · **banners con vigencia** ·
**filtro por rango de precio** · **lista de deseos** · **aviso de reposición**
(sin necesidad de cuenta) · **etiqueta de envío imprimible y seguimiento** que
el comprador ve sin cuenta · **comisión por transacción cobrada de verdad** ·
**descuento por medio de pago** (10% con transferencia, calculado en la base) ·
**feed de productos para Google Shopping y Meta** ·
**cuotas reales de MercadoPago en la ficha** (consultadas a la cuenta del
comercio, no declaradas) · **7 temas y tipografía elegible** · dominio propio.

### El camino

⚠️ **Los bloques A–G son un catálogo, no un plan.** Están agrupados por tema
porque se fueron agregando en momentos distintos, y agrupar por tema hace que
todo parezca igual de urgente. Al cruzarlos (sesión 112) aparecieron **cuatro
pares que eran el mismo trabajo con dos letras** —C1/F15, D1/F16, D5/F17,
D6/F8— y dos ítems ya hechos que seguían contando. El pendiente real es **53**.

Esta sección es el plan. Los bloques quedan abajo como referencia detallada.

**El criterio que ordena todo, y no es "impacto":** cada fase existe para
**destrabar la siguiente**, y tiene una condición de salida verificable. Sin eso,
53 ítems ordenados por impacto siguen siendo 53 ítems.

**Objetivo de 90 días (2026-08-14): producto confiable y vendible.** El análisis
lo pone así: antes de hablar de inversión o de plataforma increíble hay que
demostrar reliability, ARCA/AFIP, MercadoLibre, POS, checkout, offline,
seguridad, backups, observabilidad y métricas. Traducido a este ROADMAP:

- Fase 0 no se saltea: **AFIP real + base legal publicada**.
- Fase 1 no es cosmética: **onboarding + instrumentación + límites de plan**.
- Fase 2 tiene que probar la tesis: **un stock, dos canales, margen por canal**.
- La confiabilidad tiene que subir de nivel: **E2E de POS/panel, restore
  probado, observabilidad de webhooks, crons, pagos y funciones**.
- La IA no suma por decir "IA": suma cuando recomienda una acción y después se
  mide si el comercio la ejecutó.

---

#### 📍 Dónde estamos

✅ **Medido (2026-08-13).** El sistema funciona y cobra: dos compras reales
acreditadas con comisión de plataforma, stock que sólo mueve la base, RLS
verificada con roles reales, 811 tests, bloque A cerrado.

Y hay **un** comercio usándolo, que es el dueño. Todo lo demás del ROADMAP
mejora un producto que todavía no demostró que alguien más lo quiera (R08).

---

#### FASE 0 — Que se le pueda vender a alguien

**Por qué primero:** no se puede dar de alta un comercio ajeno hoy. Sin factura
no es un sistema de gestión argentino, y sin política de privacidad ni datos del
proveedor se le estaría pidiendo que incumpla desde el día uno.

| Qué | Estado |
|---|---|
| **C1** AFIP contra el organismo (= F15) | 🔴 El más importante y el más largo. Frenado por un certificado de homologación **que es gratis y hay que pedir**. |
| **F1 + F3** Política de privacidad y datos del proveedor | 🟡 El generador ya los escribe. Falta cargar razón social, CUIT, domicilio y email, revisar y publicar. |
| **F5** Consentimiento de marketing con fecha y origen | 🟠 Una columna y un checkbox. Antes de mandarle campañas a clientes de otro comercio. |
| **F11** Acotar la garantía a 6 meses | 🟠 Barato. |
| **F10** El envío de vuelta lo paga el vendedor | 🟠 Falta modelarlo en la devolución. |

> **Condición de salida:** se emitió **una factura electrónica real** y un
> comercio nuevo puede darse de alta sin incumplir nada.

---

#### FASE 1 — Que alguien más lo pueda usar, y que se pueda medir

**Por qué segundo:** es la fase que responde R08. Y no se puede saber si
funcionó sin instrumentación, así que van juntas.

| Qué | Estado |
|---|---|
| **D2** Onboarding guiado | 🔴 `StoreReadinessPanel` dice qué falta; no hay paso a paso. Es lo que convierte "funciona" en "otro lo puede usar". |
| **G1–G8** Instrumentación | 🔴 Los datos ya están en la base, salvo las acciones de IA. Sin esto no hay condición de salida medible. |
| **D4** Límites del plan aplicados | 🟠 Sólo productos. Faltan usuarios, tiendas y órdenes/mes. |
| **D1** Comprobante fiscal de la suscripción (= F16) | 🟠 Depende de C1. |

> **Condición de salida:** **un segundo comercio real** cargó su stock, publicó
> su tienda y cobró — y `G1` dice cuánto tardó desde el alta hasta su primera
> venta. Ese número es el que hay que bajar después.

---

#### FASE 2 — Que el diferencial se vea

**Por qué tercero:** recién acá conviene construir lo que distingue al producto.
Antes sería construirlo para una sola persona.

| Qué | Estado |
|---|---|
| **E4** ⭐ Margen real por canal | El diferencial más defendible, y sale casi gratis: los cuatro datos ya están (ver §2). |
| **C7** MercadoLibre completo | *"Vendé en el local, en tu tienda y en ML con el mismo stock"* es concreto y verificable. Falta publicar desde la ficha, importar órdenes y el cron multi-org. |
| **E1** Precio único entre mostrador y online, con margen a la vista | Consecuencia natural de E4. |
| **E2** El stock del local es el de la tienda | Casi hecho: falta avisar al vender en mostrador algo reservado online. |
| **C9** Multi-depósito real en la tienda | La tienda vende contra el total, no contra el depósito que despacha. |

> **Condición de salida:** un comercio vende por **dos canales con un solo
> stock** y puede ver, por producto, cuál le deja más margen.

---

#### FASE 3 — Que aguante más de un comercio

**Por qué cuarto:** son cosas que sólo duelen cuando hay varios. Construirlas
antes es seguro de un incendio que todavía no puede pasar.

| Qué |
|---|
| **D6** Entrar como el comercio, auditado y visible (= F8) |
| **C11** Auditoría de quién cambió un precio o un stock dentro de la organización |
| **D8** Backup y restauración por organización |
| **D5** Exportar la organización entera (= F17) — retenerla por falta de herramienta es problema legal, no comercial |
| **D3** Anuncios a los comercios · **D7** Estado del servicio |
| **F9** Contrato de tratamiento de datos — necesita abogado, no commit |

---

#### FASE 4 — Conversión de la tienda

Todo el bloque B menos lo congelado. **Va último a propósito:** mejora la
conversión de tiendas que todavía no existen. Con dos comercios, mover B3 acá
arriba puede ser correcto — pero que sea una decisión, no una inercia.

Los primeros serían **B3** (checkout en un paso), **B5** (avisos de "en camino"
y "entregado", que ya tienen `shipped_at`/`delivered_at` desde la sesión 107) y
**B13** (carrito entre dispositivos).

---

#### 🧊 Congelado — no se toca

📌 **Criterio.** Esta lista vale tanto como el plan: el modo de falla de este
proyecto no es quedarse corto, es agregar. Hay 84 páginas.

| Qué | Por qué |
|---|---|
| **B6** Multi-moneda | A9 lo destrabó técnicamente. No lo pidió nadie. |
| **B7** Reseñas con foto · **B8** Comparador · **B14** Preventa | Detalle de tienda antes de tener tiendas. |
| **B9** Filtros por atributo | La ficha olfativa está vacía en las 30 filas: filtraría sobre nada. |
| **C5** Push · **C6** Automatizaciones visuales · **C10** Reportes programados | Módulos nuevos sobre un producto con 84 páginas. |
| **F7** No Llame · **F12** CFT · **F13** Procedimiento de incidente | Se activan cuando exista campaña telefónica, cuotas con interés y más de un comercio. |
| Marketplace de apps · LATAM · contabilidad completa · B2B | Ver [docs/ESTRATEGIA.md](docs/ESTRATEGIA.md) §8. |

---

#### ⛔ Bloqueado por fuera del código

Ninguno lo destraba una sesión de programación. **Conviene destrabar los de
arriba primero**, porque C1 frena la fase 0 entera:

| Qué | Quién lo destraba |
|---|---|
| **C1** Certificado de homologación de AFIP | Trámite, gratis |
| **F1/F3** Razón social, CUIT, domicilio | El dueño, 5 minutos |
| **B1** Tarifas de envío reales · **B2/B11/B12** Etiqueta por API, CP real, sucursales | Contrato con el correo |
| **C2** Contar el inventario físico | 15 productos con Kardex ≠ stock |
| **C3** Pesar una caja real · **C4** 10 fotos y 33 descripciones | El dueño |
| **F9** Contrato de datos · **F14** Ley 25.065 | Un abogado |

---

### Los bloques, en detalle

Lo que sigue es la referencia: cada ítem dice **qué hace la competencia**, **qué
hay hoy acá** y **por qué importa**, con el estado medido contra la base.

---

#### A. El circuito de plata

Bugs y faltantes de lógica, no features. Van primero porque cada uno cobra mal
en producción.

| # | Qué | Estado |
|---|---|---|
| ~~A1~~ | ~~`min_order_value` de las promociones no se aplicaba~~ | ✅ Sesión 104. Dos pasadas: condiciones de orden primero, efectos de línea después. |
| ~~A2~~ | ~~No se reservaba stock entre la orden y el pago~~ | ✅ Se reserva al crear y se libera por vencimiento. |
| ~~A3~~ | ~~`tax_amount` siempre en cero~~ | ✅ El IVA de la orden se discrimina. |
| ~~A4~~ | ~~Cupones sin mínimo ni límite por persona~~ | ✅ Y `create_store_order` llama a `check_store_coupon` en vez de repetir la validación: el RPC es público y una llamada directa salteaba las reglas. |
| ~~A5~~ | ~~Cupón de envío gratis~~ | ✅ Sesión 98, commiteado en la sesión 111. `coupons.free_shipping` con tope opcional; se descuenta del envío y queda en `shipping_discount_ars`, separado del descuento de mercadería para no correr la base del IVA. Un cupón que no bonifica nada —retiro en tienda— se rechaza en vez de consumirse. Falta la promoción automática **acotada a categoría o producto** — "envío gratis en perfumes" sin código. |
| ~~A6~~ | ~~Devoluciones de órdenes online~~ | ✅ Sesión 106, la capa de datos: `returns.ecommerce_order_id` + `return_store_order_item`, que repone el stock por `record_stock_movement` y no deja devolver más de lo comprado ni tocar una orden impaga. **Falta la UI y el reintegro real por MercadoPago**, que necesita el token del comercio y va en una Edge Function. |
| ~~A7~~ | ~~Las promociones no registran uso~~ | ✅ Sesión 105. Se registra el ahorro atribuible a la promoción —no el descuento total— para que la métrica no dependa de cómo pagó el comprador. |
| ~~A8~~ | ~~Precios con IVA discriminado por producto~~ | ✅ Sesión 110. `products.tax_rate`, **NULL = la de la organización** (0 es exento, que es distinto). El IVA se calcula por línea y se suma; los descuentos de orden se prorratean con `prorratear()` para que las bases sumen el total; el envío va a la tasa de la organización porque es un servicio. Verificado con tres alícuotas en una orden: 268,57 contra 520,66 de la tasa única. |
| ~~A9~~ | ~~Redondeo declarado~~ | ✅ Sesión 110. `decimales_de_moneda` / `redondear_moneda` / `prorratear` en SQL, espejados en `src/lib/rounding.ts` con 19 tests. Media unidad hacia arriba **en valor absoluto** (`Math.round(-0.5)` da `-0`, y un reintegro se redondeaba para el lado equivocado). B6 ya no está bloqueado por esto. |
| ~~A10~~ | ~~Historial de precios~~ | ✅ **Ya estaba hecho y este ROADMAP lo daba por faltante.** Medido: `price_history` tiene 656 filas, 627 con autor, último cambio 2026-08-07, trigger `trg_record_price_change` y `PriceSparkline` mostrándolo. |

**Hacia dónde va el modelo de descuentos.** Un descuento tiene *condiciones de
orden* (mínimo, primera compra, segmento) y *efectos de línea* (porcentaje,
monto, precio fijo). Acá ya se evalúa en ese orden desde A1. Lo que falta para
igualar a Shopify es el campo **`combines_with`** por promoción: hoy la regla es
"gana el mejor, nunca la suma", que es más segura pero no deja hacer "10% off +
envío gratis" a propósito. Si se agrega, va como campo explícito por promoción —
**nunca aflojando la regla general**.

---

**El bloque A está cerrado.** Lo que queda de plata es fiscal (C1, AFIP contra el organismo) y de producto, no bugs de cálculo.

---

#### B. Tienda online — lo que el comprador nota

| # | Qué | Estado | Referencia |
|---|---|---|---|
| **B1** | **Revisar las tarifas de envío** | 1 provincia de 24 tiene tarifa. `Completar el tarifario` las estima; falta contrastarlas con el correo. | Todas |
| **B2** | **Etiqueta por API del correo** | La imprimible funciona; la de Correo Argentino y Andreani necesita contrato. | Tiendanube |
| **B3** | **Checkout en un paso** | Hoy es secuencial en una página. | Empretienda, Shopify |
| **B4** | **Pago embebido (Checkout Bricks)** | Se redirige a MercadoPago y se vuelve. Embebido convierte más. | Tiendanube, ML |
| **B5** | **Avisos de cada cambio de estado** | Se manda el de la orden y el de despacho. Faltan "en camino" y "entregado". | Todas |
| **B6** | **Multi-moneda** | Todo en ARS. `currency` existe y no convierte. Necesita A9 primero. | Shopify |
| **B7** | **Reseñas con foto** | Hay reseñas verificadas, sin imagen. | ML |
| **B8** | **Comparador y "visto recientemente"** | No existe. | ML |
| **B9** | **Filtros por atributo en el catálogo** | Sólo categoría, precio y género. La ficha olfativa está **vacía en las 30 filas**, así que un filtro por familia filtraría sobre nada: primero hay que cargar los datos. | Tiendanube |
| ~~B10~~ | ~~Búsqueda con corrección de tipeo~~ | ✅ Sesión 110. Damerau-Levenshtein con tolerancia **por largo del término** (≤3 exacto, 4-6 un error, ≥7 dos): con tolerancia fija "oud" matchearía "sud". Literal primero y difuso **sólo si no hay ninguna** — nunca mezclados. Verificado contra producción: "lataffa" trae 7 Lattafa, "zapatillas" trae 0. | ML |
| **B11** | **Envío a domicilio con cálculo por código postal real** | Se cotiza por provincia. El CP se pide y no afina la tarifa. | Todas |
| **B12** | **Retiro en punto de entrega (pickup points)** | Hay retiro en local. Faltan sucursales de correo. | Tiendanube, ML |
| **B13** | **Carrito persistente entre dispositivos** | Vive en `localStorage`: se pierde al cambiar de teléfono a compu aunque haya sesión. | Shopify |
| **B14** | **Preventa y reservas** | Un producto sin stock ofrece aviso de reposición, no comprar por adelantado. | Tiendanube |

---

#### C. Gestión — lo que el comercio necesita

| # | Qué | Estado | Referencia |
|---|---|---|---|
| **C1** | **AFIP probado contra el organismo** | Estructura lista, credenciales cerradas. Falta certificado de homologación y una factura emitida. | Todas las argentinas |
| **C2** | **Contar el inventario físico** | La herramienta está (conteo con asiento). Faltan 15 productos con Kardex ≠ stock. | — |
| **C3** | **Cargar el peso de los productos** | 59 de 60 en cero. El botón los estima; falta pesar una caja. | — |
| **C4** | **Fotos y descripciones** | 10 sin foto, 33 con descripción corta. El panel de calidad los rankea. | ML |
| **C5** | **App en el celular con notificaciones** | Hay PWA y POS offline. Falta el push de "vendiste" y "sin stock". | Tiendanube app |
| **C6** | **Motor visual de automatizaciones** | Existen `automations` y los crons; falta el armador de flujos. | Shopify Flow |
| **C7** | **MercadoLibre completo** | Falta publicar desde la ficha, importar órdenes y el cron multi-org. | — |
| **C8** | **Compras y reposición con proveedor** | Hay órdenes de compra y reposición automática. Falta recepción parcial y costo de importación por lote. | — |
| **C9** | **Multi-depósito real en la tienda** | El stock por sucursal existe; la tienda vende contra el total, no contra el depósito que despacha. | Shopify |
| **C10** | **Reportes exportables y programados** | Hay reportes en pantalla. Falta "mandame el cierre de mes por email". | Todas |
| **C11** | **Auditoría de quién cambió qué** | `admin_audit_logs` es de plataforma. Dentro de la organización no queda rastro de quién editó un precio o un stock. | Shopify Plus |

---

#### D. Plataforma — para operar como SaaS

| # | Qué | Estado |
|---|---|---|
| **D1** | **Facturación fiscal de la suscripción** | Stripe cobra; no se emite comprobante argentino al comercio. |
| **D2** | **Onboarding guiado** | `StoreReadinessPanel` dice qué falta; no hay un paso a paso. |
| **D3** | **Anuncios a los comercios** | No hay forma de avisar "nueva versión" o "mantenimiento". |
| **D4** | **Límites del plan aplicados** | Sólo productos. Faltan usuarios, tiendas y órdenes/mes. |
| **D5** | **Exportar la organización entera** | Existe el export por Ley 25.326 para personas, no para llevarse el negocio. |
| **D6** | **Entrar como el comercio, auditado** | `generateMagicLink` existe y está wireado; falta el registro visible de "soporte entró a tal cuenta". |
| **D7** | **Estado del servicio público** | Si algo se cae, el comercio no tiene dónde mirar. |
| **D8** | **Backup y restauración por organización** | Hay `weekly-backup`. No hay restaurar. |

---

#### E. Lo que ninguna de las tres tiene bien, y sería la ventaja

Copiar la paridad no gana clientes: iguala. Estas tres salen del hecho de que
acá **la gestión y la tienda son el mismo sistema**, cosa que Tiendanube no
tiene y ML menos.

| # | Qué | Por qué |
|---|---|---|
| **E1** | **Precio único entre mostrador y online, con margen a la vista** | Hoy hay cuatro superficies de precio y se llegó a ellas de a una. Una pantalla que muestre, por producto, qué precio ve cada canal y cuánto margen deja **después** de comisión, envío e IVA, no existe en ninguna. |
| **E2** | **El stock del local es el stock de la tienda, con reserva** | Ya está la reserva (A2) y el multi-depósito. Falta cerrarlo: vender en el mostrador algo que está reservado por una orden online tiene que avisar. |
| **E3** | **Un cliente, una ficha** | El CRM ya cruza las cinco tablas por `customer_id`. Falta que el comprador online y el del mostrador sean la misma persona automáticamente, con su historial completo en las dos direcciones. |
| **E4** | ⭐ **Margen real por canal** | **El diferencial más defendible que tiene el producto, y sale casi gratis de lo que ya está.** Un mismo producto deja márgenes distintos en el mostrador, en la tienda y en ML, y hoy nadie se lo dice al comerciante. Requiere las cuatro puntas —costo real, comisión, envío, IVA— y **acá están las cuatro** (ver §2). Una pantalla por producto: qué precio ve cada canal y cuánto queda después de todo. Después, la frase que vale: *"tu tienda propia te deja 7 puntos más que ML en este producto"*. |

📌 **Business Copilot no es otro módulo por ahora.** Es la forma en que E1–E4 y
G1–G8 deberían aparecer: "qué compro esta semana", "qué canal me deja menos
margen", "qué clientes se están enfriando", "qué promoción liquida stock". Cada
recomendación tiene que terminar en una acción posible y una métrica de uso; si
es sólo chat, no es diferencial.

#### F. Cumplimiento legal — lo que no es opcional

Sale del relevamiento completo en **[docs/LEGAL.md](docs/LEGAL.md)**, que va
requisito por requisito contra el código. Esto no es paridad con la competencia:
es lo que hace falta para vender sin exponerse. **No es asesoramiento legal** —
cada punto conviene validarlo con un profesional.

Ordenado por riesgo dividido esfuerzo, que no es el orden en que se descubrieron:

| # | Qué | Norma | Estado |
|---|---|---|---|
| **F1** | **Página de política de privacidad**, con qué datos se guardan, para qué, cuánto tiempo y **que se alojan en Estados Unidos** | Ley 25.326 arts. 6 y 12 | 🟡 **Sesión 109:** el generador la escribe con los proveedores reales y la declaración de transferencia. Falta que el dueño cargue sus datos, la revise y la publique. |
| ~~F2~~ | ~~Botón de arrepentimiento en la primera pantalla~~ | Res. 424/2020 | ✅ **Sesión 108.** Barra superior, a 4px del tope, verificado en 1280 y 375. |
| **F3** | **Datos del proveedor**: razón social, CUIT y domicilio | Ley 24.240 art. 4 | 🟡 **Verificado: los términos publicados eran la plantilla semilla intacta.** El generador los reescribe; falta cargar los datos y publicar. |
| ~~F4~~ | ~~Link a Ventanilla Única Federal de Reclamos~~ | Comercio electrónico | ✅ **Sesión 108.** En el pie y en el formulario de arrepentimiento. |
| **F5** | **Consentimiento de marketing con fecha y origen**, sin marcar por defecto | Ley 25.326 art. 27 | 🟠 Se mandan campañas por email y WhatsApp sin registrar cuándo aceptó la persona. |
| **F6** | **Baja visible en WhatsApp**, como ya la hay en email | Ley 25.326 art. 27 | 🟠 `drip-unsubscribe` cubre email; WhatsApp no dice cómo darse de baja. |
| **F7** | **Registro No Llame** antes de una campaña telefónica | Ley 26.951 | 🟠 No se consulta. |
| **F8** | → **es D6**, no es otro trabajo | Transparencia | 🟠 `admin_audit_logs` ya lo registra; falta mostrárselo. Es D6. |
| **F9** | **Contrato de tratamiento de datos** plataforma ↔ comercio | Ley 25.326 art. 25 | 🔴 La plataforma es *encargada*, el comercio *responsable*. Necesita abogado. |
| **F10** | **El costo del envío de vuelta lo paga el vendedor** | Ley 24.240 art. 34 | 🟠 La devolución registra el producto, no el flete. |
| **F11** | **Acotar la garantía a 6 meses** en el reclamo por falla | Ley 24.240 art. 11 | 🟠 Hoy acepta un reclamo sin límite de tiempo. Es el error barato, pero conviene cerrarlo. |
| **F12** | **CFT y precio de contado** si algún día hay cuotas con interés | Res. 51/2017 | 🟠 Hoy sólo hay "sin interés", donde el CFT es 0%. El código no distingue las dos cosas. |
| **F13** | **Procedimiento escrito de incidente de seguridad** | Res. AAIP 47/2018 | 🔴 Sin procedimiento no se cumple ningún plazo. |
| **F14** | **Consultar por el descuento según medio de pago** | Ley 25.065 art. 37 | 🟠 No es una decisión de producto. |
| **F15** | → **es C1**, no es otro trabajo | RG 4291 | 🔴 Ya está como A-pendiente; acá se anota que además es el riesgo fiscal más grande del sistema hoy. |
| **F16** | → **es D1**, no es otro trabajo | ARCA | 🟠 Stripe cobra y no se emite nada. |
| **F17** | → **es D5**, no es otro trabajo | — | 🟠 Es D5. Retenerlo por falta de herramienta es un problema legal, no sólo comercial. |

⚠️ **F1 a F4 son cuatro páginas y un link.** Juntos sacan del rojo casi todo lo
que Defensa del Consumidor y la AAIP detectan de oficio, y no dependen de
ningún trámite externo. Todo lo demás puede esperar; eso no.

**Al cierre de la sesión 109, F2 y F4 están hechos y F1 y F3 quedan a un paso:**
el texto lo genera el panel de Páginas de la tienda, y lo que falta es que el
dueño cargue razón social, CUIT, domicilio y email, lea lo generado y publique.
Se crean como **borrador** a propósito — publicar un texto legal por él sería
firmarlo en su nombre.

#### G. Instrumentación — lo que no se mide no existe

Se sabe todo del negocio del comercio y **nada del uso de la plataforma**. Los
datos ya están en la base; falta juntarlos. Detalle y por qué importa cada uno
en [docs/ESTRATEGIA.md](docs/ESTRATEGIA.md) §6.

| # | Qué | De dónde sale |
|---|---|---|
| **G1** | **Tiempo hasta la primera venta** de una organización nueva | `memberships.created_at` → primera `sales` |
| **G2** | **Tiempo hasta publicar la tienda** | → primera `ecommerce_orders` |
| **G3** | **Adopción omnicanal**: % que usa POS **y** tienda | cruce por `org_id` |
| **G4** | **GMV por comercio** | `sales` + `ecommerce_orders` |
| **G5** | **Activas vs. que pagan** | `memberships`, `subscriptions` |
| **G6** | **Serie temporal de riesgo de abandono** | `platform_org_health` ya ordena por urgencia; falta la serie |
| **G7** | **Stock accuracy**: % de productos cuyo stock actual coincide con Kardex | `stock_movements` vs `products`/`product_variants` |
| **G8** | **AI Action Rate**: recomendaciones de IA que terminan en acción | falta evento de recomendación → acción |

⚠️ **G3 es la que representa la tesis del producto.** Si los comercios usan sólo
la tienda o sólo la gestión, el diferencial de §2 no se está usando y hay que
saberlo antes de construir encima.

Para hablar con inversores después, G1–G8 no alcanzan solos: también hay que
tener MRR, ARR, churn, CAC, LTV y margen bruto con fecha y fuente. Si CAC o LTV
vienen de una planilla externa, se registran igual; lo prohibido es citarlos sin
fecha.

---

## 8. Riesgos

| ID | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R01 | Brecha entre organizaciones por un bug de RLS | Baja | Crítico | `publicSurface.test.ts` y la vista `rls_audit_open_policies` |
| R02 | Webhook duplicado cobra o descuenta stock dos veces | Media | Alto | Todos los caminos de pago son idempotentes |
| R03 | Un comercio pega mal su token y no cobra | Media | Alto | OAuth reemplazó el token a mano; se renueva solo |
| R04 | AFIP cambia su API | Media | Alto | Servicio abstraído y credenciales encerradas; **falta probarlo contra el organismo** |
| R05 | Costo de IA sin techo | Media | Alto | Falta límite por plan |
| R06 | Cotización de envío mal calculada contra el correo real | Media | Alto | Verificar contra un contrato real antes de escalar |
| R07 | Un solo desarrollador | Alta | Alto | CLAUDE.md, docs/ y commits largos a propósito |
| R08 | **Un solo comercio usándolo.** El multi-tenant está probado, no usado: un segundo comercio real destapa supuestos que ningún test encuentra | Alta | **Crítico** | Ninguna todavía. Es el riesgo más grande del proyecto y no se resuelve con código — ver [docs/ESTRATEGIA.md](docs/ESTRATEGIA.md) §5 |
| R09 | Un dato viejo de este repo citado como actual afuera (pasó: "418 tests" cuando eran 811) | Media | Medio | Los números medidos van con la fecha o con el comando al lado |
| R10 | Supabase caído | Baja | Crítico | PITR activo; sin runbook escrito |

---

## 9. Definición de terminado

Una funcionalidad está lista cuando:

- [ ] `npm run typecheck` en 0 errores — **no `npx tsc --noEmit`**, que no chequea nada
- [ ] `npm run lint` sin errores
- [ ] `npm test` en verde
- [ ] Tests unitarios sobre los cálculos de plata, si los hay
- [ ] Toda query filtra por `org_id`
- [ ] Verificada contra la base real, con datos `ZZ` borrados al terminar
- [ ] Loading, vacío y error resueltos
- [ ] Se lee bien a 375px
- [ ] Las operaciones destructivas quedan en la auditoría
- [ ] No rompe stock, caja, deuda, reportes ni facturación
- [ ] Anotada acá con lo que se encontró en el camino

---

## 10. Principios de arquitectura

**ADR-001 — Multi-tenant por `org_id`.** Toda tabla de negocio lo tiene y lidera
su índice. Nunca filtrar sólo por `user_id`.

**ADR-002 — La lógica con secretos vive en Edge Functions.** El frontend está
optimizado para leer.

**ADR-003 — El servidor es la autoridad sobre la plata.** El checkout manda ids
y cantidades; precios, stock, cupones, envío y comisiones se recalculan en la
base. Si el precio saliera del navegador, cualquiera pagaría lo que quisiera.

**ADR-004 — Las páginas públicas no leen tablas crudas.** Van por
`src/lib/publicDataSource.ts`, y `publicSurface.test.ts` falla si alguien se
saltea la regla o pide una columna de costo, margen o credencial.

**ADR-005 — Los tokens viven en tablas con RLS y cero policies.** Sólo las Edge
Functions con `service_role` los tocan. La UI lee vistas `*_status` que dicen si
está conectado, nunca el token.

**ADR-006 — El cliente no puede asumir que la migración está aplicada.** Se
intenta lo nuevo y se cae a lo anterior sólo si la relación o la función no
existen. Nunca tragarse un error con `?? []`.

**ADR-007 — Los cálculos de plata van a funciones puras testeadas.** Cuando la
misma cuenta existe también en SQL, el comentario de cada lado dice que son
espejos.

**ADR-008 — Realtime sólo donde aporta.** Dashboard, POS, tickets y chat. No en
reportes históricos ni listas paginadas.

**ADR-009 — `localStorage` sólo para preferencias de interfaz** y el carrito de
la tienda. Los datos de negocio van a la base.

**ADR-010 — Móvil primero.** Se diseña a 375px y se escala.

---

## 11. Historial de sesiones

Lo que se hizo y —más importante— qué se encontró roto en el camino. Los
mensajes de commit son largos a propósito y amplían cada entrada.

> Resumen condensado. El registro completo detallado está en el archivo.

### Sesiones 1–10 — Base técnica + módulos core
- Infraestructura: PWA, Realtime, JWT, code splitting 427kB, Sentry
- Auth: roles, invitaciones, platform admin, RLS completa
- Inventario: Kardex, ajustes auditados, alertas, toma física
- Ventas: POS, caja, presupuestos, devoluciones, cupones
- Clientes: CRM 360°, pipeline Kanban, RFM, segmentos
- Finanzas: gastos, deudas, conciliación, cheques, cuotas, AFIP
- Reportes: P&L, inventario valorado, exportaciones CSV/PDF
- IA: forecast OLS, chat generativo, análisis proactivo

### Sesiones 11–20 — IA accionable + UX empresarial
- Chat IA con acciones reales (crear venta/compra/tarea/cliente)
- Segmentos RFM en DB (migrado de localStorage)
- Kanban de tareas con subtareas y drag-drop
- Analytics: ABC analysis, cohorts, canales de venta
- POS: split de pago, variantes, offline mode, keyboard shortcuts
- Presupuestos: automatización completa + recordatorios WA
- Email: SMTP propio, branding, test-send, tracking

### Sesiones 21–40 — Enterprise features
- Facturas: notas de crédito, envío masivo, filtros
- Deals: activity timeline, deal scoring, pipeline analytics
- Clientes: CLV, churn risk score, importación CSV avanzada
- Vendedores: cuotas, leaderboard, comisiones, metas
- WhatsApp: Evolution API, campañas masivas, digest diario
- Links de pago: CRUD completo, MP integration, público
- Integraciones: Tiendanube, health checks, dead-letter queue

### Sesiones 41–60 — Diferenciación competitiva
- Dashboard: temperatura del negocio, forecast 7d, comparativa semanal
- POS: bundles/kits, VIP discount automático, recibo por email
- IA chat: análisis por segmento WA, resumen ventas/deudas/gastos
- Reportes: comparativa dual de períodos, semanas, tendencia
- Soporte: SupportPage completo (Service Cloud)
- Realtime: SSE streaming IA, Presence WebSocket, KPIs live
- Expensas: stacked chart, vencimientos recurrentes, adjuntos

### Sesiones 61–77 — Madurez del sistema
- Pages nuevas: ActivityFeed, SellerGoals, InventoryAging, FollowUp
- Pages nuevas: PricingIntelligence, TeamPerformance
- Pipeline: deal_stage_change automation, forecast chart
- CustomersPage: exportCSV 18 cols, ficha 360 PDF, estado de cuenta
- ProductsPage: vista grilla, bulk delete, precio/stock inline
- Dashboard: 8h chart, temperatura 5 señales, objetivos por vendedor
- UX audit: 0 subtitle=, 0 icon JSX, 134/146 páginas con KPICards

### Sesión 78 — Refocus de producto + rediseño visual (2026-07-24)
- Refocus de alcance: 160 → 83 páginas (bloque2/bloque3), eliminando
  módulos enterprise fuera de foco (HR/payroll, fleet, project mgmt,
  e-learning, territorios, contratos B2B, revenue recognition, etc.)
  y consolidando duplicados (fidelidad, CRM, analytics, pricing,
  inventario, marketing) en tabs dentro de páginas padre
- Nav reconstruido alrededor del alcance final: Principal / Inventario
  / Ventas & CRM / Ecommerce & Multi-Tienda / Finanzas / Marketing &
  Influencers / Analytics / Administración
- Nuevo: multi-tienda (sucursales), portal de influencers, atribución
  de campañas vía cupones, kardex de canjes con influencers
- Rediseño visual completo: tema "oscuro premium" (dorado → zafiro),
  tema claro real + toggle persistente (next-themes), sidebar con
  rail de íconos fijo en tablet (768-1023px, antes se comportaba
  igual que celular), 10 primitivos de UI + Dashboard corregidos para
  no depender de fondos oscuros hardcodeados

### Sesión 79 — ERP vertical de perfumería · Phase 1 (2026-07-24)
Foco: el diferenciador que pidió el dueño (módulo exclusivo de perfumes)
+ huecos baratos adyacentes. 3 migraciones aplicadas a producción por SQL
directo (el historial de migraciones está desincronizado: solo 85 de ~209
trackeadas, así que `db push` habría reintentado ~120 ya aplicadas).
- **Ficha premium de perfume** (`product_perfume_details`, 1:1 con products):
  familia olfativa, notas salida/corazón/fondo, duración, proyección,
  estación, ocasión, modelo, inspiración, edad recomendada. Form solo
  visible en categorías perfume.
- **Buscador por facetas** en ProductsPage (Sheet): género + familia +
  notas + estación + ocasión + precio máx → responde "masculino, dulce,
  vainilla, larga duración, hasta $80.000" al instante.
- **IA estructurada**: `generate-description` pasó a tool-use forzado y
  autocompleta la ficha (familia/notas/duración/proyección/ocasión).
- **CRM perfumería**: clientes con Instagram, WhatsApp separado, flag
  "compra vapers", preferencias olfativas (chips de taxonomía compartida).
- **Kardex**: tipos rotura/regalo/reserva + diálogo de movimiento manual
  (RPC `record_manual_stock_movement` con validación de rol).
- **Dashboard**: KPIs "Productos Nuevos" y "Próximos Ingresos".
- **Fix colateral**: el form de productos descartaba silenciosamente
  barcode/sku/lote/vencimiento/etiquetas al guardar — corregido.

**Phase 2 (misma sesión, ya hecho):**
- **Estadísticas por marca** (ReportsPage → tab "Marcas"): qué marca
  vende/rinde más, cuál es la más rentable, % que representa cada una,
  capital inmovilizado por marca + desglose por familia olfativa.
- **Enviar catálogo por WhatsApp** (CatalogPage): botón wa.me con el link
  del catálogo público prellenado.
- **IA de copy para Instagram** (`generate-social-copy` edge fn +
  SocialPlannerPage): genera título/contenido/hashtags para
  post/story/reel/carousel a partir de un producto o tema.
- **Enviar lista de precios por WhatsApp** (CatalogPage): botón "Precios
  WA" que arma la lista en texto (producto — precio) y la abre en wa.me.
- **Recomendador de perfumes similares** (`perfumeMatch.ts` +
  PerfumeRecommenderModal): similitud determinística por notas/familia/
  duración/proyección; acción "Similares" por perfume en ProductsPage.
  `recommendForPreferences()` queda lista para el lado cliente (Phase 3).
- **Prolijidad UI**: ficha de perfume reorganizada en subsecciones
  (Identidad / Perfil / Pirámide de notas / Uso ideal); charts de las
  superficies nuevas 100% theme-aware.
- **Endurecimiento UI app-wide** (legible en todos los dispositivos +
  tema claro/oscuro):
  - Colores hardcodeados de charts (147 ocurrencias / 16 archivos):
    tooltips/ejes/grillas → tokens del tema. Ya no se rompen en claro.
  - Páginas públicas (Landing/Auth/Pricing/Onboarding/NotFound/Invitación/
    Reset): fondo→--background, cards→--card, logo→--primary-foreground.
    Antes quedaban oscuras aunque el tema fuera claro.
  - 32 tablas (21 archivos) que se recortaban en móvil → overflow-x-auto
    (scroll horizontal).
  - TabsList (primitivo) → scroll horizontal: corrige los 17 páginas con
    muchas pestañas de una vez.
  - Verificado: sin desborde horizontal en 375px, colores OK en ambos
    temas, tsc/build/123 tests limpios.
### Sesión 80 — Sistemas por categoría + pulido UI (2026-07-25)
- **Markup/margen por categoría**: `settings.category_pricing` jsonb;
  el auto-cálculo de precios usa el markup y descuento propios de cada
  categoría (ej. perfumes ×2.2, vapers ×1.6) en vez del ×2 fijo.
  Config en Ajustes → "Precios por categoría".
- **Oferta masiva por categoría**: modal en Productos que aplica/quita
  descuento + vencimiento a todos los productos de una categoría.
- **Promociones aplicadas al cobrar**: la tabla `promotions` (targeting
  por categoría/producto/todo) existía pero nunca se aplicaba. Nuevo
  `src/lib/promotions.ts` (bestPromoPrice, +9 tests) + enforcement en POS
  (badge PROMO, registra promotion_usages) y catálogo interno.
- **Pulido UI sistemático** (sobre todas las páginas): toolbars de
  acciones con flex-wrap (8 páginas), sumado a lo previo (colores
  theme-aware, tablas y tabs con scroll, páginas públicas theme-aware).
- Nota verificada: el POS ya calculaba bien la ganancia (usa costo con
  aduana); no había bug.

- **Fix header (bug real reportado con captura)**: en páginas con toolbars
  largas (Productos ~10 botones) el bloque de acciones aplastaba el
  título/descripción a ~0px. PageHeader ahora limita acciones al 62% en
  desktop + flex-wrap; 29 páginas con divs de acciones sin flex-wrap
  corregidos. Sistémico → arregla todas las páginas con header compartido.
- **Recomendador por cliente** (Phase 3): en la ficha del cliente se
  muestran perfumes que matchean sus preferencias olfativas (% match) +
  modal "Ver todos" + WhatsApp de recomendación.
### Sesión 81 — Pricing por categoría end-to-end + typecheck real (2026-07-27)
- **Recalcular precios con el markup de cada categoría** (hueco reportado):
  "Recalcular Todo" usaba un ×2 hardcodeado → ignoraba category_pricing.
  Ahora usa el markup/descuento de cada categoría, preserva el % de las
  ofertas vigentes y actualiza en tandas de 25. Al guardar Ajustes, si
  cambian los precios por categoría aparece el aviso "¿Recalcular?".
- **`src/lib/pricing.ts`**: fuente de verdad del pricing (getCategoryMarkup,
  getCategoryDiscount, calcAutoSalePrice, calcAutoDiscountPrice,
  calcMarginPct) + 18 tests. Elimina 3 fórmulas de precio duplicadas
  (form de producto, recalculador, ajuste masivo).
- **Alerta `stale_price`** (Phase 3 ✅): avisa cuando el precio guardado se
  desvía >umbral% del que corresponde al dólar+markup actuales.
- **Typecheck real**: `npx tsc --noEmit` sobre el tsconfig raíz (files: [])
  NO chequeaba nada → el CI daba verde siempre. Por eso llegó a runtime un
  ReferenceError. Ahora `npm run typecheck` (tsconfig.app.json) y el CI lo
  usa. Destapó 13 errores que eran bugs reales:
  - SubscriptionsPage usaba 3 tablas + 1 RPC inexistentes → página rota.
    Creadas subscription_plans / customer_subscriptions /
    subscription_invoices + RPC renew_subscription (con RLS).
  - WhatsAppCampaignsPage filtraba `debts.paid` (columna inexistente) →
    el segmento "con deuda" quedaba vacío. Ahora usa remaining_ars > 0.
### Sesión 82 — Auditoría de esquema: 35 tablas faltantes → 0 (2026-07-28)

Al arreglar el typecheck (que no chequeaba nada) quedó expuesto que gran
parte del código consultaba tablas/columnas inexistentes. Se escribió un
auditor (`.from()`/`.rpc()` vs tipos generados) y se cerró la brecha.

**Bugs críticos encontrados y corregidos:**
- **POS crasheaba al renderizar**: `confirmDisabled` se leía en el array de
  deps de un useEffect ~600 líneas antes de declararse → ReferenceError.
  La caja no abría. Ahora usa un ref espejo.
- POS: el comando de voz armaba items de carrito malformados (sin costo ni
  TC → ganancia mal calculada); el webhook mandaba qty/price undefined.
- ReportsPage importaba `Toggle` de lucide-react (no existe) — mismo bug
  que había roto Productos con `DialogFooter`.
- Proveedores: 2 usos de una variable renombrada → crash al exportar CSV.
- Sucursales, Bundles y Listas de Precios guardaban contra columnas
  inexistentes → fallaban en silencio.
- WhatsApp Masivo: el segmento "con deuda" siempre vacío.
- P&L: pedía `expenses.amount` (es amount_ars) → quedaba sin gastos.

**Tablas creadas (20) para features que sí sirven:** fidelidad (5), lotes
y vencimientos (2), devoluciones (2), órdenes de compra (2) + numeración,
suscripciones de clientes (3) + renovación, alertas v2 (2), integraciones
(api_keys, webhook_configs), BI (saved_reports, bi_snapshots), OCR (2),
multi-divisa (multi_currency_transactions, fx_exposure, fx_rates), items de
bundles, seguimientos CRM. Todas con RLS por org.
**Vista `sale_items`** sobre `sales` (cada venta ya es una línea).
**Funciones:** generate_po_number, renew_subscription, expire_batches,
seed_return_reasons, get_audit_summary.

**Eliminadas (13 tablas) por estar fuera de alcance:** Motor de Precios
(incluía Inteligencia de Competencia y Precios Dinámicos), tab Franquicias
y tab Cotizaciones a proveedores (RFQ).

- Pendiente Phase 3: reservas reales (tabla stock_reservations), catálogo
  PDF por facetas, promos en catálogo público (path de lectura pública),
  price_lists mayorista en la ficha.
- A confirmar con el dueño: `calculateTaxes` aplica IVA sobre la ganancia
  (normalmente el IVA va sobre las ventas) — puede estar subestimando.
- Nota: las tablas nuevas están vacías; las páginas abren sin datos hasta
  que se cargue el primer registro.

### Sesión 83 — Cierre de Phase 3 + 49 → 0 errores de tipo (2026-07-28)

**Phase 3 completada:**
- **Catálogo filtrable por facetas**: género, familia olfativa, ocasión y
  notas sobre `product_perfume_details`. El PDF se arma desde `filtered`, así
  que exportar da exactamente la selección visible; la portada nombra las
  facetas activas.
- **Listas de precios en la ficha del producto** (`ProductPriceListsSection`):
  muestra el precio efectivo de cada lista mayorista y permite fijar un
  override por producto (precio fijo o %) en `price_list_items`.
- **Proveedor preferido por producto** (`products.supplier_id`) — lo pedían
  AutoRestock y las órdenes de compra, y no existía la columna.

**Bugs reales encontrados por el typecheck (49 errores → 0):**
- `sales.customer_email` no existe → CustomerRFM devolvía 400. Ahora el email
  se resuelve desde `customers`.
- `sales.method` / `expenses.amount` → la conciliación bancaria no cargaba
  ventas ni gastos (nombres reales: `payment_method`, `amount_ars`).
- `deals.amount` → el scoring de leads puntuaba todo con monto 0
  (real: `value_ars`). `products.price` → recomendador sin precios.
- `customers.segment` no existe: la campaña de WhatsApp por segmento nunca
  encontraba clientes. Ahora usa `customer_segment_members` y lista los
  segmentos reales de la organización.
- `purchases.supplier_name` → el histórico por proveedor salía vacío
  (real: `supplier`).
- `product_variants` no tenía `barcode` ni se mandaba `org_id`: la
  importación de variantes de Tiendanube fallaba entera.
- Los upserts de `settings` en Integraciones no mandaban `user_id` (NOT NULL)
  → guardar webhook / Mercado Pago / Evolution fallaba en un alta nueva.
- El log de entregas de webhooks consultaba columnas inexistentes
  (`webhook_id`, `event_type`, `status`…): se alineó al esquema real que
  escribe la Edge Function `send-webhook`.
- `price_history` no la escribía nadie → el historial de precios y el
  sparkline estaban vacíos siempre. Ahora `updateProductDB` registra el
  cambio de precio/costo.
- El medio de pago de un pago de deuda se descartaba: nueva tabla
  `debt_payments` como ledger.
- La auditoría de AdminPage filtraba por `severity` y buscaba por
  `entity_label`/`user_email`, columnas que no existían → se agregaron y
  `logAudit` las completa (severidad derivada de la acción).
- El forecast de Dashboard y Analytics pasaba `{date, amount}` cuando el
  hook espera `total_ars` → proyectaba siempre 0. `smoothingWindow` se
  aceptaba pero se ignoraba: ahora aplica media móvil centrada.
- KPIs de Lotes sin `icon`, ConfirmDialog de Devoluciones con `children` en
  vez de `trigger`, `safeChannel` sin scope en las alertas de stock.

**Promos en el catálogo público** (último pendiente de Phase 3): la RLS de
`promotions` exige auth, así que la vidriera anónima mostraba un precio y el
POS cobraba otro. Se agregó el RPC security-definer `get_public_promotions`,
que devuelve **solo** promos ya públicas por definición (activas, en ventana,
sin `coupon_code`, de tipo percentage/fixed y alcance all/products/categories)
y **nunca** el código de cupón. `PublicCatalogPage` vuelca el mejor precio
sobre `discount_price_ars`, así badges, % OFF, combos y el mensaje de WhatsApp
quedan consistentes solos.
*Verificado contra producción como rol `anon`: la promo pública se ve, la de
cupón queda filtrada, filas de prueba eliminadas.*

**Migraciones aplicadas:** `products_supplier_id`, `debt_payments`,
`audit_logs_rich_fields`, `product_variants_barcode`,
`public_promotions_rpc`.

**CI:** el typecheck pasa a bloqueante (la deuda llegó a 0, venía de ~810).

### Sesión 84 — Hardening: índices por org_id + auditoría de dependencias (2026-07-28)

**Índices por `org_id` (59 tablas → 0).** Toda policy de RLS evalúa
`is_org_member(org_id, auth.uid())` y toda query filtra por `org_id`, pero 59
tablas no tenían ningún índice que liderara con esa columna: cada lectura era
un seq scan sobre las filas de **todas** las organizaciones, o sea un costo que
crece con el total de clientes del SaaS y no con los datos del que consulta.
La migración los crea dinámicamente como `(org_id, created_at DESC)` cuando la
tabla tiene `created_at` y `(org_id)` si no. Las tablas calientes (sales,
products, customers, expenses, purchases) ya estaban bien.

**`afip_padron_cache`** tiene RLS con cero policies **a propósito**: es un caché
global con clave CUIT y sin `org_id`; una policy para `authenticated` dejaría
ver a quién le factura cada negocio. Se documentó con `COMMENT ON TABLE` para
que una auditoría futura no lo "corrija".

**Dependencias: 35 vulnerabilidades → 18, las 2 críticas eliminadas.**
En producción (lo que llega al browser): 7 → 3. Solo cambió el lockfile, ningún
salto de versión directo. Queda:
- `xlsx` (high, ReDoS + prototype pollution): **sin fix en npm** — SheetJS se
  distribuye por su propio CDN desde la 0.19. Se usa lazy-loaded en 6 lugares
  (import/export de Excel). Migrar la fuente del paquete es una decisión aparte.
- `react-router` (moderate, open redirect vía backslash en `<Link>`/`useNavigate`):
  **no es alcanzable en esta app** — se auditaron todos los `navigate()` y son
  rutas literales o mapas estáticos; el único branch con path variable
  (`action.type === "navigate"` del asistente) está declarado pero ningún código
  lo produce. El fix exige react-router 7 (major), que no se justifica por una
  vuln inalcanzable.
- El resto (15) es tooling de build: eslint 10, vite 8, `@sentry/vite-plugin` 5,
  todos majors de dev.

**CI:** nuevo job `security`. Bloqueante en `npm audit --omit=dev
--audit-level=critical` (gate que hoy pasa y frena lo urgente de verdad) más un
audit completo informativo. Subir a `high` cuando se resuelva `xlsx`.

### Sesión 85 — Seguridad enterprise, POS offline, crons y MercadoLibre (2026-07-29)

**Los 13 cron jobs estaban fallando, todos.** Apareció buscando por qué no
salían los emails de las secuencias: `cron.job_run_details` daba `failed` en
todo. La mayoría llamaba `current_setting('app.supabase_url')` y
`app.service_role_key`, ajustes nunca configurados; `send-drip-emails` tenía
literalmente los placeholders del ejemplo de la doc. No corrían alertas de
stock, avisos de deuda, reactivación, KPI diario, digest semanal,
automatizaciones ni campañas. Se unificó todo en `invoke_edge_function()`, que
lee del vault. Verificado: HTTP 200 `{"ok":true,"alerts":1}`. Ver `docs/CRON.md`.

**2FA no protegía nada.** El perfil permitía enrolar TOTP, pero nada chequeaba
el nivel AAL de la sesión: con la contraseña sola se entraba igual. Nuevo
`MfaGate` + enforcement por organización. La decisión vive en `decideMfaState()`,
función pura con 8 tests.

**Los 16 módulos de permisos eran decorativos.** Solo 4 páginas los consultaban,
y aunque el sidebar ocultara un ítem, con la URL se entraba igual. `moduleMap`
+ `PermissionsProvider` (una query en vez de una por módulo) + `ModuleGuard`.
Alcance documentado: es una barrera de interfaz, el límite real es la RLS.

**Derecho de supresión (Ley 25.326).** RPC `anonymize_customer`: no borra las
ventas — AFIP exige conservarlas — sino que reemplaza el PII por un seudónimo
estable. No lista las tablas a mano: recorre el catálogo, así que una tabla
nueva queda cubierta sola. Más export completo a ZIP (33 tablas, 10 tests
sobre el armado del CSV).

**El POS no servía offline.** Tres bugs: las ventas offline quedaban invisibles
al reabrir (se leía la clave `...default` porque `activeOrg` aún no había
cargado, mientras se guardaba con el id real); el `Promise.all` de 5 consultas
dejaba la caja cargando para siempre sin señal; y el caché de la API duraba 5
minutos. Ahora hay snapshot local del catálogo, `allSettled`, caché de 24 h y
auto-sincronización al recuperar señal.

**Índices por `org_id`** en 59 tablas que no los tenían: cada lectura era un
seq scan sobre las filas de todas las organizaciones.

**Dependencias:** 35 vulnerabilidades → 18, las 2 críticas eliminadas. En
producción 7 → 3. Nuevo job `security` en CI.

**MercadoLibre — capa de conexión.** Esquema (`meli_connections`,
`meli_listings`, `meli_orders`), Edge Functions `meli-oauth` y `meli-sync`
(publicar, sincronizar stock/precio, bajar órdenes) y panel en Integraciones.
Los tokens viven en una tabla con RLS y cero policies: la UI lee la vista
`meli_connection_status`, que no los expone. **Bloquea la categoría `vaper`
del lado del servidor**: ANMAT los tiene prohibidos y publicarlos trae sanción.
Falta (ver `docs/MERCADOLIBRE.md`): botón de publicar en la ficha del producto
con el predictor de categorías, importar órdenes como ventas, webhook de ML y
cron multi-organización. **Bloqueado hasta que se cree la app en
developers.mercadolibre.com.ar y se carguen las credenciales.**

### Sesión 108 — Relevamiento legal de las tres superficies (2026-08-11)

Se venía construyendo funcionalidad sin revisar contra qué normativa. La sesión
anterior encodeó el arrepentimiento en el RPC; ésta fue a ver **qué más falta**,
requisito por requisito, en la tienda, el CRM y el panel de plataforma.

Resultado en [docs/LEGAL.md](docs/LEGAL.md) y como bloque **F** en §5 (17 ítems).
Lo que hay que saber sin leerlo entero:

**Lo más caro es también lo más barato de arreglar.** Los cuatro ítems en rojo
que Defensa del Consumidor y la AAIP detectan de oficio —política de privacidad,
botón de arrepentimiento en la home, datos del proveedor, link a la Ventanilla
Única— son **cuatro páginas y un link**. Ninguno depende de un trámite externo.

**No hay política de privacidad.** Medido contra `store_pages`: hay
`terminos-y-condiciones`, `cambios-y-devoluciones`, `preguntas-frecuentes` y
`sobre-nosotros`, las cuatro publicadas. Falta la de privacidad, que la Ley
25.326 exige apenas se recolecta un email — y se recolectan varios.

**Los datos se alojan en Estados Unidos y eso hay que declararlo.** Supabase
corre en AWS `us-east-1`. Para la AAIP, Estados Unidos **no** tiene nivel
adecuado de protección, así que la transferencia necesita cláusulas o
consentimiento informado. Es un párrafo en la política de privacidad, pero hay
que escribirlo a propósito: nadie lo descubre solo.

**El descuento por medio de pago toca la Ley 25.065.** El art. 37 prohíbe cobrar
más por tarjeta. Un descuento por transferencia es práctica extendida y hubo
cambios normativos, pero la lectura no es unánime. Se anota como **F14 y se
deriva a un profesional**: no es una decisión que deba tomar el código, y menos
en silencio.

**El marco de plataforma no está escrito.** La plataforma es *encargada* del
tratamiento y el comercio *responsable* (art. 25). No hay contrato entre los dos
que diga qué puede hacer la plataforma con los datos de los clientes del
comercio. Va de la mano con que el comercio pueda ver cuándo soporte entró a su
cuenta —`admin_audit_logs` ya lo registra, falta mostrárselo— y con poder llevarse
su negocio entero al irse.

**Lo que ya estaba bien, y conviene no romper:** RLS por organización verificada
con roles reales, MFA sin excepción para staff, credenciales fuera del navegador
con tablas de cero policies, export y borrado de datos por persona, baja de las
secuencias de email, y la separación entre `store_customers` y `customers` — que
es lo que evita que el comprador de un perfume termine siendo usuario del SaaS.

El documento aclara arriba de todo que **no es asesoramiento legal**. Lo que
aporta es dónde está cada cosa en el código, para que la consulta al abogado sea
corta y concreta en vez de empezar de cero.

### Sesión 103 — Las promociones, también online (2026-08-06)

`promotions` ya se aplicaba en el POS y se mostraba en los dos catálogos. La
tienda online era la única superficie que la ignoraba: el comercio creaba "20%
off en Perfume Árabe", se descontaba en el mostrador y online se cobraba pleno.

**Van tres casos iguales** —`price_2x_ars`, las categorías, y ahora esto—, así
que queda como regla: al agregar una mecánica de precio hay que revisar **las
cuatro superficies**, no la que se está tocando.

La promoción se resuelve dentro del precio de la línea y no como un descuento
aparte, porque una promoción *es* un precio: así el volumen, el cupón y el medio
de pago trabajan después sobre el número correcto. Gana el mejor, nunca la suma.

Quedan afuera a propósito las que tienen cupón (van por el flujo de cupones),
`buy_x_get_y`/`bundle`/`free_shipping` (necesitan lógica de carrito) y
`applies_to = customers` (es de orden, no de línea).

Nueve casos verificados, y la tienda muestra lo que cobra vía
`store_catalog_products.promo_price`.

### Sesión 102 — Descuento por cantidad, general (2026-08-06)

Lo único que había era `price_2x_ars`: precio fijo para dos unidades, a mano y
sólo en vapers. Ahora hay reglas: "llevando 3 o más, 15% off", con alcance
todos/categoría/producto.

**Por producto gana el mejor, nunca la suma** — misma regla que la oferta con el
medio de pago. Entre varias reglas gana la de mayor descuento, no la más
específica. La cantidad se cuenta cruzando líneas, igual que el 2x.

Verificado con siete casos: el clave es que **una regla floja no se suma al 2x**.
Y el carrito muestra lo mismo que se cobra gracias a
`get_store_quantity_discounts`: sin ese RPC el espejo del cliente no podía ver
las reglas, que es el bug que este repo evita en cada cálculo de plata.

### Sesión 101 — El buscador sugiere mientras se escribe (2026-08-06)

Antes había que escribir, apretar Enter y esperar el catálogo para saber si
existía lo buscado. **Primero marcas y categorías, después productos**: son
atajos a muchos productos y quien escribe "lattafa" quiere ver la marca, no un
perfume puntual. Verificado en la tienda: sugiere "LATTAFA · Marca · 19
productos" y recién después los perfumes.

Cuatro decisiones: con menos de dos letras no sugiere nada; no ofrece lo agotado
salvo que sea lo único que hay —la ficha ofrece avisar cuando vuelva—; la flecha
arriba desde el primero vuelve a "nada seleccionado" para que Enter no navegue a
algo que el comprador no eligió; y encuentra la categoría por su nombre visible,
no por el slug.

El desplegable usa `onMouseDown` y no `onClick`: el `blur` del input dispara
antes que el click y se cerraba sin navegar. Todo sobre el catálogo en memoria,
sin una consulta por tecla.

### Sesión 100 — Ofertas reales: cuándo el medio de pago sí se suma (2026-08-06)

La sesión anterior frenó el descuento doble, pero dejaba afuera la otra mitad:
en una liquidación de verdad el descuento por transferencia **sí** corresponde.
Un producto rebajado de 100.000 a 70.000 sigue teniendo el 20% encima.

Eso no se deduce del número: `discount_price_ars` significa las dos cosas según
qué quiso hacer el comercio. Ahora lo decide él, con
`ecommerce_stores.payment_discount_stacks` como política y
`products.offer_stacks_payment` para pisarla por producto. El default es
**false** porque los dos errores no cuestan lo mismo: cobrar de más se corrige
porque el comprador se queja; regalar margen no avisa nadie.

La base se resuelve en `store_catalog_products.payment_base_price`, no en el
cliente: así el storefront muestra el precio sin conocer la política, y la regla
queda junto a la que usa `create_store_order` al cobrar.

Dos cosas que costaron: `CREATE OR REPLACE VIEW` sólo deja agregar columnas **al
final** (42P16 si no), y la vista sólo unía `settings` — hubo que sumarle el
JOIN a `ecommerce_stores`.

### Sesión 99 — La oferta y el medio de pago dejaron de acumularse (2026-08-06)

Lo reportó el dueño mirando su propia tienda: un vaper de lista 38.640 con
oferta 30.912 (20% off) mostraba "24.730 con transferencia (20% OFF)". Son
**36% de descuento real**, no 20 — el porcentaje del medio de pago se aplicaba
sobre un subtotal que ya venía con el precio de oferta. Y el precio tachado
tampoco cerraba con nada.

**La regla: no se acumulan, se cobra el mejor.** El descuento del medio se mide
por línea contra el precio de **lista**, así que si la oferta ya deja el precio
por debajo no descuenta nada más. No es "sólo la oferta": si el medio es mejor
—oferta del 10% con transferencia del 20%— gana el medio, porque publicar "20%
OFF con transferencia" y cobrar el 10% sería romper la promesa. Los cuatro
casos verificados contra la base.

Para poder compararlo, `resolve_store_line` ahora lleva `list_price` en la
línea; con una variante que tiene `price_override`, su lista es ese precio
propio. Las dos funciones se regeneraron desde producción con script.

En la ficha el cartel del medio de pago **sólo aparece si mejora** lo que ya se
paga: anunciarlo al lado de un número idéntico hace dudar de los dos.

### Sesión 98 — Completá tu compra (2026-08-06)

En la ficha ya había "También te puede gustar", que es descubrimiento. El
carrito no ofrecía nada, y es el momento del embudo donde un agregado cuesta
menos: el comprador ya decidió.

**La regla que lo separa de una vidriera más: primero lo que completa el envío
gratis.** Si faltan $18.000, un producto de $20.000 no es otra sugerencia — es
la que convierte ese gasto en algo que además le ahorra el envío. Con tope de
1,6× lo que falta: uno que pasa el umbral por cinco veces no completa nada,
sólo parece un intento de vender más caro. Después manda la afinidad (marca,
categoría) y al final lo más vendido, que es el desempate honesto.

Dentro de cada motivo se ofrece lo más barato: es un agregado, no un reemplazo.
Un producto con variantes abre la ficha en vez de agregarse solo, porque hace
falta elegir sabor o tamaño. Verificado en el navegador: con $52.594 faltando,
sugiere tres de $52.992 a $54.464.

De paso quedó comprobado que **el panel de liquidaciones ya existía** y está
montado en Libro mayor: muestra el desglose de cada cobro y la fecha de
acreditación. Lo que se pensaba como "Gestiona Pagos" está hecho salvo la marca.

### Sesión 97 — Subcategorías y despliegue del menú (2026-08-06)

`parent_id` estaba en la tabla y en el RPC desde el principio, sin usar. Lo que
hace que sirva no es el árbol sino que **entrar al padre traiga los productos de
las hijas**: sin eso, tocar "Perfumes" da una página vacía y el comprador
concluye que no hay stock. Verificado: filtrar por el padre devuelve 55, que son
54 + 1.

El corolario apareció mirando la tienda, no el código: el menú llevaba la lista
**plana**, así que agarraba dos hijas, el padre no salía nunca y tampoco su
desplegable. Ahora lleva sólo primer nivel, contando `productosEnRama` para que
un padre sin productos propios entre igual.

El árbol aguanta ciclo (si no, bucle infinito en el render), hija con padre
ausente —pasa al esconder el padre— y elegirse a sí misma como padre. En el
celular las hijas van indentadas y visibles: no hay hover, y un submenú que pide
otro toque esconde lo que el comprador vino a buscar.

### Sesión 96 — El menú lo arma el comercio (2026-08-05)

El menú se armaba solo y no se podía tocar. Ahora se guarda en `nav_links`
(jsonb en la tienda), y **vacío significa "armalo solo"**: por eso aplicar la
migración no cambia ninguna tienda. Un paso más: si todos los links quedaron
rotos —una categoría borrada, una página despublicada— se vuelve al automático,
porque el header no puede quedarse sin forma de llegar al catálogo.

Dos cosas que valen más que la feature: sólo se aceptan http y https —un
`javascript:` en el menú es un XSS servido, y se valida al guardar **y otra vez
al mostrar**, porque una fila vieja no pasó por el formulario de hoy— y los
links externos salen del router, que con `<Link>` darían 404. El menú se dibuja
en tres lados, así que esa decisión vive en un solo componente.

`get_store_by_slug` se regeneró desde producción con la columna al final de la
firma: tiene cuatro llamadores reales y los cuatro leen por nombre de campo.

### Sesión 95 — Las categorías dejan de estar hardcodeadas (2026-08-05)

Comparando la tienda contra Tiendanube feature por feature, casi todo ya
estaba: cuotas, envío gratis con barra de progreso, reseñas, preguntas,
wishlist, cupones, carritos abandonados, feed para Google y Meta —verificado,
emite 50 ítems sanos—, sitemap, píxeles y seguimiento. Lo que faltaba era otra
cosa, y era estructural.

**El nombre de una categoría salía de un `Record` hardcodeado con cuatro
entradas de perfumería.** En una plataforma multi-tenant eso significa que
quien venda ropa ve el slug crudo, y que nadie puede renombrar, ordenar,
esconder ni ponerle una foto a una categoría sin tocar código. Es de las
primeras cosas que Tiendanube deja hacer.

La tabla `ecommerce_categories` ya existía con la forma correcta —jerárquica,
con slug, orden e imagen— **vacía y sin usar por ningún código**, y el RPC
`get_store_categories` también, del andamiaje inicial. Mismo caso que el stock
por sucursal en la sesión 92: la estructura estaba, faltaba conectarla.

Lo que **no** cambia es `products.category`: sigue guardando el slug y sigue
siendo lo que usan el POS, los precios por categoría y las ofertas masivas.
Esta migración le agrega nombre, orden y presentación a ese slug. Tocar la
columna habría obligado a migrar seis pantallas de una vez y a reescribir
`category_pricing`, que se indexa por slug.

Por eso el día que se aplica **la tienda se ve exactamente igual**: verificado
en el navegador antes y después. Sin categorías propias el menú sigue saliendo
de los slugs de los productos con los nombres viejos; con categorías cargadas
manda lo que puso el comercio. Renombrar "Vaper" y subirla al primer lugar se
propagó al menú del header y a las tarjetas de la portada.

Dos cosas que costaron y conviene no repetir:

- **El `DROP FUNCTION` de un RPC público.** Hacía falta porque cambiaba el tipo
  de retorno. Antes de dropearlo verifiqué con grep sobre `src`, `api` y las
  edge functions que **no lo llamara nadie** y que la tabla estuviera vacía. Sin
  ese chequeo, dropear un RPC público es exactamente el cambio que rompe la
  tienda en silencio.
- **Dos falsos positivos de agujero de seguridad, los dos míos.** El primero:
  un bloque `DO $` corre como superusuario y **bypassa la RLS**, así que el
  test decía que anon y otra organización leían la tabla. Corriendo con
  `SET ROLE anon` de verdad —que es lo que CLAUDE.md dice y yo me salteé— dan
  0 y 0. El segundo: el RPC público parecía devolver 0 filas para anon, y era
  que el subquery que le pasaba el slug corre en el contexto del **llamador**,
  no dentro de la función definer; con el slug literal devuelve las 3 con sus
  conteos.

### Sesión 94 — La promo que el comercio ya tenía cargada (2026-08-05)

`price_2x_ars` —el precio llevando dos— existía en la tabla, en la vista
pública `store_catalog_products`, en el select de `publicDataSource.ts` y se
mostraba en el catálogo por WhatsApp y en la página pública. **La tienda online
era la única superficie que lo ignoraba.** El comercio tenía la promo cargada,
la estaba publicando en otro lado, y su propia tienda cobraba el precio pleno.

Medido contra la base: LOST MARY DURA, oferta 26.496 c/u y 2x 36.000 — en la
tienda pagabas 52.992 por dos. ELFBAR ICE KING 40K, oferta 30.912 y 2x 42.000 —
pagabas 61.824. Alguien que vio el catálogo por WhatsApp y entró a la tienda
encontraba otro precio, que es la clase de inconsistencia que hace dudar del
resto.

**La decisión que define la implementación es que el ahorro se cuenta por
producto, cruzando líneas.** Los dos productos con promo son vapers con 9 y 10
sabores, así que la compra real —"uno de frutilla y otro de uva"— llega al RPC
como dos líneas de una unidad. Una regla que mirara `quantity >= 2` por línea
no habría disparado **nunca**, y el bug habría quedado escondido detrás de una
función que "ya lo contempla". Se verificó justamente ese caso contra
producción: dos sabores distintos descuentan 19.824.

Dónde entra en la cuenta, que tampoco es obvio: va como descuento y no bajando
el subtotal —el subtotal guardado tiene que seguir siendo la suma de los ítems
o la orden no cierra contra su propio detalle— pero se resta **antes** del
cupón, porque la promo es un precio y no una rebaja. Un 10% off sobre un precio
que nadie paga sería regalar plata. El descuento por medio de pago sigue
último.

`create_store_order` se regeneró **desde la definición que está en producción**,
insertando los cambios con un script, no reescribiéndola de memoria: es la
misma función que casi se rompe en la sesión 90 al derivarla de un fragmento.

En el navegador, con dos sabores en el carrito: subtotal 61.824, promo −19.824,
total de mercadería 42.000 — exactamente el precio 2x. El "te faltan X para el
envío gratis" también pasó a calcularse sobre el neto, que es lo que el
comprador realmente paga.

### Sesión 93 — Preguntas en la tienda, y quién factura de verdad (2026-08-05)

**Preguntar sobre un producto**, que tiene MercadoLibre y no tiene Tiendanube.
En perfumería la objeción que frena la compra no es el precio: es "¿es
original?", "¿cuánto dura?". Hoy llegan por WhatsApp y se contestan de nuevo
cada vez. Dos decisiones definen el producto: **sólo se publican las
respondidas** —una tira de preguntas sin contestar dice que acá no atiende
nadie— y **preguntar pide cuenta, no compra**, que es toda la diferencia con
las reseñas: el que pregunta todavía no compró. Tope de 5 pendientes por
persona, o alguien deja cincuenta en un minuto. Del lado del comercio va en la
pestaña de Opiniones, ahora "Opiniones y preguntas", con el filtro arrancando
en "Sin responder": es lo único accionable de esa pantalla.

La verificación contra producción encontró que `RETURNS TABLE (id uuid, …)`
declara una variable `id` que choca con la columna en cualquier `SELECT` de
adentro de la función — `get_my_questions` abortaba con 42702. Y mirando la
ficha en el navegador aparecieron dos bugs viejos: `{(a?.length || b?.length)
&& …}` con las dos vacías evalúa a `0` y **React imprime el cero**, así que
había un 0 suelto en la página de casi todos los productos; y "Perfil olfativo"
se mostraba con el título y nada debajo, porque la fila de detalle se crea al
abrir la ficha en gestión aunque quede vacía.

**Negocio por comercio, en súper administración.** La plataforma cobra 5% por
venta y hasta acá sólo podía ver el total del mes: `platform_revenue_monthly`
agrupa por mes y moneda, no por comercio. La primera pregunta de cualquiera que
opera un marketplace es "¿quién me da la plata?" y la segunda "¿quién dejó de
dármela?", y ninguna se podía contestar sin escribir SQL a mano. El MRR de
suscripciones tampoco alcanza: un comercio puede estar al día con el plan y no
haber vendido en dos meses, y ése es justo el que se da de baja.

`platform_org_health` deriva una señal por comercio — `sin_activar`
(onboarding roto, no churn), `en_riesgo`, `cayendo`, `dormido`, `creciendo`,
`estable` — y la pantalla nueva (`/platform/negocio`) ordena por urgencia, no
alfabéticamente. El KPI que importa es **GMV en riesgo**, medido con el mes
anterior: lo que el comercio demostró que puede facturar es lo que se pierde si
nadie llama. La vista va **sin** `security_invoker` a propósito y filtra por
`is_platform_admin()` adentro; verificado con tres roles reales — staff ve las
4 organizaciones, el dueño de una organización ve 0, anónimo ve 0 — y el total
de comisión de la vista cuadra con la tabla cruda.

**Completar el tarifario de envíos.** El ítem #1 de §5, y lo que este documento
decía de él era falso: no es que un comprador de otra provincia reciba "No hay
envío disponible" — el retiro en local está habilitado, así que recibe **una**
opción, ir a buscarlo a CABA. Alguien en Ushuaia ve un checkout que parece
funcionar. Verificado con el RPC real `quote_store_shipping` sobre Buenos
Aires: antes 1 opción (retiro), después de cargar la tarifa 2 (retiro + Correo
Argentino a domicilio $14.000), y sobre los $150.000 las dos dan $0.

El botón nuevo estima las 6 zonas por **distancia de las provincias que
contienen**, no por el nombre de la zona. La banda de una zona es la de su
provincia más lejana y no el promedio: Patagonia tiene Neuquén y Tierra del
Fuego, y cotizar el promedio es vender a pérdida justo en el despacho más caro.
Nunca pisa lo cargado a mano y muestra las filas antes de crearlas.

El aviso amarillo de esa pantalla también era engañoso: decía "N provincias sin
zona", pero las 6 zonas por defecto cubren el país entero, así que estaba
callado mientras 23 provincias no podían comprar. Tener zona no alcanza — hace
falta que además tenga tarifa.

**Calidad de las publicaciones**, que es la herramienta de merchandising más
conocida de MercadoLibre y Tiendanube no tiene. Antes de escribirla se midió si
había algo que mostrar, y lo había: **10 de 60** productos activos publicados
**sin foto**, **59 de 60 sin peso**, 33 con descripción de menos de 80
caracteres, y las 30 filas de `product_perfume_details` que existen están
**todas vacías** — por eso no se hizo el filtro por familia olfativa que parecía
el próximo paso obvio: habría filtrado sobre nada.

El panel ordena por **impacto total** (productos × puntos), no por cuántos
productos tienen cada cosa mal. Verificado con el espejo en SQL: primero el
peso (59 × 15 = 885), último el SKU (60 × 2 = 120) aunque le falte a los 60.
Cargarle el SKU a todo el catálogo es más trabajo y rinde menos que sacarle la
foto a los diez que no la tienen. El peso además es el único ítem que cuesta
plata **en cada venta** y no ventas perdidas: sin él el envío se cotiza con los
0,5 kg por defecto.

Cada línea del ranking filtra el listado de abajo — una lista de pendientes que
no lleva a ningún lado no se completa nunca.

**Completar pesos**, que cierra ese círculo: el panel decía "59 sin peso" y
filtraba la lista, pero arreglarlo eran 59 diálogos. Se estima del contenido en
ml —los 60 lo tienen cargado, 54 son de 100 ml— con vista previa y sin pisar lo
cargado a mano. Mismo patrón que "Completar el tarifario", y por la misma
razón.

⚠️ **Y midiendo el efecto se cayó una afirmación de este mismo documento**, que
se había escrito dos commits antes sin verificarla. Decía que sin peso "cada
despacho más pesado se cobra de menos". Es al revés: los 55 perfumes estiman
**0,40 kg** contra un default de 0,50 y **ninguno lo supera**, así que la
tienda cotiza **de más**. Eso no cuesta margen, cuesta ventas — el envío caro
es de las primeras razones por las que se abandona un carrito.

Tres cosas más que aparecieron al medirlo, y que conviene tener presentes antes
de sacar conclusiones sobre envíos:

- El efecto sobre el precio hoy queda **tapado por el envío gratis desde
  $150.000**, que se alcanza a las 3 unidades. Dos cotizaciones consecutivas
  dieron $0 con y sin peso cargado por eso, no porque el peso no importe.
- La única tarifa cargada (CABA) tiene `price_per_extra_kg = 0`, así que ahí el
  excedente de peso **no se cobra en absoluto**. El peso empieza a mover el
  precio recién con las tarifas que genera "Completar el tarifario", que sí lo
  llevan.
- `store_cart_weight_kg` usa `products.weight_kg` cuando es > 0 y el default de
  la tienda si no — verificado leyendo la función, que es el eslabón del que
  depende todo lo anterior.

Por eso `kilosSubestimados` pasó a ser `diferenciaContraDefault`, que devuelve
las dos direcciones por separado: cotizar de más y cotizar de menos no son el
mismo problema, y un neto habría escondido cuál está pasando.

### Sesión 92 — El stock se movía dos veces, y nadie lo veía (2026-08-02)

Empezó siendo "stock real por depósito" del §6 y terminó destapando el bug más
caro que había en el sistema.

**Stock por sucursal.** La estructura estaba entera y sin usar: `locations`,
`location_stock`, la página, el `StoreFilter` y un selector en el POS que **ya
guardaba `sales.location_id`**. Faltaba el eslabón del medio —
`record_stock_movement` no sabía de sucursales— así que la venta sabía dónde se
hizo y el stock no.

**La transferencia entre sucursales inventaba mercadería.** Se hacía desde el
navegador con `Math.max(0, stock + delta)` en el origen y un INSERT del delta
completo en el destino. Reproducido: con 10 unidades, transferir 50 dejaba
origen 0 y destino 50, con el total todavía en 10. Cuarenta unidades de la nada.
Ahora va por RPC con `FOR UPDATE`, y `location_stock` pasó a sólo lectura para
la UI — tenía una policy `ALL`, que es por donde se colaba.

**Y el hallazgo grande: cada venta y cada compra movían el stock DOS veces.**
`addSaleDB`, `addSaleWithVariantDB` y `addPurchaseDB` ajustaban `products.stock`
después de insertar la fila, que ya había disparado el trigger. Vender 3 bajaba
6; comprar 5 subía 10. Lo usan el POS, Ventas, Presupuestos y el chat de IA — o
sea, todos los caminos de venta.

Se ve el rastro en producción: 15 productos con el Kardex distinto del stock
real, y varios con el Kardex en **negativo** y el stock positivo. La lectura es
que el doble descuento empujó los números abajo y se los venía corrigiendo a
mano, lo que no deja asiento. El pendiente de "AFNAN 9AM DIVE quedó en 7 y ese
número no es real" era un síntoma de esto.

**No se corrigieron los números.** Reconstruirlos exige saber qué ventas pasaron
por el camino duplicado y cuáles no, y es dato real del negocio: se corrige
contando el inventario. Queda como pendiente del dueño.

Al mirarlo aparecieron tres agujeros más: borrar una venta o una compra no
devolvía el stock; una compra programada sumaba mercadería el día que se pedía
en vez del día que llegaba; y editar sólo ajustaba por diferencia de cantidad,
sin cubrir el cambio de producto, de variante ni de sucursal.

La solución no fue sacar un descuento y dejar el otro, sino que **todo el
movimiento viva en la base**, en INSERT, UPDATE y DELETE. Mientras el cálculo
esté repartido entre cliente y trigger, alguno de los seis lugares que insertan
ventas se va a equivocar — y de hecho se equivocó.

Queda la vista `stock_negativo` como control, y una regla nueva en CLAUDE.md: no
tapar el resultado con `GREATEST(0, ...)`. Eso fue lo que hizo que el descuento
doble pasara desapercibido meses y lo que permitió que la transferencia inventara
unidades.

### Sesión 91 — El CRM deja de cruzar por nombre, y dos bugs mudos (2026-08-02)

Arrancó con una colisión: dos commits locales sin pushear hacían lo mismo que
dos del remoto —el CRM por `customer_id`, escrito en paralelo en las dos PCs—.
Se preguntó cuál sobrevivía, como manda CLAUDE.md, y ganó el remoto: es el
tronco compartido, ya tenía 15 commits encima y se había verificado forzando el
caso. Los locales quedaron en la rama `descartado/crm-customer-id-local` por si
hiciera falta rescatar algo. Es la segunda vez que pasa lo mismo; la regla de
traer el remoto **antes** de planificar no es ceremonia.

Después, los dos bugs que la pantalla no dejaba ver:

**Las notas de cliente decían "guardada" y no guardaban nada.** Los dos caminos
—la nota rápida y la masiva— escribían en `customer_notes` con
`onConflict: 'org_id,customer_name'`. Esa constraint no existe (la real es
`user_id,customer_name`), así que Postgres rechazaba con `42P10`. Y aun si
hubiera entrado, la ficha lee `customers.notes`, otra tabla: la nota no se vería
igual. No se notaba porque `upsert()` no lanza, devuelve el error en `.error`, y
nadie lo miraba — el `catch` nunca corría. La masiva era peor: `Promise.all`
sobre awaits que no lanzan informaba "Nota agregada a N clientes" con N =
seleccionados, aunque no hubiera entrado ninguna. La prueba de que estuvo roto
desde siempre: 26 perfiles y `customer_notes` con **0 filas**.

**Presupuestos y comunicaciones mostraban un tercio del historial.** Eran las
dos últimas tablas del CRM sin `customer_id`, y ni siquiera cruzaban igual entre
sí: `quotes` con `.ilike` y `customer_communications` con `.eq` exacto y
sensible a mayúsculas y tildes. Forzando el caso en producción —el mismo
cliente escrito "ZZ Ana Gómez", "zz ana gomez" y "ZZ  Ana  GÓMEZ"— la lectura
vieja veía **1 de 3** de cada una. No había forma de notarlo desde la UI: los
otros dos tercios no aparecían en ningún lado. Un presupuesto que no se ve es
plata que nadie cobra porque nadie lo siguió.

No hizo falta función nueva: `trg_sales_link_customer` ya era genérica, así que
ahora sirve a las cinco tablas. Del lado del cliente, `crmRowsForCustomer` hace
**dos consultas en vez de un `.or()`** — el `or` de PostgREST se arma
concatenando en una sola cadena, y un nombre con coma o paréntesis ("Pérez,
Juan", "Ana (mayorista)") rompe el filtro o lo convierte calladamente en otro.

También se limpiaron tres pendientes que ya estaban resueltos y seguían
documentados como abiertos (`send-team-invite`, los prefijos duplicados, y el
CRM por nombre).

**El libro de migraciones bajó de 168 a 32 de brecha.** Se escribió
`scripts/reconciliar-migraciones.mjs`, que deduce si una migración está aplicada
extrayendo los objetos que crea y preguntándole al catálogo cuáles existen —
ignorando lo que esté dentro de un bloque `DO`, donde el SQL se arma con
`format()` y los nombres no están en el archivo. Confirmó 131; otras 5 se
verificaron a mano una por una porque son `COMMENT`, `ALTER CONSTRAINT`,
`DROP FUNCTION`, `cron.schedule` y un `DO` dinámico, que el análisis estático no
puede leer.

Las 32 que quedan **no hay que aplicarlas**: 20 son duplicados superados (por
ejemplo `20260523000013_product_bundles` con 2/12 objetos, porque
`20260523000004` ya creó la feature con otros nombres de índice) y 11 crean
módulos que se sacaron del producto.

Y el hallazgo que cambió la evaluación del riesgo: **la migración destructiva
borraba 57 tablas que entre todas tenían 0 filas.** Estaba documentada como
"aplicarla sin backup borra datos"; no borraba ninguno. Estuvo sin correr un año
por miedo a un dato que no existía. Con eso claro se aplicó, previa verificación
de que ningún código las referenciara y posterior de que el `CASCADE` no se
hubiera llevado nada de la tienda pública — las 15 relaciones y funciones del
storefront siguen ahí y `get_store_by_slug` responde como rol `anon`.

**Y `db push` volvió a servir.** Cerrarlo necesitó dos cosas más que el libro:
registrar las 18 migraciones superadas por un duplicado, borrar del repo las 13
que crean módulos retirados (44 tablas que no existen ni usa ningún código —
dejarlas sólo servía para que un `push` las resucitara), y renombrar 12 archivos
cuya versión no tenía **14 dígitos exactos**. Eso último era el bloqueo real y
el más difícil de leer: con 8, 10 o 16 dígitos el CLI no ve el archivo, y el
error que tira —`LegacyDbPushMissingLocalError`, "remote migration versions not
found in local migrations directory"— apunta a la parte equivocada del problema.
Se renombraron preservando el orden lexicográfico y actualizando el libro en la
misma pasada. Hoy `db push --dry-run` responde
`{"upToDate":true,"migrations":[]}`.

Otra cosa que quedó documentada porque cuesta una hora descubrirla: **esta PC no
tiene `.env`**, así que el front local levanta pero no se conecta a ninguna base
y la tienda pública dice "Tienda no encontrada" teniendo la tienda activa. No es
un bug. Sin `.env`, el navegador sólo prueba que compila.

**Recepción parcial de órdenes de compra.** El ROADMAP decía "se recibe entera o
nada"; el código no recibía nada: "Marcar recibida" cambiaba el estado y la
fecha, sin tocar `quantity_received` —que existía y quedaba en 0 para siempre—
ni mover una unidad de stock. El estado `partially_received` estaba en el
vocabulario y en la UI con su color ámbar, y no había forma de alcanzarlo.

Ahora todo pasa por el RPC `receive_purchase_order`, que valida contra lo
pendiente, **inserta en `purchases`** para que `trg_purchase_stock_movement`
mueva el stock —escribirlo a mano habría duplicado el movimiento, el error que
este repo ya cometió una vez— deja la entrega en `purchase_order_receipts` y
recalcula el estado desde los renglones. Recibir de más se rechaza con el nombre
del producto y el faltante, en vez de recortar en silencio.

En el camino apareció un bug de aislamiento entre organizaciones:
`trg_purchase_stock_movement` derivaba la organización de la **primera membresía
del usuario** en vez de usar `NEW.org_id`, que existe y es NOT NULL. Para alguien
que pertenece a dos organizaciones, una compra cargada en la segunda movía el
stock de la primera. Había que arreglarlo igual, porque la recepción de OC
depende de eso.

De paso, el informe destapó que 6 tablas creadas en las sesiones 86–90
(`store_banners`, `store_pages`, `store_stock_alerts`, `store_wishlists`,
`platform_commission_rules`, `oauth_states`) habían quedado **sin índice por
`org_id`** — el mismo problema que `20260730000006` había arreglado para 59
tablas. Se volvió a correr esa migración, que es idempotente por diseño, y ahora
no queda ninguna.

Lo que **no** se verificó: el flujo logueado en el navegador. `/clientes` está
detrás del login y no corresponde que la sesión cargue credenciales, así que se
comprobó que compila y carga sin errores de consola, y el resto se verificó
contra la base ejecutando como rol `authenticated` con los claims de un miembro
real, para que la RLS se evaluara de verdad.

### Sesión 90 — La primera venta real, y los cuatro bugs que destapó (2026-07-31)

La sesión empezó queriendo cerrar el ciclo de envío y terminó siendo, sobre
todo, la primera vez que una compra de verdad recorrió el sistema entero. Dos
compras de $1, acreditadas en MercadoPago, con el `application_fee` de $0,05
derivado a la plataforma. El circuito de plata funciona.

Llegar hasta ahí destapó cosas que ninguna lectura del código encontró:

**La firma del webhook nunca validaba.** Con `MP_WEBHOOK_SECRET` configurado,
toda notificación con firma inválida devuelve 401 — y ninguna validaba jamás,
por dos causas independientes: faltaba el punto y coma final del manifiesto que
MercadoPago firma, y el parseo del header se rompía con un espacio
(`Object.fromEntries` dejaba la clave como `" v1"`). Resultado: la compra
quedaba pagada y acreditada del lado de MercadoPago y en "esperando el pago" del
lado de la tienda, para siempre. Lo peor era que **no había dónde mirar**: el
401 era mudo, `payment_transactions` vacía, y la orden simplemente no cambiaba.

**La venta online era la única que no registraba su liquidación.** La rama de
`ecom:` salía por un `return` temprano y nunca llegaba a
`recordPaymentTransaction`. Justo el canal que cobra comisión de plataforma era
el único que no la anotaba.

**La tienda decía "Activa" mientras 22 de 23 provincias no podían comprar.**
`canQuote` se conformaba con que **alguna** zona tuviera tarifa, y
`coveredProvinces` contaba provincias con zona, tuviera tarifas o no. Como las
6 zonas cubren las 23 provincias, daba cobertura completa. Se descubrió porque
la primera orden de prueba, a Santa Fe, murió antes de llegar al pago.

**El id de pago vivía en `tracking_number`.** Al comprador se le mostraba
"Seguimiento: 170468158111", un número que no le sirve a ningún correo, y al
despachar de verdad el número de envío pisaba el id de pago.

Y dos de MFA, encadenados: cancelar el alta de 2FA una sola vez dejaba un factor
sin verificar que **bloqueaba la activación para siempre** —y ese factor no se
veía en ninguna parte de la UI—; arreglarlo destapó que el QR se armaba con el
SVG del QR en vez de con la URI, lo que tiraba Perfil en pantalla blanca.
Nunca se había podido completar el alta de 2FA de punta a punta.

**Lo construido:** despachar una orden con etiqueta imprimible y seguimiento que
el comprador ve sin cuenta; el CRM cruzando por `customer_id` en vez de por
cómo se escribió el nombre; y una limpieza grande de credenciales.

**Credenciales.** Integraciones ofrecía OAuth y, más abajo, un campo para pegar
el token a mano — dos caminos para lo mismo, y el peor de los dos. Escribir el
test guardia encontró lo que la limpieza a ojo no: tres pantallas preguntaban
"¿hay MercadoPago?" mirando la columna vacía, así que respondían que no se podía
cobrar mientras la cuenta estaba conectada. Y la clave privada de AFIP vivía en
`settings`, que cualquier miembro de la organización puede leer.

**Se fueron Tiendanube (API) y Shopify**, con 0 conexiones cada una: cinco Edge
Functions borradas también de producción, tres tablas y cuatro columnas.
Sobrevive el importador de planillas, que no usa API y es el camino de entrada
para quien se cambia. **Stripe no se tocó**: parece una integración más y es la
facturación del propio SaaS, con dos suscripciones vivas.

Sobre OAuth donde se pidió: MercadoPago, MercadoLibre y Tiendanube ya lo tenían.
Correo Argentino, Andreani, AFIP y Evolution **no lo ofrecen** — no es que falte
implementarlo. Para AFIP lo más parecido es que cada comercio delegue el
servicio WSFE al CUIT de la plataforma desde "Administrador de Relaciones"; la
estructura nueva sirve para ese modelo sin cambios.

### Sesión 88 — Vitrina: banners, precio, deseos y reposición (2026-07-30)

Tres ítems de paridad, y un arreglo que apareció haciéndolos.

**Banners con vigencia** (`20260731000009`). Había un solo `banner_url` sin
enlace ni fecha. Ahora hay filas con título, CTA, orden y ventana de vigencia
resuelta en el servidor. El slider no aparece con un solo banner, frena el
autoplay al pasar el mouse y respeta `prefers-reduced-motion`.

**Filtro por rango de precio**, en la URL como el resto, con los extremos
reales del catálogo como placeholders.

**Deseos y aviso de reposición** (`20260731000010`/`11`). Los deseos piden
cuenta; el aviso, no — quien ve "sin stock" y se va ya es una venta perdida.

Haciéndolo apareció que **la tienda escondía lo agotado**: `catalog_products`
filtra `stock > 0`, así que la ficha devolvía "Producto no encontrado" y con
ella se perdían la URL indexada y la señal de qué reponer. Se agregó
`store_catalog_products`, hermana sin ese filtro — hermana y no un cambio a la
existente, que la leen el catálogo por WhatsApp y la página pública.

Dos guardas hicieron su trabajo: el test de producción encontró que
`UNIQUE (product_id, variant_id, email)` no deduplicaba con `variant_id` NULL
(NULL nunca es igual a NULL, el `ON CONFLICT` no disparaba); y
`edgeFunctionAuth.test.ts` falló apenas apareció una función que manda emails
sin declararse como cron.

### Sesión 87 — Reseñas y páginas de contenido (2026-07-30)

Dos huecos que separaban la tienda de una de Tiendanube, ninguno cosmético.

**Reseñas** (`20260731000007`). La regla es una: sólo reseña quien compró y
pagó, validado contra `ecommerce_orders`. Y se valida dos veces —
`can_review_product` decide qué mostrar, `upsert_product_review` es la barrera.
Una opinión por comprador y producto; editarla la republica. El comercio no
puede editar lo que escribió el cliente: sólo ocultarlo o responderle. En la
grilla la estrella aparece sólo si hay opiniones.

**Páginas de contenido** (`20260731000008`). No es maquillaje: la Ley 24.240
obliga a publicar el botón de arrepentimiento, y MercadoPago pide ver las
políticas antes de habilitar la cuenta de vendedor. Cuatro páginas editables
con URL propia, listadas en el footer, sembradas como borradores ya redactados
para Argentina — una tienda que arranca con las páginas vacías las deja
vacías. El markdown se parsea a elementos de React, nunca a HTML: el texto lo
escribe el comercio y se sirve con la sesión del comprador viva.
`miniMarkdown.test.tsx` fija eso como invariante.

De paso, `types.ts` dejó de estar truncado.

### Sesión 86 — Tienda online completa: de vitrina a ecommerce (2026-07-30)

**La tienda online no existía.** El panel "Tienda Online" venía guardando tema,
colores, métodos de pago y SEO desde hacía tiempo, pero **no había ruta
`/tienda/:slug`**: era un formulario de configuración de una vitrina que nunca
se renderizó, y el botón "Ver tienda" apuntaba a `gestiona.app`, un dominio
hardcodeado que no resuelve. Se construyó la tienda entera:

- Home, listado con filtros en la URL, ficha con perfil olfativo, carrito
  persistente, checkout y confirmación.
- Los 5 temas del panel ahora hacen algo: cada uno define variables CSS y el
  `primary_color` del negocio pisa el acento, con el texto encima ajustado por
  luminancia para que siga siendo legible.
- **Cobro online con MercadoPago**: la venta entra al mismo libro que el resto
  (`source='tienda_online'`), así aparece en Dashboard, Reportes y P&L sin
  tratamiento especial. Idempotente, porque MP reintenta sus webhooks.
- **Cuentas de comprador por tienda**, cupones, carritos abandonados con
  recuperación por email, emails transaccionales, y OG/sitemap servidos desde
  el borde para los bots (que no ejecutan JavaScript).
- **OAuth de MercadoPago multi-tienda**: la plataforma tiene una aplicación y
  cada comercio conecta su cuenta con un clic, como Tiendanube. El token pegado
  a mano sigue andando para no romper a quien ya lo tenía.
- **Variantes**: la organización tenía 26 cargadas y la vitrina las ignoraba.
  Ahora cada una es una línea de carrito con precio y stock propios.
- **Píxeles** de Meta, GA4 y TikTok con eventos de ecommerce completos. Los
  scripts sólo cargan si el ID está configurado, y no se envía dato personal.

**Bugs que habrían roto ventas reales, encontrados probando contra la base:**

- `sales.source` tenía un CHECK sin el canal propio: **toda** venta online
  fallaba al registrarse.
- Se descontaba stock a mano **además** del trigger `trg_sale_stock_movement`:
  con stock 2 y una compra de 2 quedaba en −2.
- Al sumarle el cupón, `create_store_order` quedó con dos firmas y PostgREST
  devolvía "Could not choose the best candidate function" — checkout entero
  caído.
- Las vistas `*_connection_status` usaban `security_invoker`, y como las tablas
  de tokens tienen RLS sin policies devolvían siempre vacío: el panel decía
  "sin conectar" con la cuenta vinculada, sin forma de desconectarla.
- `handle_new_user_create_org` le daba organización, rol `owner` y trial a
  **cada comprador** que se registraba en una tienda.
- El guard anti-loop del service worker era un flag de sesión sin vencimiento:
  tras la primera recarga, ningún deploy posterior volvía a aplicarse y la app
  quedaba mostrando código viejo indefinidamente.

**Pendiente para emparejar con Tiendanube/Empretienda**, en orden de impacto:
reseñas de productos (no existe ni la tabla), páginas de contenido editables
(Sobre nosotros, Preguntas frecuentes, Cambios y devoluciones), banner/slider
con enlaces en la home, lista de deseos y aviso de reposición, y filtro por
rango de precio.

---

---

*Última revisión: 2026-08-14*
*Para el detalle del día a día: `git log --oneline -20`.*
