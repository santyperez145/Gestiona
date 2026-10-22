# Tesis de Nerqia: de cero a uno, con método

**Estado:** vigente. **Revisión:** 2026-10-10. **Owner:** Dirección (todas las posiciones).
Gobierna la prioridad de [ESTRATEGIA](ESTRATEGIA.md), [ECONOMICS](ECONOMICS.md),
[PLAN_DE_LLEGADA](PLAN_DE_LLEGADA.md) (el objetivo con fecha y el orden) y
[META_FINALIZACION](META_FINALIZACION.md). Si un ítem del backlog no mueve una
hipótesis de este documento, no entra.

Dos marcos, aplicados con nuestras palabras:

- **Zero to One (Peter Thiel)** decide *qué* construir: algo nuevo que sea 10×
  mejor, con un secreto, un plan de distribución y una ventaja que dure. La
  competencia perfecta destruye margen; se gana dominando primero un mercado
  concreto y expandiéndose desde ahí.
- **Lean Startup (Eric Ries)** decide *cómo* avanzar sin engañarnos: cada
  apuesta es una hipótesis, cada entrega es el experimento más chico que la
  prueba, y el progreso se mide en aprendizaje validado, no en pantallas.

## 1. Qué es Nerqia

**Una sola plataforma para cualquier negocio que vende**, de cualquier rubro,
que hoy reemplaza a seis herramientas sueltas:

| Producto Nerqia | Trabajo | Lo que hoy usa el comercio por separado |
|---|---|---|
| Commerce | Tienda online, checkout, pedidos y canales | Tiendanube, Empretienda |
| Business | Productos, stock, caja/POS, clientes, compras, facturación ARCA | Xubio, Colppy, planillas |
| Finance | Gastos, comprobantes, aprobaciones, conciliación | Mendel |
| Creators | Campañas con influencers, canjes, contratos y resultados | GoMarz |
| Profit | Margen real por producto, canal y campaña | Escalafy |
| Growth | CRM, segmentos, email, WhatsApp, fidelidad | Clientify |

📌 El producto es multinegocio por diseño: rubros, categorías, atributos y
menú se adaptan a cada comercio (ver [BUSINESS_PROFILER](BUSINESS_PROFILER.md)).
Nada de lo que sigue convierte a Nerqia en un sistema de un rubro.

## 2. Dónde estamos (medido)

| Métrica | Valor | Fuente |
|---|---|---|
| Comercios con al menos una venta en 30 días (ATM) | 1 | base de producción, 2026-10-10 |
| Ese comercio | Ferretería Famatina: 5.500 productos, 3 ventas en 30 días, alta 2026-10-02 | idem |
| Pedidos online en 30 días | 0 | idem |
| Suscripciones pagas activas | 0 | idem |

Lectura honesta: construimos mucho producto y validamos poco. Según Lean,
estamos en la etapa de **establecer la línea de base**: todo lo que sigue se
mide contra estos números.

## 3. El secreto (Zero to One)

> Un comercio que crece termina pagando y operando **seis sistemas que no se
> hablan**. Cada uno ve una parte: la tienda ve pedidos, el sistema de gestión
> ve stock y facturas, la herramienta de gastos ve egresos, la de influencers
> ve canjes, la de marketing ve contactos, la de rentabilidad tiene que
> importar todo lo anterior para adivinar el margen. **Nadie tiene la operación
> completa en un solo lugar**, y por eso nadie puede decirle al comercio cuánto
> ganó de verdad con cada venta, campaña o influencer, y qué hacer después.

Nerqia sí: un solo registro del negocio (el Business Graph) donde la venta, el
costo, el gasto, el envío, el influencer y el cliente son el mismo dato. Eso es
lo 10×: no una herramienta mejor que cada una, sino **la única que ve todo**.
❓ Validar con entrevistas que el dolor de las herramientas sueltas es real y
pagable (E2).

## 4. Por dónde entrar (sin achicar el producto)

Thiel: se empieza dominando un mercado concreto. Lean: se empieza por los
**early adopters**, los que tienen el problema más fuerte. Para Nerqia, la
entrada es por **dolor**, no por rubro:

