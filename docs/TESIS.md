# Tesis de Nerqia: de cero a uno, con método

**Estado:** vigente. **Revisión:** 2026-10-10. **Owner:** Dirección (todas las posiciones).
Gobierna la prioridad de [ESTRATEGIA](ESTRATEGIA.md), [ECONOMICS](ECONOMICS.md) y
[META_FINALIZACION](META_FINALIZACION.md). Si un ítem del backlog no mueve una
hipótesis de este documento, no entra.

Dos marcos, aplicados con nuestras palabras:

- **Zero to One (Peter Thiel)** decide *qué* construir: algo nuevo que sea 10×
  mejor para un mercado chico que podamos dominar, con un secreto, un plan de
  distribución y una ventaja que dure. La competencia perfecta destruye
  margen; el objetivo es un monopolio de nicho que después se expande.
- **Lean Startup (Eric Ries)** decide *cómo* avanzar sin engañarnos: cada
  apuesta es una hipótesis, cada entrega es el experimento más chico que la
  prueba, y el progreso se mide en aprendizaje validado, no en pantallas.

## 1. Dónde estamos (medido)

| Métrica | Valor | Fuente |
|---|---|---|
| Comercios con al menos una venta en 30 días (ATM) | 1 | base de producción, 2026-10-10 |
| Ese comercio | Ferretería Famatina: 5.500 productos, 3 ventas en 30 días, alta 2026-10-02 | idem |
| Pedidos online en 30 días | 0 | idem |
| Suscripciones pagas activas | 0 | idem |

Lectura honesta: construimos mucho producto (ver [ESTRATEGIA §3](ESTRATEGIA.md))
y validamos poco. Según Lean, hoy estamos en la etapa de **establecer la línea
de base**: todo lo que sigue se mide contra estos números.

## 2. El secreto (Zero to One)

Hay una verdad que pocos ven sobre el comercio argentino:

> El comercio de barrio con muchos productos —ferretería, corralón, repuestos,
> librería, bazar, mayorista chico— está atendido por **dos mundos que no se
> hablan**: sistemas de mostrador viejos (o planillas) que sí entienden su
> catálogo, y creadores de tiendas que asumen catálogos chicos y prolijos. Nadie
> le da a ese comercio **un solo stock, una sola lista de precios y una sola
> caja** para el mostrador, la tienda online, WhatsApp y Mercado Libre, con
> factura de ARCA y cobro con Mercado Pago, y que aguante 5.000+ artículos con
> precios que cambian cada semana por inflación.

Indicio del secreto: el único comercio activo hoy es una ferretería con 5.500
productos. ❓ Validar con 10 entrevistas a
comercios del mismo tipo antes del 2026-10-31.

## 3. El monopolio chico donde empezar

📌 **Cabeza de playa:** ferreterías y corralones argentinos con más de 1.000
artículos que ya venden por más de un canal (mostrador + WhatsApp o
Mercado Libre). Después, comercios con la misma forma: repuestos, librerías,
bazares, mayoristas chicos.

Por qué ese nicho y no «todas las pymes»:

- Es chico y concreto: podemos ser **el** sistema de ferreterías antes de ser
  uno más entre muchos para todos los rubros.
- Su dolor es grande y medible: actualizar miles de precios por aumento de
  proveedor, stock que no coincide entre mostrador y online, ventas por
  WhatsApp sin registrar.
- Tiendanube y Empretienda no están hechas para ese catálogo; Xubio y Colppy
  son contables, no de mostrador. Ninguno cubre los dos lados.
- Se recomiendan entre ellos (proveedores y distribuidores en común): es un
  canal de distribución natural.

Lo genérico («cualquier rubro») se mantiene en el producto —ya está construido—,
pero la **comunicación, el onboarding y las funciones nuevas** apuntan al nicho
hasta dominarlo.

## 4. Las siete preguntas (Zero to One), respondidas

