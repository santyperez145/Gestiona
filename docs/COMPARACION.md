# Nerqia contra la competencia — medido, no estimado

**Fecha de corte de base: 2026-08-21; investigación competitiva de POS/pagos/caja
actualizada el 2026-08-29.** Todo número nuestro sale de una consulta a la base
de producción o de un comando reproducible y lleva la fecha al lado. Todo dato
de un competidor lleva fuente y fecha, o va marcado como no verificado.

Esa disciplina no es formalismo. Este repo es público y su documentación se lee
de afuera: ya pasó que un análisis externo citó "418 tests unitarios" (2026-08-11) tomándolo
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
| Tablas base | **328** | ✅ catálogo de producción, 2026-08-30 |
| Relaciones con `org_id` | **376** | ✅ `information_schema.columns`, incluye vistas, 2026-08-30 |
| Vistas | **111** | ✅ catálogo de producción, 2026-08-30 |
| Funciones y procedimientos | **503** | ✅ catálogo de producción, 2026-08-30 |
| Triggers | **148** | ✅ catálogo de producción, 2026-08-30 |
| Índices | **1.021** | ✅ catálogo de producción, 2026-08-30 |
| Políticas RLS | **398** | ✅ catálogo de producción, 2026-08-30 |
| Migraciones registradas | **497** | ✅ Libro reconciliado, `db push --dry-run` en `upToDate`, 2026-08-30 |
| Cron jobs | **26** | ⚠️ 22.503 corridas exitosas y **3 fallidas** en 7 días; se agregó reconciliación QR por minuto. Las tres fallas históricas corresponden a `expire-overdue-trials`, cuya recuperación posterior se documenta en la auditoría del 2026-08-28 |
| Edge Functions | **74 versionadas / 74 activas** | ✅ `npm run check:functions` valida todo el repo; la fuente recuperada de `extract-receipt` cerró la deriva y quedó detrás de plan + flag documental + proveedor, todavía apagada para comprobantes reales |
| Líneas de TypeScript | **142.349** | ✅ sin contar los 31.421 de tipos generados |
| Tests unitarios | **2.078** | ✅ `npm test`, 208 archivos, 2026-08-30 |
| Recorridos E2E | **46** | ✅ `playwright test --list`: 32 públicos, 13 de panel y 1 setup; el nuevo turno es sólo lectura |
| Tamaño de la base | **47 MB** | ✅ |
| Bundle | **7,3 MB** | ⚠️ ver §5.3 |

**Seguridad, medida:**

| | Valor |
|---|---|
| Tablas sin RLS | ✅ **0** |
| Tablas de credenciales con RLS y cero policies | ✅ **6 de 6** (`afip_credentials`, `afip_platform_credentials`, `payment_connections`, `meli_connections`, `evolution_connections`, `merchant_smtp_connections`), catálogo productivo 2026-08-29. Las tres conexiones por comercio de pago/marketplace/mensajería tienen además 0 grants de navegador |
| Políticas `USING (true)` | ✅ **3**, y las tres son catálogos públicos a propósito: `plans` (pricing), `payment_providers` y `payment_provider_fees` |

⚠️ Ese último dato **corrige** `CLAUDE.md`, que dice que la lista *"debería estar
vacía salvo `plans`"*. Son tres desde que existe el orquestador de pagos. Es
correcto —un comercio tiene que poder ver qué proveedores hay y cuánto cobran
antes de conectarse— pero el invariante documentado quedó desactualizado.

---

## 2. Nuestra escala **de negocio**, medida — y acá está el problema

| | Valor | Qué significa |
|---|---:|---|
| Organizaciones | **2** | ✅ 2026-08-26, …de las cuales **1 vende de verdad**. Eran 4: dos eran workspaces de prueba con el dueño borrado y 0 ventas, dados de baja ese día |
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
308 tablas y 1.534 tests (2026-08-25) sirviendo a **un solo comercio real**. Tiendanube tiene
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

