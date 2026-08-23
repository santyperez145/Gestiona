# Gestiona — roadmap de diseño

**Corte:** 2026-08-22  
**Estado:** documento rector exclusivo del rediseño de producto.  
**Documento de producto:** [ROADMAP.md](ROADMAP.md).

**Estándar de ejecución:**
[docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md](docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md).

Este roadmap separa la evolución visual de la evolución funcional. No crea un
segundo producto ni cambia la prioridad comercial: ordena cómo se presenta,
entiende y opera el mismo Business Core. `ROADMAP.md` decide **qué problema de
negocio se resuelve**; este documento decide **cómo debe sentirse, leerse y
usarse la solución**.

## 0. Resultado buscado

Gestiona debe sentirse como una plataforma madura de CRM, marketplace y
finanzas, no como una colección de módulos agregados en distintos momentos.
Una persona tiene que reconocer ubicación, estado, riesgo y siguiente acción
sin aprender un lenguaje distinto en cada pantalla.

El rediseño se considera completo cuando:

1. Business, Finance y Platform comparten sistema, pero se distinguen por
   navegación y acento;
2. cada ruta usa los mismos primitives, estados, densidad y accesibilidad;
3. claro y oscuro funcionan sin recibir colores del comercio;
4. storefront y checkout expresan la marca de la tienda sin contaminar Gestión;
5. las vistas prioritarias se validan en 360, 768, 1024 y 1440 px;
6. al menos un comercio real completa las tareas críticas y se mide tiempo,
   abandono y error;
7. existe evidencia visual reproducible, no sólo código y capturas elegidas.

## 1. Principios obligatorios

- **Una plataforma reconocible.** El violeta de Gestiona es estable en el
  backoffice; la personalización del merchant pertenece a la tienda y al PDF.
- **Decisión antes que decoración.** Estado, excepción y acción aparecen antes
  que gráficos secundarios o texto explicativo.
- **Densidad con aire.** Tablas y toolbars son compactas; el espacio separa
  niveles, no infla tarjetas.
- **Lista primero, detalle bajo demanda.** Patrón CRM/marketplace para productos,
  ventas, clientes, documentos y merchants.
- **Una acción primaria.** Las acciones secundarias no compiten con el trabajo
  principal de la vista.
- **Color + texto + icono.** Ningún estado depende sólo del color.
- **Mobile es otro layout, no una tabla encogida.** Se conservan tarea, filtros,
  estado y CTA.
- **Estados honestos.** Carga, vacío, permiso, error, offline y dato parcial son
  diferentes y se muestran como tales.
- **Accesibilidad por contrato.** Foco visible, teclado, etiquetas, contraste y
  reducción de movimiento se prueban en los primitives.
- **Sin forks visuales por módulo.** Una necesidad nueva extiende el sistema;
  no copia un botón, modal o select con otra apariencia.

## 2. Lenguaje visual

| Capa | Contrato |
|---|---|
| Canvas claro | `228 28% 97%`; nunca negro por identidad del comercio. |
| Canvas oscuro | Variante deliberada activada por el usuario, no fallback de un error. |
| Superficie | Cards blancas/oscuras, borde frío bajo, sombra corta y radio 8–12 px. |
| Acción | Violeta Gestiona; teal para Finance y señales sanas; coral para atención. |
| Tipografía | Space Grotesk para jerarquía, Inter para operación, JetBrains Mono para IDs/números técnicos. |
| Datos | Números tabulares, títulos cortos, unidades visibles y alineación consistente. |
| Navegación | Rail estable, topbar de contexto, breadcrumb y tabs internos persistidos. |
| Movimiento | Sólo explica transición/feedback; respeta `prefers-reduced-motion`. |

### Límite de marca

- Business, Finance y Platform usan el símbolo oficial de Gestiona; el nombre
  del workspace aparece como contexto operativo, no reemplaza la marca del SaaS.
- El logo del merchant sólo aparece en Storefront, catálogo/PDF y documentos
  dirigidos a sus compradores.
- `primary_color`, `secondary_color`, fondo, cards y acento configurables sólo
  se consumen en Storefront y catálogo PDF.
- El tema claro es la referencia de aceptación; oscuro conserva paridad.
- Auth puede usar un panel editorial oscuro deliberado: no es el fondo del
  workspace ni hereda configuración del comercio.

## 3. Línea de base medible

Medición del código al 2026-08-22:

- 97 módulos de página en `src/pages`;
- 82 usan `PageHeader`; las excepciones restantes son públicas, onboarding o
  superficies deliberadas como POS;
