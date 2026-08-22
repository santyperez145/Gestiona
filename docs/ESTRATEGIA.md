# Estrategia y posicionamiento

Este documento existe porque `ROADMAP.md` no puede cumplir dos funciones a la
vez. El ROADMAP es un diario de ingeniería: dice qué se rompió, por qué se
arregló así y qué encontró la verificación. Sirve para quien escribe código y
es ilegible para cualquier otro.

Acá va la otra mitad: **qué es este producto, contra quién compite y qué habría
que demostrar para que sea un negocio** y no sólo un sistema que funciona.

Última revisión: 2026-08-22.

---

## 0. Cómo leer este documento

Hay tres clases de afirmación acá adentro y **no valen lo mismo**:

| Marca | Qué significa |
|---|---|
| ✅ **Medido** | Verificado contra la base o el repo, con el comando al lado. |
| 📌 **Criterio** | Decisión de producto tomada acá. Discutible, pero explícita. |
| ❓ **Sin verificar** | Viene de un análisis externo y **no se pudo comprobar**. Se registra para chequear, no para citar. |

Esa separación no es burocracia. La sesión 111 arrancó con un análisis externo
que decía "418 tests unitarios y 16 E2E" — el número real era **811**, y el
error venía de una línea desactualizada de este mismo repo. Un número sin fecha
en un documento público se convierte en el dato que otros repiten.

---

## 1. Qué es esto, en una línea

📌 **Criterio.** Hasta ahora el proyecto se describía como *"sistema de gestión
para PyMEs argentinas"* que además tiene tienda. Eso subvende lo que hay
construido y, peor, orienta mal las decisiones: lleva a comparar la tienda
contra Tiendanube, que es la comparación que se pierde.

La descripción que corresponde a lo que existe:

> **El sistema donde el negocio es uno solo, aunque venda por muchos lados.**
> El mostrador, la tienda online y los marketplaces comparten el mismo stock,
> los mismos clientes, los mismos costos y la misma verdad sobre cuánto se ganó.

La tienda **no es el producto**. Es una de las bocas de salida de un sistema que
sabe cuánto costó la mercadería, cuánto queda, quién la compró y cuánto margen
dejó. Eso es lo que ninguna plataforma de ecommerce tiene por abajo, y es lo
que acá ya está construido.

---

## 2. El diferencial real, y por qué es defendible

### 2.1 No es la tienda

✅ **Medido.** La tienda de este proyecto está bien, pero Tiendanube tiene años
de ventaja en temas, apps y ecosistema. Competir por ahí es perder de frente.

### 2.2 Es que el costo real ya está adentro

Este proyecto nació importando perfumes, y eso dejó algo que un ecommerce puro
no tiene motivo para construir: **el costo verdadero de la mercadería**. Costo
en dólares, aduana, flete, tipo de cambio. Está en `total_cost_usd` y lo usa el
POS para calcular ganancia por venta.

Sumado a lo que se agregó después —comisiones de MercadoPago, costo de envío
por zona, IVA por producto (A8), redondeo declarado (A9)— el sistema tiene
**todos los términos de la ecuación de rentabilidad**, cosa que hasta las
plataformas grandes suelen tener partida entre dos productos.

### 2.3 La feature que sale casi gratis de eso

📌 **Criterio: rentabilidad por canal es la próxima feature estrella.**

Un mismo producto deja márgenes distintos según dónde se venda, y hoy nadie se
lo dice al comerciante:

```
NIKE AIR MAX — costo real $80.000

  Mostrador     $160.000   −  0 comisión  −  0 envío   →  margen 50,0%
  Tienda        $170.000   − $12.000 MP   − $8.000     →  margen 41,2%
  MercadoLibre  $180.000   − $30.600      − $8.000     →  margen 34,1%
```

Y encima de eso, la frase que vale: *"tu tienda propia te deja 7 puntos más de
margen que MercadoLibre en este producto."*

Es defendible porque **no se puede copiar sin tener los datos de abajo**. Una
plataforma de ecommerce no sabe cuánto costó la mercadería. Un ERP no sabe la
comisión del marketplace. Acá están las dos.