| | Nerqia | Tiendanube | Empretienda | Shopify |
|---|---|---|---|---|
| Catálogo, variantes, categorías | ✅ | ✅ | ✅ | ✅ |
| Carrito y checkout propio | ✅ | ✅ | ✅ | ✅ |
| Cupones, promos 2x, descuento por cantidad | ✅ | ✅ | ✅ | ✅ |
| Reseñas de compra verificada | ✅ | ❓ | ❓ | ✅ |
| Preguntas sobre el producto | ✅ | ❓ | ❓ | ❓ |
| Lista de deseos, aviso de reposición | ✅ | ❓ | ❓ | ✅ |
| Temas / plantillas | 🟡 7 temas propios | ✅ ❓+60 plantillas | ✅ | ✅ miles |
| Dominio propio | 🔴 congelado a propósito | ✅ | ✅ | ✅ |
| App móvil del comprador | 🔴 | ✅ | ❓ | ✅ |
| Tienda de aplicaciones / API pública | 🟡 API v1 y webhooks con contratos públicos, versión, scopes, cuota, idempotencia y firma; **0 keys/apps reales**, sin ecosistema | ✅ | ❓ | ✅ |

📌 **Los 🔴 de tienda están congelados deliberadamente**, no olvidados. Dominios
propios, theme engine y marketplace de apps son infraestructura para el comercio
número cincuenta, no para el segundo. Ver `docs/ARQUITECTURA.md`.

