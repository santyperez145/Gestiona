# Nerqia — roadmap de diseño

**Corte:** 2026-09-04
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

Nerqia debe sentirse como una plataforma madura de CRM, marketplace y
finanzas, no como una colección de módulos agregados en distintos momentos.
Una persona tiene que reconocer ubicación, estado, riesgo y siguiente acción
sin aprender un lenguaje distinto en cada pantalla.

El rediseño se considera completo cuando:

1. Business, Finance y Platform comparten sistema, pero se distinguen por
   navegación y acento;
2. cada ruta usa los mismos primitives, estados, densidad y accesibilidad;
3. claro y oscuro funcionan sin recibir colores del comercio;
4. storefront y checkout expresan la marca de la tienda sin contaminar Nerqia;
5. las vistas prioritarias se validan en 360, 768, 1024 y 1440 px;
6. al menos un comercio real completa las tareas críticas y se mide tiempo,
   abandono y error;
7. existe evidencia visual reproducible, no sólo código y capturas elegidas.

## 1. Principios obligatorios

- **Una plataforma reconocible.** El violeta de Nerqia es estable en el
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
| Acción | Violeta Nerqia; teal para Finance y señales sanas; coral para atención. |
| Tipografía | Space Grotesk para jerarquía, Inter para operación, JetBrains Mono para IDs/números técnicos. |
| Datos | Números tabulares, títulos cortos, unidades visibles y alineación consistente. |
| Navegación | Rail estable, topbar de contexto, breadcrumb y tabs internos persistidos. |
| Movimiento | Sólo explica transición/feedback; respeta `prefers-reduced-motion`. |

### Límite de marca

- Business, Finance y Platform usan el símbolo oficial de Nerqia; el nombre
  del workspace aparece como contexto operativo, no reemplaza la marca del SaaS.
- El logo del merchant sólo aparece en Storefront, catálogo/PDF y documentos
  dirigidos a sus compradores.
- `primary_color`, `secondary_color`, fondo, cards y acento configurables sólo
  se consumen en Storefront y catálogo PDF.
- El tema claro es la referencia de aceptación; oscuro conserva paridad.
- Auth puede usar un panel editorial oscuro deliberado: no es el fondo del
  workspace ni hereda configuración del comercio.

## 3. Línea de base medible

Medición del código al 2026-08-29:

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
  Finance/Compras, Reportes/Intelligence, Dashboard y Productos: skeleton
  inicial, refresh no bloqueante, primer uso, filtro vacío, error, offline,
  stale, parcial y éxito. Reportes, Dashboard y Productos conservan la última
  lectura durante refresh, identifican la fuente que falló y descartan
  respuestas de otra organización; Auditoría y Sucursales adoptan el mismo
  contrato. Dashboard declara como parcial el stock por sucursal que no pudo
  cargar y Productos separa catálogo/costos críticos de variantes, ventas y
  ficha técnica auxiliares. La guarda accesible mantiene el comportamiento
  bajo prueba;
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
- Settings/Mensajería ya muestra el SMTP propio como una conexión, no como una
  contraseña persistente: estado consultando/conectado/sin conectar, error con
  retry, prueba explícita al email de la sesión, actualización sin devolver la
  clave y desconexión confirmada. La ayuda enlaza las guías oficiales de Google
  y Microsoft y el comercio ya no puede confundir “guardar” con “conexión
  verificada”;
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
| Dashboard | Seis vistas ejecutivas persistidas. El Business Copilot sólo monta Pulso en Resumen y Proyección en Inteligencia cuando el entitlement está resuelto; sin IA ofrece una única salida a Mi plan en vez de errores ocultos. Briefing usa modal canónico, carga/error/retry/copy, cuatro cifras de respaldo provenientes de la misma lectura server-side y cache tenant/fecha. El pulso separa expandir/regenerar sin controles anidados y conserva sugerencias stale con error visible. `d9a583e` certificó el canvas sin overflow en 360/768/1024/1440 y la tab activa completamente visible después de corregir el recorte causado por el metadato lateral. | Parcial D3 2026-08-30 | Respuesta del proveedor sólo después de DPA/clave y organización activa. Medir tiempo a acción y `AI Action Rate`. |
| Productos | Catálogo/Operación con estados honestos y jerarquía de acciones; editor/importador fullscreen, footer persistente y Variantes como lenguaje transversal, sin el rótulo heredado “Sabores”. Matriz publicada 360/768/1024/1440 sin overflow; título semántico del importador corregido y revalidado con `aria-labelledby` y consola sin errores nuevos. Un CSV real de dos filas pasó parser, preview y cancelación publicada en desktop/360 sin escribir datos, y quedó como fixture E2E. El editor protege borradores ante X/Escape/exterior y salida del navegador. | Parcial D2.5/D3 2026-08-29 | Validación publicada del descarte —bloqueada por el límite de builds de Vercel— y medición de tarea. |
| Ventas/POS | Lista/Rendimiento; Ventas suma inspector lateral/fullscreen mobile de ticket con deep link, contexto, líneas, cobro, factura, devolución y margen registrado sin perder filtros; las acciones ya no dependen del hover. Devoluciones es ahora un workflow por ticket: búsqueda, renglones/cantidades, split del cobro original, reposición, caja faltante, reintegros completos/pendientes, evidencia externa y CTA fiscal. Retiró montos/productos libres, borrado y crédito ficticio; el comprobante interno declara que no reemplaza ARCA. Mercado Pago agrega una capa operativa sin cierre manual: el detalle ofrece reintegrar/reintentar y verificar estado sólo con `payments.edit`, conserva el pasivo visible ante rechazo o timeout y explica que la devolución física quedó registrada aunque el dinero siga pendiente. El deploy `1ec3c3c` revalidó H1/CTA/modal, interacción física mobile, consola limpia y cero overflow en 360/768/1024/1440; 0 devoluciones reales impide fingir una captura de los controles del proveedor. POS permanece fullscreen deliberado. La cola offline habla en tickets —no líneas— y el drill Playwright aislado modela 2 tickets→offline→reconexión parcial con RPC interceptado y cleanup fail-safe. El resumen de caja explica el mejor beneficio entre oferta/promoción y descuento por medio. QR Mercado Pago suma un workspace claro y focal: preparación, setup de local real, QR/importe, espera acreditable, countdown, error recuperable, cancelación, vencimiento y éxito; carrito y ticket obedecen al estado server-side. Si la pestaña se cierra, una franja contextual diferencia cobro pendiente de venta ya acreditada, ofrece retomar/cancelar o ir a Ventas/confirmar y conserva intacto el carrito actual. Fidelidad y alerta grande ya se resuelven una vez por ticket en servidor, por lo que la recuperación no depende de efectos invisibles del navegador. Facturas muestra el documento fiscal como objeto inmutable: número fiscal, emisor/receptor, condición IVA, IIBB, inicio, CAE y QR ARCA desde snapshot server-side; separa borrador, homologación y producción sin apoyarse sólo en color ni redibujar la historia desde Ajustes. | Parcial D2.5/D3 2026-09-03 | Certificar recuperación/acreditación y refund con una cuenta Mercado Pago real, autorizar una factura ARCA productiva, operar una devolución real y ejecutar el drill offline cuando exista entorno E2E. |
| CRM | Command center, segmentos, tabla y ficha 360. | Implementado | Tarea real y lectura mobile. |
| Inventario/Compras | Lista/recepción bajo tokens v3; handoff direccionado y estados comunes, incluido dato parcial/offline. | Parcial | Composición completa lista/detalle/Kardex, migrar subflujos y validar responsive. |
| Gastos | Tabla/cards y formulario unificados; comprobante privado con captura inline, disclosure previo, sugerencias estructuradas, revisión humana, error accionable y alternativa manual. El archivo queda local hasta confirmar el gasto; la extracción documental está apagada por flag mientras falten contrato y proveedor aprobados. El build `26e6a36` pasó 360/768/1024/1440 sin overflow, con disclosure visible y 0 logs nuevos. | Parcial D3 2026-08-30 | Benchmark de lectura/costo con comprobantes autorizados antes de habilitar IA. |
| Reportes/Intelligence | Primitives compartidos, alta densidad histórica. | Parcial | Simplificar filtros y priorizar decisión. |
| Settings/Integraciones | Cabecera/navegación común; SMTP privado; Mercado Pago OAuth canónico; webhooks en una sola superficie con secret one-time, health, prueba/retry server-side, entrega durable, diálogo contractual y OpenAPI público certificado externamente. | Parcial | Transportistas y matriz responsive/autenticada; medir primera integración real. |
| Finance | Shell teal, Inbox, inspector, matching, tres borradores y estados comunes con refresh/stale/offline. | Parcial | Proveedor aprobado + prueba responsive con documentos reales. |
| Platform | Rail/control plane violeta y Merchant 360. | Parcial | Cola, métricas y soporte mobile. |
| Storefront | Marca configurable aislada del SaaS; imágenes rotas degradan a fallbacks propios. El resultado de compra separa carga, acceso verificado y recuperación por email sin revelar si un número existe; pago y emails comparten la misma capacidad server-side. La comunicación transaccional distingue creación, pago y despacho y responde retries/dobles clicks como éxito deduplicado, no como otra entrega. Crawlers reciben HTML del comercio. Una red caída no se pinta como 404, catálogo vacío, pedido inexistente ni carrito vencido. | Parcial D5.29 2026-09-04 | D5.1–D5.28: cola, inspector, CTA, skeleton, SEO de servidor, error recuperable, bulk con autoridad y decisión de variante exacta hasta el seguimiento. D5.29 compacta quick choices y precio real en las cards; falta su matriz publicada y compra sandbox/real. |
| Estados públicos | Pago, tracking, legales, invitación. Link de pago y seguimiento distinguen red caída de recurso inexistente. | Parcial D5.11 2026-09-01 | Legales consistentes y accesibilidad. |

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

