# Plan de llegada: Nerqia lista para vender (cuarto trimestre de 2026)

**Estado:** vigente desde el 2026-10-22.
**Owner:** Dirección (todas las posiciones).
**Revisión:** todos los lunes, y la grande el 2026-12-15.

Este plan baja la [Tesis](TESIS.md) a un objetivo con fecha, y el orden lo fijó el dueño el 2026-10-22. La tesis decide *por qué*. Este plan decide *qué falta y en qué orden*. El [roadmap](../ROADMAP.md) y la [meta de finalización](META_FINALIZACION.md) llevan el detalle técnico y la evidencia. Si algo no acerca el objetivo de §1, no entra.

## 1. El objetivo

> **Al 15 de diciembre de 2026, tres comercios argentinos operan su negocio en Nerqia todas las semanas, y al menos uno paga.**

«Operar su negocio en Nerqia» quiere decir, para cada uno de esos comercios:
- vende en el local y online;
- factura en ARCA con su propio certificado;
- lleva el stock, los clientes, las compras y los cobros en un solo lugar;
- cierra el mes con su contador sin planillas aparte.

Para llegar se suben los escalones de la tesis (§8), en orden:

| Escalón | Fecha objetivo | Cómo se mide |
|---|---|---|
| Producción restaurada y verificada | 2026-10-24 | Base activa, migraciones aplicadas, CI en verde |
| 2 comercios facturando con CAE real | 2026-11-07 | Facturas de producción con CAE, sin ayuda por SQL |
| 10 comercios con alta | 2026-11-21 | Organizaciones con catálogo cargado |
| 8 tiendas publicadas y 5 primeras ventas online | 2026-12-05 | Pedidos online confirmados |
| **3 comercios semanales, 1 pago** | **2026-12-15** | Ventas en 4 semanas seguidas; suscripción cobrada |

Si al 15/12 no se llega a 3 comercios semanales, se revisa la puerta de entrada o la propuesta, como manda la tesis. No se agregan pantallas para compensar.

## 2. Decisiones vigentes

Las decisiones de esta lista no se vuelven a discutir en cada tarea:

1. **El orden es gestión completa y ARCA primero, tienda online después, y el resto al final** (decisión del dueño, 2026-10-22).
2. **Todo sirve para la venta en el local y para la online.** Hay un solo catálogo, un solo stock, un solo cliente, un solo libro y una sola factura. Un pedido online es una venta más del negocio; no es un sistema aparte.
3. **La comisión de Nerqia es sólo para la tienda online** ([ADR 008](ADR_008_COMISION_SOLO_TIENDA_ONLINE.md)). En el local y en la gestión, Nerqia cobra la suscripción.
4. **Cada comercio factura con su propio certificado** ([ADR 007](ADR_007_CERTIFICADO_PROPIO_POR_COMERCIO.md)). Nerqia nunca pide la clave fiscal.
5. **Los cobros van por Mercado Pago, no por Stripe** ([PAGOS](PAGOS.md)).
6. **Cero errores.** Lo pasajero se reintenta. Nada falla en silencio. «Intermitente» no cierra una tarea.
7. **Importa más la profundidad verificada que las pantallas nuevas.** Una función está terminada cuando funciona con datos reales, no cuando se ve.
8. **El dueño hace sólo lo intransferible**: plata, clave fiscal, firmas y conversaciones con comercios. Todo lo demás lo hace Dirección.

## 3. Dónde estamos (medido el 2026-10-22)