- las 3 superficies autenticadas reciben `workspace-route-surface` desde su
  layout, por lo que el canvas y los primitives no dependen de cada página;
- 20 `<select>` nativos estaban repartidos en 12 páginas de gestión; el slice
  D2.2 los migra al primitive común y deja una guarda automática;
- D2.3 retiró otros 10 `<select>` nativos de 6 componentes internos; páginas y
  componentes del SaaS quedan en cero y una guarda recursiva bloquea regresiones;
- Storefront conserva exactamente 3 selects nativos: dos en checkout
  (autofill/teclado de dirección y cuotas) y uno en listado mobile. La guarda
  fija archivo y cantidad para que la excepción no crezca por accidente;
- Finance y Compras comparten ahora una siguiente acción direccionada: la OC
  aprobada se enfoca dentro de la lista ya tenant-scoped y el modal de recepción
  se abre sólo si el estado admite ingreso; 6 guardas cubren enlace manipulado,
  estados finales y preservación del RPC de stock;
- `WorkspaceState` declara los 12 estados del estándar y D2.5 ya migra
  Finance/Compras: skeleton inicial, refresh no bloqueante, primer uso, filtro
  vacío, error, offline, stale, parcial y éxito bajo 6 guardas accesibles;
- D2.6 retiró 16 overlays manuales de 11 archivos del SaaS: altas/ediciones,
  detalle, resultado, ayuda, notificaciones y sesión usan ahora Dialog, Sheet o
  Popover con foco y cierre canónicos. Sólo quedan cuatro fullscreen técnicos
  fijados por test: backdrop del rail mobile y cámaras de POS, Compras y conteo;
- D2.4 unificó los cinco paginadores manuales de Admin, Productos, Compras,
  Reportes y Ventas en `DataPagination`, con rango real, límites, responsive y
  `aria-live` bajo guarda. También puso los 82 campos temporales de 46 archivos
  bajo `Input`, retiró 11 controles manuales y fijó tema claro/oscuro + guarda.
  Los 16 inputs de archivo quedan clasificados en importación, documento/cámara
  e imagen/branding; los 5 estructurados ya comparten `FilePicker` con
  dropzone/botón, validación, busy y error accesible;
- la validación visual autenticada desktop/mobile sigue pendiente de una sesión
  de prueba disponible en esta PC.

Los números se vuelven a medir al cerrar cada fase. Una cifra sin fecha no se
usa en material de producto o inversión.

## 4. Superficies y estado

| Superficie | Dirección | Estado | Próxima evidencia |
|---|---|---|---|
| Landing | Editorial product-led con preview real. | Implementada | Conversión CTA y mobile real. |
| Auth | Split editorial + formulario inequívoco. | Implementada | Error, recovery y registro en mobile. |
| Business shell | Rail claro, topbar contextual, canvas v3. | Implementado | Captura autenticada 4 viewports. |
| Dashboard | Seis vistas ejecutivas persistidas. | Implementado | Tiempo hasta detectar/anclar una acción. |
| Productos | Catálogo/Operación, tabla y acciones existentes. | Parcial | Editor, importador y variantes responsive. |
| Ventas/POS | Lista/Rendimiento; POS fullscreen deliberado. | Parcial | Cobro completo teclado/touch y error. |
| CRM | Command center, segmentos, tabla y ficha 360. | Implementado | Tarea real y lectura mobile. |
| Inventario/Compras | Lista/recepción bajo tokens v3; handoff direccionado y estados comunes, incluido dato parcial/offline. | Parcial | Composición completa lista/detalle/Kardex, migrar subflujos y validar responsive. |
| Reportes/Intelligence | Primitives compartidos, alta densidad histórica. | Parcial | Simplificar filtros y priorizar decisión. |
| Settings/Integraciones | Cabecera y navegación común. | Parcial | Formularios, secretos y permisos. |
| Finance | Shell teal, Inbox, inspector, matching, tres borradores y estados comunes con refresh/stale/offline. | Parcial | Proveedor aprobado + prueba responsive con documentos reales. |
| Platform | Rail/control plane violeta y Merchant 360. | Parcial | Cola, métricas y soporte mobile. |
| Storefront | Marca configurable aislada del SaaS. | Parcial | Home, PDP, carrito y checkout completo. |
| Estados públicos | Pago, tracking, legales, invitación. | Parcial | Sistema público y accesibilidad. |

## 5. Fases ejecutables

