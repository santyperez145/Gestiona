# Gestiona — roadmap de diseño

**Corte:** 2026-08-22  
**Estado:** documento rector exclusivo del rediseño de producto.  
**Documento de producto:** [ROADMAP.md](ROADMAP.md).

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

- Business, Finance y Platform sólo aceptan logo/nombre del workspace.
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
- todavía quedan selects nativos dentro de componentes especializados y del
  Storefront: se auditan por separado porque checkout mobile puede justificar
  un control nativo, pero la excepción debe ser explícita;
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
| Inventario/Compras | Sistema heredado bajo tokens v3. | Parcial | Composición lista/detalle y estados. |
| Reportes/Intelligence | Primitives compartidos, alta densidad histórica. | Parcial | Simplificar filtros y priorizar decisión. |
| Settings/Integraciones | Cabecera y navegación común. | Parcial | Formularios, secretos y permisos. |
| Finance | Shell teal, overview y Document Inbox. | Parcial | Revisión documental end-to-end. |
| Platform | Rail/control plane violeta y Merchant 360. | Parcial | Cola, métricas y soporte mobile. |
| Storefront | Marca configurable aislada del SaaS. | Parcial | Home, PDP, carrito y checkout completo. |
| Estados públicos | Pago, tracking, legales, invitación. | Parcial | Sistema público y accesibilidad. |

## 5. Fases ejecutables

### D0 — Identidad y aislamiento de temas

**Estado:** hecho técnicamente el 2026-08-22.

- tokens claro/oscuro oficiales;
- personalización del merchant aislada a tienda/PDF;
- Business, Finance y Platform con identidad consistente;
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
- [ ] D2.3: revisar selects nativos en componentes especializados; documentar la
  excepción mobile de Storefront o migrarla a un primitive propio.
- [ ] D2.4: unificar date pickers, uploader, combobox, pagination y menús.
- [ ] D2.5: consolidar estados `loading/empty/error/permission/offline/partial`.
- [ ] D2.6: retirar modales manuales que duplican Dialog/Sheet/Drawer.

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

### D4 — Finance y Platform

**Estado:** parcial.

- Document Inbox con cola, inspector, confianza, versión y siguiente acción;
- payables/aprobaciones con segregación visible;
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

## 6. Próximos 20 slices de diseño

| # | Slice | Estado | Evidencia de cierre |
|---:|---|---|---|
| 1 | Aislamiento de branding del backoffice | Hecho | Colores de tienda no mutan tokens SaaS. |
| 2 | Primitives v3 transversales | Hecho | Tres layouts y contrato automático. |
| 3 | Selects de páginas de gestión | Hecho 2026-08-22 | 20 migrados; guarda en tests. |
| 4 | Selects de componentes + decisión Storefront | Pendiente | Cero excepciones sin justificar. |
| 5 | Estados unificados | Pendiente | Seis estados demostrados en Story/fixture. |
| 6 | Modales, sheets y drawers | Pendiente | Sin overlays manuales en gestión. |
| 7 | Productos end-to-end | Pendiente | Desktop/mobile + editor/importación. |
| 8 | Ventas y devolución | Pendiente | Lista→detalle→acción sin perder filtros. |
| 9 | POS teclado/touch/offline | Pendiente | Cobro y recuperación medidos. |
| 10 | Compras, recepción y Kardex | Pendiente | Autoridad de stock visible. |
| 11 | Reportes orientados a decisión | Pendiente | Menos filtros duplicados; acción clara. |
| 12 | Settings e Integraciones | Pendiente | Secretos, permisos y estados consistentes. |
| 13 | Finance Document Inbox | Pendiente | Cola→inspección→revisión responsive. |
| 14 | Platform Merchant 360/cola | Pendiente | Staff resuelve sin entrar al tenant. |
| 15 | Storefront home/PLP/PDP | Pendiente | Marca, performance y mobile aprobados. |
| 16 | Carrito/checkout/pago | Pendiente | Compra completa 360 px/red lenta. |
| 17 | Accesibilidad AA | Pendiente | axe + teclado + zoom + contraste. |
| 18 | Visual regression CI | Pendiente | Capturas deterministas claro/oscuro. |
| 19 | Pruebas con comercios | Bloqueado externamente | Tareas reales y hallazgos registrados. |
| 20 | Investor demo mode con datos seguros | Pendiente tras validación | Narrativa reproducible, sin métricas falsas. |

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

Referencias visuales compartidas y verificadas en preview público al
2026-08-22:

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
