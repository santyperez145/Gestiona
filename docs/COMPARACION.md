# Gestiona contra la competencia — medido, no estimado

**Fecha de corte: 2026-08-21.** Todo número nuestro sale de una consulta a la
base de producción y lleva el comando al lado. Todo dato de un competidor lleva
fuente y fecha, o va marcado como no verificado.

Esa disciplina no es formalismo. Este repo es público y su documentación se lee
de afuera: ya pasó que un análisis externo citó "418 tests unitarios" tomándolo
de una línea vieja del ROADMAP cuando la suite ya era mucho mayor. Un número sin fecha se
convierte en el dato que otros repiten.

| Marca | Significa |
|---|---|
| ✅ | Medido. Está el comando o la fuente. |
| 📌 | Criterio de producto. Es una decisión, no un hecho. |
| ❓ | Sin verificar. Se cree, no se comprobó. **No usar en una presentación.** |

---

## 0. Las tres correcciones que este relevamiento obliga a hacer

Antes de cualquier comparación, tres cosas que este documento cambia respecto de
lo que decía la documentación del repo:

### 0.1 ⚠️ Tiendanube **ya tiene POS**

`CLAUDE.md` dice: *"«Tiendanube no tiene POS» era cierto y puede haber dejado de
serlo en 2026."* Dejó de serlo.