### D-1 — Investigación y estándar competitivo

**Estado:** hecho como línea de base el 2026-08-22; revisión continua.

- benchmarks funcionales oficiales de Shopify, HubSpot, Salesforce, Stripe,
  Odoo, QuickBooks y Square;
- benchmarks de Finance/spend regional de Mendel, Clara, Rindegastos y SAP
  Concur Argentina;
- benchmarks argentinos de Commerce/gestión de Tiendanube, Empretienda,
  Contabilium, Xubio, Colppy y Mercado Libre/Mercado Pago;
- inspección pública de Aerten, eMarketplace, CRM Customers/Deals y SaaS
  Marketplace Admin;
- arquetipos para índices, ficha 360, colas, dashboards, Kanban, formularios,
  importadores, POS, Storefront y Platform;
- árbol de decisión para Dialog/AlertDialog/Sheet/Drawer/Popover/Toast;
- contrato separado para filtros, vistas, segmentos, cohortes, audiencias y
  colas;
- inventario mínimo de pantallas/estados por producto;
- radar y puerta medible antes de agregar o reemplazar tecnología;
- guarda CI que exige mantener el estándar conectado a los documentos rectores.

**Salida:** cada slice parte de evidencia fechada, cubre el flujo y sus estados
y justifica tecnología; no copia un Figma ni instala por moda.

### D0 — Identidad y aislamiento de temas

**Estado:** hecho técnicamente y reforzado el 2026-08-23.

- tokens claro/oscuro oficiales;
- personalización del merchant aislada a tienda/PDF;
- Business, Finance y Platform con identidad consistente;
- símbolo canónico transparente en shells, landing, acceso, onboarding,
  invitaciones, recuperación, páginas institucionales, favicon y PWA;
- prueba de regresión para impedir mutaciones globales desde settings.

**Salida:** cambiar colores de una tienda no modifica ninguna ruta de Gestión.

### D1 — Shell, navegación y entrada pública

**Estado:** hecho técnicamente; validación comercial pendiente.

- rail/topbar/contexto compartidos;
- Platform y Finance distinguibles sin bifurcar primitives;
- landing y Auth reconstruidos;
- navegación interna persistida para Dashboard, Productos, Ventas y CRM;
- recuperación de bundles PWA entre deploys.

**Salida:** todas las rutas tienen ubicación y tarea principal inequívocas.

### D2 — Primitives y deuda transversal

**Estado:** en curso.

- [x] Button, Card, Input, Textarea, Select, Tabs, Table, Badge, Dialog,
  Popover, Tooltip, EmptyState y Skeleton bajo contrato v3.
- [x] `PageHeader` común y excepción POS documentada.
- [x] D2.2: retirar 20 selects nativos de las 12 páginas de gestión y bloquear
  regresiones a nivel página.
- [x] D2.3: migrar 10 selects de componentes especializados y limitar Storefront
  a 3 excepciones mobile/autofill verificadas por test.
- [ ] D2.4 — **parcial 2026-08-22:** paginación cerrada en los cinco listados que
  la duplicaban; fechas cerradas en 82 campos/46 archivos con cero inputs
  temporales manuales; uploaders clasificados en tres familias y las 5
  importaciones estructuradas convergidas. Faltan documento/cámara,
  imagen/branding, combobox y menús.
- [ ] D2.5 — **parcial 2026-08-22:** `WorkspaceState` cubre los 12 estados;
  Finance/Compras ya migraron carga, refresh, vacíos, error, offline, stale,
  parcial y éxito. Falta adopción por riesgo en el resto del SaaS.
- [x] D2.6 — **cerrado en Gestión 2026-08-22:** 16 overlays manuales migrados a
  Dialog/Sheet/Popover; cuatro excepciones técnicas fullscreen enumeradas y una
  guarda recursiva impide sumar otra. Storefront se audita dentro de D5.

**Salida:** una interacción base se corrige una vez y mejora toda la plataforma.

### D3 — Flujos Business prioritarios

**Estado:** parcial.

Orden:

1. Productos: tabla, filtros, editor, variantes, imágenes e importación.
2. Ventas: lista, detalle, cobro, devolución y explicación de margen.
3. POS: búsqueda, carrito, cliente, medio de pago y recuperación offline.
4. CRM: lista, ficha 360, notas, seguimiento y campañas consentidas.
5. Compras/inventario: orden, recepción, Kardex, conteo y transferencia.
6. Caja/finanzas: sesión, movimientos, conciliación y estados de resultado.