Va como ítem **E4** del ROADMAP.

### 2.4 Business Copilot, no chatbot

📌 **Criterio.** La IA no es defendible si sólo escribe descripciones, fotos o
resúmenes: eso se copia y ya lo promocionan otros. El diferencial aparece cuando
la IA trabaja sobre el grafo del negocio y convierte datos en acciones:

- qué comprar antes de quedarse sin stock;
- qué canal deja menos margen por producto;
- qué clientes se están enfriando;
- qué promoción liquida stock sin regalar margen;
- qué precio conviene mover según costo real, comisión, envío e IVA.

Cada recomendación tiene que tener una acción posible y una métrica posterior.
Por eso aparece como **AI Action Rate** en el bloque G del ROADMAP. Si no se
mide si el comercio hizo algo con la recomendación, es una demo de IA, no un
copiloto de negocio.

### 2.5 Lo que ya está y no hay que rehacer

✅ **Medido.** El análisis externo recomendaba construir un "stock engine" único
por el que pasaran todas las operaciones. **Ya existe**: `record_stock_movement`
es el único lugar que toca `products.stock`, `product_variants.stock` y
`location_stock`, con `trg_sale_stock_movement` y `trg_purchase_stock_movement`
cubriendo INSERT, UPDATE y DELETE. Se llegó ahí rompiéndolo dos veces, está
documentado en CLAUDE.md, y hay guardas para que no vuelva.

Lo mismo con el aislamiento multi-tenant: RLS por `org_id`, verificada con roles
reales, con `publicSurface.test.ts` y la vista `rls_audit_open_policies` como
guardas.

---

## 3. Contra quién se compite, honestamente

✅ / ❓ **Mapa actualizado el 2026-08-22.** El corte suma referentes globales,
Finance/spend regional y plataformas argentinas. Una fila `✅` sólo describe lo
que su fuente oficial permite sostener; `❓` sigue siendo radar y no se usa como
hecho en una presentación.