**Estado:** hecho técnicamente y corregido con la identidad N/Q el 2026-09-03.

- tokens claro/oscuro oficiales;
- personalización del merchant aislada a tienda/PDF;
- Business, Finance y Platform con identidad consistente;
- isotipo N/Q canónico transparente en shells, landing, acceso, onboarding,
  invitaciones, recuperación, páginas institucionales, favicon y PWA;
- wordmark horizontal oficial versionado para piezas de marca, sin reemplazar
  texto accesible ni contaminar la identidad visual de los merchants;
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
- [ ] D2.5 — **parcial 2026-08-29:** `WorkspaceState` cubre los 12 estados;
  Finance/Compras, Reportes/Intelligence, Dashboard y Productos ya migraron
  carga, refresh, vacíos, error, offline, stale, parcial y éxito. Productos
  además protege el cambio de tenant y no convierte fallas de variantes,
  movimiento o ficha técnica en catálogo vacío. Falta adopción por riesgo en el
  resto del SaaS y validación visual autenticada.
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

- [x] Productos deja de presentar trece botones con el mismo peso en el
  encabezado: alta, refresh y selector de vista quedan como controles directos;
  once herramientas de exportación, etiquetas y administración se agrupan en
  un menú con secciones, permisos y nombres accesibles. Lista/grilla declara
  `aria-pressed` y mobile reduce los rótulos secundarios sin esconder la acción
  principal (2026-08-29).
- [x] El alta/edición de Producto deja el modal angosto bloqueado por el
  estándar y pasa a workspace fullscreen: cabecera y footer de guardado permanecen
  alcanzables, los grupos colapsan a mobile y las variantes tienen labels,
  cards y acciones completas. El importador Excel/CSV adopta el mismo canvas,
  progreso visible, footers apilados y pistas accesibles para sus comparaciones
  horizontales. La autoridad server-side y Kardex no cambian (2026-08-29).
- [x] Gastos deja de mostrar enlaces públicos directos: tabla desktop, cards
  mobile y formulario comparten una acción de comprobante con estado de
  preparación, error recuperable, URL firmada y tile claro/oscuro. El escáner
  se expande dentro del formulario —sin Dialog/focus trap anidado—, entrega el
  archivo a la misma autoridad y declara que se sube al guardar, sin una segunda
  composición ni un upload huérfano. Playwright autenticado verificó en
  localhost un solo Dialog, scanner inline, desktop/file inputs y 0 enlaces
  públicos o errores de interacción (2026-08-29).
- [x] El escáner deja de usar el chat SSE como OCR y pasa a un contrato
  documental propio. Antes de enviar muestra proveedor y tratamiento; después
  presenta **sugerencias** —no hechos contables— con CTA de revisión, error
  visible y camino manual. La categoría sólo puede salir del tenant. El flag
  separado conserva todo apagado hasta aprobar privacidad/proveedor. La matriz
  publicada 360/768/1024/1440 confirmó formulario + scanner sin overflow,
  disclosure visible y 0 errores/warnings nuevos; falta la prueba real
  autorizada (2026-08-30).
- [x] Dashboard deja de ejecutar IA por estar meramente montado en una vista
  oculta: Pulso/Proyección dependen de vista visible + entitlement, el estado
  sin beneficio dirige a Mi plan y el Briefing deja el contrato SSE roto. El
  modal muestra evidencia agregada devuelta por la misma lectura server-side,
  y los errores tienen retry sin borrar el último resultado. Sidekick Pulse e
  Intuit Intelligence se usan como patrón verificado de contexto + tarea, no
  como diseño copiado. Validación publicada y proveedor real siguen abiertos
  (2026-08-30).
- [x] Ventas abre un ticket desde tabla o card en un inspector canónico: la
  selección vive en `?sale=`, Back/Forward y cerrar conservan búsqueda,
  filtros, vista y página; agrupa por `sale_transaction_id`, muestra el
  registro heredado como una sola línea y no consulta fuera de la lectura RLS
  existente. En 360 px el Sheet ocupa el viewport completo, cobro/factura/
  devolución no dependen sólo del color y las acciones de tabla dejaron de
  existir sólo en hover. Shopify Orders, Square Order Manager y Tiendanube
  Ventas fueron reverificados en fuente oficial; se adopta orientación y
  operación omnicanal, no su composición ni su vocabulario (2026-08-29).