**Salida:** las cinco tareas más frecuentes se completan en desktop y mobile sin
perder contexto ni encontrar un patrón visual nuevo.

### D4 — Finance Mendel-class y Platform

**Estado:** parcial.

Mendel es el benchmark principal de experiencia para Finance: control
preventivo, presupuesto, aprobación, gasto, evidencia y conciliación deben
sentirse como un solo recorrido. La traducción visual es propia y comparte los
primitives de Gestiona; no copia marca, assets ni composiciones.

**Arquitectura de información objetivo de Finance:**

1. **Inicio:** gasto del periodo, presupuesto disponible/comprometido/consumido,
   pendientes propios, comprobantes faltantes y excepciones con siguiente acción.
2. **Gastos:** todos los medios en una tabla/cola; filtros y vistas por estado,
   persona, categoría, centro/proyecto, política, evidencia y conciliación.
3. **Solicitudes y aprobaciones:** bandejas separadas por tarea; detalle en
   drawer con presupuesto, regla, evidencia, historial y decisión persistente.
4. **Presupuestos y políticas:** lista → detalle/versiones → simulación de
   impacto; jerarquía y regla efectiva visibles antes de publicar.
5. **Medios de pago:** tarjetas externas/importadas y estado de integración;
   tarjetas físicas/virtuales sólo aparecen como operables cuando exista emisor
   regulado, nunca como mock de una capacidad inexistente.
6. **Centros de costo y proyectos:** ownership, responsables, gasto, disponible
   y excepciones sin crear otra contabilidad.
7. **Conciliación y Contabilidad:** transacción → comprobante → imputación →
   asiento/exportación, con diferencia, retry y estado ERP visibles.
8. **Integraciones y configuración:** conexiones, salud, última sincronización,
   roles, delegaciones y auditoría sin exponer credenciales.

En mobile la navegación se reduce por trabajo —capturar, solicitar, aprobar y
resolver— sin encoger la tabla desktop. En desktop, la lista conserva contexto y
el drawer muestra política/presupuesto/historial antes de la acción.

- [x] Document Inbox con cola, inspector, confianza, versión y siguiente acción;
- [x] Revisión estructurada por cabecera/importes/líneas, errores matemáticos y
  confirmación explícita de cero efectos operativos;
- [x] Matching con proveedor/producto canónicos, método visible, empates sin
  autoselección y confirmación que aprende aliases por tenant;
- [x] Aprobación documental con siguiente acción Finance → OC, foco contextual,
  limpieza de filtros y recepción sólo en estados válidos, sin duplicar stock;
- payables/aprobaciones con segregación visible entre solicitante, manager,
  contador y pago;
- presupuesto, política, centro de costo/proyecto y fuera de política visibles
  antes de aprobar; captura y reembolso mobile convergen en la misma cola;
- Merchant 360 con salud, activación, integraciones y evidencia;
- cola operativa con severidad, dueño, retry y resultado;
- métricas de inversión separadas de operación;
- permisos/MFA/consentimiento visibles antes de acciones sensibles.

**Salida:** staff y merchant entienden autoridad, estado y riesgo sin leer datos
crudos ni confundirse de organización.

### D5 — Commerce y superficies públicas

**Estado:** pendiente de auditoría completa.

- home de tienda, listado, búsqueda y filtros;
- ficha de producto, variantes, stock y confianza;
- carrito y checkout responsive;
- operación de órdenes con búsqueda, filtros persistentes, vistas rápidas,
  exportación y bulk al nivel de paridad local de Tiendanube;
- alta/importación y venta manual desde mobile con la simplicidad de referencia
  de Empretienda, sin crear otro stock;
- pago, seguimiento, devolución y errores recuperables;
- legales y contacto consistentes;
- performance visual, imágenes y skeletons sin layout shift.

**Salida:** compra completa a 360 px, teclado y red lenta, con marca del merchant
y sin filtrar chrome o colores del SaaS.

### D6 — Responsive, accesibilidad y resiliencia

**Estado:** pendiente.

- matriz 360/768/1024/1440 para cada flujo crítico;
- navegación completa con teclado y foco visible;
- nombres accesibles, live regions y orden de lectura;
- contraste WCAG AA para texto/controles/estados;
- zoom 200%, reducción de movimiento y targets táctiles;
- loading, error, offline y stale-build ensayados;
- screenshots deterministas claro/oscuro en CI.

**Salida:** cero bloqueos críticos de axe, cero overflow accidental y recorridos
prioritarios estables en los cuatro viewports.

