# Nerqia — roadmap de diseño

**Corte:** 2026-10-08. Este documento define la dirección visual y los próximos
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

- canvas claro (piedra fría, no crema genérica) y superficies blancas;
- cobalto Nerqia `#173aef` para foco y acción primaria; teal, verde, ámbar y
  coral sólo para significado;
- radios de 8 px; cards anidadas y orbes/gradientes decorativos prohibidos;
- **Syne** en titulares; **IBM Plex Sans** en interfaz; **IBM Plex Mono** en
  números y metadatos (sin Inter ni Space Grotesk);
- íconos Lucide; botones con texto claro;
- títulos compactos en workspaces; escala hero sólo en landing;
- tablas/colas densas, comparables y responsivas;
- 40–44 px mínimos para acciones táctiles;
- Clientes es cartera de compradores del Commerce OS — no un CRM genérico con
  kit violeta;
- movimiento breve y funcional, respetando `prefers-reduced-motion`.

## 3. Anatomía compartida

Profit Foundation (2026-10-02) vive como Rentabilidad en Analytics, con alias
`/profit`; sin otra pantalla ni KPI heredados. Población completa y detalle
paginado, contribución total/medida separadas, fuente y cobertura, modo por org,
período/tienda/canal/modo en URL, error recuperable y refresh sin vaciar la lectura.
Tres modos: producto, SKU y operación; filtros/tablist siguen montados durante
carga/error y las opciones retiradas no muestran UUID ni eligen otra tienda.
SKU actual se distingue de los costos históricos; duplicados conservan identidad.
Producto/SKU/canal y operación compactos en móvil; expandir conserva columnas legibles. Verificación
sintética con teclado/Axe y capturas en 360/390/768/1024/1280/1440 px; no prueba
adopción ni operación financiera externa.

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
| Landing | Tienda online como señal principal; Gestión y Finance continúan el mismo pedido. | Publicada/responsive; ambas homes visibles en Google el 2026-10-04 y routing XML corregido/verificado en producción, sin cambiar la interfaz humana. | Cobertura actual en Search Console; conversión real. [Evidencia](docs/SEO_INDEXACION.md). |
| Business | Workspace claro, rail persistente, topbar, tabs y tablas densas. | Shell y primitives transversales; páginas críticas migradas. | Eliminar CSS heredado y cerrar estados restantes. |
| Commerce admin | Configuración, rendimiento, voz, catálogo, páginas, diseño, pagos/envíos. | Selector de tienda compartido con Pedidos; datos reales en producción. | Surtido multi-tienda y responsive autenticado. |
| Storefront | Marca del comercio, catálogo mobile-first y checkout confiable. | Tema/favicon, SPA/restauración y retry sin perder carrito; búsqueda coherente, aproximados rotulados y filtros; combobox con foco/IDs únicos/touch 44 px y links nombrados. PR19 `6644f613` READY, 27 coincidencias reales; texto conservado al repetir Enter (2026-10-08). | Performance de campo y compradores. |
| Acceso y correo | Identidad Nerqia clara en el alta y seguridad sin jerga del proveedor. | Confirmación propia publicada en Auth; gate con enrolamiento, opt-in «Recordar este navegador durante 7 días» y recuperación TOTP; dispositivos revocables con vencimiento; proxy probado sin pedir secretos al browser. | Preview/release y circuito browser tras configurar secreto server-side; remitente Auth SMTP, entrega real y enforcement MFA transversal. |
| Finance | Trabajo de gasto, documentos y aprobación; no espejo de Business. | Layout/entitlement e Inbox técnico. | Primer documento real y políticas preventivas. |
| Platform | Control plane violeta, colas y Merchant 360. | Shell, MFA, áreas operativas; Mensajería separa diagnóstico de staff, acción del comercio y copy del comprador, con alertas persistentes en campañas/SMTP/equipo. | Completar matriz visual autenticada y estados reales de webhook/Auth SMTP. |

Facturación manual mantiene la gramática Business: selector de IVA por renglón,
predeterminado que sólo actualiza líneas no personalizadas y resumen agrupado
por alícuota antes del total. En C se muestra cero; sin identidad fiscal se
muestra un borrador no fiscal, evitando controles que prometan emisión ARCA.
La conexión fiscal conserva el último diagnóstico sólo para la configuración
que se probó; si cambia durante la espera, pide revisar y reintentar en vez de
mostrar un éxito obsoleto.
La credencial fiscal de Platform acepta CRT + KEY o PEM pegado, aclara que el
CSR va a ARCA, valida el par y muestra vencimiento/huella sin devolver secretos.
La guía separa delegación/solicitud del comercio y aceptación/computador por Nerqia.
Los cortes de septiembre comprobaron 93 contextos de ruta y 70 escenarios
públicos responsive; corrigieron títulos, `NaNd`, ceros transitorios y onboarding.
Proveedores/Pagos tienen tabla, filtros y recuperación; pagos simples/masivos
conservan intento, progreso y mensajes sanitizados sin duplicar ante retries.
Alcance y gates en [Auditoría funcional](docs/AUDITORIA_FUNCIONAL.md).

Pedidos conserva su cola; Tienda sólo publicación, catálogo visible, contenido,
diseño, pagos/envíos. El gate no reconstruye páginas duplicadas retiradas.

