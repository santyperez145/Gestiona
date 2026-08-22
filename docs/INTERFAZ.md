# Gestiona — sistema de interfaz

**Corte:** 2026-08-22

Este documento fija la dirección visual de Gestiona. El producto se inspira en
los patrones de CRM, marketplace y admin panel de las referencias compartidas,
pero no copia componentes, textos ni assets de terceros.

## Dirección

Gestiona es una herramienta operativa que se usa muchas horas seguidas. La
interfaz debe ayudar a escanear, comparar y ejecutar, no competir con los datos.

- Rail lateral oscuro y estable para identidad y navegación.
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

## Superficies

| Superficie | Navegación | Acento | Objetivo |
|---|---|---|---|
| Business | Rail + vistas internas | Dorado | Operar productos, stock, ventas y clientes. |
| Finance | Rail propio + documentos | Teal | Revisar evidencia y aprobar decisiones. |
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

## Slice CRM implementado

La vista **Clientes / CRM** toma como referencia principal el [CRM app con
clientes, deals y tareas](https://www.figma.com/design/y3iW4vARslK39hLDzTj37D/CRM-app-with-customers--deals--nested-data--tasks-and-menu-filtering--Community-):
la lista es el centro de trabajo, los segmentos funcionan como navegación
rápida y la ficha seleccionada conserva el contexto de la persona mientras se
ejecutan acciones, se revisan compras o se programa seguimiento.

- `Clientes` y `Insights` son tabs internos persistidos por organización.
- `Clientes` usa un rail de segmentos, toolbar de búsqueda/filtros y selección
  contextual de la ficha 360.
- `Insights` concentra KPI, top de clientes, segmentación, riesgo y RFM para
  que la lista no se convierta en una página interminable.
- En mobile el rail se convierte en una fila horizontal navegable y la ficha
  mantiene una acción explícita para cerrarse.

Este slice usa datos, permisos, exportaciones, notas, comunicaciones, cuotas y
acciones existentes; el rediseño no crea un segundo modelo de clientes.

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
  se presenta como una columna de widgets sin fin. Los hashes históricos
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
