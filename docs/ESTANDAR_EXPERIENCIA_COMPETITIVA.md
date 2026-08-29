# Gestiona — estándar integral de producto y experiencia competitiva

**Corte de investigación:** 2026-08-22  
**Estado:** lineamiento obligatorio para producto, diseño e ingeniería.  
**Ámbito:** Business, Commerce, Finance, Platform, Intelligence, Storefront y
superficies públicas.

Este documento define **cómo investigar, decidir, diseñar, construir y validar**
una experiencia de primer nivel. No reemplaza a [`ROADMAP.md`](../ROADMAP.md),
que ordena el producto, ni a [`DESIGNROADMAP.md`](../DESIGNROADMAP.md), que
ordena el rediseño. Es la vara permanente contra la cual ambos se ejecutan.

La intención no es copiar una pantalla famosa ni sumar todas las funciones que
existen en el mercado. Gestiona adopta patrones que reducen tiempo, error y
riesgo, y conserva su diferencial: una sola verdad de stock, cliente, costo,
cobro, impuestos, envío y margen a través de todos los canales.

## 1. Autoridad y lenguaje de evidencia

Cada afirmación de este documento usa una de estas marcas:

- **✅ Verificado:** comportamiento documentado por una fuente oficial y
  revisado en la fecha de corte.
- **👁 Observado:** composición vista directamente en un preview público de
  Figma; prueba el patrón visual, no que una empresa real lo use ni que funcione.
- **📌 Decisión Gestiona:** traducción elegida para nuestro producto.
- **❓ Hipótesis:** idea todavía sin evidencia de uso, performance o negocio.

Reglas:

1. una captura no demuestra una capacidad;
2. marketing no demuestra un flujo end-to-end;
3. una función de un competidor no entra al roadmap sin conectar con un trabajo,
   una métrica y una fase vigente;
4. “similar a” nunca autoriza copiar assets, textos, datos o composiciones
   completas;
5. toda comparación se vuelve a verificar antes de publicarla: el mercado
   cambia;
6. si una fuente no se pudo verificar, se escribe `❓`, no se completa de
   memoria.

## 2. Qué se estudió y qué aporta cada referencia

### Referencias globales de operación