| Puerta de entrada | Quién | Dolor | Producto que abre |
|---|---|---|---|
| Catálogo grande | ferreterías, repuestos, librerías, mayoristas | miles de precios que cambian; stock que no coincide entre mostrador y online | Business + Commerce |
| Marca con influencers | indumentaria, cosmética, perfumería, accesorios | no saben qué influencer vende ni cuánto ganaron | Creators + Profit |
| Negocio con muchos gastos | gastronomía, servicios, distribuidoras | comprobantes y gastos sueltos, cierre de mes a mano | Finance + Business |

Cada puerta lleva a la misma plataforma; el comercio entra por un dolor y se
queda por el resto. 📌 Argentina primero (ARCA, Mercado Pago, pesos); la
comunicación y los experimentos se ordenan por puerta, el producto no.

## 5. Las siete preguntas (Zero to One)

| Pregunta | Respuesta de Nerqia | Estado |
|---|---|---|
| Ingeniería: ¿10× mejor? | Una plataforma en lugar de seis, con margen real conectado a cada venta, gasto y campaña. | ❓ medir horas y suscripciones ahorradas |
| Momento: ¿por qué ahora? | Inflación con precios que cambian seguido, factura electrónica obligatoria, cobro con QR masificado, comercio por redes e influencers, e IA que puede actuar sobre datos unificados. | ✅ contexto |
| Monopolio: ¿empezamos dominando algo concreto? | Las tres puertas de §4 en Argentina; ser «el sistema completo» de los comercios multicanal argentinos antes de ir a la región. | 📌 |
| Equipo | Fundador + desarrollo asistido; falta venta y onboarding en la calle. | ❓ |
| Distribución | Venta directa a los primeros comercios por puerta; después referidos, influencers de la red Creators (cada influencer trabaja con varias marcas) y «Hecha con Nerqia» en tiendas y tickets. | ❓ E4 |
| Durabilidad | El historial operativo completo vive en Nerqia: cuanto más módulos usa un comercio, más cuesta irse. Red de influencers y marcas del lado Creators. | 📌 |
| Secreto | §3. | ❓ validar |

## 6. Las dos apuestas de fe (Lean)

**Hipótesis de valor:** un comercio que usa Nerqia para vender lo usa **todas
las semanas** y suma un segundo producto (Finance, Creators, Profit o Growth)
en 60 días, porque ver todo junto le ahorra tiempo y le muestra plata que
antes no veía.
Métricas: ventas registradas por semana; productos Nerqia usados por comercio.

**Hipótesis de crecimiento:** cada comercio activo trae a otro en 90 días
(colega, proveedor, influencer compartido) y la suscripción se paga sola al
reemplazar herramientas que ya pagaba.
Métricas: altas referidas por comercio activo; conversión gratis → pago.

## 7. Motor de crecimiento

Lean distingue tres motores: **pegajoso** (retención), **viral** (cada usuario
trae otro) y **pago** (adquirir más barato que el valor de vida). 📌 Primario:
**pegajoso**, reforzado por la cantidad de productos que usa cada comercio.
Segundo: **viral** a través de Creators (un influencer conecta varias marcas) y
de las tiendas. Pago, sólo con costo de adquisición medido y retención probada.

## 8. Contabilidad de la innovación

1. **Línea de base** (2026-10-10): §2.
2. **Ajustar el motor:** cada experimento mueve una métrica de §6. Escalera de
   gates: **10 comercios → 8 tiendas → 5 primeras ventas online → 3 comercios
   vendiendo todas las semanas.**
3. **Pivotar o perseverar:** revisión el **2026-12-15**. Sin 3 comercios
   vendiendo todas las semanas, se cambia la puerta de entrada o la propuesta,
   con lo aprendido escrito acá.

Métricas de vanidad que **no** cuentan como progreso: altas totales, pantallas,
visitas, cantidad de funciones. Sí cuentan: ATM semanal, retención por cohorte
([ACTIVACION_COHORTES](ACTIVACION_COHORTES.md)), productos por comercio,
conversión gratis → pago.

## 9. Experimentos en curso

