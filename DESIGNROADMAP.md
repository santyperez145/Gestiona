# Nerqia — roadmap de diseño

**Corte:** 2026-09-04. Este documento define la dirección visual y los próximos
cierres de experiencia. Producto y prioridad viven en [ROADMAP.md](ROADMAP.md);
los patrones completos viven en
[el estándar competitivo](docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md).

## 1. Resultado buscado

Nerqia debe sentirse como un único sistema profesional aunque tenga cuatro
superficies: Commerce, Business, Finance y Platform. La tienda pública adapta
la marca del comercio; las superficies de trabajo mantienen la identidad de
Nerqia y la misma gramática de interacción.

La interfaz prioriza velocidad, lectura y acción. No es una landing disfrazada
de software ni una colección de cards decorativas.

## 2. Lenguaje visual

- canvas claro, superficies blancas y separación por borde/sombra mínima;
- violeta Nerqia para foco y acción primaria; turquesa, verde, ámbar, coral y
  rojo sólo para significado;
- radios de 6–10 px; cards anidadas prohibidas;
- Inter para interfaz y Sora sólo en titulares de marca;
- íconos Lucide; botones con texto sólo para comandos claros;
- títulos compactos en workspaces y escala hero únicamente en landing;
- tablas/colas densas, comparables y responsivas;
- 40–44 px mínimos para acciones táctiles;
- sin gradientes/orbes decorativos, texto negativo ni paletas monocromáticas;
- movimiento breve y funcional, respetando `prefers-reduced-motion`.

## 3. Anatomía compartida

Toda vista de gestión usa, cuando corresponda:

1. shell y breadcrumb de superficie;
2. `PageHeader` con título, descripción y una acción primaria;
3. selector de contexto persistente: organización, tienda, período o ubicación;
4. `WorkspaceViewTabs` para vistas reales, no para filtros accidentales;
5. filtros y búsqueda sincronizados con URL;
6. contenido principal según arquetipo;
7. detalle en panel/sheet sin perder la población;
8. estados completos y recuperación explícita.

Primitives preferidas: `Button`, `Input`, `Select`, `Tabs`, `Table`, `Badge`,
`Dialog`, `Sheet`, `Popover`, `Tooltip`, `EmptyState`, `WorkspaceState`,
`DataPagination`, `DateRangeFilter`, `FilePicker` e `ImageUpload`.

## 4. Superficies

| Superficie | Dirección | Estado 2026-09-04 | Próximo cierre |
|---|---|---|---|
| Landing | Tienda online como señal principal; Gestión y Finance continúan el mismo pedido. | Publicada y validada en 360/768/1024/1280×720/1440. | Conversión real y copy basado en evidencia. |
| Business | Workspace claro, rail persistente, topbar, tabs y tablas densas. | Shell y primitives transversales; páginas críticas migradas. | Eliminar CSS heredado y cerrar estados restantes. |
| Commerce admin | Configuración, rendimiento, voz, catálogo, páginas, diseño, pagos/envíos. | Selector de tienda compartido con Pedidos; datos reales en producción. | Surtido multi-tienda y responsive autenticado. |
| Storefront | Marca del comercio, catálogo mobile-first y checkout confiable. | Tema, variantes, carrito, checkout, SEO y resiliencia de medios. | Performance de campo y test con compradores. |
| Finance | Trabajo de gasto, documentos y aprobación; no espejo de Business. | Layout/entitlement e Inbox técnico. | Primer documento real y políticas preventivas. |
| Platform | Control plane violeta, colas y Merchant 360. | Shell, MFA, áreas operativas; Mensajería separa diagnóstico de staff, acción del comercio y copy del comprador, con alertas persistentes en campañas/SMTP/equipo. | Completar matriz visual autenticada y estados reales de webhook/Auth SMTP. |

## 5. Arquitectura de información objetivo de Finance

Finance usa el lenguaje de Mendel como referencia de trabajo y el de Nerqia
como producto propio:

- **Inicio:** posición, pendientes, excepciones, presupuesto y acciones.
- **Gastos:** documentos, tarjetas externas, reembolsos y detalle 360.
- **Solicitudes y aprobaciones:** cola por responsable, SLA, política y monto.
- **Presupuestos y políticas:** disponible, comprometido, consumido y reglas.
- **Medios de pago:** conexiones y transacciones; emisión detrás de partner.
- **Conciliación y Contabilidad:** match, obligaciones, banco, exportación y
  trazabilidad.