✅ Empretienda documenta importación/carga de productos, productos digitales y
mayoristas, y promociones; además, “Agregar venta” registra ventas de local,
WhatsApp o redes y ajusta stock como el checkout. Eso prueba simplicidad
operativa y stock compartido dentro de su plataforma, no un POS offline ni un
Kardex auditable. Fuentes oficiales: [productos](https://empretienda.helpjuice.com/es_AR/productos)
y [agregar venta](https://empretienda.helpjuice.com/es_AR/conociendo-agregar-),
consultadas el 2026-08-22.

### 3.2 Gestión — acá es donde ganamos

| | Nerqia | Tiendanube | Empretienda |
|---|---|---|---|
| POS de mostrador | ✅ PWA **con modo offline** | ✅ PDV, ✅ **no en su app móvil** | 🟡 carga manual de venta presencial/WhatsApp/redes |
| Turno de caja por sucursal | 🟡 autoridad server-side por organización/ubicación; apertura/cierre por RPC, fondo, ticket único, vendedor, devoluciones, efectivo esperado y diferencia. Fixture productivo aprobado; **0 turnos reales**, por lo que falta adopción | ❓ | ❓ |
| Devolución POS total/parcial | 🟡 ticket y cobro original autoritativos; stock/caja/ledger en un commit y efectivo inmediato. Mercado Pago deriva Order/Payment/monto server-side, ejecuta o consulta con idempotencia estable y conserva la deuda ante rechazo/timeout. Fixtures aprobadas; **0 devoluciones reales** y refund live todavía sin certificar | ✅ Shopify POS: motivo, reposición, límite/medio original | ❓ |
| Descuento automático por medio en POS | ✅ mejor beneficio, autoridad servidor, evidencia por línea y configuración persistible desde su propia sección | ❓ | ❓ |
| Fidelidad/alerta grande por ticket | ✅ una vez por `sale_transaction`, idempotente y recalculable al anular | ❓ | ❓ |
| Stock único entre canales | ✅ ledger de stock con triggers | ✅ | ✅ tienda + venta cargada manualmente |
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

✅ **Benchmark de caja actualizado el 2026-08-29.** [Square](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session)
modela una sesión con efectivo inicial, ventas/reembolsos, ingresos/retiros,
esperado y conteo final; [Shopify POS](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/register-sessions-in-shopify-pos)
agrega ubicación, responsable, métodos no efectivo y discrepancia. Nerqia
traduce ese patrón al Business Core: un ticket con varias líneas o split cuenta
una vez, la venta se enlaza atómicamente a la sesión abierta de su sucursal y el
cliente no puede escribir apertura/cierre directamente. Eso es paridad técnica,
no una ventaja probada mientras no existan turnos reales operados y cerrados.

✅ **Benchmark de devoluciones actualizado el 2026-08-30.**
[Shopify POS](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/order-management/complete-refund-orders?locale=en)
permite devolución total/parcial, motivo, reposición y distribución hasta el
monto disponible de cada pago original; los medios personalizados sólo vuelven
al mismo medio. [Square](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session)
incluye los reembolsos de efectivo en el cálculo de la sesión. Nerqia adopta
esa paridad y agrega una obligación contable visible para toda parte externa no
confirmada. [Mercado Pago](https://www.mercadopago.com.ar/developers/es/docs/sales-processing/cancellations-and-refunds)
documenta cancelaciones/reembolsos y su [endpoint de refund de Orders](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api/refund-order/post)
exige una clave de idempotencia. Nerqia ya implementa ambos caminos
server-side —Orders para el QR moderno y Payments para cobros heredados—,
reintento/reconsulta y cierre sólo ante confirmación positiva; rechazo, timeout
o respuesta ambigua conservan el pasivo. La certificación live sigue 🔴 hasta
ejecutar y conciliar una devolución real: una fixture SQL no sustituye al
proveedor.

### 3.3 Fiscal y legal argentino

| | Nerqia | Tiendanube | Empretienda |
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

| | Nerqia | Tiendanube | Shopify |
|---|---|---|---|
| MercadoPago por OAuth | ✅ única autoridad; link exige `sales.create`, comisión por canal y referencia reconciliable | ✅ | ❓ |
| QR dinámico acreditado antes de cerrar POS | 🟡 implementado con Order, reserva y cierre server-side; polling, webhook y cron autenticado reconcilian aun con Caja cerrada, y la UI recupera el intento/venta sin tocar el carrito nuevo. Prueba reversible aprobada; cobro live pendiente | ✅ Mercado Pago QR | ❓ |
| Comisión de plataforma sobre la venta | ✅ **cobró de verdad** (`application_fee` 5% en las compras de prueba de 2026-08-11). ⚠️ Hoy la regla está en **0,5% e inactiva** (medido 2026-08-25): no se cobra nada | ✅ ❓0,7%–2% por transacción según plan | ✅ |
| Orquestador multi-proveedor con failover | 🟡 construido, **no enchufado al checkout** | ❓ | ✅ |
| Medio de pago propio | 🔴 Nerqia Pay no existe como PSP propio | 🔴 | ✅ Shopify Payments |
| Suscripción del SaaS | 🟡 por MercadoPago, **nunca cobró** | ✅ | ✅ |

✅ El costo por transacción de Tiendanube en Argentina va de **0,7% a 2%** según
el plan, **además** de lo que cobre la pasarela
([tiendanube.com/blog/precio-tiendanube](https://www.tiendanube.com/blog/precio-tiendanube/),
consultado 2026-08-21).

✅ **Benchmark QR actualizado el 2026-08-29.** Mercado Pago define una Order
dinámica por transacción, `external_pos_id`, `X-Idempotency-Key`, vencimiento y
consulta de la orden para conocer el estado; el QR dinámico es único para esa
compra. Nerqia ya respeta ese contrato y agrega su propia reserva/cierre
atómico contra el Business Core. Desde el slice 70, la consulta no depende de
una pestaña: un cron autenticado vuelve a consultar Orders cada minuto y Caja
muestra cobros pendientes o ventas cerradas hasta que el cajero las reconoce.
Desde el slice 71, el mismo cierre server-side también otorga fidelidad y crea
la alerta de venta grande una sola vez por ticket; el retry no duplica y una
anulación parcial recalcula. Esto evita que una venta recuperada dependa de
efectos client-side invisibles.
Eso es resiliencia propia sobre el mismo contrato de Mercado Pago, no una
capacidad que se atribuya al competidor sin evidencia. No se marca ✅ de uso porque todavía falta una
compra escaneada real y configurar el tópico Orders del webhook en la cuenta
productiva. Fuentes oficiales: [Create Order](https://www.mercadopago.com.ar/developers/es/reference/in-person-payments/qr-code/orders/create-order/post),
[procesar QR](https://www.mercadopago.com.ar/developers/es/docs/qr-code/payment-processing)
y [crear Store/POS](https://www.mercadopago.com.ar/developers/es/docs/qr-code/create-store-and-pos).

⚠️ **Corrección de este documento (2026-08-25).** Una versión anterior decía que
nuestra comisión base era del **5%** y que era entre 2,5× y 7× más cara que
Tiendanube. Es falso. Medido contra `platform_commission_rules`: la única regla
tiene `percent = 0.500` —y `platform_commission_amount` la divide por 100, así
que son **0,5%**— y además está **inactiva** (`is_active = false`,
`approval_status = 'draft'`). Hoy no se cobra comisión alguna.

El 5% era real, pero de **agosto de 2026**, cuando se hicieron las dos compras
de prueba; la regla se cambió el 22 de agosto. Cité un número medido sin mirar
si seguía vigente — exactamente el error que este documento denuncia en su
primera página.

📌 Lo que sigue siendo una decisión pendiente: **cuánto cobrar**. 0,5% está por
debajo del rango de Tiendanube y la regla está en borrador esperando aprobación
comercial, fiscal y contractual. Que hoy no se cobre nada no es una ventaja: es
una decisión sin tomar.

### 3.5 Estándar internacional: no confundir paridad con ventaja

| Capacidad | Shopify | Odoo | Nerqia | Lectura honesta |
|---|---|---|---|---|
| Inventario compartido entre POS, tienda y ubicaciones | ✅ documentado | ✅ documentado | ✅ movimientos en base y `location_stock` | Es paridad obligatoria, no un claim diferencial. |
| POS cuando se corta la conexión | ❓ no se relevó aquí | ✅ documentado | ✅ PWA offline | Diferencia potencial que requiere uso real, no una promesa. |
| Contabilidad de partida doble ligada a venta/POS | ❓ no se relevó aquí | ✅ documentado | 🟡 conectada, 0 asientos reales | Odoo es el estándar funcional; Nerqia no puede declararse superior. |
| Margen con costo landed, comisión, envío e IVA | ❓ sin relevamiento comparable | ❓ sin relevamiento comparable | ✅ Core modelado | Hipótesis de posicionamiento: se valida con decisiones de precio y margen de comercios reales. |

Fuentes oficiales consultadas el 2026-08-21: Shopify documenta inventario
sincronizado entre POS, tienda y ubicaciones
([Shopify POS](https://www.shopify.com/pos/features)); Odoo documenta POS que
continúa temporalmente offline, registra movimientos de stock y consolida los
locales ([Odoo POS](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale.html))
y su partida doble y asientos de POS ([Odoo Accounting](https://www.odoo.com/documentation/18.0/applications/finance/accounting.html)).
No se infiere la ausencia de una función cuando no se la relevó.

### 3.6 Finance documental — paridad verificada y límite propio

✅ **Verificado el 2026-08-22 con fuentes oficiales vigentes.** [Odoo 19](https://www.odoo.com/documentation/19.0/applications/finance/accounting/vendor_bills/invoice_digitization.html)
recibe facturas por carga o email, extrae campos, deja corregirlos y busca una
orden de compra coincidente. [QuickBooks](https://quickbooks.intuit.com/learn-support/en-uk/help-article/import-transactions/upload-receipts-bills-quickbooks-online/L862MmZHn_GB_en_GB)
acepta web, móvil y email, extrae y deja el comprobante en “For review” antes de
agregarlo o emparejarlo. Sus [workflows de Bill Pay](https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-workflows/set-use-bill-approval-payment-release-workflows/L1IOLL9hv_US_en_US)
separan quien carga, aprueba y paga.

Conclusión: OCR, revisión, matching y aprobaciones son **paridad**, no un claim
defendible. Nerqia estaba atrás: su OCR sólo prellenaba Compras y ni siquiera
tenía cadena de custodia.

✅ **Gastos alcanza la paridad de revisión, no la de operación live.** Su
captura ya separa documento, sugerencias y registro: el archivo permanece local
hasta confirmar, la salida está estructurada, la categoría pertenece al tenant
y la persona ve “Sugerencias listas para revisar” antes de aplicar. Un error no
se convierte en un formulario vacío y el camino manual sigue disponible. Esto
resuelve el patrón de producto; no prueba exactitud OCR ni habilita documentos
reales mientras falten DPA/proveedor, clave y flag explícito.

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

✅ **Cuarto límite técnico cerrado:** el matching sólo usa aliases confirmados o
identidades exactas. Una primera factura puede exigir selección manual; la
siguiente reutiliza CUIT/SKU por proveedor. Los empates quedan ambiguos, la UI
muestra método y candidatos, y confirmar no crea efectos operativos. Fixture
tenant-safe con retry: outsider/compras/deuda/stock/ledger/restos 0.

✅ **Quinto límite técnico cerrado:** la última revisión y su matching crean
Supplier Invoice, Purchase y Payable Draft separados sin tocar el Core. Sólo
owner/admin con `finance.edit` puede aprobar; esa transacción crea una orden
`confirmed` y una obligación idempotentes. Las líneas distinguen inventario de
cargos no inventariables, USD exige tipo de cambio y la recepción sigue siendo
la única puerta a `purchases` y stock. Fixture real: producto 7→7,
outsider/retry/RLS/restos 0.

⚠️ **No es todavía un producto validado:** producción tiene 2 organizaciones (2026-08-26) con
Finance disponible, 0 solicitudes, 0 habilitaciones, 0 match runs, 0 aliases y
0 borradores. Faltan scanner y extractor aprobados, benchmark y facturas reales
que atraviesen aprobación y recepción.

### 3.7 Finance regional — el control empieza antes del OCR

✅ **Verificado el 2026-08-22 con fuentes oficiales.** El benchmark relevante
para Nerqia Finance no termina en digitalizar facturas:

| Capacidad | Mendel | Clara Global | Rindegastos | Nerqia hoy / decisión |
|---|---|---|---|---|
| Política y presupuesto antes del gasto | ✅ reglas de monto, categoría, ubicación y frecuencia; presupuestos | ✅ políticas y aprobaciones | ✅ políticas por tipo, monto y centro de costo | 🔴 F5: política versionada + presupuesto + excepción; no bloquear desde UI sin autoridad server-side. |
| Captura y rendición | ✅ gasto, comprobante y reembolso | ✅ WhatsApp/formulario, tarjeta y reembolso | ✅ web/móvil/offline, viáticos, kilometraje y fondos | 🟡 Document Inbox web; F5 agrega mobile/WhatsApp, reembolso y fondos sin duplicar documentos. |
| Roles y aprobaciones | ✅ rutas de uno o varios niveles | ✅ empleado, manager, contador y admin | ✅ flujos por área/centro de costo | 🟡 preparación con `finance.edit` y aprobación final owner/admin; faltan grafo multinivel, delegación, SLA y segregación hasta pago. |
| ERP y auditoría | ✅ REST/WebServices/CSV/TXT/SFTP y asiento | ✅ reporte de pago y multi-entidad | ✅ API/exportaciones e integraciones | 🟡 Core y audit log propios; F5 agrega Finance Connect, exportación idempotente y reconciliación. |
| Tarjeta/custodia/viajes | ✅ producto principal | ✅ tarjeta corporativa | 🔴 usa tarjetas existentes; sí viáticos | 🔴 fuera de F3/F5 salvo demanda, partner regulado, economics y revisión legal. |

Fuentes: Mendel [producto](https://mendel.com/ar/producto/),
[tarjetas](https://mendel.com/ar/producto/tarjetas-mendel/) e
[integraciones](https://mendel.com/ar/producto/integraciones/); Clara
[Argentina](https://global.clara.com/es-AR); Rindegastos
[gestión](https://rindegastos.com/es-mx/gestion-de-gastos) y
[API](https://rindegastos.com/es-co/documentacion-api).

📌 **Decisión:** F3 permanece enfocado en documento → matching → borradores del
Core → aprobación. F5 incorpora control preventivo, centros de costo/proyectos,
reembolsos/fondos, captura móvil, cola de incumplimientos y exportación. No se
agregan tarjetas ni viajes para imitar una matriz: son otro modelo operativo,
económico y regulatorio.

---

## 4. Precios — lo que cobran ellos

| | Plan gratis | Pagos | Comisión |
|---|---|---|---|
| Tiendanube AR | ✅ sí, sin límite de tiempo | ❓ desde ~USD 18/mes | ✅ 0,7%–2% por transacción + pasarela |
| Empretienda | ❓ oferta AR no reverificada en este corte | ❓ precio AR no reverificado | ❓ no usar una comisión sin fuente local vigente |
| Shopify | 🔴 sólo prueba | ❓ desde USD 29/mes | ✅ + comisión si no usás Shopify Payments |
| **Nerqia** | 14 días de trial | ❓ planes definidos, **nunca cobrados** | ⚠️ **0% efectivo** — regla de 0,5% en borrador, inactiva (2026-08-25) |

Todos los planes de Tiendanube tienen ✅ 25% de descuento pagando anual, y ✅ no
limitan cantidad de productos, visitas ni ventas.

📌 **Dos decisiones de precio que hay que tomar antes del segundo comercio:**
bajar la comisión a un rango competitivo, y definir si hay plan gratis. La
oferta argentina vigente de Empretienda debe reverificarse antes de usarla; no
se decide pricing con un dato de otro país o una captura vieja. Aun contra el
plan gratuito verificado de Tiendanube, el argumento de facturación nativa y
margen real todavía no está probado en producción.

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
- ✅ **Credenciales inalcanzables desde el navegador**: 6 tablas medidas con
  RLS y cero policies. La UI lee vistas `*_status` que dicen si está conectado,
  nunca el token ni la contraseña.
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
necesita un SaaS de 2 organizaciones (2026-08-26). No es el cuello de botella.

### 5.2 Dónde estamos claramente atrás

| Área | Nosotros | Cómo lo hace una empresa grande | Impacto |
|---|---|---|---|
| **Entorno de staging** | ✅ **No existe.** Se prueba contra producción con datos `ZZ` que se borran | Al menos un entorno idéntico, con datos sintéticos | 🔴 Alto |
| **Backups con restore probado** | 🟡 `weekly-backup` + restore de datos aprobado el 2026-08-21: 147 tablas / 63 filas, 937,22 ms y cero restos. Falta reconstrucción integral y RTO/RPO contractual | Restore drill periódico y cronometrado, incluida infraestructura completa | 🟠 Medio |
| **Observabilidad** | 🟡 Sentry en front, Merchant 360 y traza correlacionada del pago desde checkout hasta ledger, visible con RLS y sin PII. Faltan métricas/SLO, OpenTelemetry, alertas y health checks activos | Trazas distribuidas, métricas, alertas por SLO | 🔴 Alto |
| **Feature flags** | 🟡 `checkout_brick` se pausa globalmente o por comercio, con auditoría y fallback al checkout externo; no hay porcentaje ni canary | Todo lo riesgoso sale detrás de un flag y se activa por porcentaje | 🟠 Medio |
| **Despliegue** | ✅ `git push` → Vercel. Sin canary, sin rollback automático | Blue-green o canary, rollback en un clic, health checks | 🟠 Medio |
| **CI** | ✅ Deno para 74 Edge Functions + lint + typecheck + build, 2.078 tests en 208 archivos (2026-08-30), audit completo en 0 y 46 E2E críticos definidos (32 públicos, 13 panel, 1 setup) | Suite completa bloqueante, incluidos los E2E y el código serverless | 🟢 Cerrado para los recorridos definidos |
| **API pública / webhooks salientes** | ✅ Contrato técnico cerrado: API OpenAPI 3.1, `/v1`, scopes sin filtración, cupo durable, venta atómica/idempotente, ARS 2/USD 4, lifecycle y CORS server-to-server; webhooks con guía/receptor Node, HMAC, timestamp, filtro, outbox, id estable, retry, DLQ/replay, log y certificación HTTPS externa sintética. ⚠️ 0 keys/apps reales | API documentada, versionada, con rate limit y webhooks firmados | 🟢 Base técnica; adopción externa pendiente |
| **Multi-región / DR** | 🔴 Una sola región | Réplicas, failover regional | 🟢 Bajo hoy |
| **On-call** | 🔴 No existe | Rotación, runbooks, postmortems | 🟢 Bajo hoy |
| **SOC 2 / ISO 27001** | 🔴 | Requisito para vender a empresas | 🟢 Bajo hoy |

✅ **El agujero de Edge Functions quedó cerrado el 2026-08-21.** Los 1.469 tests
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
  consultado 2026-08-22). Nerqia adopta el mismo límite conceptual en Finance:
  intención server-side, objeto privado y finalización separada; la diferencia
  es que nuestro objeto queda unido a una versión documental y a la
  organización.
- ✅ **Supabase Storage:** los buckets privados fuerzan RLS también al descargar
  y permiten URL firmada temporal; los buckets aceptan límite de tamaño y tipos
  MIME ([Storage Buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals),
  revisado 2026-08-29). Por eso los originales de Finance y los comprobantes de
  Gastos no usan `getPublicUrl`: persisten un path tenant-safe y crean una URL
  de 60 segundos sólo después de que RLS valida el permiso actual.
- ✅ **Meta WhatsApp Cloud API:** la colección oficial de Meta separa texto de
  plantillas y exige crear/aprobar una plantilla antes de usarla como
  notificación; el envío usa `type=template`, nombre, idioma y componentes
  ([plantilla interactiva](https://www.postman.com/meta/whatsapp-business-platform/request/lwtlz1k/send-message-template-interactive),
  revisado 2026-08-29). Cumpleaños ya no recicla texto libre ni una conexión
  Evolution: queda apagado hasta que Plataforma registre la plantilla aprobada,
  y reserva una entrega única antes de hablar con Meta.
- ✅ **DolarAPI:** los endpoints documentados para oficial, blue y bolsa exponen
  `venta` y `fechaActualizacion` sin credencial
  ([documentación Argentina](https://dolarapi.com/docs/argentina/operations/get-dolares),
  revisado y consultado 2026-08-29). Nerqia valida respuesta positiva con
  timeout, conserva la última fuente sana ante una falla parcial y actualiza
  sólo referencias; el tipo de cambio operativo sigue siendo decisión del
  comercio.
- ✅ **Correo transaccional:** Google indica que las App Passwords requieren
  verificación en dos pasos y no siempre están disponibles; Microsoft documenta
  OAuth para SMTP AUTH, y Resend exige dominio verificado incluso cuando se usa
  su interfaz SMTP ([Google App Passwords](https://support.google.com/accounts/answer/185833),
  [Microsoft OAuth para SMTP](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth),
  [Resend SMTP](https://resend.com/docs/send-with-smtp), revisados 2026-08-29).
  Nerqia prioriza OAuth/credencial específica del proveedor; si el comercio
  usa SMTP, prueba antes de persistir, guarda el secreto sólo en backend y nunca
  lo incluye en snapshots, respuestas ni vistas de estado.
- ✅ **MercadoLibre:** sus notificaciones deben responder rápido, encolar el
  evento y consultar el recurso canónico por API en vez de confiar ciegamente en
  el payload ([notificaciones](https://developers.mercadolibre.com.ar/es_ar/notificaciones),
  consultado 2026-08-22). El mismo criterio se mantiene para futuros webhooks de
  órdenes, pagos y envíos: ACK, outbox, retry, deduplicación y lectura de la
  autoridad.
- ✅ **Tiendanube:** su documentación de migración separa productos, clientes,
  dominios, pagos y envíos; la importación masiva es un proceso explícito y
  recomienda respaldar antes ([migración](https://ayuda.tiendanube.com/es_AR/migrar-mi-tienda),
  consultado 2026-08-22). Su gestión de ventas documenta búsqueda por orden,
  cliente, email e importe, filtros por estados/canal/producto/cupón, vistas
  rápidas, exportación y bulk
  ([ventas](https://ayuda.tiendanube.com/es_AR/123288-mis-ventas/como-buscar-y-filtrar-mis-ventas)).
  Esto respalda el pipeline del roadmap
  `extract → staging → normalize → validate → preview → import → reconcile`, no
  una importación que pisa datos en silencio, y fija la paridad de operación de
  órdenes para D3/D5.
- ✅ **Shopify y Square en operación de órdenes:** Shopify conserva vistas de
  pedidos con búsqueda, filtros, columnas y orden, y permite inspeccionar un
  pedido sin abandonar la población; Square reúne órdenes de POS, web y socios,
  filtrables por estado, origen y pago, con detalle y actividad
  ([Shopify Orders](https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders/searching-orders),
  [Square Order Manager](https://squareup.com/help/us/en/article/6923-pickup-orders-on-square-point-of-sale),
  consultados 2026-08-29). Nerqia adopta el patrón como inspector de ticket
  con selección en URL, lista/filtros intactos y margen registrado visible; no
  copia sus estados ni presenta una línea como si fuera todo el ticket.
- ✅ **Empretienda:** comunica importación masiva, alertas de stock, medios de
  pago, envíos y administración móvil; su ayuda confirma productos
  digitales/mayoristas y venta manual con el mismo stock
  ([producto](https://www.empretienda.com/), [productos](https://empretienda.helpjuice.com/es_AR/productos)
  y [venta](https://empretienda.helpjuice.com/es_AR/conociendo-agregar-),
  consultados 2026-08-22). Se considera paridad de superficie y simplicidad; no
  se le atribuye POS offline ni arquitectura interna.
- ✅ **Mendel:** documenta políticas de gasto, presupuestos/tarjetas, reglas,
  aprobaciones, centros de costo, auditoría e integraciones contables
  ([producto](https://mendel.com/ar/producto/), [tarjetas](https://mendel.com/ar/producto/tarjetas-mendel/)
  e [integraciones](https://mendel.com/ar/producto/integraciones/), consultados
  2026-08-22). Finance toma ese estándar de control: quién solicita, qué
  presupuesto/política aplica, quién aprueba, qué evidencia queda y qué efecto
  está prohibido antes de aprobar.
- ✅ **Clara y Rindegastos:** agregan captura WhatsApp/mobile/offline,
  reembolsos/fondos, roles, múltiples entidades y políticas por centro de costo
  ([Clara](https://global.clara.com/es-AR), [Rindegastos](https://rindegastos.com/es-mx/gestion-de-gastos),
  consultados 2026-08-22). F5 adopta el control y la operación por excepción;
  no promete tarjetas, custodia ni viajes.
- ✅ **Contabilium, Xubio y Colppy:** confirman que el benchmark argentino ya
  integra facturación, compras, stock, caja/bancos, impuestos/contabilidad y
  canales locales ([Contabilium](https://contabilium.com/ar/industrias/erp-ecommerce/),
  [Xubio](https://xubio.com/ar/precios-empresas), [Colppy](https://colppy.com/sistema-de-gestion-para-pymes),
  consultados 2026-08-22). Nerqia debe ganar en implementación y margen
  explicable, no presentar esos módulos como novedad.

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

12. ~~**API pública con webhooks firmados y versionado.**~~ Contrato técnico
    cerrado el 2026-08-29. El siguiente gate no es agregar endpoints: una
    integración real debe justificar identidad OAuth, sandbox y portal antes
    de construir un marketplace de apps.
13. **Canary deploys con rollback automático.**
14. **Staging.**
15. **Multi-región y DR con RTO/RPO declarados.**
16. **SOC 2**, si alguna vez se le vende a una empresa mediana.

---

## 7. Lo que **no** hay que copiar

📌 Tan importante como la lista de arriba.

- **Marketplace de apps.** Con 1 comercio, un ecosistema de apps no tiene a
  quién servirle. Es la infraestructura del comercio 500.
- **Theme engine.** 7 temas cubren de sobra a 2 organizaciones (2026-08-26). Un motor de
  temas es un compromiso de compatibilidad para siempre.
- **Multi-idioma y multi-moneda.** No hay demanda medida.
- **Más features de ERP.** El modo de falla de este proyecto no es quedarse
  corto: es agregar. Al 2026-08-25 hay 308 tablas para 34 ventas.

---

## 8. El resumen en cinco líneas

1. ✅ **Técnicamente estamos mejor de lo que corresponde a nuestro tamaño**: RLS
   real, ledger, outbox, idempotencia, 1.534 tests y typecheck de 65 funciones (2026-08-25).
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
