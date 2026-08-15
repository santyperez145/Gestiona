# Estrategia y posicionamiento

Este documento existe porque `ROADMAP.md` no puede cumplir dos funciones a la
vez. El ROADMAP es un diario de ingeniería: dice qué se rompió, por qué se
arregló así y qué encontró la verificación. Sirve para quien escribe código y
es ilegible para cualquier otro.

Acá va la otra mitad: **qué es este producto, contra quién compite y qué habría
que demostrar para que sea un negocio** y no sólo un sistema que funciona.

Última revisión: 2026-08-14.

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

❓ **Sin verificar.** Lo que sigue viene de un análisis externo y **no se pudo
comprobar desde acá** (sin acceso a los sitios de los competidores). Se anota
como hipótesis a chequear antes de usarlo en cualquier presentación:

| Competidor | Qué dice el análisis | Estado |
|---|---|---|
| **Tiendanube** | **Lanzó POS en Argentina en 2026.** Si es cierto, "ellos no tienen POS" deja de ser argumento y hay que dejar de usarlo. | ❓ **Chequear primero** |
| **Contabilium** | ERP + POS + stock + facturación + ecommerce + marketplaces, argentino. El competidor local más directo. | ❓ |
| **VentaWeb** | ERP + tienda argentina. ~1.200 comercios. | ❓ |
| **Axon ERP** | POS + stock + ecommerce nativo + ARCA. Muy parecido al planteo de acá. | ❓ |
| **Max24** | POS + stock + tienda + ARCA. ~1.200 tiendas. | ❓ |
| **Lightspeed / Cin7 / Odoo / Shopify** | Referencias de producto, no competidores directos en este mercado. | ❓ |

⚠️ **La conclusión que sí se sostiene sin verificar nada:** si hay cuatro o
cinco productos argentinos haciendo "ERP + tienda", entonces **la categoría ya
existe** y no hay que convencer a nadie de que el problema es real. Eso es una
buena noticia y cambia el discurso: no se vende la idea, se vende la ejecución.

Y la mala: **no alcanza con "gestión + tienda"** como diferencial, porque ya lo
dicen varios. Hay que bajar a lo concreto, que es §2.3.

---

## 4. Lo que hay que dejar de decir

📌 **Criterio.**

| No decir | Por qué |
|---|---|
| "Tiendanube no tiene POS" | Puede ser falso desde 2026. Un dato viejo en una presentación destruye la credibilidad del resto. |
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