No se crean copias de proveedores, clientes, productos, compras, gastos, cobros
o ledger. Cada pantalla Finance consume el mismo Business Graph y aplica su
propio permiso.

## 6. Arquetipos

| Arquetipo | Uso | Contrato mínimo |
|---|---|---|
| Índice | Productos, clientes, ventas. | búsqueda, vistas, filtros, columnas, bulk, paginación y detalle. |
| Cola | Pedidos, aprobaciones, errores. | estado, prioridad/SLA, responsable, próxima acción y retry. |
| Ficha 360 | Merchant, cliente, orden, documento. | identidad, estado, hechos, actividad, relaciones y acciones. |
| Dashboard | Inicio, Commerce, Finance, Platform. | período, fuente, comparación, drill-down y estado parcial. |
| Formulario/editor | Producto, tienda, configuración. | secciones breves, validación inline, dirty state y confirmación. |
| Wizard/importador | onboarding y migración. | preview, mapeo, validación, progreso, resultado y rollback. |
| POS | venta rápida. | viewport completo, touch, teclado, offline explícito y ticket. |
| Storefront/checkout | comprador. | producto real, variantes, entrega/pago, confianza y recuperación. |

## 7. Estados obligatorios

Cada vista debe contemplar:

- carga inicial con dimensiones estables;
- refresh conservando datos;
- empty inicial con una acción;
- empty filtrado con limpieza de filtros;
- error con causa útil y retry;
- offline o stale con última lectura identificada;
- permiso insuficiente;
- resultado parcial sin presentarlo como cero;
- éxito y feedback accesible;
- dirty state antes de cambiar contexto.

## 8. Backlog visual ordenado

### D1 — Commerce first-level

1. Surtido multi-tienda: índice compartido + publicación por vitrina.
2. Storefront: home, colección, búsqueda, PDP, carrito y checkout en matriz
   mobile/desktop.
3. Pedidos: cola, selección masiva, inspector y recuperación por SLA.
4. Migrador: origen, preview, mapeo, progreso, reconciliación y redirects.
5. Analytics: embudo y canal con explicación, no métricas decorativas.

### D2 — Business

1. Auditar páginas que todavía usan cards largas o tabs locales no persistidas.
2. Converger filtros, columnas, bulk y detalle en índices de alto uso.
3. Retirar estilos heredados únicamente después de screenshots de regresión.
4. Medir tiempo a venta, producto, cliente y ajuste de stock.

### D3 — Finance

1. Inbox lado a lado: documento, extracción, confianza y revisión.
2. Cola de aprobación con política/excepción visibles.
3. Presupuesto con comprometido/consumido/disponible.
4. Tarjetas externas y transacciones antes de cualquier promesa de emisión.
5. Conciliación con evidencia y exportación.

### D4 — Platform

1. Unificar lista → Merchant 360 → acción sensible.
2. Hacer visibles error, degradación, retry y SLA por integración.
3. Diferenciar operación, riesgo, billing y soporte por rol.

### D5 — Resiliencia transversal

1. WCAG 2.2 AA, teclado, foco y lector.
2. 360/390/768/1024/1280×720/1440 sin overflow ni solapamientos.
3. INP/LCP/CLS de campo, presupuesto de assets y lazy boundaries.
4. Navegación sin recarga y actualización PWA manual segura.
5. Contraste claro/oscuro y textos largos reales.

## 9. Definition of Done visual

Una pantalla se considera terminada cuando:

1. sigue un arquetipo y la jerarquía compartida;
2. conserva el contexto en URL/persistencia;
3. cubre todos los estados relevantes;
4. funciona con datos vacíos, largos, parciales y reales;
5. no duplica componentes o estilos que ya tienen primitive;
6. pasa teclado y Axe sin impactos críticos/serios;
7. se inspecciona en la matriz responsive;
8. no produce `warn`/`error` nuevos en consola;
9. el flujo completo llega a la mutación/resultado real;
10. queda documentada y publicada con el slice de producto.

## 10. Referencias

Las referencias verificadas y fechadas están en
[ESTRATEGIA.md](docs/ESTRATEGIA.md). Los Figma aportan estructura, densidad y
jerarquía; nunca se copian marca, assets ni contenido. La implementación sigue
[INTERFAZ.md](docs/INTERFAZ.md) y
[ESTANDAR_EXPERIENCIA_COMPETITIVA.md](docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md).

Este archivo se actualiza sólo cuando cambia la dirección, el estado de una
superficie o el orden de trabajo. La evidencia histórica se conserva en Git.