| Tema | Estado | Por qué importa |
|---|---|---|
| **Producción** | **Caída desde el 19/10.** Supabase apagó el proyecto por una factura impaga (USD 33,74, RGPCAY-00018). | Ningún comercio puede usar Nerqia hasta que se pague. Es el bloqueante número uno. |
| Construido sin aplicar | 6 migraciones (20261021000100, 20261022000100…0500) y 4 funciones sin desplegar (`afip-credentials`, `afip-platform-cert`, `afip-authorize`, `mercadopago-link`). | Todo eso existe en el código, pero no en producción. |
| Adopción (10/10) | 1 comercio con ventas (Ferretería Famatina), 0 pedidos online y 0 suscripciones pagas. | Es la línea de base de la tesis. |
| Calidad visible | Las 70 pantallas, en escritorio y celular, sin errores, sin desborde y sin fallas graves de accesibilidad (140/140, con cuentas vacías). | Falta repetir el barrido con datos. |
| CI | La puerta local está en verde. El E2E falla en el acto porque la base no responde (antes figuraba «cancelado»). | Vuelve a verde cuando vuelva la base. |

## 4. Qué falta, por frente

Cada ítem tiene su criterio de terminado. `[ ]` es pendiente, `[~]` es construido sin verificar con datos reales y `[x]` es verificado.

### A. Operación de la plataforma (habilita todo lo demás)

- [ ] **Restaurar producción.** Primero el dueño paga. Después Dirección corre `npm run db:pendientes` (simulacro de las 20 pendientes contra producción), aplica, despliega las funciones y verifica tiendas, ARCA y CI. *Terminado:* CI en verde y una tienda real que carga. Desde el 23/10 las 20 ya pasan en CI contra una base reconstruida desde cero (`simulacro-migraciones.yml`, 2026-10-23: 812 migraciones y 19 de 19 matrices en OK); la primera a aplicar por seguridad es 20261023000200 (vistas de sólo lectura).
- [~] **Que no vuelva a pasar.** Una tarjeta de respaldo y alertas de facturación en Supabase, Vercel y el dominio (dueño), más un control diario del estado del proyecto (Dirección; hecho el 23/10: `estado-produccion.yml` prueba Supabase y el sitio cada 6 horas y abre un issue «Producción caída», que llega por mail, y lo cierra cuando vuelve). *Terminado:* un aviso llega antes del corte, no después.
- [ ] **Restauración probada.** Restaurar un backup en un proyecto de prueba y medir cuánto tarda. *Terminado:* tiempo medido y escrito.
- [ ] Protección de `main` para administradores y un segundo revisor (decisión del dueño, ROADMAP §5 P0).

### B. ARCA completo

- [~] El certificado propio por comercio (ADR 007) está construido. *Terminado:* Exentry (CUIT 23-22891559-9) y Famatina facturan en producción con su certificado.
- [ ] **Primer CAE real de cada comprobante: A, B, C, nota de crédito y nota de débito.** Es el gate externo de ARCA. *Terminado:* un comprobante de cada tipo autorizado en producción y revisado.
- [~] **Factura completa** (construida el 22/10): concepto y servicios, exento y no gravado, moneda extranjera y percepciones cargadas a mano. Falta lo automático, que se describe abajo.
- [~] **Percepciones automáticas en la factura emitida** (construidas el 22/10: padrón ARBA/AGIP filtrado por cliente, IVA, cálculo en la factura). (IIBB e IVA, «otros tributos» de WSFE). Las necesitan los mayoristas que son agentes de percepción. Hoy la factura no las lleva. *Terminado:* una factura con percepción autorizada y su línea en el Libro IVA.
- [~] **Contingencia CAEA** (construida el 22/10): si ARCA no responde, la factura sale con el CAEA de la quincena y se informa sola antes de la fecha tope. *Terminado:* un comprobante emitido con CAEA en homologación e informado con resultado «A».
- [~] **Factura de Crédito Electrónica MiPyME (FCE)** (construida el 22/10: emisión, notas, CBU y consulta de obligación en WSFECRED). *Terminado:* una FCE emitida en homologación con el certificado asociado a FCE, y el circuito de aceptación y rechazo del comprador explicado.
- [~] El Libro IVA Digital (ventas y compras), el subdiario en Excel, las retenciones sufridas y el monotributo están construidos. *Terminado:* un contador importa el mes real en el aplicativo de ARCA sin correcciones.
- [~] **Ingresos Brutos del mes** (construido el 22/10: liquidación por jurisdicción en el Libro IVA, coeficiente CM05 por inscripción, retenciones restadas, hoja en el Excel del contador): base imponible por jurisdicción (local y Convenio Multilateral) y las percepciones y retenciones sufridas, todo listo para el contador. *Terminado:* el resumen de IIBB de un mes real coincide con lo que liquida el contador.
- [~] **Conciliación con «Mis Comprobantes Emitidos»** (construida el 22/10): el archivo de ARCA (.zip, .csv o Excel) contra lo autorizado en Nerqia; marca CAE otorgados que no se guardaron, comprobantes hechos por fuera, y diferencias de CAE, importe o fecha. *Terminado:* un mes real de un comercio conciliado sin falsos positivos.
- [~] **Factura de exportación E (WSFEX)** (construida el 22/10): factura, notas, autorización automática sin duplicados, Libro IVA con código «X». *Terminado:* una factura E autorizada en homologación con el certificado asociado a exportación.
- [~] **Padrón automático** (22/10): al escribir un CUIT en cualquier pantalla, ARCA completa razón social, condición y domicilio; usa el certificado de la plataforma o el del comercio. *Terminado:* una consulta real respondida con un certificado asociado a «Consulta de Constancia de Inscripción».
- [ ] Controlador fiscal: certificación en Modo Entrenamiento con el equipo real (gate externo, ya listado en la meta).

