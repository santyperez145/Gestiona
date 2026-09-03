# Unit economics y decisión de pricing

Este documento separa lo **medido**, lo **modelado** y lo **aprobado**. El
workbench de Plataforma → Comisiones → Unit economics permite cambiar supuestos
sin escribir la base ni activar una comisión.

Última revisión: **2026-08-21**.

## 1. Punto de partida medido

✅ La evidencia disponible es demasiado chica para fijar pricing:

| Señal | Valor observado | Qué permite concluir |
|---|---:|---|
| Comercios reales | 1 | Operación inicial, no product-market fit. |
| Pagos de marketplace | 2 × ARS 1 | La mecánica de split funcionó; no mide conversión ni margen. |
| Comisión histórica registrada | ARS 0,10 total / 5% | Evidencia técnica, no precio validado. |
| Propuesta visible | 0,5%, borrador | Cobra ARS 0 hasta aprobación comercial, fiscal y contractual. |
| Suscripciones efectivamente cobradas | 0 | No hay ARPU ni retención paga observables. |

El 0,5% no es una recomendación. Con montos de ARS 1, el redondeo por
transacción también distorsiona cualquier take rate. Ningún número de esta
muestra debe entrar a un pitch como economía validada.

## 2. Qué calcula el workbench

La autoridad pura es `src/lib/unitEconomics.ts` y tiene pruebas para impuesto
incluido/adicionado, leakage, piso/tope por transacción, costo del procesador,
contribución y break-even.

| Métrica | Definición reproducible |
|---|---|
| Cargo de Nerqia al merchant | Tarifa por ticket promedio × transacciones, después de piso/tope, impuesto y leakage. |
| Ingreso neto de comisión | Cargo menos impuesto indirecto; si el impuesto se adiciona, la base comercial es el ingreso. |
| Net take rate | Ingreso neto de comisión + suscripción neta, dividido GMV. |
| Costo variable | Costo por transacción + costo por merchant + pérdida de riesgo sobre GMV. |
| Contribución | Ingreso neto de plataforma − costo variable. |
| Contribution margin | Contribución / ingreso neto de plataforma. |
| Resultado operativo | Contribución − costos fijos del mes. |
| Break-even GMV | Costos fijos / contribución por peso de GMV al mix actual. |

📌 El break-even mantiene ticket, frecuencia, merchants por GMV y estructura
variable del escenario. **No** proyecta crecimiento, CAC, churn, retención ni
cambios de mix.

### Dos economías que no se mezclan

El arancel del procesador y su impuesto reducen el neto del comercio. No son
COGS de Nerqia cuando el proveedor los descuenta directamente al vendedor.
Los COGS de la plataforma deben cargarse explícitamente: infraestructura,
soporte/operación, costo por transacción, fraude/chargeback absorbido y otros
costos contractualmente propios.

Mercado Pago documenta que en el modelo marketplace primero descuenta su costo
al vendedor y luego la comisión del marketplace del saldo restante. También
exige OAuth para el split. Fuente oficial consultada el 2026-08-21:
[integración marketplace](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/how-tos/integrate-marketplace)
y [prerrequisitos](https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/prerequisites).

## 3. Calidad de cada supuesto

| Input | Fuente actual | Estado |
|---|---|---|
| GMV, transacciones y merchants | Último mes ARS de `platform_revenue_monthly`. | ✅ Medido, muestra insuficiente. |
| Comisión | Regla base visible, incluso si está en borrador. | ✅ Configuración; ❌ no pricing aprobado. |
| Arancel de proveedor | `payment_provider_fees`. | 📌 Estimación; el settlement real manda cuando existe. |
| Leakage/refunds | Entrada manual. | ❓ Falta cohorte real. |
| Suscripción neta | Entrada manual. | ❓ No hay cobros reales. |
| Costo por transacción/merchant | Entrada manual, inicia en cero. | ❓ Falta medición. |
| Pérdida de riesgo | Entrada manual, inicia en cero. | ❓ Falta contrato e historial. |
| Costos fijos asignados | Entrada manual, inicia en cero. | ❓ Falta criterio contable. |

El panel advierte cuando los costos están en cero. En ese estado muestra la
aritmética de ingresos, pero contribución y break-even no son defendibles.

## 4. Benchmark competitivo verificable

✅ Tiendanube informa oficialmente que el costo por transacción es 0% usando
Pago Nube. Con un medio de pago externo publica 2% para Esencial, 1% para
Impulso y 0,7% para Escala; Evolución es negociable. Ese costo se suma al
arancel del proveedor. Fuente oficial actualizada el 2026-03-25:
[costos por transacción de Tiendanube](https://ayuda.tiendanube.com/es_AR/123484-costos-por-transaccion/que-son-los-costos-por-transaccion-de-tiendanube).

📌 Esto es un benchmark del **costo transaccional**, no una equivalencia de
producto. Nerqia compite como sistema operativo omnicanal con margen real por
canal; no conviene presentarlo como una tienda más barata. El benchmark obliga
a explicar qué valor incremental recibe el merchant por cualquier cargo y cuál
es su costo total de cobro.

## 5. Hipótesis de monetización a comparar

Ninguna está aprobada:

| Modelo | Ventaja potencial | Riesgo a demostrar |
|---|---|---|
| Nerqia Pay incluido | Monetización alineada al volumen y una sola explicación de costo. | Contrato upstream, approval rate, fraude, refunds e impuesto pueden borrar el margen. |
| Suscripción + 0% transaccional | Costo predecible y comparación simple. | Fricción de adopción antes de demostrar ROI y churn alto en comercios chicos. |
| Híbrido por plan | Permite precio bajo de entrada y mejores economics en merchants grandes. | Complejidad comercial y riesgo de cobrar dos veces sin valor visible. |
| Cargo por valor ejecutado | Alinea revenue con Finance, Ship o automatizaciones que ahorran dinero. | Atribución, consentimiento y resultado verificable. |

La hipótesis preferida del roadmap sigue siendo monetizar dentro de Nerqia
Pay cuando el contrato lo permita y evitar una comisión adicional difícil de
explicar. El workbench existe para refutarla si los costos no cierran.

## 6. Gate para aprobar un precio

Finance no debería activar una regla hasta reunir evidencia de:

1. contrato upstream que permita el modelo marketplace y defina chargebacks,
   refunds, reservas, plazos y responsabilidad;
2. factura argentina de la comisión/suscripción y tratamiento impositivo
   validado por contador;
3. términos comerciales aceptados y versionados por cada merchant afectado;
4. costo de servir medido, no cargado como cero por conveniencia;
5. sensibilidad con escenario base, estrés y pérdida de volumen;
6. costo total para el merchant comparado con alternativas verificadas;
7. contribución positiva antes de costos fijos y camino creíble a break-even;
8. aprobación explícita en el RPC de comisiones, con vigencia y auditoría.

Hasta entonces, la salida correcta del sistema es **borrador que cobra ARS 0**.

## 7. Lectura para inversores

La historia defendible hoy no es “ya tenemos un take rate”. Es:

- el split, settlement, ledger, refund y traza están instrumentados;
- una edición accidental ya no puede activar pricing;
- merchant economics y platform economics se explican por separado;
- el modelo muestra qué datos faltan para probar contribución y break-even;
- la siguiente evidencia comercial es un segundo merchant transaccionando y
  pagando, no otra feature de amplitud.

Cuando haya cohortes, el scorecard debe reportar GMV conciliado, ingreso neto,
net take rate, contribution margin, costo de servir, retención paga y
concentración por merchant con período y consulta reproducible.
