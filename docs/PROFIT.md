# Nerqia Profit

**Estado:** canónico; contrato de producto aprobado, superficie dedicada pendiente.
**Revisión:** 2026-10-01. **Owner:** Producto / Datos.
Decisión: [ADR 004](ADR_004_GROWTH_PROFIT_SHARED_GRAPH.md).

## Propósito y límite

Explicar cuánto contribuye una operación, dónde falta evidencia y qué decisión
conviene revisar. Profit interpreta el Graph; Finance y el ledger son autoridad
financiera. No crea otra contabilidad, stock ni tabla de clientes. Un P&L
contable consume el ledger; una contribución analítica no se presenta como
utilidad neta o EBITDA sin gastos operativos y política contable completos.

Referencia pública consultada 2026-10-01: [Escalafy](https://www.escalafy.com/)
describe rentabilidad por producto/campaña/canal, stock multicanal y MCP/API.
Es una descripción del proveedor, no una certificación de su aplicación privada
ni paridad demostrada de Nerqia. Las capacidades se construyen con marca propia.

## Base existente y faltantes

| Trabajo | Estado comprobable en el repositorio | Gate pendiente |
|---|---|---|
| Hechos por línea | `sale_margin_facts`, leídos por `ChannelMarginTab`. | Operaciones reales con fuentes completas. |
| Desglose por operación | `sale_margin_operations` y `OperationMarginPanel`. | Cobertura real por tienda y canal. |
| Confianza | `missing_components`, `coverage_pct`, bloqueos de devolución. | Métrica de cobertura visible en cada agregado. |
| Precio y outcome | Propuesta, aplicación/reversión y ventana observada existentes. | Piloto; observación no equivale a causalidad. |
| Profit por SKU/producto/tienda | Fundaciones reutilizables; no suite terminada. | Proyección tenant-safe y regresión contra detalle. |
| Gasto y atribución Ads | No certificado. | Conector read-only, identidad y conciliación de gasto. |
| Profit de campaña | Contrato futuro. | Atribución, devolución, gasto completo y cobertura. |
| Capital en inventario/alertas | Datos Core; producto por completar. | Costo histórico, disponibilidad y prueba de decisión. |
| Entrada `/profit` / standalone | Planeada; entrada vigente `/analytics`. | Navegación, permisos, UI y pilotos antes de moverla. |

El contrato de fuentes actual vive en [MARGIN_FACTS](MARGIN_FACTS.md). No se
reimplementa en el navegador ni se reconstruye costo viejo desde `products`.

## Contrato económico

```text
ventas brutas - descuentos - devoluciones = ventas netas
ventas netas - costo histórico/landed cost
             - comisión marketplace/procesador/financiación
             - costo o subsidio de envío atribuible
             - impuestos atribuibles - fulfillment variable
             = contribución antes de publicidad
contribución antes de publicidad - gasto publicitario asignado
             = contribución después de publicidad
```

Reglas obligatorias:

- Si la fuente ya contiene ingreso neto, no restar de nuevo descuentos/refunds.
- No restar dos veces una comisión incluida en la liquidación o costo landed.
- No confundir envío cobrado al comprador con costo logístico del merchant.
- No mezclar importe con IVA incluido con ingreso neto de IVA sin un puente
  fiscal explícito; IVA/retención no es automáticamente un costo económico.
- Preservar moneda, escala decimal, instante, fuente, versión y procedencia;
  no usar float para persistir dinero ni mezclar FX actual con historia.
- Ausente es `NULL`, no cero; estimado, parcial y conciliado son estados distintos.
- Los agregados conservan población total y cubierta. Un subtotal cubierto no
  se rotula como resultado completo; devoluciones inciertas bloquean el cierre.
- Asignaciones usan pesos documentados y residuo de redondeo; suman al origen.
- Datos importados conservan external ID, hash/revisión y una clave idempotente;
  no pisan hechos propios ni duplican órdenes observadas en varios canales.

## Métricas publicitarias sin ambigüedad

Con gasto publicitario positivo y atribución explícita:

```text
Revenue ROAS = ingreso atribuido / publicidad
Contribution ROAS = contribución antes de publicidad / publicidad
Marketing ROI = contribución después de publicidad / publicidad
```

El break-even de Contribution ROAS es 1; el de Marketing ROI es 0. No se usa
el rótulo ambiguo Profit ROAS sin fórmula y base visibles. Si el gasto es cero
o desconocido, el cociente no está disponible, nunca infinito ni cero inventado.

Ejemplo aritmético, no dato de un merchant: contribución previa 1.542,
publicidad 1.000, contribución posterior 542. Contribution ROAS = 1,542;
Marketing ROI = 54,2%. El 0,542 posterior no significa pérdida. Una contribución
positiva tampoco demuestra utilidad neta después de todos los costos fijos.

First/last touch, ventana, UTM/click ID y pedidos sin atribuir quedan separados.
Sumar conversiones autodeclaradas de varias redes no produce ventas canónicas.
Cambios antes/después se muestran como observados, no experimentos causales.

## Producto por fases

1. **P1:** orden/producto/canal con fuentes actuales, cobertura y faltantes;
   distinguir disponibilidad de datos de rentabilidad y mantener un solo detalle.
2. **P1/P2:** SKU, tienda, devoluciones, costo de inventario y alertas con
   explicación, responsable, rango y enlace al origen; sin alertas inventadas.
3. **P2:** importación externa read-only de comercio/pagos y luego Ads. No basta
   un CSV/OAuth para declarar el conector conciliado o attribution completa.
4. **P2:** campañas/cohortes y capital de trabajo, leyendo caja/AR/AP de Finance.
5. **Posterior:** producto standalone sólo tras ICP, retención, economics y
   permisos independientes comprobados; no exige otra base ni repositorio.

## Loop y permisos

Profit detecta → Automate prepara/simula → Growth/Commerce recibe propuesta →
merchant autorizado aprueba → ejecutor idempotente actúa → Profit mide outcome.
Pricing, presupuesto Ads, compra, pago, refund y fiscal no cambian por un prompt.
Empezar Margin Guardian e Inventory Planner en shadow mode, con kill switch.

Lecturas privadas exigen tenant y permisos de costos/margen; staff Platform no
obtiene el detalle por su rol. Agregados, exports y MCP conservan esas guardas.
MCP empieza read-only; herramientas financieras requieren aprobación reforzada.

## Definition of Done

Una vista tiene filtros persistentes, contexto de tienda/canal/moneda/período,
loading, error recuperable, vacío y parcial; funciona en móvil/desktop y muestra
procedencia/cobertura. SQL y cálculos se verifican con dos tenants, descuentos,
refunds, múltiples líneas, FX, cero/ausencia y residuo de redondeo. Se concilia
detalle con agregado y se prueba el resultado con un merchant externo.

KPIs: cobertura de ingresos, tiempo a margen explicable, decisiones adoptadas,
errores evitados e impacto observado; cantidad de gráficos no mide adopción.