- [x] Devoluciones deja el CRUD genérico y adopta el arquetipo Workflow:
  ticket cobrado → renglones/cantidades → reparto sobre cobros originales →
  confirmación. La jerarquía separa dinero ya reintegrado de obligación
  pendiente, explica caja cerrada, ofrece evidencia externa sólo donde
  corresponde y deriva el documento con CAE a Facturación. La lectura tiene
  KPIs, filtros, error recuperable, detalle por medio y comprobante interno con
  límite fiscal explícito; la autoridad permanece en el RPC transaccional
  (2026-08-30).
- [x] POS deja de elegir su composición por el viewport ajeno al rail. Caja es
  una superficie inmersiva declarada en el manifest, recibe el alto/ancho
  disponible real y conserva los avisos críticos del shell. A 1.092 px la
  versión publicada comprimía el catálogo a 428 px y cortaba un carrito cuyo
  contenido superaba el panel; ahora cards y bundles responden a container
  queries, el split catálogo/carrito empieza en 1.280 px y, debajo, el sheet
  queda dentro del workspace. Carrito, total y CTA comparten un único scroll
  con header sticky; una matriz E2E sin escrituras fija
  360/768/1024/1092/1280/1440. Puerta: 2.607 tests, build/PWA y 75 Edge
  Functions. `dd29eba8` quedó `READY`; la sesión autenticada a 1.092×912
  confirmó 844 px útiles, padding 0, cards de 198 px, documento sin overflow y
  sheet contenido con CTA dentro del mismo scroll. Falta ejecutar la matriz
  automatizada completa con credenciales E2E (2026-09-03).
- [x] Facturación deja de representar una factura autorizada con la identidad
  fiscal viva. El snapshot de servidor congela emisor, receptor, punto de
  venta, cotización y payload QR al autorizar; el PDF imprime el QR v1 actual
  de ARCA y diferencia borrador, homologación y producción. Configuración suma
  IIBB/inicio y la vista distingue error de carga de una lista vacía. La prueba
  real reversible cerró transición, inmutabilidad y 0 restos; typecheck, lint
  sin errores, 2.618 tests, build/PWA, 75 funciones y audit high quedaron
  verdes. El deploy `db6fa0b8` quedó `READY` y la sesión autenticada verificó
  `/facturas` con 2/2 documentos “Emitida + CAE” y `/afip` con nomenclatura
  ARCA, 2 autorizados, 0 pendientes y 0 errores; ambas rutas cargaron sin
  warnings ni errores de consola. Queda un CAE productivo externo y la medición
  de tarea (2026-09-03).

**Salida:** las cinco tareas más frecuentes se completan en desktop y mobile sin
perder contexto ni encontrar un patrón visual nuevo.

### D4 — Finance Mendel-class y Platform

**Estado:** parcial.

Mendel es el benchmark principal de experiencia para Finance: control
preventivo, presupuesto, aprobación, gasto, evidencia y conciliación deben
sentirse como un solo recorrido. La traducción visual es propia y comparte los
primitives de Nerqia; no copia marca, assets ni composiciones.

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
- [x] Ajustes distingue borradores editables de plantillas Meta aprobadas: el
  comercio autoriza cumpleaños, pero la interfaz no promete Evolution ni un
  envío hasta que Plataforma tenga canal y plantilla operables (2026-08-29);
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

**Estado:** en curso desde el 2026-08-30. La primera auditoría productiva
encontró un banner activo que responde como página HTML (`naturalWidth=0`) y
deja un bloque negro con ícono roto. El slice D5.1 agrega fallback de marca en
la tienda, recuperación si el recurso vuelve a cargar y alerta/bloqueo de
reactivación en Gestión; no modifica el contenido del comercio. `e63c0ad`
quedó `Ready` y tienda + Banners pasaron 360/768/1024/1440 sin overflow, con
CTA/alerta visibles y 0 logs propios; quedan el resto del recorrido y el
reemplazo del activo por el comercio.

D5.2 interrumpió la secuencia visual por privacidad: la auditoría reprodujo que
un visitante anónimo podía obtener una orden correlativa con email y domicilio.
El rediseño del resultado agrega estado de verificación por email para enlaces
históricos, conserva acceso directo por capacidad opaca en enlaces nuevos y no
revela si falló número, email o token. El control vive también en RPC, pago y
email; la pantalla no finge seguridad. `c543249`, la migración y tres Edges ya
están en producción. El estado neutral pasó 360/768/1024/1440 con ancho del
documento igual al viewport, CTA de 44 px, PII ausente y consola limpia; una
prueba sintética fallida mantuvo el mismo mensaje sin revelar existencia.

D5.3 cierra el estado invisible que sostiene esa pantalla: checkout, pago y
webhooks pueden repetir una notificación sin que el comprador vea dos
confirmaciones ni el comercio dos ventas. Orden + audiencia + evento forman la
identidad; un claim atómico devuelve `duplicate`/`inProgress`, el proveedor se
llama fuera de la transacción y un token de worker cierra el resultado. Resend
recibe una segunda clave idempotente; SMTP queda cubierto por el ledger durable
sin prometer exactly-once fuera del control de Nerqia. No agrega chrome ni
otra pantalla: vuelve confiable el feedback transaccional del recorrido D5.
La configuración de despliegue conserva explícitamente la frontera: creación
de pedido pública con capacidad revalidada dentro de la función y cambio de
estado autenticado con JWT; una guarda evita que otro entorno los despliegue al
revés.

D5.4 cierra el medio muerto que el recorte de Pay dejó a la vista: Mercado Pago
marcado sin cuenta conectada. La vitrina pública deja de listarlo; una orden
con ese método no entra; Stripe y PayPal no se ofrecen aunque hayan quedado
en un array viejo. El comercio sigue viendo su interruptor, con la explicación
de que el comprador no lo ve hasta activar Nerqia Pay.

D5.5 cierra la cola que el comercio usa después de cobrar: chips en inglés,
sin búsqueda y una tabla que desaparecía a 360 px. Pedidos busca por número,
cliente, email, teléfono o monto; persiste `q` y `vista` en la URL; exporta el
recorte filtrado; y distingue “para despachar” (pagado, aún no salió) de
“pendiente de pago”. El Foco del día aterriza en esa vista. No se finge un
despacho masivo: hace falta RPC.

D5.7 cierra el recorrido de compra en el teléfono: la ficha deja Agregar al
pie, el carrito opera a 44 px y el checkout no esconde Confirmar bajo el
formulario. No reemplaza una compra sandbox ni el hero que el comercio publicó.