### D7 — Validación con personas y evidencia para inversión

**Estado:** no iniciado.

- prueba moderada con dueño y dos comercios externos;
- tiempo a primera venta, carga de producto, conciliación y lectura de margen;
- éxito sin ayuda, errores, retrocesos y abandono;
- encuesta breve de claridad/confianza, no sólo preferencia estética;
- before/after reproducible de tareas y no de pantallas elegidas;
- librería de capturas reales para demo e investor room.

**Salida:** el rediseño demuestra menor tiempo/error y mayor confianza; no se
declara validado porque “se ve mejor”.

## 6. Próximos 26 slices de diseño

| # | Slice | Estado | Evidencia de cierre |
|---:|---|---|---|
| 1 | Aislamiento de branding del backoffice | Hecho | Colores de tienda no mutan tokens SaaS. |
| 2 | Primitives v3 transversales | Hecho | Tres layouts y contrato automático. |
| 3 | Selects de páginas de gestión | Hecho 2026-08-22 | 20 migrados; guarda en tests. |
| 4 | Selects de componentes + decisión Storefront | Hecho 2026-08-22 | 10 migrados; SaaS en cero y 3 excepciones públicas bajo guarda. |
| 5 | Estándar integral competitivo | Hecho 2026-08-22 | 17 referencias oficiales (7 globales, 4 Finance/spend y 6 argentinas), 4 Figma observados, arquetipos, overlays, segmentación, matriz de cobertura y puerta tecnológica bajo guarda CI. |
| 6 | Estados unificados | Parcial 2026-08-22 | Contrato de 12 estados + 6 guardas; Finance/Compras migrados sin confundir vacío/error/parcial. Faltan rutas restantes y matriz visual. |
| 7 | Modales, sheets y drawers | Hecho en Gestión 2026-08-22 | 16 overlays de 11 archivos migrados; tamaños canónicos, focus trap y cierre accesible. Sólo rail mobile + 3 scanners fullscreen quedan bajo allowlist CI; Storefront pertenece a D5. |
| 8 | Paginación canónica | Hecho en Gestión 2026-08-22 | Cinco listados comparten rango, responsive, límites y aria-live; cálculo puro cubierto y guarda evita controles locales. |
| 9 | Fechas canónicas | Hecho en Gestión 2026-08-22 | 82 campos/46 archivos conservan semántica nativa bajo Input; 11 variantes manuales retiradas y regresión bloqueada. Uploaders clasificados aparte. |
| 10 | Importadores estructurados canónicos | Hecho en Gestión 2026-08-22 | Catálogo, precios, Tiendanube, clientes y banco comparten FilePicker; extensión/MIME, drop, busy, error y misma selección cubiertos. |
| 11 | Productos end-to-end | Pendiente | Desktop/mobile + editor/importación. |
| 12 | Ventas y devolución | Pendiente | Lista→detalle→acción sin perder filtros. |
| 13 | POS teclado/touch/offline | Pendiente | Cobro y recuperación medidos. |
| 14 | Compras, recepción y Kardex | Parcial 2026-08-22 | Finance llega a la OC exacta, muestra contexto y abre la recepción idempotente; faltan Kardex integrado y matriz responsive. |
| 15 | Reportes orientados a decisión | Pendiente | Menos filtros duplicados; acción clara. |
| 16 | Settings e Integraciones | Pendiente | Secretos, permisos y estados consistentes. |
| 17 | Finance Document Inbox | Parcial 2026-08-22 | Cola, retry, bloqueo, cuarentena, confianza, revisión, matching y diálogo Supplier Invoice/Purchase/Payable Draft visibles. Líneas, vencimiento, TC, efectos, aprobación y handoff a recepción usan estados claros; faltan proveedor OCR aprobado y validación responsive con documentos reales. |
| 18 | Finance command center Mendel-class | Congelado hasta adopción F3 | Inicio, gastos, solicitudes/aprobaciones, presupuestos/políticas, medios, centros, conciliación e integraciones completan desktop/mobile con estados y autoridad visibles. |
| 19 | Platform Merchant 360/cola | Pendiente | Staff resuelve sin entrar al tenant. |
| 20 | Storefront home/PLP/PDP | Pendiente | Marca, performance y mobile aprobados. |
| 21 | Carrito/checkout/pago | Pendiente | Compra completa 360 px/red lenta. |
| 22 | Accesibilidad AA | Pendiente | axe + teclado + zoom + contraste. |
| 23 | Visual regression CI | Pendiente | Capturas deterministas claro/oscuro. |
| 24 | Pruebas con comercios | Bloqueado externamente | Tareas reales y hallazgos registrados. |
| 25 | Investor demo mode con datos seguros | Pendiente tras validación | Narrativa reproducible, sin métricas falsas. |
| 26 | Identidad oficial de Gestiona | Hecho 2026-08-23 | Símbolo RGBA canónico en 13 superficies, favicon/Apple/PWA; merchant aislado a Storefront/documentos; desktop y acceso móvil verificados en localhost. |