| Pregunta | Respuesta de Nerqia hoy | Estado |
|---|---|---|
| Ingeniería: ¿10× mejor, no 10%? | Cambio de precios masivo por proveedor/porcentaje y stock único mostrador + online + ML en una sola operación. Hoy eso son horas de planilla por semana. | ❓ medir horas ahorradas |
| Momento: ¿por qué ahora? | Inflación con listas que cambian seguido, factura electrónica obligatoria (ARCA) y cobro con QR/Mercado Pago masificado. | ✅ contexto |
| Monopolio: ¿empezamos con gran porción de un mercado chico? | Ferreterías y corralones multicanal (§3). | 📌 decidido |
| Equipo: ¿el equipo correcto? | Fundador + desarrollo asistido; falta alguien que venda en la calle a ferreterías. | ❓ |
| Distribución: ¿cómo llegamos? | Venta directa a los primeros 10, después referidos entre comercios, distribuidores mayoristas y la propia tienda («Hecha con Nerqia»). | ❓ experimento E4 |
| Durabilidad: ¿seguiremos en 10 años? | El historial operativo (ventas, costos, márgenes, clientes) vive en Nerqia: cuanto más se usa, más cuesta irse. Más la red de proveedores/listas compartidas. | 📌 |
| Secreto: ¿qué sabemos que otros no? | §2. | ❓ validar |

## 5. Las dos apuestas de fe (Lean)

**Hipótesis de valor:** un comercio con catálogo grande que vende por más de un
canal usa Nerqia **todas las semanas** para vender y actualizar precios, porque
le ahorra horas y errores de stock.
Métrica: ventas registradas por semana y cambios de precio masivos por mes.

**Hipótesis de crecimiento:** cada comercio activo trae a otro en 90 días
(proveedor, colega, cliente de la tienda), y el plan pago se paga solo con el
tiempo ahorrado.
Métrica: altas referidas por comercio activo; conversión de gratis a pago.

## 6. Motor de crecimiento

Lean distingue tres motores: **pegajoso** (retención), **viral** (cada usuario
trae otro) y **pago** (adquisición más barata que el valor de vida). 📌 El
motor primario es **pegajoso**: con un solo comercio, el riesgo no es atraer
gente sino que el que llega no se quede. Viral (referidos, «Hecha con Nerqia»
en la tienda y el ticket) es el segundo. Pago queda para cuando haya un costo
de adquisición medido y retención probada.

## 7. Contabilidad de la innovación

Tres etapas, en orden:

1. **Línea de base** (2026-10-10): §1.
2. **Ajustar el motor:** cada experimento mueve una métrica de §5. Los gates
   ya acordados son la escalera: **10 comercios → 8 tiendas → 5 primeras ventas
   online → 3 comercios vendiendo todas las semanas.**
3. **Pivotar o perseverar:** revisión el **2026-12-15**. Si para esa fecha no
   hay 3 comercios vendiendo todas las semanas, se pivotea de nicho (no de
   producto) o de propuesta, con lo aprendido escrito acá.

Métricas de vanidad que **no** se reportan como progreso: altas totales,
pantallas construidas, visitas, cantidad de funciones. Métricas que sí: ATM
semanal, retención por cohorte (ver [ACTIVACION_COHORTES](ACTIVACION_COHORTES.md)),
ventas por comercio, conversión gratis → pago.

## 8. Experimentos en curso

Cada uno es el producto mínimo para aprender, con fecha y criterio de éxito.