D5.8 cierra el salto de layout de la primera pintura: el spinner del SaaS
(`bg-background` + Loader2) reserva header, banner `16/7` y ocho tarjetas
cuadradas con tokens `--st-*` del tema minimal. Banner de home y foto de ficha
piden LCP (`eager`/`high`); el resto declara `width`/`height`/`sizes` y espera.
No comprime ni recorta el archivo del comercio; no mide LCP de campo.

D5.9 cierra el hueco que hacía invisible a la tienda en Search Console:
Google-InspectionTool y AdsBot recibían el `index.html` de Nerqia porque
no estaban en el rewrite de crawlers. `robots.txt` ahora sale del borde y
declara `Sitemap:`; el listado deja de canibalizar la home; la ficha declara
`og:type=product` y el precio que cobra el catálogo. No es SSR ni dominio
propio: es el borde que ya existía, cerrado de verdad.

D5.10 cierra la mentira de la red lenta: un `Failed to fetch` pintaba
«Tienda no encontrada» y el catálogo devolvía `[]`, así que la home decía
cero productos con el stock lleno. Ahora 404 y error son estados distintos;
Reintentar no borra el carrito; el checkout idempotente reintenta el corte
con la misma clave. No es una compra sandbox ni un service worker offline.

D5.11 cierra el mismo corte un paso más adelante: el seguimiento pedía el
email (o decía «datos incorrectos») cuando no había podido consultar; el
carrito recuperado y la cuenta pintaban vacío; el link de pago decía
«no encontrado». Un poll que falla ya no borra un pedido visto. No se pide
el email hasta que el servidor responde. Bulk sigue fuera: hay 2 órdenes
pagas de $1, no una cola que justifique RPC masivo.

D5.12 cierra una incompatibilidad de los enlaces heredados sin crear otra
superficie de comercio: `/catalogo/:id` acepta tanto el `user_id` antiguo como
el `org_id` del Business Core para productos y branding. La frontera de datos
usa una lista explícita de columnas públicas, diferencia red/permisos de un
catálogo realmente vacío y ofrece Reintentar sin borrar el último estado. La
tienda canónica migra en D5.14 a `<slug>.nerqia.app`; este arreglo mantiene
vivo el legado sin convertirlo en otra tienda.

D5.13 lleva el carrito al contrato visual y operativo de una tienda madura sin
crear otra pantalla: la ruta existente muestra si está sincronizando, guardado
en servidor, sólo local o con error, y explica ajustes de disponibilidad. La
composición se rehidrata contra catálogo y variantes actuales; el recupero de
email sustituye todas las líneas de una vez (antes sobrevivía sólo la última por
estado React obsoleto). La cuenta se resuelve para el slug exacto antes de unir
carritos y una salida rota la capacidad del dispositivo compartido. El precio y
el stock siguen siendo del Core/checkout; el indicador no promete nube cuando
el RPC todavía no está desplegado.

D5.14 implementa la URL limpia sin bifurcar experiencia: todos los componentes
consumen `basePath` desde StoreContext, por lo que home, PLP, PDP, carrito,
checkout, cuenta y pedido tienen las mismas vistas y estados en path heredado y
subdominio. Canonical, robots, sitemap, feed y previews sociales también
resuelven por host. La aceptación visual exige publicar el wildcard y recorrer
home → PDP → carrito → checkout a 360/768/1024/1440; DNS que resuelve no cuenta
como evidencia de UI, TLS o checkout funcional.

D5.15 convierte la prueba publicada en guardas de calidad. La tienda real mostró
que `to=""` conserva la pantalla actual, por lo que Inicio ahora siempre es `/`
en el host canónico. Una composición que decide mostrar banners y ocultar el
hero conserva un H1 accesible con el nombre del comercio, y el robots de la
tienda ya no hereda rutas del panel ni emite reglas contradictorias. Es el
criterio de este roadmap: una observación de navegador termina en contrato y
regresión, no sólo en una captura. El deploy `aaa4b01` quedó `READY` y la
revalidación sobre `exentryimports.nerqia.app` confirmó H1 en home/PDP,
`Inicio → /`, robots acotado a rutas privadas y cero errores de consola.

D5.16 integra dominios propios sin sumar otra pantalla ni otro storefront. La
sección dentro de **Publicar** separa dirección incluida, dominio propio, estado
de titularidad/DNS/TLS, registros copiables, último chequeo y baja confirmada.
Loading, error del proveedor, pendiente, mal configurado y activo son estados
distintos; el subdominio incluido nunca desaparece durante una propagación. El
CTA principal usa el dominio externo sólo después de `active`. A diferencia de
un formulario cosmético, la UI consume una Edge Function owner/admin y el
resolver público mínimo; queda pendiente la matriz publicada con un dominio
externo real cuando exista la credencial dedicada.

D5.17 corrige la primera impresión para buscadores y previews sociales. La
home de cada tienda debe entregar su propio título, descripción, imagen,
canonical y JSON-LD aun cuando Vercel tenga un `index.html` físico para la SPA.
Un Routing Middleware único decide por host y User-Agent antes del filesystem;
la persona sigue viendo la interfaz normal y el bot recibe el documento
semántico del mismo Storefront. Se elimina la lista repetida de crawlers en
`vercel.json` y se conserva una sola en `storefrontSeo.ts`. El deploy
`7209c138` quedó `READY`: Googlebot/Inspection recibieron título, descripción y
canonical propios en home/categoría; el comprador conservó la SPA, y el
navegador real mostró H1/canonical de la tienda sin errores de consola.

D5.18 hace que la plataforma también tenga una primera impresión semántica. El
documento estático sólo tenía head y un root vacío; ahora Google recibe el mismo
posicionamiento que ve una persona en la landing —gestión omnicanal, stock,
POS, tienda online, caja y margen— con jerarquía H1/H2, enlaces internos,
canonical y nombre de sitio estructurado. Un único contrato alimenta borde,
sitemap y head de la SPA, por lo que `/precios` no compite con `/pricing` ni las
pantallas privadas heredan la canonical de la home. No es una promesa de
ranking. El deploy `15124ccd` quedó `READY`: Googlebot/Inspection recibieron
home y precios con H1/canonical indexables; el panel salió `noindex`, la SPA
humana siguió intacta y la tienda activa no retrocedió. La propiedad de dominio
fue verificada, el sitemap quedó **Correcto** en Search Console y Nerqia/Exentry
entraron a la cola prioritaria. Falta indexación observada.

D5.19 unifica los documentos legales de plataforma en un shell propio. Términos
y Privacidad repetían header, footer, secciones y navegación; Privacidad además
forzaba `prose-invert`, por lo que el modo claro no tenía un contrato visual
confiable. Ahora comparten identidad oficial, versión visible, ancho/ritmo de
lectura, foco, targets de 44 px, tabla responsive de proveedores y un aviso
amarillo explícito para la identidad legal que falta. El contenido deja de
prometer Stripe, USD, borrado, SLA y jurisdicción sin evidencia, y cada estado
externo se presenta como condición o gate. La matriz local pasó en
claro/oscuro y 360/768/1024/1440 sin overflow de página ni errores, con tabla
contenida y footer de 44 px. Falta inspección publicada y validación profesional
del texto.

