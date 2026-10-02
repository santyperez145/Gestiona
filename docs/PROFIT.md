# Nerqia Profit

**Estado:** canónico; Foundation en Analytics, suite completa pendiente.
**Revisión:** 2026-10-02. **Owner:** Producto / Datos.
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
Comparación verificada 2026-10-02: [Shopify Profit reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/profit-reports)
ofrece desglose por producto/variante y usa costo registrado al vender. Nerqia
conserva además las líneas sin costo como pendientes, no las oculta del período.

## Base existente y faltantes

| Trabajo | Estado comprobable en el repositorio | Gate pendiente |
|---|---|---|
| Hechos por línea | `sale_margin_facts`; `get_profit_period` presenta agregados y detalle. | Operaciones reales con fuentes completas. |
| Desglose por operación | `sale_margin_operations` y `OperationMarginPanel`. | Cobertura real por tienda y canal. |
| Confianza | `missing_components`, `coverage_pct`, bloqueos de devolución. | Métrica de cobertura visible en cada agregado. |
| Precio y outcome | Propuesta, aplicación/reversión y ventana observada existentes. | Piloto; observación no equivale a causalidad. |
| Profit por producto/SKU/canal/tienda | Un agregado SQL, detalle paginado, cobertura y filtros; verificación reversible de 1.007 líneas y dimensiones. | Certificación con fuentes completas; inventario/Ads siguen pendientes. |
| Gasto y atribución Ads | No certificado. | Conector read-only, identidad y conciliación de gasto. |
| Profit de campaña | Contrato futuro. | Atribución, devolución, gasto completo y cobertura. |
| Capital en inventario | `/valuacion-inventario`: FIFO sobre costos congelados, cobertura, capas/rotación paginadas, export y cierres diarios. | Evidencia de adquisiciones/retornos completa, conciliación física, landed cost y decisión real. |
| Entrada `/profit` / standalone | Alias de `/analytics?vista=rentabilidad`; misma vista/autoridad, no otra página. | Producto standalone y piloto; Growth sigue planeado. |

El contrato de fuentes actual vive en [MARGIN_FACTS](MARGIN_FACTS.md). No se
reimplementa en el navegador ni se reconstruye costo viejo desde `products`.

### Foundation publicado por contrato

`get_profit_period` exige membresía y `analytics.view`, incluso ante overrides
de admin/owner. Las vistas por línea, operación y cobertura conservan la misma
restricción. Staff Platform no obtiene detalle por ser staff.

Un snapshot SQL conserva población completa, cobertura, contribución total y
subtotal explicable; sólo producto/SKU/canal y operaciones se paginan (25 filas en
UI, hasta 100 por petición). Paginar no recalcula los totales desde una página.
La fecha del ticket es la primera línea, en Buenos Aires; el fin civil es
exclusivo al inicio del día siguiente. Todas sus líneas pertenecen a ese ticket,
incluso al cruzar medianoche. Moneda actual ARS; no representa FX ni gasto Ads.

La vista dedicada no hereda KPI de ganancia neta, año o sucursal que no aplica.
Producto, SKU y operación comparten controles; período, tienda, canal y modo
sobreviven en URL, con preferencia de modo por organización. `/profit` conserva
sólo `df`, `dt`, `profit_store`, `profit_channel`, `profit_mode`, nunca tokens. El acceso
vigente a Analytics continúa administrativo; los tests SQL de cuatro roles
prueban autoridad de lectura, no amplían los roles de navegación.

Errores recuperables, refresh sin vaciar la lectura, datos stale identificados,
revocación de permisos sin conservar cifras, vacío, parcialidad y contrato JSON
validado. Si falta la RPC no se vuelve al agregado truncado del navegador.
Prueba reproducible: `supabase/verificaciones/20261002_profit_period_authority.sql`
valida roles/denegaciones/dos tenants, 1.007 líneas, páginas disjuntas, límites
de medianoche y cero restos con rollback. No certifica adopción externa.

### Dimensiones de SKU y tienda

`get_profit_period_dimensions` exige los siete argumentos, incluido `p_filters`:
`storeId`, `channel`, `groupBy` (`product`/`sku`). Se rechazan claves inválidas,
tiendas ajenas y canales desconocidos; el contrato devuelve los filtros aplicados.
`get_profit_period` conserva su firma y delega sin filtros en esa autoridad;
no duplica cálculo ni introduce sobrecargas ambiguas.
`sale_margin_dimensions` sólo incorpora identidad y etiquetas del catálogo
actual, nunca precio o costo actual. Agrupa por producto/variante/canal, no por
texto SKU: dos variantes con el mismo SKU no se fusionan. El bucket sin variante
identificada sigue visible; etiquetas actuales no prueban identidad histórica.