✅ Tiendanube tiene **Punto de Venta (PDV)**, sincroniza stock y ventas en tiempo
real con la tienda online, y funciona en celular, tablet y computadora. El plan
gratuito incluye *PDV Inicial* y todos los planes pagos incluyen *PDV Plus*
([ayuda.tiendanube.com/es_AR/pdv](https://ayuda.tiendanube.com/es_AR/pdv),
consultado 2026-08-21).

**Consecuencia estratégica, y es grande:** "somos el único que une mostrador y
tienda" **ya no es un diferencial**. Era el argumento central. Hay que dejar de
usarlo.

Lo que sí queda: ✅ el PDV de Tiendanube **no está disponible en su aplicación
móvil, en ninguna versión** — se usa desde la web. Nuestro POS es PWA con modo
offline, lo que sí es una diferencia real en un mostrador con internet malo.

### 0.2 ✅ Tiendanube **no** factura ARCA de forma nativa — y eso sí es nuestro

Tiendanube resuelve la facturación electrónica con **apps de terceros**:
Facturante, iFactura, Xubio. Se instalan desde su tienda de aplicaciones y se
pagan aparte
([ayuda.tiendanube.com/es_ES/afip](https://ayuda.tiendanube.com/es_ES/afip),
consultado 2026-08-21).

Nosotros facturamos **adentro**, sin app, sin costo extra y —desde C14— sin que
el comercio tenga que generar un certificado: delega `wsfe` a la plataforma y
listo. Ese es un diferencial real, verificable y difícil de copiar rápido,
porque implica que la plataforma se haga cargo del certificado y de la relación
con ARCA.

⚠️ Con una salvedad honesta: **nosotros tampoco facturamos todavía en
producción.** Ver §2.

### 0.3 ⚠️ El diferencial que sigue en pie es el margen, no el canal

📌 Un ecommerce no conoce el costo con aduana. Un ERP no conoce la comisión del
medio de pago. El margen real por canal necesita **cuatro datos a la vez**
—costo con aduana, comisión, envío e IVA— y acá están los cuatro porque el
proyecto nació importando.

Eso sigue siendo cierto y ahora tiene respaldo contable: desde H8 el ledger de
partida doble registra la venta de mostrador con costo de mercadería, IVA y
comisiones. La comparación correcta no es decir que nadie más lleva
contabilidad: Odoo documenta partida doble y asientos desde POS. Entre las
plataformas de tienda relevadas no encontramos un ledger interno comparable
(❓ relevamiento no exhaustivo). El diferencial a probar es la combinación
argentina de costo landed, comisión, envío e IVA por canal, no la existencia
aislada de un libro contable.

---

## 1. Nuestra escala técnica, medida

```bash
npx supabase db query --linked --file docs/consultas/escala.sql
```

| | Valor | Comentario |
|---|---:|---|
| Tablas base | **285** | ✅ `docs/consultas/escala.sql`, 2026-08-21 |
| Tablas con `org_id` | **304** | ✅ `docs/consultas/escala.sql`, 2026-08-21 |
| Vistas | **62** | ✅ `docs/consultas/escala.sql`, 2026-08-21 |
| Funciones y procedimientos | **374** | ✅ `docs/consultas/escala.sql`, 2026-08-21 |
| Triggers | **134** | ✅ `docs/consultas/escala.sql`, 2026-08-21 |
| Índices | **865** | ✅ `docs/consultas/escala.sql`, 2026-08-21 |
| Políticas RLS | **367** | ✅ `docs/consultas/escala.sql`, 2026-08-21 |
| Migraciones registradas | **377** | ✅ Libro reconciliado, `db push --dry-run` en `upToDate` |
| Cron jobs | **20** | ✅ 9.859 corridas exitosas y **0 fallidas** en 7 días |
| Edge Functions | **64** | ✅ `npm run check:functions`, 2026-08-22 |
| Líneas de TypeScript | **142.349** | ✅ sin contar los 31.421 de tipos generados |
| Tests unitarios | **1.233** | ✅ `npm test -- --maxWorkers=1 --fileParallelism=false`, 2026-08-21 |
| Specs E2E | **3** | ✅ Playwright, sólo lectura contra producción |
| Tamaño de la base | **47 MB** | ✅ |
| Bundle | **7,3 MB** | ⚠️ ver §5.3 |

**Seguridad, medida:**

| | Valor |
|---|---|
| Tablas sin RLS | ✅ **0** |
| Tablas de credenciales con RLS y cero policies | ✅ **4 de 4** (`afip_credentials`, `afip_platform_credentials`, `payment_connections`, `meli_connections`) |
| Políticas `USING (true)` | ✅ **3**, y las tres son catálogos públicos a propósito: `plans` (pricing), `payment_providers` y `payment_provider_fees` |

⚠️ Ese último dato **corrige** `CLAUDE.md`, que dice que la lista *"debería estar
vacía salvo `plans`"*. Son tres desde que existe el orquestador de pagos. Es
correcto —un comercio tiene que poder ver qué proveedores hay y cuánto cobran
antes de conectarse— pero el invariante documentado quedó desactualizado.

---

## 2. Nuestra escala **de negocio**, medida — y acá está el problema

| | Valor | Qué significa |
|---|---:|---|
| Organizaciones | **4** | ✅ …de las cuales **1 vende de verdad** |
| Usuarios | **2** | ✅ |
| Productos | **60** | ✅ |
| Tiendas publicadas | **1** | ✅ |
| Ventas de mostrador | **34** | ✅ |
| Órdenes online | **6** | ✅ |
| Clientes | **33** | ✅ |
| Pagos acreditados | **2** | ✅ de $1 cada uno, con comisión de plataforma real |
| **Facturas emitidas** | **0** | ✅ |
| **Asientos contables** | **0** | ✅ |
| Eventos de dominio | **10** | ✅ |
| Suscripciones cobradas | **0** | ✅ 3 registros, las 3 en `past_due` |

⚠️ **Este es el dato que ordena todo el documento.** Tenemos una plataforma de
285 tablas y 1.233 tests sirviendo a **un solo comercio real**. Tiendanube tiene
❓ más de 130.000 tiendas activas (fuente secundaria: blog de un competidor,
[tiendli.com](https://tiendli.com/blog/tiendanube-vs-empretienda-vs-shopify-vs-tiendli/),
2026 — **verificar antes de citarlo**). Shopify tiene ✅ 2.898.351 tiendas vivas
verificadas por DNS y **US$115.600 millones de GMV en un solo trimestre**
(Q2 2026, [digitalcommerce360](https://www.digitalcommerce360.com/article/shopify-revenue-gmv/)).

La distancia no es de features. Es de **evidencia de que el producto funciona
con gente que no lo escribió**.

📌 La consecuencia práctica: **el próximo trabajo que importa no es una feature
más, es el segundo comercio.** Todo lo que no acerque a eso está en el lugar
equivocado de la lista.

---

## 3. Comparativa función por función

Leyenda: ✅ está y se usó · 🟡 está pero nunca corrió en real · 🔴 no está

### 3.1 Tienda online

| | Gestiona | Tiendanube | Empretienda | Shopify |
|---|---|---|---|---|
| Catálogo, variantes, categorías | ✅ | ✅ | ✅ | ✅ |
| Carrito y checkout propio | ✅ | ✅ | ✅ | ✅ |
| Cupones, promos 2x, descuento por cantidad | ✅ | ✅ | ❓ | ✅ |
| Reseñas de compra verificada | ✅ | ❓ | ❓ | ✅ |
| Preguntas sobre el producto | ✅ | ❓ | ❓ | ❓ |
| Lista de deseos, aviso de reposición | ✅ | ❓ | ❓ | ✅ |
| Temas / plantillas | 🟡 7 temas propios | ✅ ❓+60 plantillas | ✅ | ✅ miles |
| Dominio propio | 🔴 congelado a propósito | ✅ | ✅ | ✅ |
| App móvil del comprador | 🔴 | ✅ | ❓ | ✅ |
| Tienda de aplicaciones / API pública | 🔴 | ✅ | ❓ | ✅ |

📌 **Los 🔴 de tienda están congelados deliberadamente**, no olvidados. Dominios
propios, theme engine y marketplace de apps son infraestructura para el comercio
número cincuenta, no para el segundo. Ver `docs/ARQUITECTURA.md`.

### 3.2 Gestión — acá es donde ganamos

| | Gestiona | Tiendanube | Empretienda |
|---|---|---|---|
| POS de mostrador | ✅ PWA **con modo offline** | ✅ PDV, ✅ **no en su app móvil** | ❓ |
| Stock único entre canales | ✅ ledger de stock con triggers | ✅ | ❓ |
| Kardex auditable | ✅ `stock_movements`, única fuente | ❓ | ❓ |
| Toma física auditada | ✅ `abrir/registrar/cerrar_conteo` | ❓ | ❓ |
| Compras e importación con aduana | ✅ | 🔴 | 🔴 |
| **Costo real con impuestos de importación** | ✅ | 🔴 | 🔴 |
| **Margen por canal con los 4 datos** | ✅ | 🔴 | 🔴 |
| **Ledger contable de partida doble** | 🟡 conectado, **0 asientos** | 🔴 | 🔴 |
| Cuenta corriente / fiado | ✅ y va a Deudores, no a Caja | ❓ | ❓ |
| Multi-sucursal | ✅ `location_stock` | ❓ | ❓ |
| Listas de precios y precios por categoría | ✅ | ❓ | ❓ |
| CRM con ficha 360 | ✅ 5 tablas cruzadas por `customer_id` | 🟡 básico ❓ | ❓ |

### 3.3 Fiscal y legal argentino

| | Gestiona | Tiendanube | Empretienda |
|---|---|---|---|
| Factura electrónica ARCA | 🟡 **nativa**, CAE en homologación, 0 en producción | ✅ vía apps de terceros pagas | ❓ |
| Certificado por comercio | ✅ **no hace falta** (delegación `wsfe`) | n/a (lo resuelve la app) | ❓ |
| IVA por producto | ✅ | ❓ | ❓ |
| Condición del receptor (RG 5.616) | ✅ | ❓ | ❓ |
| Botón de arrepentimiento | ✅ | ✅ ❓ | ❓ |
| Generador de políticas legales | ✅ borrador, falta publicar | ❓ | ❓ |
| Flete de devolución a cargo del vendedor (Ley 24.240 art. 34) | ✅ modelado | ❓ | ❓ |

⚠️ **La honestidad acá importa más que en ningún otro lado:** tenemos el circuito
fiscal más completo del cuadro **y cero facturas emitidas**. Una integración que
nunca emitió no es una ventaja, es una promesa.

### 3.4 Cobros

| | Gestiona | Tiendanube | Shopify |
|---|---|---|---|
| MercadoPago por OAuth | ✅ | ✅ | ❓ |
| Comisión de plataforma sobre la venta | ✅ **cobró de verdad**: `application_fee` 5% | ✅ ❓0,7%–2% por transacción según plan | ✅ |
| Orquestador multi-proveedor con failover | 🟡 construido, **no enchufado al checkout** | ❓ | ✅ |
| Medio de pago propio | 🔴 GestionaPay no existe | 🔴 | ✅ Shopify Payments |
| Suscripción del SaaS | 🟡 por MercadoPago, **nunca cobró** | ✅ | ✅ |

✅ El costo por transacción de Tiendanube en Argentina va de **0,7% a 2%** según
el plan, **además** de lo que cobre la pasarela
([tiendanube.com/blog/precio-tiendanube](https://www.tiendanube.com/blog/precio-tiendanube/),
consultado 2026-08-21). Nuestra regla base está en **5%**, que es entre 2,5× y
7× más caro. 📌 Eso hay que revisarlo antes de vender: hoy no es competitivo.

### 3.5 Estándar internacional: no confundir paridad con ventaja

| Capacidad | Shopify | Odoo | Gestiona | Lectura honesta |
|---|---|---|---|---|
| Inventario compartido entre POS, tienda y ubicaciones | ✅ documentado | ✅ documentado | ✅ movimientos en base y `location_stock` | Es paridad obligatoria, no un claim diferencial. |
| POS cuando se corta la conexión | ❓ no se relevó aquí | ✅ documentado | ✅ PWA offline | Diferencia potencial que requiere uso real, no una promesa. |
| Contabilidad de partida doble ligada a venta/POS | ❓ no se relevó aquí | ✅ documentado | 🟡 conectada, 0 asientos reales | Odoo es el estándar funcional; Gestiona no puede declararse superior. |
| Margen con costo landed, comisión, envío e IVA | ❓ sin relevamiento comparable | ❓ sin relevamiento comparable | ✅ Core modelado | Hipótesis de posicionamiento: se valida con decisiones de precio y margen de comercios reales. |

Fuentes oficiales consultadas el 2026-08-21: Shopify documenta inventario
sincronizado entre POS, tienda y ubicaciones
([Shopify POS](https://www.shopify.com/pos/features)); Odoo documenta POS que
continúa temporalmente offline, registra movimientos de stock y consolida los
locales ([Odoo POS](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale.html))
y su partida doble y asientos de POS ([Odoo Accounting](https://www.odoo.com/documentation/18.0/applications/finance/accounting.html)).
No se infiere la ausencia de una función cuando no se la relevó.

### 3.5 Finance documental — paridad verificada y límite propio

✅ **Verificado el 2026-08-22 con fuentes oficiales vigentes.** [Odoo 19](https://www.odoo.com/documentation/19.0/applications/finance/accounting/vendor_bills/invoice_digitization.html)
recibe facturas por carga o email, extrae campos, deja corregirlos y busca una
orden de compra coincidente. [QuickBooks](https://quickbooks.intuit.com/learn-support/en-uk/help-article/import-transactions/upload-receipts-bills-quickbooks-online/L862MmZHn_GB_en_GB)
acepta web, móvil y email, extrae y deja el comprobante en “For review” antes de
agregarlo o emparejarlo. Sus [workflows de Bill Pay](https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-workflows/set-use-bill-approval-payment-release-workflows/L1IOLL9hv_US_en_US)
separan quien carga, aprueba y paga.

Conclusión: OCR, revisión, matching y aprobaciones son **paridad**, no un claim
defendible. Gestiona estaba atrás: su OCR sólo prellenaba Compras y ni siquiera
tenía cadena de custodia.

✅ **Primer límite cerrado.** `/finance` tiene chrome propio, misma identidad y
organización, y exige entitlement de producto + `finance.view`; ninguno se
reemplaza por un feature flag. El comercio solicita, Platform aprueba y cada
transición queda auditada. El resumen consume el proveedor, la orden, la
obligación y el ledger existentes mediante RPC agregado, sin inventar un Core
paralelo.

✅ **Segundo límite técnico cerrado:** el original es privado e inmutable, cada
versión conserva cadena de custodia y el inspector recalcula hash/tamaño/MIME
sobre bytes server-side, bloquea PDF activo, deduplica dentro del tenant y exige
scanner privado limpio antes de extracción. El scanner todavía no está
configurado: la salida segura es `scanner_unavailable`, no un falso “limpio”.

✅ **Tercer límite técnico cerrado:** la extracción acepta sólo ids, vuelve a
descargar y verificar el original privado, fuerza un tool call con JSON Schema y
registra proveedor/modelo/prompt/confianza. Postgres recalcula validaciones y una
persona confirma una revisión append-only; no se crean compras, deudas, stock o
asientos. El flag y el modelo siguen ausentes hasta aprobar privacidad y medir
exactitud/costo con documentos autorizados.

⚠️ **No es todavía un producto validado:** producción tiene 4 organizaciones con
Finance disponible, 0 solicitudes y 0 habilitaciones. Faltan scanner y extractor
aprobados, benchmark real, matching, aprobación y borradores del Core.

---

## 4. Precios — lo que cobran ellos

| | Plan gratis | Pagos | Comisión |
|---|---|---|---|
| Tiendanube AR | ✅ sí, sin límite de tiempo | ❓ desde ~USD 18/mes | ✅ 0,7%–2% por transacción + pasarela |
| Empretienda | ✅ con tope de productos | ❓ USD 7–30/mes | ❓ ~3–5% en plan gratis |
| Shopify | 🔴 sólo prueba | ❓ desde USD 29/mes | ✅ + comisión si no usás Shopify Payments |
| **Gestiona** | 14 días de trial | ❓ planes definidos, **nunca cobrados** | ⚠️ **5%** |

Todos los planes de Tiendanube tienen ✅ 25% de descuento pagando anual, y ✅ no
limitan cantidad de productos, visitas ni ventas.

📌 **Dos decisiones de precio que hay que tomar antes del segundo comercio:**
bajar la comisión a un rango competitivo, y definir si hay plan gratis. Sin plan
gratis, competir contra dos rivales que sí lo tienen exige un argumento muy
fuerte — y hoy el argumento (facturación nativa, margen real) todavía no está
probado en producción.

---

## 5. Tecnología: la nuestra contra la de ellos

### 5.1 Dónde nuestra arquitectura es genuinamente buena

Esto no es autoindulgencia: son cosas medibles que la mayoría de los SaaS
chicos no tiene.

- ✅ **La lógica de plata vive en la base, no en el navegador.** El checkout
  manda ids y cantidades; precios, stock, cupones, envío y comisiones se
  recalculan en Postgres. Un cliente comprometido no puede cambiar un precio.
- ✅ **Multi-tenant por fila con RLS real**, 365 políticas, 0 tablas sin RLS.
  Verificado ejecutando como `anon` y `authenticated`, no como superusuario.
- ✅ **Credenciales inalcanzables desde el navegador**: 4 tablas con RLS y cero
  policies. La UI lee vistas `*_status` que dicen si está conectado, nunca el
  token.
- ✅ **Stock con ledger e idempotencia.** `record_stock_movement` es el único
  camino que toca `products.stock`. La vista `stock_negativo` está vacía.
- ✅ **Outbox con eventos de dominio**: agregar un consumidor es una fila, no una
  edición en el centro. Ya lo aprovecharon la facturación automática (C13) y el
  asiento contable del mostrador (H8).
- ✅ **Libro contable inmutable**: un asiento no se borra, se contraasienta, y el
  balance lo verifica un trigger diferido.
- ✅ **Tests guardia que fallaron de verdad**: `edgeFunctionAuth` bloqueó una
  función nueva que mandaba emails antes de que llegara a producción.

📌 En términos de **arquitectura de datos**, esto está por encima de lo que
necesita un SaaS de 4 organizaciones. No es el cuello de botella.

### 5.2 Dónde estamos claramente atrás

| Área | Nosotros | Cómo lo hace una empresa grande | Impacto |
|---|---|---|---|
| **Entorno de staging** | ✅ **No existe.** Se prueba contra producción con datos `ZZ` que se borran | Al menos un entorno idéntico, con datos sintéticos | 🔴 Alto |
| **Backups con restore probado** | 🟡 `weekly-backup` + restore de datos aprobado el 2026-08-21: 147 tablas / 63 filas, 937,22 ms y cero restos. Falta reconstrucción integral y RTO/RPO contractual | Restore drill periódico y cronometrado, incluida infraestructura completa | 🟠 Medio |
| **Observabilidad** | 🟡 Sentry en front, Merchant 360 y traza correlacionada del pago desde checkout hasta ledger, visible con RLS y sin PII. Faltan métricas/SLO, OpenTelemetry, alertas y health checks activos | Trazas distribuidas, métricas, alertas por SLO | 🔴 Alto |
| **Feature flags** | 🟡 `checkout_brick` se pausa globalmente o por comercio, con auditoría y fallback al checkout externo; no hay porcentaje ni canary | Todo lo riesgoso sale detrás de un flag y se activa por porcentaje | 🟠 Medio |
| **Despliegue** | ✅ `git push` → Vercel. Sin canary, sin rollback automático | Blue-green o canary, rollback en un clic, health checks | 🟠 Medio |
| **CI** | ✅ Deno para 65 Edge Functions + lint + typecheck + build, 1.446 tests, audit y 42 E2E críticos bloqueantes (tienda desktop/móvil + panel autenticado) | Suite completa bloqueante, incluidos los E2E y el código serverless | 🟢 Cerrado para los recorridos definidos |
| **API pública / webhooks salientes** | 🔴 No hay | API documentada, versionada, con rate limit y webhooks firmados | 🟠 Medio |
| **Multi-región / DR** | 🔴 Una sola región | Réplicas, failover regional | 🟢 Bajo hoy |
| **On-call** | 🔴 No existe | Rotación, runbooks, postmortems | 🟢 Bajo hoy |
| **SOC 2 / ISO 27001** | 🔴 | Requisito para vender a empresas | 🟢 Bajo hoy |

✅ **El agujero de Edge Functions quedó cerrado el 2026-08-21.** Los 1.446 tests
corren en un job separado y `security` mantiene `npm audit` bloqueante para
vulnerabilidades críticas. El job `build` instala Deno y ejecuta
`npm run check:functions`: descubre los 65 `index.ts` del filesystem, por lo que
una función nueva no puede escapar de la puerta. La primera corrida encontró y
corrigió 56 errores de tipo reales en ARCA, pagos, cotización, MercadoLibre,
plataforma y helpers compartidos.

✅ El E2E bloqueante quedó cerrado el 2026-08-21: setup autenticado obligatorio,
tienda desktop/móvil y panel son de sólo lectura y bloquean el merge/deploy. El
siguiente hueco ya no es sumar recorridos por cantidad, sino incorporar cada
nuevo flujo crítico cuando tenga una acción y datos de prueba seguros.

### 5.3 El bundle

✅ 7,3 MB en `dist/assets`, con tres archivos de 592 KB, 440 KB y 424 KB. 📌 Para
una tienda pública que se abre desde un celular con datos, eso es mucho: es una
de las primeras razones por las que se abandona un carrito. Shopify y Tiendanube
sirven storefronts mucho más livianos ❓ (no medido). Vale la pena separar el
bundle del **panel** del bundle de la **tienda**: hoy comparten build.

### 5.4 Benchmark operativo actualizado — 2026-08-22

Este corte agrega patrones que sí cambian decisiones de arquitectura. No se
copian pantallas: se copian controles que reducen errores de operación.

- ✅ **Shopify:** `stagedUploadsCreate` usa una carga segura en dos pasos: crea
  un destino temporal y después sube el archivo directamente. La documentación
  lo recomienda para archivos grandes, medios e importaciones masivas
  ([StagedUploadsCreatePayload](https://shopify.dev/docs/api/admin-graphql/latest/payloads/StagedUploadsCreatePayload),
  consultado 2026-08-22). Gestiona adopta el mismo límite conceptual en Finance:
  intención server-side, objeto privado y finalización separada; la diferencia
  es que nuestro objeto queda unido a una versión documental y a la
  organización.
- ✅ **Supabase Storage:** los buckets privados fuerzan RLS también al descargar
  y permiten URL firmada temporal; los buckets aceptan límite de tamaño y tipos
  MIME ([Storage Buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals),
  consultado 2026-08-22). Por eso los originales de Finance no usan `getPublicUrl`.
- ✅ **MercadoLibre:** sus notificaciones deben responder rápido, encolar el
  evento y consultar el recurso canónico por API en vez de confiar ciegamente en
  el payload ([notificaciones](https://developers.mercadolibre.com.ar/es_ar/notificaciones),
  consultado 2026-08-22). El mismo criterio se mantiene para futuros webhooks de
  órdenes, pagos y envíos: ACK, outbox, retry, deduplicación y lectura de la
  autoridad.
- ✅ **Tiendanube:** su documentación de migración separa productos, clientes,
  dominios, pagos y envíos; la importación masiva es un proceso explícito y
  recomienda respaldar antes ([migración](https://ayuda.tiendanube.com/es_AR/migrar-mi-tienda),
  consultado 2026-08-22). Esto respalda el pipeline del roadmap
  `extract → staging → normalize → validate → preview → import → reconcile`, no
  una importación que pisa datos en silencio.
- ✅ **Empretienda:** comunica importación masiva, alertas de stock, medios de
  pago, envíos y administración móvil como capacidades de comercio
  ([producto](https://empretienda.com/), consultado 2026-08-22). Se considera
  paridad de superficie; no se atribuyen detalles internos sin documentación
  técnica pública.
- ✅ **Mendel:** su producto muestra políticas de gasto, presupuestos/tarjetas,
  aprobaciones, auditoría y detalle por categoría
  ([Spend Management](https://mendel.com/en-ar/product/), consultado
  2026-08-22). Finance toma ese estándar de control: quién solicita, quién
  aprueba, qué evidencia queda y qué efecto está prohibido antes de aprobar.

📌 **Regla derivada:** cada integración nueva debe tener una autoridad canónica,
un evento idempotente, una cola/reintento cuando sea asíncrona y una pantalla de
excepción. Cada carga de archivo debe tener intención, límite, privacidad,
versión y auditoría antes de conectarse a IA o a un efecto financiero.

---

## 6. Lo que falta para operar "como las grandes", en orden

📌 Este orden no es por dificultad ni por lo que sea más divertido. Es por
**cuánto duele que falte**.

### Nivel 1 — Sin esto no se puede vender a nadie (semanas)

1. ~~**`deno check` en el CI.**~~ ✅ Cerrado el 2026-08-21 y ampliado el 2026-08-22: las 65 funciones
   pasan una puerta Deno que descubre los entrypoints; se corrigieron 56 errores
   antes de hacerla bloqueante.
2. **Emitir una factura real en producción.** El circuito ya emitió CAE en
   homologación; falta el certificado de producción y el punto de venta como
   *Web Services*. Es un trámite, no código.
3. ~~**Restore de datos probado.**~~ ✅ Cerrado el 2026-08-21 para el dataset:
   snapshot v3 privado, hash verificado, 147 tablas / 63 filas restauradas en
   937,22 ms y cero restos. Sigue pendiente reconstruir una plataforma aislada
   completa antes de declarar RTO/RPO contractual.
4. **Bajar la comisión** a un rango competitivo con el 0,7%–2% de Tiendanube.
5. **Publicar las políticas legales.** El generador está; falta razón social,
   CUIT y domicilio, y apretar publicar.

### Nivel 2 — Sin esto no se puede crecer (meses)

6. **Segundo comercio real**, con su tiempo de alta medido. Es la condición de
   salida de la fase 1 y el único dato que le importa a un inversor.
7. **Observabilidad de verdad**: ✅ el pago ya conserva una correlación desde
   intent/attempt hasta proveedor, eventos, liquidación y ledger, con timeline
   RLS sin PII. Faltan métricas/SLO y alertas cuando un webhook falla, además de
   health activo de crons, outbox y proveedores; una traza consultable no avisa
   sola que ocurrió un incidente.
8. ~~**Feature flags para el checkout integrado.**~~ 🟡 Parcial, 2026-08-21:
   `checkout_brick` se puede pausar por comercio o globalmente desde Operaciones,
   con auditoría y redirect externo como fallback. Sigue pendiente el rollout por
   porcentaje y cubrir otros flujos sólo si tienen un fallback explícito.
9. **~~Enchufar el orquestador de pagos al checkout.~~** ✅ Cerrado en el slice
   P0.3.1 (2026-08-21): `store-pay` registra intención e intento tanto para
   preferencia externa como para Brick; el webhook reconcilia la misma orden.
   ✅ P0.3.2/P0.3.3 agrega el reintegro de RMA por MercadoPago con monto
   validado en SQL, token sólo server-side, `X-Idempotency-Key`, reconciliación
   por webhook y recepción física idempotente. La factura ya reserva la
   secuencia ARCA en base y la recepción parcial de compra usa su propia clave
   idempotente. ✅ La matriz transaccional del 2026-08-21 aprobó siete escenarios
   y encontró dos fallas reales: la comisión ecommerce no llegaba al ledger y
   el wrapper del refund era ambiguo. Ambas quedaron corregidas, con rollback y
   cero restos. Falta certificación con red/dinero real; no se confunde la
   autoridad interna con disponibilidad del proveedor.
10. **Separar el bundle de la tienda del bundle del panel.**
11. **Suscripción cobrada de punta a punta.** Hay 3 registros, los 3 en
    `past_due`, y ninguno cobró nunca.

### Nivel 3 — Sin esto no se puede escalar (trimestres)

12. **API pública con webhooks firmados y versionado.** Es lo que convierte un
    producto en una plataforma, y es exactamente lo que hace que Tiendanube y
    Shopify tengan ecosistema de apps.
13. **Canary deploys con rollback automático.**
14. **Staging.**
15. **Multi-región y DR con RTO/RPO declarados.**
16. **SOC 2**, si alguna vez se le vende a una empresa mediana.

---

## 7. Lo que **no** hay que copiar

📌 Tan importante como la lista de arriba.

- **Marketplace de apps.** Con 1 comercio, un ecosistema de apps no tiene a
  quién servirle. Es la infraestructura del comercio 500.
- **Theme engine.** 7 temas cubren de sobra a 4 organizaciones. Un motor de
  temas es un compromiso de compatibilidad para siempre.
- **Multi-idioma y multi-moneda.** No hay demanda medida.
- **Más features de ERP.** El modo de falla de este proyecto no es quedarse
  corto: es agregar. Ya hay 285 tablas para 34 ventas.

---

## 8. El resumen en cinco líneas

1. ✅ **Técnicamente estamos mejor de lo que corresponde a nuestro tamaño**: RLS
   real, ledger, outbox, idempotencia, 1.446 tests y typecheck de 65 funciones.
2. ✅ **Comercialmente no existimos todavía**: 1 comercio, 0 facturas, 0
   asientos, 0 suscripciones cobradas.
3. ⚠️ **Perdimos el diferencial del POS** — Tiendanube ya lo tiene.
4. ✅ **Ganamos uno mejor**: facturación ARCA nativa sin certificado por comercio
   y margen real con los cuatro datos. Falta probarlo en producción.
5. ⚠️ **El riesgo principal ya es evidencia comercial:** factura productiva,
   segundo comercio, una decisión de margen aplicada y el primer documento
   Finance aprobado. CI y restore de datos están cerrados para su alcance, pero
   no reemplazan esas operaciones reales.

---

*Consultas usadas para los números de §1 y §2: `supabase/verificaciones/`. Para
regenerar, ver `docs/consultas/escala.sql`. Última revisión: 2026-08-22.*