D5.20 pone un límite explícito al listado de productos. La auditoría publicada
midió 60 cards y 12.179 px de documento en un teléfono; una tienda grande no
puede montar todo su catálogo y todas sus variantes en una sola vista. El PLP
ahora muestra 20 productos por página sobre la misma lectura canónica, conserva
`page` en la URL, reinicia la página al cambiar un filtro y ofrece rango,
Anterior/Siguiente, foco y objetivos de 44 px. Tiendanube publica 12/16/20 y
permite carga progresiva o páginas; Shopify usa conexiones con cursor. El
siguiente escalón de Nerqia será paginación server-side cuando el volumen real
lo justifique, sin abrir otro catálogo ni duplicar el Business Core. Puerta
local: 2.633 tests, typecheck, build/PWA, lint sin errores y audit con 0
vulnerabilidades. El deploy
`6dddf72e` quedó `READY`: 360 px bajó de 60 cards/12.179 px a 20/5.000 px;
página 2 y retorno desde PDP conservaron 21–40/60. A 1.440 px montó 20, mantuvo
44 px, reinició página al filtrar y ambas matrices cerraron sin overflow ni
logs. D5.20 queda cerrado; cursor server-side espera volumen real.

D5.21 corrige la jerarquía y la semántica del panel de rendimiento de
Commerce. “Revenue hoy” y “Órdenes totales” salían de la misma cola de hasta 200
filas, y “Órdenes completadas” contaba estados de carrito aunque los pedidos
históricos no tuvieran sesión vinculada. El panel ahora consume un snapshot
server-side exacto, presenta facturación paga, pedidos registrados, conversión
medible y carritos recuperables, y deja a la vista la cobertura faltante sin
mezclarla en el porcentaje. El embudo se rotula por sesiones desde el contrato
canónico del 3/9; si el snapshot falla hay error recuperable, no cuatro ceros.
Shopify y Tiendanube distinguen ventas/pedidos de conversión y trabajan por
período; filtros, comparación, checkout iniciado y canal quedan como próxima
capa, no como números inferidos. Puerta local: 2.635 tests, typecheck,
build/PWA, lint sin errores y audit sin vulnerabilidades. `7e2b7295` quedó
`READY`: la sesión publicada mostró $2/2 pagos, 6 pedidos, 0/5 conversiones,
5 carritos con items/0 recuperables y explicó los 6 pedidos no atribuibles. La
matriz 1.440/360 px cerró sin overflow horizontal ni logs. D5.21 queda cerrado;
el impacto comercial requiere tráfico real y no se simula.

D5.22 completa la etapa que faltaba en ese mismo embudo, sin abrir otra página
ni un sistema paralelo de eventos. Al entrar a checkout con carrito hidratado,
la sesión canónica guarda `checkout_started_at` de forma idempotente y después
Meta/GA reciben su señal complementaria. El panel suma **Checkout iniciado**
entre carrito y compra y declara las dos fechas de cobertura, porque una etapa
nueva no puede atribuirse hacia atrás. La puerta local quedó completa y la
autoridad productiva se probó dos veces sobre un token anónimo, dejando un
solo timestamp y 0 residuos. `8ff64b65` quedó `READY`: a 360 px el recorrido
catálogo → carrito → checkout no tuvo overflow ni logs y el panel pasó de 0/5
a 1/6 (16,7%) con la etapa nueva y ambas fechas visibles. Después de limpiar la
sesión técnica volvió a 0/5 y quedó 0 residuo; no se creó pedido ni se movió
stock. D5.22 queda cerrado. Quedan período, comparación y canal.

D5.23 incorpora período y comparación en la misma superficie, sin derivar al
usuario a Reportes ni clonar Analytics. El filtro compartido persiste `df`/`dt`
en la URL, ofrece presets/calendario y ahora garantiza 44 px tanto en el trigger
como en limpiar y presets. El servidor compara el mismo número de días anterior
con cierre horario argentino. Las cards muestran tendencia sólo con base no
cero y el texto explica cuándo no corresponde calcularla. La UI y su matriz
quedan listas para deploy; en móvil la explicación larga de la tendencia se
oculta visualmente pero conserva un nombre accesible. Publicado con `7ea5a0a9`:
en 360 px período, comparación y reload fueron exactos; selector/limpiar midieron
44 px, la URL se limpió sin perder otros parámetros y no hubo overflow ni logs.
El navegador no aceptó ampliar a desktop, así que esa matriz no se declara
recorrida en este slice. D5.23 queda cerrado con evidencia móvil.

D5.24 corrige la experiencia que no se ve en una captura pero decide si el
catálogo puede descubrirse. La misma página visual conserva transición y foco,
pero anterior/siguiente pasan a ser enlaces con destino real y estado inactivo
semántico. El documento equivalente para crawlers ya no es una portada vacía:
presenta navegación principal, migas, categorías, las 20 fichas de la ventana
y vecinos secuenciales. Cada página tiene título/canonical propios y una URL
fuera de rango converge a contenido real. El sitemap enumera esas ventanas sin
fechas ni prioridades ficticias. Una caída responde 503 reintentable, no un
404 o vacío engañoso. Puerta completa local: 2.642 tests/282 archivos,
TypeScript, lint sin errores, build/PWA y handlers empaquetados; el endpoint
externo de `npm audit` agotó el tiempo y no se declara verificado. Falta matriz
publicada antes de cerrar D5.24. `c68abf90` quedó Ready: Googlebot recorrió
home/PLP/PDP/sitemap con 12/20 enlaces y canonical por ventana; la SPA navegó
2→3 a 1.288 px con 44 px, cero overflow/logs. La nueva guarda E2E corrió contra
producción como Pixel 5 y cerró 1/1 con 20 cards, anchors, targets ≥44 px y cero
overflow/errores. D5.24 queda cerrado; indexación externa no.

D5.25 corrige la semántica visual antes de sumar otra gráfica. Las supuestas
sesiones productivas eran 7/7 carritos con items y ninguna tenía UTM. Commerce
ahora presenta una tabla responsive de canales dentro del overview existente:
desktop compara visita, carrito, checkout, compra, conversión e ingreso pago;
mobile convierte cada canal en una ficha de dos columnas sin scroll lateral.
El vacío dice que no hay visitas medibles y los pedidos anteriores permanecen
operables, en vez de mostrar siete ceros. Color sólo apoya al nombre del canal,
nunca reemplaza el texto. La nota de cobertura explica primera fuente, cohorte,
retención y ausencia deliberada de ROAS sin costo conectado.