### C. Gestión completa (el sistema de gestión del comercio)

**Circuito de ventas**

| Paso | Estado |
|---|---|
| Presupuesto | listo |
| Venta | lista |
| Remito con entregas parciales | construido el 22/10 |
| Factura | lista |
| Cobro y recibo | listos |
| Cuenta corriente | lista |
| Cheques | listos |

- [~] **Trazabilidad en cada documento** (construida el 22/10: «Operación completa» en la ficha de la venta, con enlaces directos a presupuesto, remitos y facturas). La venta muestra su presupuesto, sus remitos, sus facturas y sus cobros, y cada documento enlaza a los otros. *Terminado:* desde cualquier documento se llega a toda la operación en un clic. Es el «todo enlazado» que pidió el dueño y el diferencial de la tesis (§3).
- [~] **Facturar remitos o ventas juntos** (construido el 22/10: Remitos › «Facturar juntos»). Una factura por varios remitos del mismo cliente: es la factura mensual del mayorista. *Terminado:* una factura con CAE que cubre dos remitos y deja las dos ventas facturadas.
- [ ] Pedido de cliente con reserva de stock. **Se valida antes de construirlo:** venta más entrega parcial ya cubre la mayoría de los casos. Sólo entra si aparece en las entrevistas (E2).

**Circuito de compras**

| Paso | Estado |
|---|---|
| Orden de compra | lista |
| Recepción | lista |
| Factura del proveedor (con IVA) | lista |
| Cuenta corriente del proveedor | enlazada a sus facturas el 22/10 |
| Orden de pago | construida el 22/10 |
| Libro IVA de compras | listo |

- [~] **Enlazar la factura del proveedor con la compra y la deuda** (construido el 22/10: «A cuenta corriente» en el Libro IVA Compras; la orden de compra se guarda si se indica). Al cargar la factura del proveedor, se asocia a la compra o a la recepción y genera la deuda en su cuenta corriente. *Terminado:* la deuda del proveedor coincide con sus facturas menos sus pagos, sin cargar nada dos veces.
- [~] **Orden de pago** (construida el 22/10: varios medios, cheques de cartera, comprobante impreso, y retención de IIBB del agente calculada con el padrón; en ARBA el lote A-122R del período, en AGIP el certificado propio; el archivo de e-ARCIBA y el lote de percepciones de ARBA, construidos el 23/10). *Terminado:* un lote aceptado por ARBA y un archivo importado en e-ARCIBA sin errores. Pagar una o varias facturas con varios medios (efectivo, transferencia, cheque propio o de terceros) y emitir el comprobante. Si el comercio es agente, calcular la retención y emitir su certificado. *Terminado:* una orden de pago impresa que cancela dos facturas, con el cheque de terceros dado de baja de la cartera.
- [x] Antigüedad de deudas con proveedores (ya existía en Proveedores) y vencimientos en la agenda (22/10: el Calendario muestra los pagos a proveedores y los cheques a depositar o debitar).