| Id | Hipótesis | Experimento mínimo | Éxito si | Fecha |
|---|---|---|---|---|
| E1 | La ferretería vuelve cada semana | Acompañar a Ferretería Famatina 4 semanas; medir ventas registradas y uso de precios masivos | ≥ 20 ventas/semana registradas en Nerqia | 2026-11-07 |
| E2 | El dolor nº 1 es actualizar precios | 10 entrevistas a ferreterías/corralones con la misma guía | ≥ 7 lo nombran primero sin sugerirlo | 2026-10-31 |
| E3 | Importar 5.000 artículos en minutos convence | Alta asistida: planilla del comercio → catálogo publicado | Catálogo listo en < 30 min y en el día | 2026-11-15 |
| E4 | Los comercios se recomiendan | Pedirle a cada comercio activo un contacto, con un mes de plan pago gratis para ambos | ≥ 1 alta referida por cada 3 activos | 2026-12-01 |
| E5 | Se paga cuando ahorra tiempo | Ofrecer Starter a los comercios con 4 semanas de uso | ≥ 30% acepta pagar con Mercado Pago | 2026-12-15 |

Regla Lean: un experimento sin criterio de éxito escrito antes de empezar no
cuenta como aprendizaje.

## 9. Potencial de unicornio: la cuenta

Una valuación de USD 1.000 millones para SaaS con fintech suele pedir del
orden de **USD 100 millones de ingresos anuales recurrentes**. Con una cuota
de USD 25 por mes (USD 300 al año) por comercio, eso son **~330.000 comercios
pagos**. Argentina sola no alcanza: hay ~509.661 pymes empleadoras
(UCEMA, diciembre 2025) y Tiendanube, el líder regional, informa ~180.000
marcas activas en toda Latinoamérica (2025).

Por eso el camino al unicornio tiene tres pisos, y sólo se sube al siguiente
cuando el anterior está probado:

1. **Monopolio de nicho en Argentina** (ferreterías y similares): suscripción.
2. **Pagos dentro del sistema** (Nerqia Pay sobre Mercado Pago): comisión sobre
   lo que el comercio cobra. Un comercio que vende ARS 20 millones al mes a
   0,5% de comisión vale más que su suscripción. Así crece el ingreso por
   comercio sin cobrar más caro.
3. **Expansión regional** a mercados con el mismo problema (México, Colombia,
   Chile), con la misma forma de comercio y rails locales.

Thiel insiste en que en las startups manda la ley de potencia: unos pocos
clientes, canales y decisiones explican casi todo el resultado. Por eso este
documento elige **un** nicho, **un** motor y **cinco** experimentos.

## 10. A qué decimos que no (por ahora)

- Stripe: no hay mercado que lo exija; cobramos con Mercado Pago
  ([PAGOS](PAGOS.md)).
- Nuevas superficies de Growth, Profit standalone, B2B y Developer Platform
  hasta pasar el gate de 3 comercios semanales.
- Funciones pedidas por un solo comercio que no se repiten en las entrevistas.
- Publicidad paga antes de medir retención.

## Fuentes de mercado

- Pymes registradas (509.661) y tamaño: [UCEMA, Indicadores PyMEs dic. 2025](https://cl2.ucema.edu.ar/sites/default/files/2025-12/IndicadoresPyMES122025.pdf).
- Tiendanube, 170.000+ tiendas activas y 60.000 marcas argentinas (octubre 2025): [Ámbito, 2025-10-20](https://www.ambito.com/negocios/tiendanube-acelera-inteligencia-artificial-y-apunta-al-millon-marcas-latinoamerica-n6198958).
- Tiendanube, planes con comisión por transacción de 0,7% a 2% y ajuste trimestral: [ayuda de Tiendanube](https://ayuda.tiendanube.com/es_ES/123484-costos-por-transaccion/por-que-tiendanube-cobra-un-costo-por-transaccion), consultado 2026-10-10.
- Xubio y Colppy, rangos de precio públicos para pymes: [guía de software de facturación](https://www.guiadesoftware.com/blog/mejor-software-facturacion-argentina), consultado 2026-10-10 (fuente de terceros, confirmar en sitio oficial).
- Monotributistas, ~4,74 millones (dato sin fecha en el proyecto): [HCDN, proyecto 289596](https://rest.hcdn.gob.ar/web/proyectos/289596/adjuntos/104224).