La superficie se apoya en una visita first-party de 30 minutos distinta del
carrito de 30 días. Capacidad hasheada, sólo UTM/hostname, RLS sin lectura
directa y snapshot tenant-safe reducen el dato antes de diseñarlo. El límite
antiabuso también hashea el sujeto por IP antes del contador horario; la
transición productiva purgó 53 claves legacy y dejó 0 en claro. Shopify
Acquisition/Marketing y Tiendanube Estadísticas fueron reverificados en fuente
oficial; se adopta su separación entre adquisición, venta y costo conectado,
no su composición. Migración productiva y fixture reversible cerraron
first-touch, vínculo a carrito/checkout, owner/outsider y 0 residuos. Puerta
dirigida: 76/76 tests. El gate de privacidad agrega el estado pausado, CTA a
Páginas, confirmación owner/admin y Pausar. Si la política publicada es
anterior, el editor ofrece anexar la divulgación como borrador sin pisar ni
publicar el texto del comercio; la tienda real queda en 0 visitas hasta que el
dueño lo revise. La puerta completa quedó verde con 2.652 tests/284 archivos,
TypeScript, lint
sin errores y build/PWA; el endpoint de `npm audit` no respondió y no se toma
como evidencia. `bc1ef553` quedó Ready y aliasado: a 1.288 px el panel publicado
mostró jerarquía sin desborde, el vacío honesto de canales y el asistente legal;
la prueba preparó el texto sólo en memoria, recargó sin guardar y produjo 0
logs. La tienda pública conservó catálogo y navegación, también sin logs. Queda
la inspección mobile autenticada —la sesión disponible no permite cambiar el
viewport— y tráfico real posterior al opt-in; no se declaran con una emulación
o un fixture.

D5.26 retira una contaminación visual encontrada en esa misma recorrida: el
catálogo público mostraba un producto de prueba llamado `ZZ NO COMPRAR`. La
corrección se limita a desactivar el ID exacto cuando conserva ese nombre y
stock 0; pedidos históricos y stock no se reescriben. El corte se cierra sólo
si la base y el storefront dejan de exponerlo. Producción confirmó fila
inactiva con dos referencias históricas, catálogo 60→59, 0 fixtures visibles y
storefront publicado sin el nombre ni logs: **cerrado**.

D5.28 corrige la jerarquía transaccional de la ficha. El stock agregado ya no
se presenta como disponibilidad del sabor/talle todavía no elegido y el
cotizador no consulta una línea ambigua. El selector accesible antecede stock,
envío y compra; muestra saldo bajo, tacha `Agotado` y conserva esa opción como
interactiva para suscribir el aviso al SKU exacto. El CTA principal y su barra
móvil no quedan como botones deshabilitados sin explicación: nombran la opción
pendiente y devuelven foco al grupo. La referencia no se copia: Shopify valida
la entidad variante y Tiendanube el tratamiento visible del agotado; Nerqia
los integra con su cotización y su autoridad de carrito existentes. La primera
recorrida descubrió que el RPC ocultaba `stock=0`; `20260904000090` completa el
contrato público saneado y conserva la validación de compra en servidor. La
base cerró 26/26 activas, 6/6 agotadas y 0 diferencias como `anon`, con libro en
brecha 0. Puerta final: 2.663 tests/286 archivos, TypeScript, lint sin errores y
build/PWA. Publicado, la PDP real expuso 7 sabores disponibles + 2 agotados;
agotado llevó al aviso exacto sin envío y disponible a stock + envío + compra,
sin escrituras, overflow ni logs. El E2E Pixel 5 pasó; Chromium a 720 px halló
un CTA visualmente presente pero `aria-hidden` después de volver desde agotado,
porque el observer retenía el nodo desmontado. `variantId` rehace ahora la
observación y tiene guarda. `940cee4a` quedó Ready; el mismo E2E publicado pasó
**2/2** en Chromium y Pixel 5, sin escrituras. Matriz D5.28 cerrada.

D5.29 evita que la card duplique esa PDP. La referencia competitiva no se toma
como una receta uniforme: Shopify admite selectores de variante en grilla y
quick view cuando aceleran una elección similar, mientras Tiendanube concentra
el selector completo y el estado agotado en el detalle. Nerqia muestra hasta
tres quick choices comprables, con 44 px, `radiogroup` y `aria-checked`; un link
cuenta todas las opciones y las agotadas que se resuelven en la ficha. Así, 9 o
20 variantes no empujan precio y CTA fuera del card. La imagen y el precio
cambian con la selección; sin ella, “Desde” sólo usa el menor SKU comprable.
Todos los SKU agotados llevan a sus avisos en lugar de dejar un falso botón
deshabilitado. La regla de precio quedó compartida por card, PDP y carrito; la
orden sigue resolviendo precio y stock en servidor. Falta puerta integral y
matriz publicada antes de cerrar D5.29.

- home de tienda, listado paginado, búsqueda y filtros;
- ficha de producto: CTA móvil y decisión exacta de variantes hechas; falta
  confianza adicional basada en datos/proveedores reales;
- carrito y checkout: objetivos táctiles y sticky en 360 px hechos;
- operación de órdenes: búsqueda, vistas, CSV, inspector y bulk parcial con
  autoridad server-side hechos; la puerta local cerró 2.657 tests/285 archivos,
  TypeScript, lint sin errores y build/PWA. Publicado sin overflow ni logs: 15
  checkboxes desktop/mobile quedaron deshabilitados frente a 5 impagos + 2
  entregados reales, sin fabricar una orden para abrir la barra. Falta la tarea
  con el primer pedido operable real y compra sandbox/real;
- alta/importación y venta manual desde mobile con la simplicidad de referencia
  de Empretienda, sin crear otro stock;
- pago, seguimiento y errores recuperables: hechos para pedido, carrito,
  cuenta y link de pago; falta devolución con el mismo criterio;
- legales y contacto consistentes;
- performance visual: skeleton y tamaño de imagen hechos; red lenta: 404 ≠ error, hecho.

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

## 6. Próximos 30 slices de diseño