**Stock, caja y precios:** multidepósito, kardex, toma física, lotes, valuación, turnos de caja con arqueo, listas de precios y actualización masiva ya existen.
- [ ] Verificar con el catálogo real de Famatina (5.500 productos). *Terminado:* un ajuste masivo de precios y una toma física, de punta a punta, sin ayuda.

**Calidad**
- [ ] Barrido de pantallas **con datos**: tablas, gráficos y acciones por fila.
- [x] E2E del circuito completo con datos sintéticos: presupuesto, venta, remito, factura, cobro y cuenta corriente (2026-10-23: `e2e/circuito-gestion.spec.ts` en `e2e-local.yml`, contra un Supabase local reconstruido y sembrado; la factura queda sin CAE porque no hay ARCA local).

### D. Tienda online, enlazada a la gestión (después de C)

- [x] Un solo stock: el pedido online genera la venta y la venta mueve el stock, con el mismo trigger que el local.
- [~] Pedido pagado → venta → factura automática en ARCA (outbox). *Terminado:* un pedido real con CAE.
- [~] **Del pedido online al remito y al envío** (22/10: «Remito» en el envío del pedido, con la venta que creó el pago; la etiqueta y el seguimiento ya estaban). Remito desde el pedido, etiqueta y seguimiento, con el mismo circuito que una venta del local. *Terminado:* un pedido online despachado con remito y seguimiento.
- [~] **Precio y stock por canal** (el precio por tienda ya existe en el surtido; falta reservar stock para el local, que toca las cinco funciones de la vitrina y se hace con la base activa para probarlo). Precio online distinto si el comercio quiere, y stock reservado para la tienda. *Terminado:* las dos reglas configuradas y respetadas en el checkout.
- [~] **Cliente único** (22/10: el comprador se busca por CUIT o DNI y después por email, y su identidad fiscal del checkout completa la ficha sin pisarla). El comprador online es el mismo cliente del local, con CUIT para la factura A y cuenta corriente si corresponde.
- [~] **Migración desde Tiendanube o desde una planilla** (experimento E3; el importador ya reconoce las exportaciones de Tiendanube, Shopify y Empretienda, con sus variantes, y las planillas propias). *Terminado:* catálogo publicado en menos de 30 minutos.
- [~] Mercado Libre: verificar con datos reales la sincronización de stock, precios y pedidos.
- [x] La comisión de Nerqia es sólo sobre ventas online (ADR 008).

### E. Validación comercial (dueño, con apoyo de Dirección)

- [ ] **E2:** 15 entrevistas, 5 por cada puerta de entrada (tesis §4). El guion y la carga ya están listos en [ENTREVISTAS_E2](ENTREVISTAS_E2.md). *Terminado:* resultados escritos en la tesis.
- [ ] **E1:** acompañar a Famatina 4 semanas. *Terminado:* 20 o más ventas por semana registradas.
- [ ] **Precio:** fijar el precio de la suscripción y el porcentaje de la comisión online. Es decisión del dueño, con el análisis de Dirección y la competencia escrita.
- [~] **Alta asistida:** un recorrido de 30 minutos que lleva al comercio del registro a la primera venta y la primera factura. Construido: la lista de activación del panel (identidad, catálogo, stock, ARCA hasta un CAE real y primera venta) y «Para empezar a facturar» en ARCA. *Terminado:* un comercio real lo recorre en 30 minutos sin ayuda.

### F. Después (no antes de los escalones de §1)

Finance avanzado, Creators, Growth, Profit, IA nueva, apps nativas, región. Todo eso existe en distinto grado, y se profundiza cuando el objetivo esté cumplido o cuando un experimento lo pida.

