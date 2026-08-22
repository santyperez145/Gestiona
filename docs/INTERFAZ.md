# Gestiona — sistema de interfaz

**Corte:** 2026-08-22

Este documento fija la dirección visual de Gestiona. El producto se inspira en
los patrones de CRM, marketplace y admin panel de las referencias compartidas,
pero no copia componentes, textos ni assets de terceros.

La secuencia completa, cobertura por superficie, métricas y slices ejecutables
viven en [`DESIGNROADMAP.md`](../DESIGNROADMAP.md). `INTERFAZ.md` conserva el
contrato del sistema; el roadmap visual registra la ejecución y la evidencia.

## Dirección

Gestiona es una herramienta operativa que se usa muchas horas seguidas. La
interfaz debe ayudar a escanear, comparar y ejecutar, no competir con los datos.

- Rail lateral estable para identidad y navegación; claro en Business y
  violeta en Platform para distinguir las dos superficies.
- Superficie de trabajo clara, con fondo neutro y contenido agrupado.
- Una acción primaria por contexto; las secundarias viven en menú o toolbar.
- Tablas densas, números alineados y estados expresados con color + texto.
- Tarjetas de profundidad baja; el borde y el espaciado hacen la jerarquía.
- Radio estándar de 8 a 12 px; no usar tarjetas anidadas como layout.
- Tabs o subnavegación cuando una pantalla supera una lectura razonable.
- Mobile conserva las acciones críticas, filtros y estado; no reduce todo a
  una versión ilegible de la tabla desktop.

### Sistema visual obligatorio v3

La implementación actual toma como dirección obligatoria los patrones de
CRM, eMarketplace, Gestão de Marketplace, SaaS marketplace y Neomart
compartidos por el dueño: canvas claro, superficies blancas, rail persistente,
jerarquía compacta, active states muy visibles y acentos de color para separar
operación, salud e inteligencia.

- Primary del workspace claro: violeta `252 83% 62%`.
- Superficie: fondo casi blanco `228 28% 97%`, tarjetas blancas y bordes fríos
  de bajo contraste.
- Secundarios: turquesa para salud/finanzas y coral para acciones de atención;
  el color siempre acompaña texto y estado.
- Profundidad: sombras cortas y suaves, radios de 8–12 px, sin tarjetas
  anidadas para construir el layout.
- Navegación: rail de organización y rail violeta de plataforma; topbar con
  identidad del workspace, breadcrumb, búsqueda global, estado de conexión y
  acción primaria. Los encabezados llevan una guía de acento, las métricas
  declaran su tono con icono/estado y los tabs usan una superficie segmentada
  con una activa inequívoca.

El modo oscuro sigue disponible mediante el toggle, pero el modo claro es la
experiencia por defecto y la referencia que debe validarse visualmente en cada
slice nuevo.

### Límite de personalización

El workspace de Gestión tiene una identidad única y predecible. Los colores
elegidos por cada comercio no pueden reescribir `--background`, `--primary`, el
rail ni ningún otro token global de Business, Finance o Platform: además de
romper el modo claro, eso vuelve irreconocible el producto y hace imposible
garantizar contraste entre tenants.

- Nombre y logo identifican a la organización dentro del chrome compartido.
- Fondo, cards y acento configurables pertenecen únicamente a la tienda pública
  y al catálogo PDF.
- Business usa el violeta oficial, Finance conserva su acento teal y Platform
  su chrome diferenciado; el toggle claro/oscuro es la única variante cromática
  del backoffice.
- Las paletas históricas con `primary`/`secondary` se pueden leer por
  compatibilidad, pero Gestión no las aplica ni vuelve a escribirlas.

## Superficies

| Superficie | Navegación | Acento | Objetivo |
|---|---|---|---|
| Business | Rail + vistas internas | Violeta | Operar productos, stock, ventas y clientes. |
| Finance | Rail propio claro/oscuro + documentos | Teal | Revisar evidencia y aprobar decisiones. |
| Platform | Topbar de identidad + rail de control plane | Violeta | Operar merchants, salud, riesgo y soporte sin confundirse con un tenant. |
| Storefront | Navegación de tienda | Configurable | Comprar sin ver el backoffice. |

La landing y Auth son superficies públicas de adquisición y acceso: tienen una
dirección editorial propia, pero comparten tipografía, escala de radios,
contraste y acento con el producto. La landing debe mostrar el producto real en
la primera pantalla; Auth debe hacer evidente si la persona va a iniciar sesión
o crear un workspace.

El color de acento no reemplaza al estado. Error, advertencia, éxito y dato
pendiente deben conservar una etiqueta legible y no depender sólo del color.

## Estructura de una vista

1. Contexto: superficie, organización y estado de conectividad.
2. Título: una frase corta que nombre el trabajo de la vista.
3. Toolbar: búsqueda, filtros persistentes y una acción primaria.
4. Navegación interna: tabs o sidebar si hay más de un trabajo relacionado. En
   Settings, las seis secciones permanecen en la misma vista y recuerdan la
   última sección por organización; en Platform, el rail separa el control plane
   del workspace de cada comercio.