La tienda procede del pedido canónico de Commerce. Elegir una tienda restringe
a sus operaciones completas, no a un surtido ni a stock clonado. Sus ventas
anteriores siguen consultables aunque esté inactiva. Sin filtro se incluyen
también ventas sin tienda atribuida. `profit_store_options` expone sólo ID,
nombre/estado con la misma membresía y permiso; no configuración ni secretos.
Los filtros permanecen operables durante errores/cambios y se pueden limpiar
juntos; una selección retirada no muestra UUID ni elige otra automáticamente.

`supabase/verificaciones/20261002_profit_sku_store_dimensions.sql` valida cuatro
roles, dos tenants, SKUs repetidos, paginación, tienda inactiva, devoluciones,
NULL y dinero inmutable tras cambiar el costo actual, con rollback y cero restos.

### Capital en inventario

Una sola pantalla: `/valuacion-inventario`, enlazada desde Profit y con acceso a Kardex.
`inventory_capital_items` proyecta el stock Core por producto/variante; no crea
otro inventario ni asientos. `get_inventory_capital` exige membresía y permisos
`inventory.view` + `analytics.view`; población, cobertura e importes completos
se agregan antes de paginar posiciones, capas e histórico de forma independiente.
La navegación administrativa vigente no cambia por los tests SQL de lectura.

FIFO analítico consume ingresos antiguos primero y mantiene únicamente unidades
remanentes. Usa `stock_movements.unit_cost_ars` congelado, nunca precio, margen,
costo actual o FX por defecto. Es costo registrado en Kardex, **no certifica
landed cost ni política contable**. Un saldo inicial no documentado, cero legacy
sin evidencia o devolución sin costo original quedan pendientes. Transferencias
balanceadas no adquieren capital. Negativos, saltos en el Kardex, orden simultáneo
ambiguo o variantes sin reconciliar bloquean la valuación de esa identidad;
los saldos negativos no se recortan. Se preservan subtotal cubierto y `NULL`
completo; ausencia de demanda no se muestra como infinitos ni días inventados.

Rotación usa ventas netas de devoluciones registradas de los últimos 90 días,
por identidad, no por coincidencia de nombres. Días de cobertura observados no
son pronóstico; sin historial no prueba stock muerto. La señal de más de 90 días
sin vender sólo suma costo trazable con una venta previa comprobable.

`capture_inventory_capital` requiere además `inventory.create`, fecha civil
vigente y bloqueo org/día. Guarda en `inventory_snapshots` existente, con versión,
actor y detalle de fuentes de toda la organización, sin aplicar el filtro de la
pantalla. Reintentos/doble clic conservan la primera captura; el navegador no
puede reescribirla. Filas anteriores sin versión no se presentan como costo
comprobado. Son capturas analíticas, no cierres contables ni ajustes físicos.

Búsqueda literal, tabs y tres páginas se preservan en URL. Cada tab exporta su
página identificada, con `NULL` vacío, labels humanos y celdas neutralizadas;
no exporta un subtotal como total ni expone UUID como etiquetas. Estados de
permiso, parcialidad, error y lectura anterior conservan recuperación explícita.

`supabase/verificaciones/20261002_inventory_capital_authority.sql` prueba cuatro
roles, dos tenants, 1.007 movimientos sin truncar, FIFO, variantes con SKU igual,
saldo inicial, devoluciones, negativos, transferencias, paginación, capturas
idempotentes y costos inmutables tras cambiar catálogo, con rollback y cero restos.
No demuestra adopción ni conciliación física. FIFO/AVCO/política contable completa,
identificación específica, landed cost y costo original de retornos siguen siendo
trabajos de dominio, no opciones simuladas en la interfaz.

Referencia oficial consultada 2026-10-02: [Shopify Inventory reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/inventory-reports)
publica snapshots y reportes de valor de inventario. [Odoo, valoración de operaciones](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/inventory_valuation/operations_valuation.html)
distingue ingresos, salidas, retornos y costos bajo FIFO/AVCO. Referencias de
trabajo, no evidencia de algoritmos idénticos ni paridad certificada.

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
2. **P1/P2:** certificar SKU/tienda, netear devoluciones, costo de inventario y alertas con
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