## 5. Secuencia

| Fase | Fechas | Contenido | Sale cuando |
|---|---|---|---|
| 0 | hoy | El dueño paga Supabase. Dirección restaura, aplica y despliega (≈1 h). | CI en verde |
| 1 — Gestión y ARCA | 23/10 al 13/11 | B completo (certificados reales, CAE de cada tipo, percepciones, FCE, IIBB). C: trazabilidad, facturar remitos, compras con orden de pago, barrido con datos. | 2 comercios facturando y el circuito de C de punta a punta |
| 2 — Tienda enlazada | 14/11 al 05/12 | Todo D. Altas asistidas en paralelo. | 8 tiendas y 5 ventas online |
| 3 — Adopción | 05/12 al 15/12 | Acompañamiento, métricas, revisión de la tesis. | Revisión del 15/12 |

E1 y E2 corren en paralelo desde la fase 1: no esperan al software.

## 6. Quién hace qué

| Tarea | Responsable |
|---|---|
| Pagar Supabase y poner una tarjeta de respaldo y alertas de facturación | **Dueño (hoy)** |
| Crear el certificado de Exentry en ARCA con su clave fiscal, guiado por el asistente | **Dueño (≈15 min, cuando vuelva la base)** |
| Asociar ese certificado a «Consulta de Constancia de Inscripción» (padrón automático) y probarlo en ARCA → Consulta de CUIT | **Dueño (≈2 min)** |
| Entrevistas, acompañar a Famatina y conseguir los 10 comercios | **Dueño**, con guion y material de Dirección |
| Precio de la suscripción y porcentaje de la comisión online | **Dueño decide**, Dirección propone |
| Todo lo demás: producto, ingeniería, seguridad, ARCA, datos, documentación, calidad y operación | Dirección |

## 7. Cómo se trabaja

- **Lunes:** revisión de métricas y escalones (§1), qué se cerró, qué se trabó y el plan de la semana. Este documento se actualiza ese día.
- **Cada entrega** cumple la Definition of Done del roadmap (§7): la puerta en verde, el E2E del flujo, la documentación alineada y el push con el CI mirado después.
- **Cada decisión de producto o de negocio** queda escrita como ADR.
- **Jerarquía de documentos:** Tesis → este plan → roadmap → meta de finalización. Si se contradicen, manda el de más arriba y se corrige el de abajo.

## 8. Métricas

| Métrica | Hoy | Meta al 15/12 |
|---|---|---|
| Comercios con ventas en 30 días | 1 | 10 |
| Comercios que venden todas las semanas | 0 o 1 | 3 |
| Comercios facturando con su propio certificado | 0 | 3 |
| Pedidos online confirmados en 30 días | 0 | 5 o más |
| Suscripciones pagas | 0 | 1 o más |
| Construido sin verificar (migraciones y funciones pendientes) | 10 | 0 |
| CI en verde en `main` | no (base caída) | sí, todos los días |
| Errores de producción por semana (registro de errores) | sin medir | medido y en baja |

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Otro corte por facturación de la infraestructura (ya pasó) | Tarjeta de respaldo, alertas y control diario (frente A) |
| Validar con un solo comercio | E2 y la meta de 10 comercios; ninguna decisión sale de un solo caso |
| Dispersión: seis productos y más de 70 pantallas | El orden de §2 y la regla de no abrir frentes fuera de la fase |
| Cambios de ARCA (escalas del monotributo, resoluciones nuevas) | Revisión semestral escrita en el código (monotributo) y en este plan |
| Datos fiscales y certificados sensibles | Cifrado en el servidor, auditorías en 0, nunca la clave fiscal (ADR 007) |

## 10. Lo que no se hace ahora

Publicidad paga, expansión regional, Stripe, nuevas superficies de IA, apps nativas y funciones pedidas por un solo comercio. Todo eso espera al objetivo de §1 o a un experimento que lo pida.