5. Contenido: primero la decisión o el dato operativo; después el detalle.
6. Estado: carga, vacío, permiso, error y datos desactualizados explícitos.

## CRM command center implementado

La referencia anterior de CRM quedó descartada como dirección principal el
2026-08-22: resolvía navegación y detalle, pero era demasiado minimalista para
la densidad operativa de Gestiona y el resultado se confundía con la interfaz
anterior. La nueva composición combina dos referencias verificadas en su
preview público:

- [Aerten Web App](https://www.figma.com/community/file/1252610051102275471/aerten-web-app)
  aporta el patrón de gestión completo: rail, encabezado, tabs, búsqueda,
  filtros, tabla densa, estados y acción primaria.
- [eMarketplace Admin Dashboard](https://www.figma.com/design/ojLD3JQrTWpUzCRFnS4WXC/eMarketplace-%F0%9F%9B%8D%EF%B8%8F-%7C-Admin-Dashboard--Community-)
  aporta el violeta protagonista, las superficies claras y las tarjetas
  tintadas que hacen distinguibles salud, recurrencia y atención.

Gestiona traduce esos patrones al trabajo real del comercio: la lista sigue
siendo el centro, los segmentos funcionan como navegación rápida y la ficha
seleccionada conserva el contexto mientras se ejecutan acciones, se revisan
compras o se programa seguimiento.

- `Clientes` y `Insights` son tabs internos persistidos por organización.
- El command center muestra cartera total, actividad a 30 días, recurrencia y
  clientes que requieren atención antes de entrar al detalle.
- `Clientes` usa un rail de segmentos, toolbar de búsqueda/filtros y selección
  contextual de la ficha 360; en desktop la cartera es una tabla operativa con
  relación, compras, facturación, ticket y salud visibles en la misma lectura.
- `Insights` concentra KPI, top de clientes, segmentación, riesgo y RFM para
  que la lista no se convierta en una página interminable.
- En mobile el rail se convierte en una fila horizontal navegable y la ficha
  mantiene una acción explícita para cerrarse; las columnas pasan a campos
  rotulados y no a una tabla comprimida.

Este slice usa datos, permisos, exportaciones, notas, comunicaciones, cuotas y
acciones existentes; el rediseño no crea un segundo modelo de clientes. El
criterio competitivo es conservar la ficha 360 y el margen por cliente que ya
existen en Gestiona, pero llevarlos a la velocidad de lectura de un CRM maduro.

| Referencia | Patrón observado | Traducción en Gestiona |
|---|---|---|
| Aerten | Gestión de registros con tabla, filtros, tabs, roles/estado y CTA. | Cartera densa con estado comercial, métricas y ficha 360. |
| eMarketplace Admin | Violeta fuerte, canvas claro y tarjetas de señal diferenciadas. | Command center de cuatro señales con tonos violeta, mint, sky y coral. |
| CRM anterior | Lista, segmentos y detalle contextual con baja densidad. | Se conservan navegación y contexto; deja de definir la composición visual. |

## Contrato transversal admin / marketplace

El patrón de navegación interna se extiende a las superficies operativas que
comparten el lenguaje de los kits de admin y marketplace: una barra compacta de
vistas, una sola tarea por vista, contadores de contexto y estado persistido por
organización. `WorkspaceViewTabs` es el primitive común para este contrato.

- **Productos** separa `Catálogo` de `Operación`: la lista, filtros y acciones
  quedan enfocadas en publicar y editar; KPIs, vencimientos y antigüedad quedan
  en la vista operativa.
- **Ventas** separa `Ventas` de `Rendimiento`: la tabla y cobranza no compiten
  con KPIs, métodos de pago ni tendencia diaria.
- **Dashboard** separa `Resumen`, `Rendimiento`, `Clientes`, `Stock`, `Caja y
  finanzas` e `Inteligencia` en vistas activas persistidas por organización; no
  se presenta como una columna de widgets sin fin. Usa `WorkspaceViewTabs`
  con acento violeta, iconos, conteos reales y estado del Business Core; evita
  sumar un segundo rail al rail global del Figma CRM. Los hashes históricos
  (`#dashboard-*`) siguen abriendo la vista correspondiente y un estado viejo
  de `localStorage` nunca puede ocultar todas las vistas. El contrato traduce
  explícitamente el hash (`dashboard-sales`) a la clave visual (`sales`) y una
  guarda recorre las seis parejas: el estado y el selector CSS no pueden volver
  a divergir dejando todo el contenido con `display:none`.
- **Settings, Admin, Integraciones, Reportes y Tienda** conservan
  sus primitives de tabs/sidebar porque necesitan contenido Radix o navegación
  profunda; deben adoptar los mismos tokens de borde, densidad, foco, scroll
  horizontal móvil y persistencia por organización.
- **Platform** usa un rail de control separado, con grupos de `Workspace`,
  `Operaciones`, `Ingresos` y `Gobierno`; cada grupo se filtra por permisos de
  plataforma y mantiene el acento violeta propio del control plane.
- La navegación no duplica datos ni permisos: sólo cambia la composición de la
  vista y mantiene montadas las acciones/modales que el flujo ya utiliza.

Esta es la traducción del patrón de CRM, eMarketplace y marketplace kits a la
operación omnicanal de Gestiona: lista primero, contexto visible, detalle bajo
demanda y una ruta clara a la acción.

### Primitives y cobertura transversal

`AppLayout`, `FinanceLayout` y `PlatformLayout` envuelven cada ruta autenticada
en `workspace-route-surface`. Ese contrato evita que la renovación dependa de
que cada una de las más de cien páginas recuerde agregar una clase: una vista
heredada recibe automáticamente canvas, cards, tablas, hover y contraste del
sistema v3 mientras se migra su composición particular.

Los primitives compartidos son la unidad mínima del rediseño:

- `Button` concentra alturas, radios, foco, profundidad y acción primaria;
- `Input`, `Select` y `Textarea` usan superficie clara, borde visible y foco
  violeta común;
- `Card`, `Dialog`, `Popover` y `Tooltip` comparten borde, radio y elevación;
- `Tabs` adopta navegación segmentada, con activa inequívoca y scroll móvil;
- `Table` fija densidad, números tabulares, encabezado tintado y hover de fila;
- `Badge`, `EmptyState` y los skeletons preservan contraste y estados sin que
  cada módulo invente otro lenguaje.

El slice D2.2 eliminó los 20 `<select>` nativos que permanecían en 12 páginas de
gestión. Business, POS, Reportes, Finance y Platform usan ahora el mismo
primitive con trigger, portal, foco, teclado y contraste compartidos; una guarda
recorre `src/pages` para impedir que la inconsistencia reaparezca. Los selects
embebidos en componentes especializados y Storefront forman el siguiente slice:
en checkout mobile un control nativo sólo puede sobrevivir como excepción de
usabilidad documentada, no por olvido.

`PageHeader` es también transversal: Ajustes, Perfil, Document Inbox, resumen
de Finance y comunicaciones de Platform ya comparten ubicación, contexto,
título, descripción y acciones. Finance traduce el acento del primitive a teal
sin bifurcar el componente. POS es la excepción deliberada: ocupa el viewport
como superficie de caja y conserva búsqueda, categorías, carrito y estado del
turno siempre visibles; agregarle un hero administrativo reduciría velocidad de
cobro, pero sus controles y tokens sí pertenecen al mismo sistema.

Document Inbox expresa la cadena de confianza en la misma fila del original:
`Sin inspeccionar`, `Inspeccionando`, `Scanner pendiente`, `Listo para extraer`,
`Duplicado` o `Cuarentena`. La acción de inspeccionar aparece sólo cuando puede
progresar; un scanner ausente se muestra como bloqueo recuperable y nunca como
éxito verde. Esto traduce un estado de seguridad real, no una decoración.

Una personalización puntual puede cambiar composición o tono semántico, pero no
volver a definir estos fundamentos. El test `managementVisualContract` protege
la cobertura de las tres superficies y los tokens esenciales.

## Referencias de dirección

- [CRM app con clientes, deals y tareas](https://www.figma.com/design/y3iW4vARslK39hLDzTj37D/CRM-app-with-customers--deals--nested-data--tasks-and-menu-filtering--Community-)
- [Profile UI Kit marketplace](https://www.figma.com/design/Khvuwp0ptolMD8aHM4CHzh/Profile-UI-Kits--Free----Tbean-Marketplace-App--Community-)
- [Brand Marketplace App](https://www.figma.com/design/57ORGgL3BkPkMTNgyVNx1p/Brand-Marketplace-App---Pickolab--Community-)
- [eMarketplace Admin Dashboard](https://www.figma.com/design/ojLD3JQrTWpUzCRFnS4WXC/eMarketplace-%F0%9F%9B%8D%EF%B8%8F-%7C-Admin-Dashboard--Community-)
- [Gestão de Marketplace](https://www.figma.com/design/jDuICk6QkPLZWMNdZlooUO/Gest%C3%A3o-de-Marketplace--Community-)
- [SaaS marketplace admin dashboard](https://www.figma.com/community/file/1592463185051545674/saas-marketplace-admin-dashboard)
- [Online marketplace with admin panel](https://www.figma.com/community/file/1603844072075947715/online-marketplace-with-admin-panel)
- [Aerten web app](https://www.figma.com/community/file/1252610051102275471/aerten-web-app)
- [Neomart multi-vendor marketplace](https://www.figma.com/community/file/1517000338815971780/neomart-multi-vendor-marketplace-ui-kit)

## Definition of done visual

- La vista se entiende sin leer instrucciones dentro de la app.
- El usuario identifica ubicación, estado y siguiente acción en menos de unos
  segundos.
- Los filtros y tabs se conservan al cambiar de ruta cuando el contexto lo
  requiere.
- No hay overflow horizontal accidental en 360, 768, 1024 ni desktop.
- Los estados de loading, vacío, error y permiso tienen tratamiento propio.
- El contraste y el foco visible funcionan en tema claro y oscuro.
- La captura desktop y mobile se revisa antes de cerrar un slice.