| # | Slice | Estado | Evidencia de cierre |
|---:|---|---|---|
| 1 | Aislamiento de branding del backoffice | Hecho | Colores de tienda no mutan tokens SaaS. |
| 2 | Primitives v3 transversales | Hecho | Tres layouts y contrato automático. |
| 3 | Selects de páginas de gestión | Hecho 2026-08-22 | 20 migrados; guarda en tests. |
| 4 | Selects de componentes + decisión Storefront | Hecho 2026-08-22 | 10 migrados; SaaS en cero y 4 excepciones públicas bajo guarda. |
| 5 | Estándar integral competitivo | Hecho 2026-08-29 | 20 benchmarks oficiales (10 globales, 4 Finance/spend y 6 argentinos), 4 Figma observados, arquetipos, overlays, segmentación, matriz de cobertura y puerta tecnológica bajo guarda CI. Shopify POS y Square ya fijan también el contrato de sesión física: ubicación, fondo, responsable, movimientos, esperado, conteo y diferencia. |
| 6 | Estados unificados | Parcial 2026-08-29 | Contrato de 12 estados; Finance/Compras, Reportes/Intelligence, Dashboard y Productos migrados sin confundir vacío/error/parcial ni mezclar tenants. Auditoría y Sucursales adoptan el contrato; faltan rutas restantes y matriz visual. |
| 7 | Modales, sheets y drawers | Hecho en Gestión 2026-08-22 | 16 overlays de 11 archivos migrados; tamaños canónicos, focus trap y cierre accesible. Sólo rail mobile + 3 scanners fullscreen quedan bajo allowlist CI; Storefront pertenece a D5. |
| 8 | Paginación canónica | Hecho en Gestión 2026-08-22 | Cinco listados comparten rango, responsive, límites y aria-live; cálculo puro cubierto y guarda evita controles locales. |
| 9 | Fechas canónicas | Hecho en Gestión 2026-08-22 | 82 campos/46 archivos conservan semántica nativa bajo Input; 11 variantes manuales retiradas y regresión bloqueada. Uploaders clasificados aparte. |
| 10 | Importadores estructurados canónicos | Hecho en Gestión 2026-08-22 | Catálogo, precios, Tiendanube, clientes y banco comparten FilePicker; extensión/MIME, drop, busy, error y misma selección cubiertos. |
| 11 | Productos end-to-end | Parcial 2026-08-29 | El catálogo conserva lectura válida, identifica fallos críticos/auxiliares y reduce trece CTA equivalentes. Editor e importador ya son fullscreen responsive; una comprobación publicada encontró que faltaba la columna flex que contenía scroll y footer, por lo que el contrato ahora fija esa geometría y mantiene el CTA persistente. Variantes se opera con labels/cards mobile bajo guarda y ya no cambia el título del módulo a “Sabores”: Sabor/Talle/Color/Medida quedan como tipo, no como nombre de la capacidad. Menú y workspace pasaron la matriz publicada 360/768/1024/1440 sin overflow; la consola encontró el `DialogTitle` semántico faltante del importador, que ya quedó corregido bajo guarda y revalidado con nombre accesible y sin errores nuevos. El parser publicado leyó un CSV real de dos filas, mostró ambas en preview y canceló sin aplicar ni generar consola nueva, también a 360 px; el fixture y el recorrido quedaron en el E2E autenticado. X/Escape/exterior y salida del navegador ya protegen una ficha editada con confirmación controlada; falta revalidarla publicada porque Vercel rate-limitó el build. Queda medición de tarea. |
| 12 | Ventas, devolución y facturación | Parcial 2026-09-03 | La cola RMA distingue reintegro autorizado de permiso faltante. Lista→detalle conserva filtros/página: `?sale=` abre un Sheet lateral/fullscreen mobile, agrupa el ticket canónico y explica líneas/cobro/factura/devolución/canal y margen. Devoluciones de mostrador opera a nivel ticket con cantidades restantes, importe server-side, split original, estado por parte, caja/stock/ledger atómicos y documento fiscal honesto. Carga libre, borrado y falso crédito en tienda fueron retirados. Para Mercado Pago, monto/Order/Payment se derivan server-side; la UI con permiso permite ejecutar, reintentar o verificar sin ocultar la deuda, y sólo una respuesta positiva cancela el pasivo. Facturas congela identidad fiscal, ofrece QR ARCA real en UI/PDF y distingue homologación/producción. Facturas y notas de crédito consumen ahora sus eventos durables en un único motor, persisten candidato y reconcilian un timeout mediante las consultas oficiales antes de repetir; el listado representa un `draft` con CAE como Emitida sin duplicar estados del Core. Pruebas reversibles cierran partial/retry/outsider/over-return/ledger, rechazo→pendiente, idempotencia, confirmación→pasivo cero, snapshot, inmutabilidad, reserva automática, candidato, outbox y 0 restos. `db6fa0b8` quedó `READY`; la sesión real certificó 2/2 “Emitida + CAE”, 2 CAE autorizados, 0 pendientes/errores y consola limpia en Facturas/ARCA. Faltan refund Mercado Pago live, emisión ARCA productiva real y medición de tarea. |
| 13 | POS teclado/touch/offline/QR/turno | Parcial 2026-09-03 | F2/F9, targets táctiles, descuentos server-side, cola offline por ticket, QR dinámico, recuperación idempotente, fidelidad y turno autoritativo ya tienen contrato técnico y fixtures reversibles con 0 restos. El POS muestra estado/sucursal real, no descuenta stock antes de acreditar QR y conserva la obligación visible ante fallas. La auditoría encontró que el shell comprimía a 1.092 px el catálogo a 428 px y recortaba un carrito de 923 px dentro de 804 px. Caja ahora declara superficie inmersiva, consume el remanente real, adapta cards/bundles por container queries, difiere el split desktop a 1.280 px y mantiene total/confirmación en un único scroll. `dd29eba8` quedó `READY`: a 1.092×912 usa 844 px, padding 0, cards de 198 px, documento sin overflow y sheet contenido. El E2E sin escrituras fija 360/768/1024/1092/1280/1440. Faltan ejecutar esa matriz con credenciales vigentes, acreditación/refund QR live, operar/cerrar un turno real y medir tiempo/errores. |
| 14 | Compras, recepción y Kardex | Parcial 2026-08-22 | Finance llega a la OC exacta, muestra contexto y abre la recepción idempotente; faltan Kardex integrado y matriz responsive. |
| 15 | Reportes orientados a decisión | Pendiente | Menos filtros duplicados; acción clara. |
| 16 | Settings e Integraciones | Parcial 2026-08-29 | SMTP propio usa estado saneado; Mercado Pago quedó en una única tarjeta OAuth. Webhooks retiró duplicación/eventos fantasma y suma gestión server-side, firma, health, log y contrato público. API keys dejó sólo campos operativos, no lee hashes, diferencia activas/vencidas y expone guía, OpenAPI y lifecycle; el panel publicado pasó sesión real, claro/oscuro y 360/768/1024/1440 sin overflow ni errores de consola. La descripción sensible que la matriz encontró truncada ya fue desplegada y revalidada en claro/oscuro a 360 px y desktop. La pestaña Precios ya no termina sin salida: suma CTA propio, feedback de efecto en la próxima venta, labels accesibles y persistencia aislada para descuentos POS/mayorista/márgenes, sin confirmar campos ocultos de otras pestañas. Producción `5252e20` confirmó con sesión real el CTA, los cuatro nombres y una auditoría de guardado sin alterar 10% / 5% / 0% / 0%. Falta completar la matriz responsive de Ajustes, revisar cambios sin guardar del resto de secciones, transportistas y las demás conexiones. |
| 17 | Finance Document Inbox | Parcial 2026-08-22 | Cola, retry, bloqueo, cuarentena, confianza, revisión, matching y diálogo Supplier Invoice/Purchase/Payable Draft visibles. Líneas, vencimiento, TC, efectos, aprobación y handoff a recepción usan estados claros; faltan proveedor OCR aprobado y validación responsive con documentos reales. |
| 18 | Finance command center Mendel-class | Congelado hasta adopción F3 | Inicio, gastos, solicitudes/aprobaciones, presupuestos/políticas, medios, centros, conciliación e integraciones completan desktop/mobile con estados y autoridad visibles. |
| 19 | Platform Merchant 360/cola | Pendiente | Staff resuelve sin entrar al tenant. |
| 20 | Storefront y operación Commerce | Parcial D5.29 2026-09-04 | D5.1 cubre resiliencia de banners, hero, categorías, cards, PDP, búsqueda, logo, carrito y sugerencias. D5.7 deja el CTA de compra al pie en 360 px. D5.8 reserva geometría al cargar y declara tamaño de imagen. D5.9 hace que crawlers vean HTML del comercio. D5.10 distingue 404 de red caída y no pinta un catálogo vacío. D5.11 no pide email ni declara el carrito vencido si la red falló. D5.12 conserva enlaces `/catalogo/:id` user/org. D5.13 hace visible y honesta la persistencia server-side y recupera todas las líneas/variantes. D5.14 reutiliza ese mismo Storefront en `<slug>.nerqia.app` con base, canonical, robots, sitemap, feed y previews resueltos por host. D5.15 corrige Inicio, H1 y robots a partir de la recorrida real. D5.20 pagina el PLP publicado con 20 cards, URL/retorno/filtros, 44 px y cero overflow/logs. D5.21 separa facturación paga, pedidos exactos y conversión atribuible mediante snapshot tenant-safe. D5.22 suma checkout iniciado y D5.23 período/comparación. D5.24 alinea humano/crawler y sitemap. D5.25 deja de llamar visita a un carrito: sesión first-party de 30 minutos, token hasheado, UTM/hostname mínimos, vínculo al Core y canales responsive con cohorte/cobertura; migración y fixture productivos dieron owner/outsider y 0 residuos. D5.26 retira el único fixture `NO COMPRAR` sin borrar su historia. D5.27 suma selección responsive, confirmación con alcance, resultado persistente y transición masiva tenant-safe de hasta 50 pedidos sin mezclar cobro/cancelación; `722c4951` quedó publicado, sin overflow/logs, y el estado no operable real deshabilitó todos los controles. D5.28 hace que la PDP elija el SKU antes de prometer stock/envío, tacha el agotado sin impedir su alerta y convierte CTA/barra móvil en recuperación accesible hacia el selector; producción confirmó 26/26 activas, 6/6 agotadas, libro sano, una PDP real 7+2 y E2E publicado 2/2 en Chromium/Pixel 5. D5.29 limita la card a tres quick choices disponibles, deriva el selector completo a la PDP y comparte precio exacto con ficha/carrito; falta matriz publicada. Faltan tarea con pedido operable, tráfico real tras opt-in, compra sandbox/real y cursor server-side cuando el volumen lo exija. |
| 21 | Carrito/checkout/pago | Parcial D5.27 2026-09-04 | Resultado protegido por capacidad; D5.3–D5.6 cierran avisos, Pay honesto, cola e inspector. D5.7 deja CTA de ficha/carrito/checkout a 44 px en 360. D5.10 reintenta `create_store_order_idem` ante un corte de red con la misma clave. D5.11 distingue link de pago inexistente de corte de red y no borra un pedido ya visto. D5.27 agrega selección desktop/mobile, confirmación, resultados parciales persistentes y RPC tenant-safe. Falta compra sandbox/real. |
| 22 | Accesibilidad AA | Pendiente | axe + teclado + zoom + contraste. |
| 23 | Visual regression CI | Pendiente | Capturas deterministas claro/oscuro. |
| 24 | Pruebas con comercios | Bloqueado externamente | Tareas reales y hallazgos registrados. |
| 25 | Investor demo mode con datos seguros | Pendiente tras validación | Narrativa reproducible, sin métricas falsas. |
| 26 | Identidad y dominio oficial de Nerqia | Hecho 2026-09-03 | Nombre, productos, isotipo N/Q RGBA entregado por el dueño, wordmark horizontal, favicon/Apple/PWA, metadata, Auth y shells comparten contrato canónico; se retiró el viejo símbolo G que había quedado renombrado. `nerqia.app` es el origen productivo y `www` redirige al raíz. La identidad del merchant queda aislada en Storefront/documentos y los namespaces técnicos heredados permanecen compatibles. Landing y acceso se habían verificado en localhost 1280×720 sin errores de consola; la sustitución visual queda protegida por dimensiones, formato y adopción, y requiere nueva inspección publicada tras el deploy. |
| 27 | Contrato visible de webhooks | Hecho 2026-08-29 | Diálogo legible, código de firma, semántica de id/retry/orden, guía y OpenAPI 3.1; transporte sintético certificado contra HTTPS externo y receptor eliminado. |
| 28 | Contrato visible de API pública | Hecho 2026-08-29 | Panel, estado vacío y modal auditados con sesión de administrador real en producción: claro/oscuro, 360/768/1024/1440, cero overflow y consola sin warnings/errors. Guía, OpenAPI 3.1 y changelog accesibles; secretos one-time sin bloque negro en claro. La prueba descubrió que `stock:write` ocultaba parte de su consecuencia en mobile; el bundle nuevo `index-CBuC_8gZ.js` ya muestra la explicación completa en claro/oscuro a 360 px, conserva 512 px de diálogo desktop y deja consola limpia. Evidencia: `docs/evidencias/2026-08-29_api_keys_visual.md`. |
| 29 | Descubrimiento público de Nerqia | Parcial D5.24 2026-09-04 | Landing y precios comparten título, descripción, H1, canonical y texto visible con el documento semántico del borde; `WebSite` fija el nombre Nerqia y el índice raíz incorpora la plataforma sin duplicar el sitemap de tiendas. D5.24 lleva el mismo contrato al catálogo completo: `OnlineStore`, migas, ItemList, fichas y paginación enlazables, canonical por ventana, 503 ante caída y sitemap sin señales inventadas. Puerta local: 2.642 tests/282 archivos, typecheck, lint 0 errores, build/PWA y handlers; `npm audit` quedó sin evidencia por timeout externo. `c68abf90` quedó Ready y pasó Googlebot, SPA 1.288 px y E2E Pixel 5 1/1. Propiedad DNS verificada, sitemap Correcto y home de Nerqia/Exentry en cola prioritaria. Al 4/9 siguen sin resultados útiles; falta indexación externa observada y métricas de Search Console. |
| 30 | Documentos legales de plataforma | Parcial D5.25 2026-09-04 | Términos/Privacidad usan un shell único, claro/oscuro, versión visible, aviso de identidad faltante y tabla responsive de proveedores. D5.25 informa la medición first-party: 30 minutos, token hasheado, UTM/hostname sin IP/URL/identidad y poda automática a 13 meses; el generador del merchant incorpora esos límites y una política previa puede recibir el bloque como borrador no publicado, pero cada dueño debe revisar y publicar. Matriz local previa 360/768/1024/1440 sin overflow ni errores, 44 px y tokens claro/oscuro. Falta matriz publicada del texto nuevo, identidad real y validación profesional. |

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
contra el diferencial real de Nerqia: stock único, costos completos, margen
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