| Competidor | Qué dice el análisis | Estado |
|---|---|---|
| **Tiendanube** | ✅ Tiene Punto de Venta en Argentina y stock centralizado entre canales. En costo transaccional publica 0% con Pago Nube; con proveedor externo, 2% Esencial, 1% Impulso y 0,7% Escala, más el arancel del proveedor; Evolución es negociable. | ✅ [Punto de Venta](https://ayuda.tiendanube.com/pdv/que-es-punto-de-venta-de-tiendanube), [stock](https://www.tiendanube.com/funcionalidades/gestion-de-stock) y [costos por transacción](https://ayuda.tiendanube.com/es_AR/123484-costos-por-transaccion/que-son-los-costos-por-transaccion-de-tiendanube), verificado 2026-08-21 |
| **Empretienda** | ✅ Administra catálogo desde cualquier dispositivo, importa productos, contempla digitales/mayoristas/promociones y permite cargar una venta presencial, WhatsApp o redes descontando el mismo stock. | ✅ [producto](https://www.empretienda.com/), [productos](https://empretienda.helpjuice.com/es_AR/productos) y [agregar venta](https://empretienda.helpjuice.com/es_AR/conociendo-agregar-), verificado 2026-08-22 |
| **Contabilium** | ✅ ERP argentino con POS, facturación, compras, stock multi-depósito, tesorería/contabilidad e integraciones de ecommerce y marketplaces. Es una referencia local directa para la continuidad Commerce → gestión. | ✅ [ERP Argentina](https://contabilium.com/ar) y [ERP ecommerce](https://contabilium.com/ar/industrias/erp-ecommerce/), verificado 2026-08-22 |
| **Xubio** | ✅ Gestión argentina con facturación, compras, cobranzas/pagos, stock, importaciones, impuestos, contabilidad, permisos e integraciones con Mercado Libre, Mercado Pago, Tiendanube y WooCommerce. | ✅ [producto](https://xubio.com/ar/) y [funciones por plan](https://xubio.com/ar/precios-empresas), verificado 2026-08-22 |
| **Colppy** | ✅ Gestión/contabilidad cloud para PyMEs con facturación, bancos, pagos/cobros, stock, cash flow e integraciones locales. | ✅ [plataforma](https://colppy.com/) y [gestión para PyMEs](https://colppy.com/sistema-de-gestion-para-pymes), verificado 2026-08-22 |
| **Mendel** | ✅ Spend management regional con tarjetas, presupuestos, políticas preventivas, aprobaciones, centros de costo e integración con ERP. Es el benchmark principal de control de gasto, no sólo OCR. | ✅ [producto](https://mendel.com/ar/producto/), [tarjetas](https://mendel.com/ar/producto/tarjetas-mendel/) e [integraciones](https://mendel.com/ar/producto/integraciones/), verificado 2026-08-22 |
| **Clara Global** | ✅ Unifica gasto con tarjeta y reembolso, comprobantes por WhatsApp/formulario, roles, aprobaciones, múltiples entidades y reporte de pago. | ✅ [plataforma Argentina](https://global.clara.com/es-AR), verificado 2026-08-22 |
| **Rindegastos** | ✅ Rendiciones, políticas, aprobaciones, anticipos/fondos, viáticos, captura offline, duplicados e integraciones/API. | ✅ [gestión de gastos](https://rindegastos.com/), [controles](https://rindegastos.com/es-mx/gestion-de-gastos) y [API](https://rindegastos.com/es-co/documentacion-api), verificado 2026-08-22 |
| **SAP Concur Argentina** | ✅ Referencia enterprise para integrar viajes, gastos y facturas con captura automática y visibilidad fiscal/regulatoria. | ✅ [servicios financieros](https://www.concur.com.ar/servicios-financieros), verificado 2026-08-22 |
| **VentaWeb** | ERP + tienda argentina. ~1.200 comercios. | ❓ |
| **Axon ERP** | POS + stock + ecommerce nativo + ARCA. Muy parecido al planteo de acá. | ❓ |
| **Max24** | POS + stock + tienda + ARCA. ~1.200 tiendas. | ❓ |
| **Shopify** | ✅ Sus reportes de rentabilidad cubren producto, orden y mercado; en orden/mercado contemplan producto, envío, aranceles e impuestos. La ayuda advierte que `Cost per item` es estático y exige haberlo cargado al vender. | ✅ [Profit reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/profit-reports), verificado 2026-08-22 |
| **Odoo** | ✅ Margen por línea y pedido desde precio de venta menos costo del producto, incluyendo el efecto de tarifas y descuentos. | ✅ [Márgenes](https://www.odoo.com/documentation/18.0/es/applications/sales/sales/sales_quotations/margin.html), verificado 2026-08-22 |
| **QuickBooks** | ✅ Recibe comprobantes por web, móvil o email, extrae datos, deja revisar/matchear y separa roles de carga, aprobación y pago en Bill Pay. | ✅ [Captura y revisión](https://quickbooks.intuit.com/learn-support/en-uk/help-article/import-transactions/upload-receipts-bills-quickbooks-online/L862MmZHn_GB_en_GB) y [aprobaciones](https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-workflows/set-use-bill-approval-payment-release-workflows/L1IOLL9hv_US_en_US), verificado 2026-08-22 |
| **Lightspeed / Cin7** | Referencias de producto, no competidores directos en este mercado. | ❓ |

✅ **Conclusión ya verificable:** la categoría omnicanal local está cubierta por
Tiendanube/Empretienda y la continuidad ERP por Contabilium/Xubio/Colppy. POS,
stock compartido, facturación e integraciones son paridad; no alcanzan como
argumento. La ejecución tiene que bajar a lo concreto de §2.3: margen por
producto y canal con costo de importación, comisión, envío e IVA, preservando
la evidencia que compone el número y reduciendo el tiempo de implementación.

✅ **Margin facts medidos el 2026-08-22:** “tener margen” tampoco alcanza como
argumento. Shopify ya documenta profit por orden/mercado y Odoo margen por
línea/pedido. Gestiona ahora conserva por venta la fuente de costo, comisión,
envío e IVA y sólo publica contribución si están los cuatro. La base inicial es
34/34 líneas visibles, 0 completas y 2,9% de cobertura promedio: instrumentación
honesta, todavía no ventaja validada. Contrato y consulta reproducible:
[MARGIN_FACTS.md](MARGIN_FACTS.md).

✅ **Explicación por operación, 2026-08-22:** las 34 líneas reconstruyen 34
operaciones y ARS 1.143.696 sin duplicación; los seis medios históricos cierran
contra ingresos. 31 operaciones tienen flag de precio promocional, pero ninguna
conserva su precio de referencia: aparecen como evidencia parcial. Los pagos
divididos se desglosan por importe y una devolución bloquea la contribución
hasta reconciliar el neto. Esto cierra el contrato técnico, no el impacto real.

✅ **Cobro POS conciliable, 2026-08-22:** la próxima venta de mostrador crea
evidencia de cada parte del pago en el mismo commit. Efectivo/transferencia
prueban costo cero; débito/crédito esperan el arancel real y bloquean el margen
del ticket completo mientras tanto. La conciliación exige permiso financiero,
calcula el neto en servidor, audita y asienta banco/arancel/valores. También se
corrigió que cupón o descuento global podían verse en el POS pero perderse al
recalcular `total_ars`, y el precio de referencia que el RPC decía auditar ahora
sí se persiste. Esto mejora la evidencia futura; la base histórica sigue en 0
operaciones completas y no se reconstruyó.

✅ **Action Loop de precio, 2026-08-22:** el benchmark actualizado confirma que
crear promociones y mirar sus ventas es paridad: Tiendanube ya reporta cupones,
Shopify/Odoo conectan descuentos con analytics/margen, Sidekick exige aprobación
y Pricefx tiene workflow/revocación. Gestiona ahora congela baseline, aplica con
`marketing.edit`, recalcula el piso desde el Core, audita, mide con margin facts
y revierte sin pisar un precio cambiado después. El resultado se etiqueta
`observed_not_causal`: una comparación temporal no se vende como experimento.
Fixture real con rollback: ARS 3.000 → ARS 2.700, cobertura 100% en ambas
ventanas, conflicto ARS 2.600 bloqueado, reversión exacta, outsider/restos 0.
Producción: 25 recomendaciones descartadas, 0 aplicadas y 0 outcomes; el valor
comercial sigue sin validar. Contrato y fuentes: [PRICE_IMPACT_LOOP.md](PRICE_IMPACT_LOOP.md).

✅ **Finance como producto, 2026-08-22:** Odoo/QuickBooks confirman que OCR,
review, matching y aprobaciones son paridad. Mendel, Clara, Rindegastos y Concur
elevan la vara: control antes del gasto, presupuesto/política, centro de costo,
roles, reembolso, captura móvil y operación por excepción. Gestiona cerró
primero el límite que faltaba: `/finance` tiene chrome propio, misma
identidad/organización, entitlement separado de `finance.view` y decisión
Platform auditada. Su resumen lee proveedores, órdenes, obligaciones y ledger
del Core existente mediante RPC, sin duplicarlos. El matching ya propone sólo
aliases confirmados o identidad exacta, preserva ambigüedades y aprende CUIT/SKU
después de una decisión humana. La factura revisada ya crea Supplier Invoice,
Purchase y Payable Draft separados; owner/admin materializa una orden confirmada
y una deuda, mientras la recepción sigue siendo la única puerta al stock.
Producción: 4 organizaciones con Finance disponible, 0 solicitudes, 0
habilitaciones, 0 matches y 0 borradores reales. Esto prueba arquitectura, no
adopción.
Tarjetas, custodia y viajes quedan fuera hasta tener demanda, socio regulado,
economics y revisión legal. Contratos: [ADR 001](ADR_001_FINANCE_PRODUCT_SURFACE.md)
y [borradores](FINANCE_DOCUMENT_DRAFTS.md).

✅ **Benchmark económico agregado el 2026-08-21:** la comparación de pricing
no se usa para decir “somos más baratos”. Se usa para probar que el costo total
del merchant y la contribución de la plataforma cierran a la vez. Fórmulas,
calidad de supuestos y gate de aprobación: [ECONOMICS.md](ECONOMICS.md).

---

## 4. Lo que hay que dejar de decir

📌 **Criterio.**

| No decir | Por qué |
|---|---|
| "Tiendanube no tiene POS" | Es falso: su ayuda oficial documenta Punto de Venta en Argentina. Un dato viejo en una presentación destruye la credibilidad del resto. |
| "Somos más baratos" | Invita a una guerra de precios contra alguien con más espalda. |
| "Tenemos 84 páginas / 56 edge functions / 1.279 commits" | Cantidad de código no es valor. Un producto con 100 funciones puede ser peor que uno con 20. |
| "Tenemos IA" | Todos la tienen. Lo que importa es qué hace con los datos del negocio. |
| "Es una alternativa a Tiendanube" | Ubica el producto abajo del líder, en su categoría, con su vara. |

---

## 5. El riesgo más grande no es técnico

📌 **Criterio, y es incómodo:** hoy hay **una organización real usando esto**.
El sistema está construido para muchas —RLS por `org_id`, panel de plataforma,
comisión por venta— pero eso está *probado*, no *usado*.

Todo lo que sigue en el ROADMAP es mejora de producto. **Nada de eso responde
la única pregunta que importa**, que es si alguien más lo quiere.

La secuencia razonable, y no es la que da ganas de hacer:

1. **Que un segundo comercio lo use de verdad.** No un amigo con una cuenta de
   prueba: alguien que cargue su stock y cobre con esto. Un solo caso destapa
   más que veinte features — el onboarding, los supuestos escondidos, las diez
   cosas que "obviamente" se hacen así porque este negocio las hace así.
2. **Que pague.** Es la única señal que no miente.
3. **Recién ahí**, medir.

---

## 6. Qué se mide, y cómo no exagerarlo

✅ **Medido (2026-08-15):** G1–G8 ya tienen vistas o eventos en el panel de
plataforma. Se puede observar activación, publicación, adopción de canales,
salud, precisión de stock y acciones de IA sin inventar métricas desde el
navegador. Lo que todavía no existe es una serie comercial suficiente para
concluir retención, conversión o crecimiento: hay que separar siempre
**instrumentado** de **validado con comercios reales**.

La fuente concreta de cada señal es:

| Métrica | Por qué | Se saca de |
|---|---|---|
| **Tiempo hasta la primera venta (G1)** | Es *el* número de activación. Si un comercio nuevo tarda dos semanas, el problema es onboarding, no falta de features. | ✅ `platform_org_health` |
| **Tiempo hasta publicar y primera orden (G2)** | Mide si la tienda llega a vender, no sólo si se creó. | ✅ `platform_org_activation` + `published_at` instrumentado |
| **Adopción omnicanal (G3)** | El porcentaje que usa POS **y** tienda prueba que se usa el diferencial. | ✅ `platform_org_activation` |
| **GMV y organizaciones activas (G4/G5)** | Separa uso operativo de tracción económica. | ✅ `platform_org_health`; falta definir el denominador de pago antes de reportarlo como métrica SaaS. |
| **Riesgo de abandono (G6)** | Qué comercios bajaron su actividad y requieren intervención. | ✅ `platform_org_risk_series`, desde snapshots diarios reales sin backfill ficticio. |
| **Stock accuracy (G7)** | Si stock y Kardex no cierran, la promesa omnicanal se cae aunque la tienda sea linda. | ✅ `platform_org_stock_accuracy` |
| **AI Action Rate (G8)** | Mide acciones aplicadas, no aperturas de chat. | ✅ `apply_ai_offer_recommendation` → `platform_org_ai_actions`; no incluye chats ni sugerencias efímeras. |

📌 **Criterio para usuarios e inversión:** cada serie se muestra con fecha,
cohorte y denominador. Hasta que un segundo comercio complete el recorrido, se
presenta como instrumentación lista para medir, nunca como prueba de retención
o product-market fit.

Para una conversación de inversión también hacen falta MRR, ARR, churn, CAC,
LTV, margen bruto y GMV mensual con fecha. Si salen de herramientas externas o
de una planilla, se documenta la fuente. Lo que no se hace más es citar un
número sin fecha.

---

## 7. Sobre el repositorio público

✅ **Medido, y conviene aclararlo porque suena peor de lo que es.**

**No hay ninguna credencial filtrada.** El commit `a77d310` (2026-04-05, del bot
de scaffolding) versionó un `.env`, pero contenía sólo `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PROJECT_ID` y la **anon key** — las tres son públicas por diseño
y viajan en el bundle del navegador. Es exactamente el motivo por el que la
barrera es la RLS y no el secreto, cosa que este proyecto ya asumió. No hay
`service_role`, ni claves privadas, ni tokens de MercadoPago: esos viven en
tablas con RLS y cero policies, y en el vault.

Lo que **sí** está publicado es otra cosa: `ROADMAP.md` y `CLAUDE.md` son un
diario de ingeniería honesto que incluye cada bug que se encontró, cómo se
descubrió y qué estuvo mal durante meses. Para trabajar es lo mejor que tiene el
proyecto. Para mostrarlo afuera, es un inventario de debilidades escrito por
uno mismo.

📌 **Criterio: no cambiar nada todavía.** Hoy no hay a quién ocultárselo, y
partir la documentación en dos repos agrega fricción diaria a cambio de un
beneficio hipotético. Pero **antes de la primera conversación con alguien de
afuera** hay que decidir: o el repo pasa a privado con un público reducido
(README, capturas, arquitectura), o se acepta que el diario se lee.

---

## 8. Lo que NO habría que construir ahora

📌 **Criterio.** Esta lista vale tanto como el ROADMAP, porque el modo de falla
de este proyecto no es quedarse corto: es agregar.

- ❌ **Marketplace de apps.** Necesita comercios que quieran apps. Hoy hay uno.
- ❌ **Expansión a LATAM.** Ni siquiera hay dos comercios argentinos.
- ❌ **Contabilidad completa.** Es otro producto.
- ❌ **Manufactura, B2B, multi-moneda real.** No los pidió nadie.
- ❌ **Más módulos.** Hay 84 páginas. La pregunta ya no es qué falta.

✅ **Medido:** el proyecto ya hizo bien esto una vez — se dropearon 57 tablas de
módulos retirados que entre todas tenían 0 filas. Conviene recordarlo cuando
vuelvan las ganas de agregar.

---

## 9. Las tres cosas que sí

📌 **Criterio**, en orden:

1. **AFIP contra el organismo.** Sin factura, en Argentina no es un sistema de
   gestión: es una planilla linda. Es el `C1` del ROADMAP y está frenado por un
   certificado de homologación que es gratis y hay que pedir.
2. **Comprobar MercadoLibre con una cuenta real.** La capa técnica ya publica
   desde ficha, importa órdenes `paid` al Core, conserva comisión y envío del
   vendedor, recibe el webhook y tiene cron multi-organización protegido. Falta
   configurar Callback URL + tópico `Orders`, cargar el secreto del cron y
   verificar una venta real sin declarar victoria antes de hacerlo.
3. **Segundo comercio y onboarding medido.** Que un comercio nuevo cargue
   stock, publique, venda por dos canales y llegue a su primera venta el mismo
   día. Es lo que convierte “funciona para el dueño” en “alguien más lo puede
   usar” y produce la primera evidencia honesta para usuarios e inversión.

---

## 10. Lo que este documento no es

No es un plan de inversión y no debería usarse como tal. Un inversor no
pregunta qué se construyó: pregunta quién paga. Hoy la respuesta es un comercio,
que además es el dueño del proyecto.

Eso no está mal —es exactamente donde empieza todo— pero conviene no confundir
**tener un sistema que funciona** con **tener un negocio**. Lo primero está
bastante avanzado. Lo segundo no empezó, y ninguna feature lo empieza.