| Referencia | Evidencia | Patrón útil | Traducción, no copia |
|---|---|---|---|
| Shopify Admin | ✅ [vistas y filtros](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/searching-filtering-views), [acciones masivas](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/bulk-actions) | Vistas reutilizables por recurso, filtros explícitos, selección de página o de todos los resultados. | Índices de productos, ventas y clientes con estado en URL, vistas guardadas y bulk seguro. |
| HubSpot CRM | ✅ [vistas guardadas](https://knowledge.hubspot.com/records/manage-saved-views-in-the-updated-index-page), [columnas](https://knowledge.hubspot.com/records/customize-index-page-columns), [filtros rápidos](https://knowledge.hubspot.com/records/customize-quick-filters), [segmentos](https://knowledge.hubspot.com/segments/view-and-filter-lists) | La vista guarda filtros, columnas, orden y alcance; preview sin perder la lista; lógica de segmentos agrupada. | `ResourceView` canónica y diferencia estricta entre filtro, vista, segmento, cohorte y cola. |
| Salesforce | ✅ [vistas de lista](https://help.salesforce.com/s/articleView?id=xcloud.basics_understanding_list_views_lex.htm&language=en_US&type=5), [vistas personalizadas](https://help.salesforce.com/s/articleView?id=xcloud.customviews_lex.htm&language=en_US&type=5), [Kanban](https://help.salesforce.com/s/articleView?id=kanban.htm&language=en_US&type=5) | Tabla/Kanban/split según tarea, vista fijada, búsqueda amplia y tablero con agrupación y resumen. | Tablero sólo para entidades con etapas reales; la tabla sigue siendo la autoridad para comparar. |
| Stripe Dashboard | ✅ [búsqueda](https://docs.stripe.com/dashboard/search), [Workbench](https://docs.stripe.com/workbench/overview), [filtros](https://docs.stripe.com/connect/dashboard/filters) | Búsqueda global con operadores y URL compartible; inspector persistente de errores, eventos, webhooks y salud. | Command palette y Operation Inspector transversal con correlación, retry y auditoría, sin exponer secretos. |
| Odoo | ✅ [tipos de vista](https://www.odoo.com/documentation/19.0/applications/studio/views.html), [dashboards](https://www.odoo.com/documentation/19.0/applications/productivity/dashboards.html), [filtros globales](https://www.odoo.com/documentation/19.0/applications/productivity/spreadsheet/work_with_data/global_filters.html) | Lista, Kanban, búsqueda, pivots y dashboards con filtros globales y drill-down al registro fuente. | Un mismo Business Core con representaciones por tarea; todo KPI puede explicar y abrir su población. |
| Shopify Flow | ✅ [triggers, condiciones y acciones](https://help.shopify.com/en/manual/shopify-flow/reference), [editor](https://help.shopify.com/en/manual/shopify-flow/create/workflow-editor) | Automatizaciones visuales con ramas, datos dinámicos, schedules, loops y conectores. | Orbit/Playbooks: señales multi-dominio, preview de impacto, autoridad del Core, approval gates, retry y outcome; no un automatizador genérico. |
| HubSpot Workflows | ✅ [historial y versiones](https://knowledge.hubspot.com/workflows/understand-your-workflow-details-page), [trazado por registro](https://knowledge.hubspot.com/workflows/review-a-records-workflow-paths-and-actions) | Performance, action logs, historial de enrollment, revisión de versiones y camino exacto de cada registro. | Cada run de Orbit muestra snapshot, evidencia, policy, entidad enlazada, error, retry y resultado, con retención/PII explícitas. |
| QuickBooks Online | ✅ [receipts/bills](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-transactions/upload-receipts-bills-quickbooks-online/L862MmZHn_US_en_US), [aprobaciones](https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-workflows/set-use-bill-approval-payment-release-workflows/L1IOLL9hv_US_en_US), [gestión de bills](https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-bills/review-manage-bills-quickbooks-online/L8VbbnAd2_US_en_US) | Cola `For review`, documento y datos lado a lado, match o creación, estado de aprobación y tarea asignada. | Finance Document Inbox, revisión humana versionada y borradores sin efecto hasta aprobación. |
| Square | ✅ [reportes](https://squareup.com/help/us/en/article/5072-summaries-and-reports-from-the-online-dashboard), [colas de disputa](https://squareup.com/help/us/en/article/8361-view-dispute-reports) | Fecha/local/dispositivo como contexto; tarjetas de performance y lista accionable; “requiere respuesta”. | POS/reportes por ubicación y colas con severidad, dueño, vencimiento y próxima acción. |

### Finance y spend management regional

| Referencia | Evidencia | Patrón útil | Traducción, no copia |
|---|---|---|---|
| Mendel | ✅ [producto](https://mendel.com/ar/producto/), [tarjetas](https://mendel.com/ar/producto/tarjetas-mendel/), [integraciones](https://mendel.com/ar/producto/integraciones/) y [MCP](https://mendel.com/ar/mendel-mcp/) | Control preventivo: presupuesto y política antes del gasto; tarjetas físicas/virtuales, reglas por monto/categoría/ubicación/frecuencia, aprobaciones multinivel, centros de costo y exportación a ERP. Su MCP permite consultar y aprobar en lote con herramientas autorizadas. | F5 debe unir solicitud, política, presupuesto, evidencia, aprobador, excepción y exportación sobre el mismo Business Graph. Las acciones de IA reutilizan permisos y auditoría; nunca evitan la aprobación humana. |
| Clara Global | ✅ [plataforma Argentina](https://global.clara.com/es-AR) | Comprobante por WhatsApp/formulario, gasto con tarjeta y reembolso en un mismo flujo, roles diferenciados, entidades legales aisladas y reporte de pago estructurado. | Ingreso mobile/WhatsApp, reembolso y tarjeta externa convergen en una cola común sin mezclar organizaciones ni monedas. Solicitante, manager, contador y administrador ven alcances distintos. |
| Rindegastos | ✅ [gestión de gastos](https://rindegastos.com/), [controles y flujos](https://rindegastos.com/es-mx/gestion-de-gastos) y [API](https://rindegastos.com/es-co/documentacion-api) | Rendiciones, anticipos/fondos, viáticos, kilometraje, captura offline, duplicados, políticas por centro de costo y aprobaciones por monto/tipo; API para usuarios, gastos, informes, fondos y políticas. | Expense Management necesita captura resiliente, fondos/reembolsos, política versionada, cola de infracciones y contrato de integración estable; el rol final sigue siendo responsable de la decisión. |
| SAP Concur Argentina | ✅ [servicios financieros](https://www.concur.com.ar/servicios-financieros) | Viajes, gastos y facturas en una suite, captura automática y visibilidad fiscal/regulatoria. | Es referencia enterprise de cobertura y compliance, no alcance inmediato. Gestiona preserva evidencia fiscal argentina y escala por fases sin presentar una suite de viajes inexistente. |

📌 **Límite Finance:** tarjetas corporativas, custodia de fondos y viajes no
entran en F3 ni se prometen por paridad. Primero se valida documento → matching
→ borrador → aprobación sobre el Core. F5 agrega política, presupuesto, centro
de costo, reembolso, captura móvil y operación por excepción. Emitir tarjetas o
mover dinero exige demanda, socio regulado, economics y análisis legal propios.

### Ecosistema argentino de comercio y gestión

| Referencia | Evidencia | Patrón útil | Traducción, no copia |
|---|---|---|---|
| Tiendanube | ✅ [funcionalidades](https://www.tiendanube.com/funcionalidades) y [búsqueda/filtros de ventas](https://ayuda.tiendanube.com/es_AR/123288-mis-ventas/como-buscar-y-filtrar-mis-ventas) | Tienda, redes, marketplaces, PDV, stock sincronizado, pagos, envíos, marketing y ecosistema de apps. Ventas ofrece filtros ricos, vistas rápidas, exportación y acciones masivas. | La paridad Commerce incluye el recorrido completo y una operación de órdenes veloz; POS o stock compartido ya no son diferenciales. Gestiona debe explicar costo y margen por canal desde la misma orden. |
| Empretienda | ✅ [plataforma](https://www.empretienda.com/), [productos](https://empretienda.helpjuice.com/es_AR/productos) y [carga de venta](https://empretienda.helpjuice.com/es_AR/conociendo-agregar-) | Administración desde cualquier dispositivo, carga/importación de productos, productos digitales/mayoristas, promociones y una venta presencial/WhatsApp que descuenta el mismo stock. | El segundo comercio debe poder empezar y vender desde el celular con menos configuración. La venta fuera del checkout sigue entrando al Core, no crea otro inventario. |
| Contabilium | ✅ [ERP Argentina](https://contabilium.com/ar) y [ERP ecommerce](https://contabilium.com/ar/industrias/erp-ecommerce/) | Facturación, compras, stock, tesorería, contabilidad y POS con integraciones a Mercado Libre, Tiendanube, WooCommerce y Shopify; depósitos, precios, órdenes y clientes sincronizados. | El benchmark local no termina en ecommerce: onboarding, ARCA, depósitos, compras y conciliación deben funcionar juntos. La amplitud sin adopción no cuenta como ventaja. |
| Xubio | ✅ [producto](https://xubio.com/ar/) y [matriz de empresas](https://xubio.com/ar/precios-empresas) | Facturación, cobranzas, pagos, compras, stock/depósitos, importaciones, impuestos, contabilidad, permisos e integraciones locales en una matriz de planes explícita. | El lenguaje fiscal y las tareas argentinas deben ser nativos. Gestiona compite con menor tiempo a valor y evidencia de margen, no con una lista más larga de módulos. |
| Colppy | ✅ [plataforma](https://colppy.com/) y [gestión para PyMEs](https://colppy.com/sistema-de-gestion-para-pymes) | Gestión y contabilidad cloud, facturación, bancos, pagos/cobros, stock, cash flow e integraciones con Mercado Pago, Tiendanube y Mercado Libre. | Finance y Business muestran continuidad entre operación, banco, impuesto y asiento, con estados conciliados y responsables visibles. |
| Mercado Libre + Mercado Pago | ✅ [publicación](https://www.mercadolibre.com.ar/ayuda/como-publicar-en-mercado-libre_25316), [Orders API de Point](https://www.mercadopago.com.ar/developers/es/docs/mp-point/overview) y [marketplace fee](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/how-tos/integrate-marketplace) | Catálogo/variantes/stock, fulfillment, cobro presencial y online, conciliación por notificaciones y comisión de marketplace mediante OAuth. | MercadoLibre es un canal del Core y Mercado Pago una infraestructura de cobro: cada evento se reconcilia, es idempotente y termina en orden, stock, pago y margen explicables. |

📌 **Paridad local obligatoria:** catálogo/importación, venta de mostrador y
online, stock único, promociones, pagos, envíos, dominio, facturación argentina,
filtros/acciones de órdenes, uso mobile e integraciones. Ninguna de esas piezas
aislada es el posicionamiento. El claim defendible a validar es que Gestiona
reúne operación, Commerce y Finance con costo histórico, comisión, envío e IVA
en la misma decisión de margen.

❓ **Radar regional no usado como hecho:** Tango, Dragonfish, Fudo/Maxirest,
VentaWeb, Axon y Max24 siguen siendo referencias por verificar contra fuentes
oficiales vigentes antes de incorporarlas a una comparación o presentación.

### Dirección visual compartida

Inspección directa realizada en preview público el 2026-08-22:

| Referencia | Observación | Qué se adopta | Qué no se adopta |
|---|---|---|---|
| [Aerten](https://www.figma.com/community/file/1252610051102275471/aerten-web-app) | 👁 Rail, título compacto, tabs, búsqueda, filtros, tabla de alta lectura, estados y CTA. | Densidad y jerarquía de índices administrativos. | Paleta bordó, contenido HR y assets. |
| [eMarketplace Admin](https://www.figma.com/design/ojLD3JQrTWpUzCRFnS4WXC/eMarketplace-%F0%9F%9B%8D%EF%B8%8F-%7C-Admin-Dashboard--Community-) | 👁 Canvas claro, violeta fuerte, navegación en dos niveles, filtros laterales y cards comerciales tintadas. | Separación cromática de contexto, salud y atención. | Layout de catálogo como solución universal. |
| [CRM Customers/Deals](https://www.figma.com/design/y3iW4vARslK39hLDzTj37D/CRM-app-with-customers--deals--nested-data--tasks-and-menu-filtering--Community-) | 👁 Rail de iconos, listas densas, detalle de deal/cliente, formularios breves, `load more` y vacío explícito. | Lista → preview/ficha → acción sin perder orientación. | Minimalismo que oculte margen, permisos o relaciones. |
| [SaaS Marketplace Admin](https://www.figma.com/community/file/1592463185051545674/saas-marketplace-admin-dashboard) | 👁 Dashboard de control, entidades, cuentas, planes, slots y `Review Queue`; la revisión abre una ficha completa con evidencia y acciones sensibles separadas. | Control plane por trabajos, cola con SLA y detalle completo para decisiones de riesgo. | Métricas decorativas sin drill-down ni periodo. |

📌 Los Figma aportan dirección y cobertura. Los competidores oficiales aportan
comportamiento. Ninguna de las dos fuentes reemplaza pruebas con comerciantes.

## 3. Modelo mental obligatorio

Toda superficie responde en este orden:

1. **Dónde estoy:** producto, organización, tienda/ubicación y entorno.
2. **Qué trabajo hago:** título y verbo inequívocos.
3. **Qué requiere atención:** excepción, riesgo, vencimiento o dato parcial.
4. **Qué puedo decidir:** comparación y evidencia suficiente.
5. **Qué acción sigue:** una primaria, secundarias jerarquizadas.
6. **Qué pasó:** confirmación, resultado persistido y trazabilidad.

Si una pantalla empieza con gráficos pero no responde esas preguntas, no es un
dashboard: es decoración. Si un modal exige estudiar contexto que está detrás,
no es un modal: es una página o un inspector.

## 4. Anatomía universal de una pantalla

No todas las vistas muestran las doce zonas, pero ninguna inventa otro orden:

1. **Chrome:** producto, organización, rol y navegación global.
2. **Context strip:** tienda, sucursal, periodo, canal, entorno y conectividad.
3. **Breadcrumb:** sólo cuando existe profundidad real; no repite el título.
4. **Page header:** título corto, descripción operativa, estado y CTA primaria.
5. **View bar:** vistas guardadas o trabajos hermanos, con activa inequívoca.
6. **Query bar:** búsqueda, filtros rápidos, filtro avanzado y limpiar.
7. **Selection bar:** aparece con selección y declara alcance exacto.
8. **Decision summary:** conteo/KPI que explica qué población representa.
9. **Workspace:** lista, tablero, editor, reporte, cola o composición 360.
10. **Context panel:** preview/inspector no destructivo cuando evita perder lugar.
11. **Feedback:** progreso, error recuperable, resultado y auditoría.
12. **Help in context:** definición o política cerca de la decisión; no tutoriales
    permanentes que compitan con los datos.

📌 La URL debe representar recurso, vista, filtros compartibles, orden,
paginación y registro seleccionado cuando tenga valor. El estado efímero —modal
de confirmación, hover, input incompleto— no se serializa.

## 5. Arquetipos de pantalla

### 5.1 Índice de recursos

Para productos, órdenes, clientes, proveedores, documentos, merchants y
conexiones.

Debe incluir:

- título, conteo y acción de alta/importación;
- vistas del sistema y vistas guardadas;
- búsqueda con alcance claro;
- filtros rápidos visibles y filtros avanzados;
- chips/tokens removibles de filtros activos;
- columnas configurables, orden y densidad;
- tabla desktop y cards/filas rotuladas mobile;
- selección explícita, selección de página y, si aplica, de todos los
  resultados filtrados;
- acciones masivas compatibles sólo con la selección actual;
- preview lateral para inspección breve;
- paginación o carga progresiva con posición recuperable;
- estados de carga, cero resultados, recurso inexistente, permiso, error,
  offline, stale y parcial.

No debe incluir:

- cuatro filas de KPI entre el título y la lista;
- filtros ocultos que siguen afectando resultados;
- checkboxes sin acción masiva disponible;
- acciones destructivas sin alcance, impacto y resultado;
- tabla comprimida horizontalmente en mobile.

### 5.2 Ficha 360

Para cliente, producto, orden, proveedor, merchant y documento.

Debe responder:

- identidad y estado;
- propietario, organización, tienda/sucursal y permisos;
- hechos canónicos con fuente y fecha;
- relaciones importantes;
- timeline/auditoría;
- riesgos y pendientes;
- actividad y métricas con periodo;
- acciones autorizadas y por qué una acción puede estar bloqueada.

Usar preview lateral si la lectura es corta y reversible. Usar ruta completa si
hay edición extensa, documentos, conciliación, permisos, aprobación, riesgo o
una decisión que necesita URL y auditoría.

### 5.3 Cola operativa

Para Document Inbox, webhooks, pagos, disputes, activación, soporte y salud.

Cada item muestra:

- severidad y estado textual;
- tipo de entidad e identidad;
- dueño/assignee;
- antigüedad, SLA o vencimiento;
- causa conocida o última evidencia;
- reintentos y último resultado;
- siguiente acción concreta;
- estado bloqueado y dependencia externa cuando corresponda.

La cola tiene filtros por estado, severidad, dueño, organización, origen y
fecha; ordena por impacto/vencimiento, no sólo por creación. Una tarjeta de KPI
abre exactamente su población filtrada.

### 5.4 Dashboard de decisión

No es una home de widgets. Tiene:

- periodo, zona horaria, organización/sucursal/canal visibles;
- 3–6 señales de decisión, cada una con definición, delta y fuente;
- alertas/colas accionables antes de gráficos secundarios;
- comparación contra periodo/baseline coherente;
- filtros globales aplicados a todo o excepciones declaradas;
- drill-down reproducible al conjunto de registros;
- dato incompleto o cobertura visible;
- cero totales mezclados entre moneda, impuestos o canales incompatibles.

### 5.5 Board / Kanban

Sólo cuando la entidad tiene etapas ordenadas y mover una card expresa una
transición válida. Requiere:

- definición de etapa y WIP si aplica;
- suma/conteo por columna;
- filtro, búsqueda y alternativa en tabla;
- cards con identidad, importe, edad, dueño y riesgo;
- transición server-side autorizada y auditada;
- explicación si el movimiento está bloqueado;
- teclado y alternativa accesible para drag-and-drop.

No usar Kanban para productos o reportes sólo porque “se ve moderno”.

### 5.6 Formulario y editor

- campos agrupados por decisión, no por tabla SQL;
- label persistente, ayuda breve y ejemplo sólo cuando agrega valor;
- validación inline al salir del campo o enviar, nunca error sólo por color;
- resumen de errores con foco cuando el formulario es largo;
- defaults explícitos y seguros;
- autosave sólo si existe indicador `guardando/guardado/error` y recuperación;
- cambios sin guardar protegidos;
- permisos, efectos secundarios y alcance visibles antes de confirmar;
- mobile con teclado/tipo de input correcto y CTA alcanzable.

### 5.7 Wizard / importador

Secuencia canónica:

~~~text
origen → mapping → validación → preview → confirmación → procesamiento
      → resultado reconciliado → errores descargables/reintentables
~~~

No escribe dominio en `mapping` ni `preview`. Declara filas válidas, inválidas,
duplicadas, omitidas y modificadas; un retry conserva idempotencia.

### 5.8 Reporte y análisis

- pregunta de negocio en el título;
- definiciones, periodo, moneda y cobertura;
- tabla fuente además del gráfico;
- filtros globales consistentes;
- comparación válida;
- exportación con los mismos filtros;
- drill-down a registros;
- acción posible cuando el hallazgo lo permite.

### 5.9 POS

Workspace a viewport completo, optimizado para repetición:

- estado de caja, ubicación, operador y conectividad siempre visibles;
- búsqueda/categorías, resultados y carrito simultáneos en desktop;
- precio, promoción, stock y variante desde autoridad server-side;
- cliente opcional sin frenar venta rápida;
- cobro, split, vuelto, comprobante y recuperación;
- touch targets y navegación de teclado;
- offline con límites explícitos, cola y reconciliación;
- prevención de doble submit y estado de resultado inequívoco.

### 5.10 Storefront y checkout

Usa marca del comercio, no chrome de Gestión. Debe cubrir home, PLP, búsqueda,
PDP, variantes, disponibilidad, carrito, checkout, pago, resultado, tracking,
devolución, arrepentimiento, legales y contacto.

Prioridades:

1. producto, precio y disponibilidad comprensibles;
2. costo/plazo de envío antes de pedir datos innecesarios;
3. checkout como invitado y cuenta opcional;
4. resumen persistente y totales server-side;
5. errores por campo y recuperación de pago;
6. mobile, autofill, teclado adecuado e imágenes optimizadas;
7. no exponer costo, margen, tokens ni datos de otra organización.

### 5.11 Control plane de Platform

Platform no imita el panel del comercio. Organiza trabajo de staff:

- overview de salud y negocio;
- merchants y Merchant 360;
- activación y soporte consentido;
- colas de integraciones, webhooks, pagos, cron y documentos;
- Finance entitlements y gobierno;
- planes, billing, economics y revenue;
- auditoría, MFA, permisos y acciones sensibles;
- métricas de tracción separadas de métricas operativas.

Entrar a un tenant no reemplaza herramientas de plataforma ni otorga
membership. Toda mutación sensible identifica actor, motivo, organización,
antes/después, correlation id y resultado.

### 5.12 Playbook / workflow operativo

Para Orbit y cualquier automatización que coordine más de un dominio:

- builder visual y representación tabular/legible equivalentes;
- trigger, contexto, condición, guard, acción, espera y outcome distinguibles;
- campos con fuente, tipo, frescura, cobertura y scope de organización;
- preview de población, impacto, datos faltantes, permisos, riesgo y costo;
- versión inmutable, owner, estado, aprobación de publicación y kill switch;
- acciones clasificadas como `observe`, `notify`, `prepare`, `request_approval`,
  `reversible`, `external` o `irreversible`;
- ejecución con ruta exacta, snapshot de policy, duración, retry, error y
  siguiente acción;
- acciones masivas con alcance, límites, deduplicación y progreso explícitos;
- no ejecutar efectos sobre dinero, stock, precio, documento o cliente desde el
  canvas: el dominio dueño conserva la autoridad;
- mobile con lista de pasos y detalle accesible, no canvas reducido hasta ser
  ilegible.

## 6. Overlays: modal, sheet, drawer, popover y feedback

### Árbol de decisión

1. ¿Es navegación o tiene URL útil? **Página.**
2. ¿Necesita comparar con la lista? **Sheet/inspector no modal.**
3. ¿Edita más de 6–8 campos, archivos o líneas? **Página o fullscreen editor.**
4. ¿Es una decisión breve que bloquea el contexto? **Dialog.**
5. ¿Es destructiva, irreversible o de alto riesgo? **AlertDialog.**
6. ¿Es ayuda, filtro corto o selector contextual? **Popover/Dropdown.**
7. ¿Sólo confirma resultado y no exige acción? **Toast + estado persistido.**

### Contrato de Dialog

- un propósito y un verbo;
- título, descripción del impacto y cuerpo breve;
- ancho por contenido (`sm`, `md`, `lg`), sin tamaño arbitrario por página;
- CTA primaria a la derecha en desktop y ancho completo en mobile;
- cancelar visible; cerrar con `Esc` salvo proceso crítico en curso;
- foco inicial seguro, focus trap y retorno al disparador;
- error inline que no cierra ni borra datos;
- submit bloqueado y feedback mientras procesa;
- no anidar dialogs ni abrir dropdowns detrás del overlay.

### Contrato de AlertDialog

- nombra objeto y consecuencia;
- para alto impacto puede pedir confirmación explícita, motivo o reautenticación;
- nunca usa el mismo tono/color que una acción primaria normal;
- explica recuperación o irreversibilidad;
- registra auditoría cuando cambia dinero, acceso, stock, publicación o datos.

### Contrato de Sheet / Drawer

- mantiene contexto y selección de la lista;
- ancho suficiente para leer, no para esconder un formulario completo;
- encabezado y acciones sticky sólo si el contenido scrollea;
- URL/selección recuperable cuando el detalle lo justifica;
- en mobile se convierte en fullscreen o ruta, no en una franja angosta.

### Toast y notificaciones

- toast no es la única evidencia de una operación importante;
- éxito describe resultado, no “Todo listo”;
- error conserva una acción de reintento o acceso al detalle;
- notificaciones durables viven en inbox/activity, con leído, objeto y fecha;
- no acumular toasts por cada fila de un bulk.

## 7. Vistas, filtros, segmentos, cohortes y colas

Estos conceptos no son sinónimos:

| Concepto | Propósito | Persistencia | Ejemplo |
|---|---|---|---|
| Filtro | Acotar la lectura actual. | URL/sesión según valor. | `stock < mínimo`. |
| Vista guardada | Repetir un trabajo con filtros, columnas, orden y layout. | Usuario/equipo/sistema. | `Pedidos para despachar`. |
| Segmento | Población de negocio reutilizable. | Dominio, con definición y miembros dinámicos/estáticos. | `Clientes en riesgo`. |
| Cohorte | Población anclada a un evento/periodo para medir evolución. | Analítica versionada. | `Alta de agosto → primera venta`. |
| Cola | Items que requieren resolución y tienen estado/SLA/dueño. | Operacional y auditable. | `Pagos para conciliar`. |
| Audiencia | Destinatarios consentidos para una comunicación. | Snapshot/versionada al ejecutar. | `VIP con opt-in`. |

### Contrato de filtros

- quick filters para los 3–5 criterios frecuentes;
- advanced filters para combinaciones;
- grupo `AND` dentro de un bloque y `OR` entre bloques sólo si la UI lo explica;
- operadores legibles: es, no es, contiene, vacío, entre, antes/después;
- filtros activos visibles y removibles;
- `Limpiar` restaura una vista conocida;
- count se actualiza o declara que es estimado;
- valores posibles vienen de autoridad tenant-safe;
- URL compartible no contiene PII o secretos.

### Contrato de vistas guardadas

Una vista guarda:

- recurso y layout (`table`, `board`, `split`);
- filtros y búsqueda estructurada;
- columnas, orden, ancho/densidad cuando valga;
- agrupación y orden;
- alcance: privada, equipo/rol u organización;
- dueño, versión, favorita/pinned y default;
- definición de permisos para editar/compartir.

Las vistas de sistema no se pueden romper; se duplican para personalizar. Una
vista compartida no concede acceso a datos que el usuario no podía leer.

### Contrato de segmentos y audiencias

- nombre, descripción, propósito y owner;
- reglas visibles y población estimada;
- inclusión/exclusión manual auditada;
- preview de miembros y explicación “por qué está incluido”;
- consentimiento/canal antes de convertir en audiencia;
- snapshot al ejecutar una campaña para poder auditarla;
- exclusión de unsubscribed/bounced/deleted en servidor.

## 8. Tablas, selección y acciones masivas

### Tabla canónica

- primera columna fija para identidad/selección;
- encabezados breves, orden accesible y unidad en label/valor;
- números tabulares, moneda y fecha coherentes;
- estado como badge textual;
- acciones de fila en menú, con primaria directa sólo si es muy frecuente;
- hover no es la única forma de descubrir acciones;
- columnas opcionales configurables, esenciales protegidas;
- sticky header sólo con scroll interno deliberado;
- virtualización sólo después de perfilar; no elimina semántica o accesibilidad;
- exportación conserva permisos, filtros, moneda y zona horaria.

### Selección

Debe diferenciar:

1. filas visibles seleccionadas;
2. página completa;
3. todos los resultados del filtro;
4. exclusiones manuales sobre selección global.

La barra masiva declara `N seleccionados` y, si corresponde, `todos los N
resultados`, impacto y acciones posibles. Operaciones largas son jobs
idempotentes con progreso, resultado parcial, retry y archivo de errores.

### Mobile

- tabla simple de 2–3 columnas puede conservarse;
- tabla operativa pasa a filas/cards rotuladas;
- filtro abre sheet fullscreen;
- acciones frecuentes quedan accesibles sin hover;
- selección masiva sólo si el caso de uso móvil es real;
- scroll horizontal se acepta sólo para comparaciones donde cambiar el layout
  destruye el significado, con pista visual y primera columna fija.

## 9. Estados completos y recuperación

Cada arquetipo documenta y prueba los estados que apliquen:

| Estado | Debe mostrar | Acción |
|---|---|---|
| Initial loading | Estructura estable, no spinner suelto. | Esperar/cancelar si es largo. |
| Refreshing | Datos actuales + señal no bloqueante. | Seguir operando cuando sea seguro. |
| Empty-first-use | Valor y primer paso. | Crear/importar/conectar. |
| Empty-filtered | Filtros responsables. | Limpiar/editar filtros. |
| Error recoverable | Qué falló sin inventar causa. | Reintentar o cambiar dato. |
| Permission | Capacidad faltante y owner posible. | Solicitar acceso si existe flujo. |
| Offline | Última sincronización y límites. | Reintentar/usar cola permitida. |
| Stale | Fecha de frescura y posible impacto. | Actualizar. |
| Partial | Cobertura y parte no confiable. | Completar/revisar. |
| Conflict | Cambio concurrente y diferencias. | Recargar/combinar/reintentar. |
| Rate limited | Ventana/retry seguro. | Esperar sin duplicar. |
| Success | Objeto, resultado y próximo paso. | Ver detalle/deshacer si es seguro. |

Nunca convertir error de red, RLS o tabla inexistente en `[]`. Vacío y falla
son estados opuestos.

## 10. Navegación, búsqueda y command layer

- navegación principal por productos/trabajos, no por tablas internas;
- grupos estables y activos inequívocos;
- organización/tienda/sucursal siempre distinguibles;
- deep links para registros y vistas;
- historial Back/Forward conserva query y selección;
- búsqueda global por nombre, email, SKU, orden, documento e ID según permiso;
- resultados agrupados por tipo, con contexto y acción;
- operadores avanzados se descubren de forma progresiva;
- command palette prioriza navegar, crear y ejecutar comandos seguros;
- comandos sensibles abren confirmación y nunca evitan autorización server-side;
- recientes y favoritos son personales, no una fuente de verdad.

📌 El patrón Stripe Workbench inspira un futuro `Operation Inspector` para
correlation IDs, webhooks, pagos, cron e integraciones. No se implementa como
consola de datos crudos ni permite secretos desde el navegador.

## 11. Responsive, accesibilidad e internacionalización

### Viewports de aceptación

- 360 px: teléfono mínimo;
- 768 px: tablet/ventana compacta;
- 1024 px: laptop pequeña;
- 1440 px: escritorio de referencia;
- zoom 200% y texto aumentado sin pérdida de tarea.

Mobile decide qué queda simultáneo y qué pasa a ruta/sheet. No oculta estado,
totales, CTA ni recuperación.

### Accesibilidad

Objetivo: WCAG 2.2 AA. La [recomendación oficial de W3C](https://www.w3.org/TR/WCAG22/)
es la autoridad; no un score aislado.

- HTML semántico antes que roles;
- label/nombre/description en cada control;
- orden de foco y lectura coherente;
- teclado completo y foco visible;
- focus trap y retorno en overlays;
- mensajes de error asociados a campos y resumen en formularios largos;
- live regions para progreso/resultado pertinente;
- contraste de texto, controles, foco y estados;
- targets táctiles suficientes;
- color nunca como única señal;
- `prefers-reduced-motion`;
- alternativa a drag, canvas y gráficos;
- tablas con encabezados y captions/contexto;
- idioma, moneda, fecha, zona horaria y pluralización explícitos.

[Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/accessibility)
resuelve semántica, teclado y foco de muchos patrones, pero la app sigue siendo
responsable de labels, copy, composición y pruebas. Playwright recomienda
combinar [`@axe-core/playwright`](https://playwright.dev/docs/accessibility-testing)
con evaluación manual y pruebas inclusivas: axe no certifica por sí solo.

## 12. Rendimiento y resiliencia perceptual

Presupuestos de experiencia, no promesas sin medición:

- respuesta visual inmediata en click/tap/tecla;
- medir INP en campo; [INP](https://web.dev/articles/inp) observa la latencia de
  las interacciones a lo largo de la visita;
- skeleton con dimensiones estables para evitar layout shift;
- route chunks recuperables entre deploys;
- imágenes responsivas, comprimidas y con tamaño declarado;
- no bloquear interacción por cálculos que pueden ir a worker/servidor;
- paginación server-side para datasets grandes;
- prefetch sólo de rutas/datos probables y tenant-safe;
- optimistic update sólo si rollback y conflicto están resueltos;
- offline únicamente con contrato de autoridad, idempotencia y reconciliación;
- observabilidad de error, latencia y correlation id sin PII sensible.

Antes de virtualizar, cachear o agregar un worker se obtiene un perfil. Una
optimización sin baseline es una hipótesis.

## 13. Lineamiento tecnológico

### Base aprobada al 2026-08-22

📌 Se conserva el stack actual: React 18, TypeScript, Vite, Tailwind y
primitives locales sobre Radix; TanStack Query para estado de servidor;
React Hook Form + Zod para formularios; Vitest para lógica; Playwright para
flujos; Sentry para observabilidad; Recharts para visualizaciones y
React Virtuoso sólo donde el volumen lo justifica.

Razones:

- [Radix](https://www.radix-ui.com/primitives/docs/overview/introduction) permite
  adopción incremental, control visual y patrones accesibles;
- [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview)
  separa cache/sincronización de server state del estado local;
- el stack ya tiene inversión, cobertura y reglas de seguridad; una reescritura
  no prueba activación, margen ni Finance.

### Radar

| Estado | Tecnología/capacidad | Regla |
|---|---|---|
| Mantener | Radix + components locales | Extender primitive común; actualizar paquetes Radix coordinadamente. |
| Mantener | TanStack Query | Query keys tenant-aware, errores explícitos e invalidación tras autoridad server-side. |
| Mantener | RHF + Zod | Esquema UX no reemplaza validación/RPC de servidor. |
| Mantener | Vitest + Playwright | Cálculos puros en Vitest; tareas e integración en Playwright. |
| Mantener | Recharts | Sólo gráficos con pregunta, tabla alternativa y drill-down. |
| Medir | React Virtuoso | Activar tras perfil; preservar teclado/semántica/selección. |
| Pilotear | [TanStack Table](https://tanstack.com/table/latest/docs/overview) | Prototipo en un índice complejo; adoptar si reduce estado duplicado sin romper diseño, URL o server-side query. |
| Pilotear | `@axe-core/playwright` | Slice D6 con baseline, allowlist temporal explicada y auditoría manual. |
| Pilotear | Screenshot assertions de Playwright | Primero 6–10 vistas críticas deterministas; no 100 snapshots frágiles. |
| Evaluar por flujo | State machine explícita | Sólo checkout, aprobación u offline con transiciones/guards complejos; no globalizar. |
| Evitar ahora | Rewrite a otro framework/meta-framework | Sin evidencia de que resuelva el gate comercial actual. |
| Evitar ahora | Microfrontends | Tres superficies no justifican duplicar runtime, auth y design system. |
| Evitar ahora | GraphQL sobre Supabase por moda | Agrega capa sin eliminar la autoridad/RLS existente. |
| Evitar ahora | Data grid visual cerrado | Sólo si un benchmark demuestra que headless + primitives no cubre necesidad real. |
| Evitar ahora | Animación o state library transversal | No instalar antes de un problema medido y un owner. |
| Evitar ahora | Storybook como fin | Usar fixtures/galería de estados; instalarlo sólo si mejora revisión y mantenimiento medidos. |

### Puerta para una dependencia nueva

No basta con “la usan grandes empresas”. La propuesta incluye:

1. problema y usuarios;
2. capacidad del stack actual y gap demostrado;
3. alternativas: propia, paquete existente y no hacer;
4. seguridad, tenancy, privacidad, licencia y supply chain;
5. accesibilidad y comportamiento mobile;
6. peso, runtime, tree-shaking y browser support;
7. mantenimiento, releases, comunidad y bus factor;
8. compatibilidad con React/Vite/TypeScript y estrategia de migración;
9. spike pequeño con benchmark real;
10. costo de salida y rollback;
11. test, observabilidad y owner;
12. actualización de roadmap/ADR.

Puntaje de decisión sobre 100:

| Criterio | Peso |
|---|---:|
| Valor/tarea del usuario | 25 |
| Seguridad, autoridad y confiabilidad | 20 |
| Accesibilidad | 15 |
| Performance y bundle | 15 |
| Mantenibilidad y salida | 10 |
| Encaje con arquitectura | 10 |
| Licencia/costo/proveedor | 5 |

Umbral: 80/100, cero bloqueo de seguridad/accesibilidad y prototype verde. Una
decisión reversible puede pilotearse; una irreversible exige ADR y migración.

## 14. Cobertura mínima por producto

Esta matriz evita declarar “rediseño completo” porque el happy path se ve bien.

| Producto/superficie | Pantallas y flujos mínimos |
|---|---|
| Adquisición/Auth | Landing, pricing/plan cuando exista, login, registro, recovery, verificación, invitación, MFA, sesión expirada, legales. |
| Business Home | Resumen, vista por tarea, periodo/sucursal/canal, alertas, drill-down, configuración vacía y dato parcial. |
| Productos | Índice, vistas/filtros, alta/edición, variantes, imágenes, precios/costos/impuestos, publicación/canales, importación, bulk, historial. |
| Inventario | Stock por ubicación, Kardex, conteo, ajuste con motivo, transferencia, recepción, mínimos, negativos y conflictos. |
| Compras | Proveedores, orden, recepción parcial, costo aterrizado, deuda, documento vinculado, devolución/cancelación. |
| Ventas/órdenes | Índice, detalle, cobro/split, envío, factura, margen explicado, devolución, cancelación, comunicación y auditoría. |
| POS/caja | Apertura, venta, cliente, cobro, comprobante, devolución, cierre, offline, retry y reconciliación. |
| CRM | Índice, vista guardada, segmentos, ficha 360, timeline, notas/tareas, campañas consentidas, import/export y duplicados. |
| Finance | Overview, Document Inbox, original, inspección, extracción, revisión, match, drafts, payables, approvals, pagos, conciliación y audit trail. |
| Commerce admin | Tiendas, catálogo/publicación, navegación/contenido, descuentos, envío, pagos, dominio, analítica, pedidos y readiness. |
| Storefront | Home, PLP, búsqueda/filtro, PDP, carrito, checkout, pago, resultado, tracking, devolución, legales y contacto. |
| Integraciones | Catálogo, connect/OAuth, estado, permisos, scopes, sync, logs sanitizados, retry, disconnect y consecuencias. |
| Intelligence / Orbit | Hallazgo, explicación, evidencia, simulación, policy, aprobación, ejecución, resultado, reversión, playbook versionado, runs, excepciones y AI Action Rate. |
| Platform | Dashboard, merchants, Merchant 360, activation, support, health, queues, Finance access, billing/economics, flags, announcements y audit. |
| Perfil/Settings | Organización, miembros/roles, sucursales, fiscal/legal, seguridad/MFA, notificaciones, import/export y eliminación/retención. |
| Estados públicos | Invitación, pago, tracking, consentimiento, arrepentimiento, privacidad, términos, 404/403/500 y mantenimiento. |

Para cada fila se prueban happy, loading, empty, filtered-empty, error,
permission, offline/stale/partial cuando aplique, claro/oscuro y cuatro
viewports. El inventario se actualiza si nace una superficie; no se elimina una
fila para hacer que el porcentaje mejore.

## 15. Copy, confianza y lenguaje financiero

- nombrar tareas con verbos y objetos reales;
- decir qué pasó, sobre qué objeto y qué sigue;
- fechas absolutas junto a relativas cuando hay riesgo;
- moneda y zona horaria explícitas;
- `0`, `sin datos`, `no calculado` y `sin permiso` nunca son intercambiables;
- un porcentaje muestra denominador y periodo;
- margen muestra componentes, fuente, cobertura y tratamiento impositivo;
- IA declara evidencia, confianza, límites y si la acción fue simulada;
- confirmaciones no usan “Sí/No” cuando pueden usar `Aprobar factura` /
  `Cancelar`;
- un bloqueo externo dice quién puede resolverlo y cómo;
- no prometer ahorro, exactitud o cumplimiento sin evidencia.

## 16. Seguridad, permisos y acciones sensibles

La UI explica autoridad pero no la reemplaza.

- permisos server-side para lectura y mutación;
- tenant/org/store/location en toda query relevante;
- MFA en Platform;
- secretos sólo por Edge y nunca de vuelta al navegador;
- botones ocultos/deshabilitados coherentes con capacidad, sin filtrar datos;
- acciones sensibles con motivo, before/after, actor, timestamp y correlation id;
- soporte consentido y temporal, sin impersonación silenciosa;
- exports, búsqueda y vistas respetan RLS;
- datos de demo sintéticos o sanitizados;
- no analytics con PII innecesaria;
- no clipboard/log/error con tokens o documentos privados.

## 17. Protocolo competitivo por slice

Antes de diseñar:

1. ubicar fase y pilar;
2. nombrar usuario, trabajo, riesgo y métrica;
3. auditar implementación actual y Business Core;
4. estudiar 2–3 referentes: al menos una fuente funcional oficial y una visual
   cuando cambie composición;
5. registrar `✅/👁/📌/❓`;
6. extraer principios, no pixels;
7. inventariar ruta, estados, overlays, responsive, permisos y datos;
8. decidir tecnología con la puerta de §13;
9. prototipar el flujo más riesgoso con datos límite;
10. definir pruebas y condición de salida.

Durante:

1. primitive primero, página después;
2. autoridad server-side y errores honestos;
3. fixtures de datos largos, cero, parcial, conflicto y permiso;
4. desktop y mobile en paralelo;
5. telemetría del trabajo, no clicks de vanidad;
6. slice pequeño, gate completo, roadmap, commit y push.

Después:

1. tarea end-to-end en localhost/base real según contrato;
2. teclado, axe/manual, zoom y viewports;
3. error/red lenta/offline/stale build cuando aplique;
4. evidencia visual reproducible;
5. métrica real o `pendiente`, nunca inferida;
6. actualizar ROADMAP, DESIGNROADMAP, este estándar si cambió el patrón y ADR
   si cambió arquitectura;
7. fecha y fuente al actualizar una comparación.

## 18. Definition of Ready y Definition of Done

### Ready

- fase autorizada;
- no duplica un item existente;
- usuario/trabajo/resultado/métrica;
- autoridad de datos y trigger revisados;
- comparativa vigente;
- mapa de pantallas/estados/overlays;
- riesgo legal, privacidad, accesibilidad y soporte;
- decisión build/buy/keep con salida;
- criterio de aceptación verificable.

### Done técnico

- happy y estados aplicables;
- responsive 360/768/1024/1440;
- claro/oscuro y sin branding de tenant en SaaS;
- teclado, foco, labels y contraste;
- permisos y errores reales;
- idempotencia/auditoría para mutaciones críticas;
- tests de cálculo/contrato/E2E proporcionales;
- typecheck, Edge check, lint, tests y build verdes;
- documentación/roadmaps actualizados;
- commit y push independiente.

### Done de producto

Además de lo técnico:

- una persona objetivo completa la tarea con datos reales;
- tiempo, error, recuperación y abandono medidos;
- no aumenta soporte ni correcciones manuales;
- la métrica de negocio se mueve o la hipótesis se rechaza;
- evidencia apta para demo/inversión sin esconder limitaciones.

`Implementado`, `validado` y `adoptado` son estados distintos.

## 19. Evidencia para usuarios e inversores

Una app atractiva abre la conversación; una operación demostrable sostiene la
inversión. Cada narrativa debe unir:

~~~text
problema real
→ flujo visible
→ autoridad y resiliencia
→ adopción medida
→ resultado económico
→ capacidad de repetición
~~~

La investor room puede mostrar:

- video/captura reproducible de primera venta y margen explicado;
- Finance desde documento hasta borrador/aprobación sin efectos ocultos;
- Merchant 360 y resolución de una excepción;
- cohortes de activación, ATM, retención y AI Action Rate con fecha;
- SLO, restore drill, incidentes y recuperación;
- arquitectura multi-tenant y permisos;
- comparativa con fuentes y límites.

No muestra conteos de features como tracción, datos reales sensibles, métricas
sin denominador ni mocks presentados como producción.

## 20. Antipatrones bloqueados

- copiar Figma frame por frame;
- instalar una librería porque “es la mejor” sin benchmark;
- reescribir stack estable antes de cerrar gates comerciales;
- dashboards infinitos;
- cards anidadas como layout;
- modales para workflows largos;
- drawer como depósito de complejidad;
- filtros invisibles o sin URL cuando deben compartirse;
- llamar segmento a cualquier filtro;
- Kanban sin transición de dominio;
- acciones masivas cuyo alcance no se entiende;
- tablas desktop encogidas en mobile;
- estados dependientes sólo del color;
- skeleton que no coincide con la estructura;
- `?? []` ante errores;
- optimistic UI en dinero/stock sin rollback y autoridad;
- IA sin evidencia, acción ni medición;
- demo que necesita SQL manual o datos inventados;
- declarar “rediseño completo” sin states, mobile y prueba de tarea.

## 21. Cadencia de mantenimiento

- Revisar referencias críticas antes de cada fase y como mínimo trimestralmente.
- Registrar fecha, URL oficial, cambio observado e impacto.
- Mantener `docs/COMPARACION.md` para capacidades y este documento para
  patrones de producto/experiencia.
- `docs/INTERFAZ.md` conserva tokens y composición vigente.
- `DESIGNROADMAP.md` convierte brechas visuales en slices.
- `ROADMAP.md` decide si una brecha merece prioridad de producto.
- Si evidencia nueva contradice una decisión, se corrige la decisión y se deja
  razón; no se conserva por orgullo o costo hundido.

La vara final es simple: Gestiona debe permitir que un comercio opere mejor y
que la plataforma escale con menos intervención, mientras cada número, permiso
y efecto conserva una autoridad comprobable.