Máximo dos slices visuales activos. Un problema de seguridad, datos, stock,
pagos o legal interrumpe esta secuencia y vuelve a `ROADMAP.md`.

## 7. Definition of Done visual

Cada slice debe incluir:

1. tarea y usuario concreto;
2. referencia observada y traducción propia;
3. estados happy/loading/empty/error/permission/offline cuando apliquen;
4. claro y oscuro sin colores de tenant;
5. 360, 768, 1024 y 1440 px sin overflow accidental;
6. teclado, foco, etiquetas y contraste;
7. datos largos, cero, parciales y permisos restringidos;
8. tests de lógica/contrato y captura cuando el entorno permita datos;
9. typecheck, funciones, lint, tests y build;
10. `DESIGNROADMAP.md` y `ROADMAP.md` actualizados en el mismo commit;
11. métrica y evidencia pendiente declaradas;
12. commit y push independientes.

Estados permitidos: **Pendiente**, **En curso**, **Parcial**, **Bloqueado** y
**Hecho**. “Implementado” no significa “validado con usuarios”.

## 8. Métricas de diseño/producto

| Métrica | Definición |
|---|---|
| Task Success | % que completa la tarea sin intervención. |
| Time on Task | Mediana desde entrada hasta resultado persistido. |
| Error Recovery | % que recupera error sin soporte/recarga destructiva. |
| Navigation Backtrack | Retrocesos o rutas equivocadas por tarea. |
| Empty-to-Action | % que entiende qué hacer desde un estado vacío. |
| Mobile Completion | Tareas completas a 360 px / intentos. |
| Accessibility Criticals | Bloqueos axe/teclado/contraste abiertos. |
| UI Consistency Debt | Controles nativos, overlays y patrones duplicados sin excepción. |
| Activation Conversion | Registro → primera venta del canal objetivo. |
| Investor Demo Reliability | Demos completas sin reload, SQL ni datos inventados. |

Las primeras ocho miden experiencia; las últimas dos conectan el diseño con la
tesis de negocio. No se usan vanity metrics como cantidad de pantallas
rediseñadas sin tarea terminada.

## 9. Referencias y criterio competitivo

El benchmark completo, sus fuentes oficiales y la traducción obligatoria a
pantallas, overlays, segmentación y tecnología vive en
[`docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md`](docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md).
Esta sección conserva sólo la dirección visual resumida.

Referencias visuales compartidas y verificadas en preview público al
2026-08-22; CRM Customers/Deals y eMarketplace Admin se reabrieron durante
D2.3 para contrastar densidad, jerarquía compacta, canvas claro y violeta:

- Aerten: tabla densa, filtros, roles y detalle de registro;
- eMarketplace Admin: canvas claro, violeta protagonista y señales tintadas;
- CRM Customers/Deals: navegación lista/detalle y tareas relacionadas;
- Gestão de Marketplace y SaaS Marketplace Admin: control plane, estados y
  densidad de operación;
- Pickolab/Neomart: patrón de marketplace público y jerarquía comercial.

No se copian assets ni composiciones completas. Se toman patrones y se prueban
contra el diferencial real de Gestiona: stock único, costos completos, margen
por canal, Finance conectado y autoridad por organización.

Las afirmaciones funcionales sobre competidores continúan en
`docs/ESTRATEGIA.md` con fecha y fuente oficial. Este documento no convierte una
referencia visual en una promesa competitiva.

## 10. Regla de actualización

- Todo cambio visual actualiza este documento.
- Si además cambia capacidad, riesgo, datos, métrica o fase de producto,
  actualiza `ROADMAP.md`.
- Un slice visual no puede marcar como hecho un gate comercial del roadmap
  normal.
- El conteo de cobertura se regenera desde el código antes de publicarlo.
- Las excepciones (POS fullscreen, select nativo mobile, canvas editorial Auth)
  se documentan y prueban; no quedan implícitas.