| Id | Hipótesis | Experimento mínimo | Éxito si | Fecha |
|---|---|---|---|---|
| E1 | El comercio de catálogo grande vuelve cada semana | Acompañar a Ferretería Famatina 4 semanas con ajuste de precios en bloque (por proveedor/marca) e importación | ≥ 20 ventas/semana registradas | 2026-11-07 |
| E2 | Las herramientas sueltas duelen y se pagan | 15 entrevistas, 5 por puerta de §4: qué herramientas usan, cuánto pagan, qué no pueden responder | ≥ 10 usan 3+ herramientas y nombran el margen real como pregunta sin respuesta | 2026-10-31 |
| E3 | Migrar es rápido | Alta asistida: planilla o export del sistema anterior → catálogo publicado | Catálogo listo en < 30 min | 2026-11-15 |
| E4 | Creators trae marcas | Ofrecer el portal de influencers a 3 marcas; medir cuántas marcas nuevas llegan por sus influencers | ≥ 1 marca nueva referida | 2026-12-01 |
| E5 | Se paga al reemplazar herramientas | Ofrecer Starter a comercios con 4 semanas de uso, mostrando lo que dejan de pagar | ≥ 30% paga con Mercado Pago | 2026-12-15 |

Regla Lean: sin criterio de éxito escrito antes de empezar, no es un experimento.

## 10. Potencial de unicornio: la cuenta

Una valuación de USD 1.000 millones para software con pagos suele pedir del
orden de **USD 100 millones de ingresos anuales recurrentes**. Ser la
plataforma completa sube el ingreso por comercio: en vez de una cuota, el
comercio paga por la suite que reemplaza seis herramientas, más una comisión
sobre lo que vende en su tienda online (en el local y en la gestión no hay
comisión: [ADR 008](ADR_008_COMISION_SOLO_TIENDA_ONLINE.md)). Con USD 50 por mes de suscripción (USD 600 al año) hacen
falta ~170.000 comercios pagos; con comisión de pagos, menos.

Referencia de tamaño: ~509.661 pymes empleadoras en Argentina (UCEMA,
diciembre 2025) y ~180.000 marcas activas en Tiendanube en toda Latinoamérica
(2025). Argentina sola no alcanza; el camino tiene tres pisos y se sube al
siguiente sólo con el anterior probado:

1. **Suite completa en Argentina**: suscripción por productos usados.
2. **Pagos dentro del sistema** (Nerqia Pay sobre Mercado Pago): comisión
   sobre lo cobrado en la tienda online; crece con las ventas del comercio, no
   con el precio.
3. **Región**: México, Colombia y Chile, con rails y facturación locales.

La ley de potencia (Thiel): pocos clientes, canales y decisiones explican casi
todo. Por eso se miden pocos números y se corren pocos experimentos a la vez.

## 11. Cómo se prioriza el producto

- Los seis productos son la visión y se mantienen. Lo que se prioriza es
  **profundidad verificada** (que cada flujo funcione de punta a punta con
  datos reales) por sobre pantallas nuevas.
- Primero lo que mueve un experimento de §9; después lo que conecta productos
  entre sí (el diferencial de §3).
- Stripe: no; cobramos con Mercado Pago ([PAGOS](PAGOS.md)).
- Publicidad paga: no antes de medir retención.
- Funciones pedidas por un solo comercio que no se repiten en las entrevistas
  esperan.

## Fuentes de mercado

- Pymes registradas (509.661) y tamaño: [UCEMA, Indicadores PyMEs dic. 2025](https://cl2.ucema.edu.ar/sites/default/files/2025-12/IndicadoresPyMES122025.pdf).
- Tiendanube, 170.000+ tiendas activas y 60.000 marcas argentinas (octubre 2025): [Ámbito, 2025-10-20](https://www.ambito.com/negocios/tiendanube-acelera-inteligencia-artificial-y-apunta-al-millon-marcas-latinoamerica-n6198958).
- Tiendanube, comisión por transacción de 0,7% a 2% y ajuste trimestral: [ayuda de Tiendanube](https://ayuda.tiendanube.com/es_ES/123484-costos-por-transaccion/por-que-tiendanube-cobra-un-costo-por-transaccion), consultado 2026-10-10.
- Xubio y Colppy, rangos de precio para pymes: [guía de software de facturación](https://www.guiadesoftware.com/blog/mejor-software-facturacion-argentina), consultado 2026-10-10 (terceros; confirmar en sitio oficial).
- Referentes por producto: [Mendel](https://mendel.com/ar/producto/), [GoMarz](https://go-marz.com/), [Escalafy](https://www.escalafy.com/), [Clientify](https://clientify.com/marketing), consultados 2026-10-10.
- Monotributistas, ~4,74 millones (dato sin fecha en el proyecto): [HCDN, proyecto 289596](https://rest.hcdn.gob.ar/web/proyectos/289596/adjuntos/104224).