El editor de automatizaciones suma una prueba segura visible: distingue probar
de ejecutar, presenta impacto y ejemplos en un modal legible, explica qué no se
modificó y mantiene los flujos nuevos pausados hasta la activación consciente.
La ejecución comunica por separado éxito, ausencia de acciones y fallo real.

POS conserva buscador detrás del prompt opcional de vendedor; el gate distingue
la superposición del error. Carrito móvil con cierre accesible en encabezado y
categorías nombradas; matriz independiente de rubro/sucursal en 360/768/1024/
1092/1280/1440 px. CI conserva captura/trace de fallos siete días.
El acceso autenticado conserva el loader durante una recuperación transitoria
acotada de PostgREST y sólo después muestra la pantalla de recuperación. La
sesión abierta no se presenta como logout, aprobación pendiente ni ausencia de
organización ni reconstruye autoridad desde preferencias del navegador. El gate
de Platform sólo abandona ese estado tras agotar el presupuesto y reintentar.
El newsletter confirma una solicitud sin revelar si ese email existía o fue baja.
Los filtros globales de fecha conservan la misma selección en URL y ahora
refrescan todas las métricas dependientes con un único criterio civil inclusivo.
El período que se ve en el control es exactamente el período de las tarjetas,
tablas y gráficos, también para fechas sin hora y zona argentina.

El Select compartido muestra nombres desde la primera carga, no IDs ni códigos.
Las etiquetas compuestas y las opciones asíncronas conservan el valor original;
una selección ausente se declara no disponible, sin elegir otra automáticamente.
Etiquetas opacas usan `textValue`. El menú conserva un descendiente activo válido,
admite nombres largos sin overflow y consume Escape antes del modal padre.
Los modales mantienen una columna con mínimo cero para no recortar el formulario.
Equipo y Platform reutilizan los mismos nombres de roles, sin modificar permisos.

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

POS, corte 2026-10-08: revisión QR explica el motivo y permite consultar el mismo
cobro; no invita a cambiar el medio y duplicar dinero. Preferencia de impresión
como switch accesible por usuario/dispositivo, ticket persistido y reimpresión
del cobro recuperado. Solicitud fiscal durable distingue pendiente/CAE y corrección; vendedor sin link administrativo.
Sin gradiente decorativo; dieciséis E2E POS verdes (red interceptada). Checkout: colores atómicos al cotizar, sin contraste transitorio.
[Replay completo 08/10](docs/MIGRATION_REPLAY.md) aprobado; PR18 `4fcd814a` READY y QR v16 productivo. Autoridad/impresión reales pendientes.
La matriz funcional y el orden de cierre viven en [POS](docs/POS_OPERACION.md).

1. Auditar páginas que todavía usan cards largas o tabs locales no persistidas.
2. Converger filtros, columnas, bulk y detalle en índices de alto uso.
3. Retirar estilos heredados únicamente después de screenshots de regresión.
4. Medir tiempo a venta, producto, cliente y ajuste de stock.
5. Ficha de producto: búsqueda de imagen en diálogo compacto con miniaturas,
   creador/licencia/fuente, selección explícita y carga manual siempre visible;
   siguiente cierre: cola bulk con revisión por excepción.

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
4. Soporte usa inbox + conversación responsive, estado, prioridad, responsable y no leídos; el comercio comparte el mismo hilo sin ver herramientas de staff.

### D5 — Resiliencia transversal

1. WCAG 2.2 AA, teclado, foco y lector.
2. 360/390/768/1024/1280×720/1440 sin overflow ni solapamientos.
3. Identidad: panel y tienda comparten alta, acceso, “me olvidé”, recuperación,
   política de clave, estados válidos/expirados y lenguaje de cliente; ningún
   mensaje nombra proveedor, configuración interna o documentación del equipo.
4. INP/LCP/CLS de campo, presupuesto de assets y lazy boundaries. Productos,
   Analytics, Finance y comisiones de Platform deben ofrecer estado útil durante
   sus consultas largas, nunca un canvas vacío ni un cero provisional. Dashboard
   limita cada fuente inicial a 20 s y transforma el bloqueo en recuperación
   explícita, conservando datos previos durante refresh.
5. Navegación sin recarga y actualización PWA manual segura.
6. Contraste y textos reales; shell nativo con jerarquía web, safe areas, teclado, permisos contextuales y retorno externo, sin chrome WebView ni rutas duplicadas. El scanner móvil abre la cámara del sistema sólo al solicitarlo, explica el permiso y conserva carga manual.

### D6 — Paridad operacional, no clonación

1. Commerce: recorrer home, colección, búsqueda/filtros, producto/variantes,
   carrito, checkout, seguimiento, cuenta y devolución en ambos temas y móvil;
   cada pantalla necesita error/recuperación, datos propios y cierre del trabajo.
2. Profit/Escalafy: una vista de contribución con cobertura y fuentes; después
   campaña/cohorte/Ads. No mostrar ROAS ni utilidad neta cuando faltan hechos.
3. Creators/GoMarz: brief, selección, colaboración, revisión/versiones, derechos,
   publicación y liquidación en sus rutas existentes. La marca y el creador ven
   únicamente sus acciones/datos; ningún estado de seguimiento simula un payout.

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

Actualizar sólo ante cambios de dirección, superficie o prioridad; Git conserva la evidencia histórica.
