# Meta de finalización

**Estado:** vigente, actualizado 2026-10-10. **Owner:** Producto / CTO.
Propósito: convertir el plan estratégico del 2026-10-09 en un backlog verificable;
no repite estado ni evidencias, que viven en el [roadmap](../ROADMAP.md) y en cada contrato.

Meta fijada por el dueño el 2026-10-09: completar el plan estratégico de esa
fecha para finalizar la app. Es el backlog de ejecución; el orden de §5 y los
gates de §6 del [roadmap](../ROADMAP.md) siguen gobernando. `[x]` = implementado y verificado internamente;
un gate externo nunca se marca con fixtures. Push automático a `main` tras
`npm run verify` verde.

**1. Facturar y cobrar sin entender ARCA (P0)**
- [x] Rechazos WSFE leídos estructuradamente y explicados con acción (manual 4.7).
- [x] Bandeja de pendientes fiscales en Facturas: grupos por acción y filtro `?fiscal=` (sin CAE ni autorización real).
- [x] Fiscal Health en ARCA: datos, conexión, delegación, ambiente, rechazos, pendientes y CAE reciente (puntaje 0–100).
- [x] Vigencia del certificado de plataforma con aviso a 60/30/7 días y vencido en Platform.
- [x] Observaciones de ARCA con CAE otorgado guardadas en la factura (sólo el servicio las escribe) y visibles en Facturas.
- [x] Nota de Débito asociada a factura autorizada (A/B/C), con CbtesAsoc en WSFE.
- [x] Padrón de ARCA (A5): CUIT → nombre, condición IVA y domicilio en la ficha del cliente y el alta rápida del POS (Edge `arca-padron`, certificado de la plataforma, cache 30 días, tope diario). Requiere asociar el certificado de la plataforma a `ws_sr_constancia_inscripcion` en ARCA.
- [ ] Alta fiscal guiada del comercio: padrón del emisor, delegación paso a paso, detección de puntos CAE, autotest y factura de homologación.
- [x] POS: "Facturar todas las ventas" por organización; un cliente con CUIT activa la factura del ticket.
- [x] Commerce: cada pedido pagado genera su factura y se autoriza en ARCA vía outbox (`orden.pagada` → `facturar_orden_pagada` → `factura.creada` → `afip-authorize`); el lote muestra el resultado y qué hacer por pedido.
- [ ] Asistente de renovación de certificado (generar CSR y cargar CRT guiado).
- [ ] Contraste completo con WSFEv1 4.8; abstracción `FiscalProvider` (WSFE/WSMTXCA/WSFEX).
- [ ] Portal de contadores multi-organización y Fiscal API con idempotencia.
- [ ] Gate externo: A/B/C/NC/ND autorizadas en ARCA con identidad delegada.

**0. Pedidos del dueño 2026-10-09 (prioridad)**
- [x] Productos con 11.000 ítems: página de 60 filas en lista y grilla, agrupado lineal, filtros memorizados y búsqueda diferida.
- [x] Carga del catálogo en paralelo por rangos de UUID (un viaje en vez de 9), orden con `Intl.Collator`; variantes y ventas sin tope silencioso de 1.000 filas.
- [x] Importación: cada problema con causa, arreglo y ejemplos; correcciones de un clic; errores del servidor con arreglo.
- [x] Proveedor en cada producto: columna de importación (asocia o crea), visible y filtrable en Productos.
- [x] Controlador fiscal Epson TM-T900FA por red (protocolo HTTP oficial), sin doble comprobante con ARCA.
- [ ] Controlador fiscal: certificación en Modo Entrenamiento con el equipo real, canal nativo Tauri, Hasar 2G.
- [ ] Todos los comprobantes electrónicos de ARCA (WSFE, WSMTXCA, WSFEX, FCE MiPyME).
- [ ] Estudio funcional de test.scadi.com.ar y paridad de funciones útiles.
- [x] Clientes con CUIT/DNI, condición IVA, razón social y domicilio fiscal; selector en POS y factura manual; factura A/B/C según cliente.
- [x] POS con catálogo grande: búsqueda indexada, grilla acotada, ventas/variantes completas.
- [x] POS con atajos F1–F11 (cliente, medio de pago, cupón, ticket en espera, cobrar, factura).
- [x] Revisar y unificar productos duplicados (stock por Kardex, códigos como alternativos, archivo si hay historia).
- [x] Vender por kilo, metro, litro o m² (stock y Kardex con tres decimales, sólo para productos por medida).
- [x] Descuento manual máximo y autorización del encargado con PIN, validados en la base.
- [x] Fiado con límite de crédito por cliente: la base rechaza la deuda que lo supere; el POS muestra el disponible.
- [x] Selectores de producto con búsqueda (50 resultados) en todas las pantallas: ningún `Select` dibuja el catálogo entero.
- [x] Presentaciones (caja, bulto, pack) con código propio: escanearlas en el POS suma sus unidades.
- [x] Precio propio por presentación y recepción de compras por caja. La base decide el precio de caja (`precio_presentacion_autoritativo`, sólo mejora el precio y exige una caja entera) y el tope de descuento se mide contra él; la recepción convierte cajas con el factor guardado. `scripts/presentation-price-matrix.sql` 7/7 contra la base vinculada en transacción revertida. Aplicada en la base vinculada; la matriz pasó 7/7 contra la base migrada el 2026-10-10.

- [x] Catálogo según el rubro: reglas de categorías por rubro (ferretería, 23 categorías), clasificación automática en cada alta e importación, «Ordenar categorías» con vista previa y deshacer, ficha sin género ni ml en rubros que no los usan, pistas de importación sin falsos positivos y borrado masivo por lotes.

- [x] Rendimiento de base y app: realtime por Broadcast (sin lectura del WAL), cron sólo con trabajo pendiente, índices en todas las FK a products y catálogo con caché local incremental (medido 2026-10-10: 8,7 MB por apertura con 7.378 productos).

- [x] Cara nueva, primera vuelta (2026-10-10): tipografía Plus Jakarta Sans + Inter, grises neutros en lugar de azul marino, tarjetas blancas planas, radios más suaves, espaciado de títulos ajustado; etiqueta «secondary» legible (usaba el color de fondo como texto); menú con el nombre del comercio primero y grupos en castellano llano; barra superior con una sola ruta legible.
- [x] Galería visual de desarrollo `/__diseno` (sólo `import.meta.env.DEV`; `?shell=1` la dibuja dentro del marco real con el menú completo) para revisar el diseño sin sesión.

**Qué sigue — retomar acá (2026-10-10)**

Pedido del dueño: «cambiar la cara» también en lo funcional y en la organización, y terminar todo. Orden sugerido:

1. **Reimportar el catálogo de Ferreteria Famatina** (los productos se borraron el 2026-10-10 a pedido; copia en `public.zz_backup_productos_famatina`, borrarla cuando la reimportación esté confirmada). La importación ya categoriza sola por rubro; revisar el resultado con «Ordenar categorías».
2. **Organización funcional del menú** (perfil emprendedor/establecido/avanzado, «Más herramientas», Reportes + Analytics en un solo destino y «Entradas y salidas» —ex Movimientos operativos, que se confundía con el Libro mayor— hechos el 2026-10-10): hoy hay ~70 destinos. Agrupar por tarea del comercio (Vender · Catálogo y stock · Clientes · Cobros y facturación · Tienda online · Marketing · Reportes · Configuración), esconder lo avanzado detrás de «Más herramientas» según el rubro y el perfil (emprendedor / establecido / avanzado), y unificar pantallas duplicadas (Ventas vs Movimientos, Reportes vs Analytics vs Inteligencia).
3. **Inicio (Dashboard) por tarea:** qué vender hoy, qué reponer, qué cobrar, qué facturar; menos widgets decorativos. Revisarlo en `/__diseno?shell=1` o con sesión real.
   Hecho 2026-10-10: el Foco del día suma «qué facturar» (mismo criterio que la bandeja fiscal) y 20 bloques de análisis pasaron a «Más indicadores», plegado. Falta revisarlo con sesión real.
4. **Productos y caja con la cara nueva:** tabla densa, filtros como chips, acciones masivas visibles; caja a pantalla completa con teclado (F1–F10) como protagonista.
5. **Revisar pantalla por pantalla con sesión real**: el dueño inicia sesión en el navegador integrado y se recorren las páginas principales en claro y oscuro.
6. Pendientes de la meta de esta lista (alta fiscal guiada del emisor, WSMTXCA/WSFEX/FCE, controlador fiscal con el equipo real, estudio de test.scadi.com.ar con sesión del dueño, B2B, OMS, Studio, Growth, Profit, Developer Platform).
7. Acciones que sólo puede hacer el dueño: asociar el certificado de la plataforma a `ws_sr_constancia_inscripcion` en ARCA (padrón), crear `VERCEL_TOKEN`, cargar secretos de Stripe / WhatsApp / Mercado Pago plataforma / Resend.

Infraestructura hecha el 2026-10-10 para tener en cuenta: realtime por Broadcast desde la base (topics `org:<id>`, `user:<id>`, `plataforma:soporte`; ver `src/lib/orgRealtime.ts`), catálogo con caché local incremental (`src/lib/catalogCache.ts`), cron condicionados a trabajo pendiente, índices en todas las FK hacia `products`, categorías por rubro como datos (`rubro_reglas_categoria`).

**2. Abrir mi tienda en minutos (P1)**
- [ ] Studio: árbol de páginas, secciones/bloques, tokens y preview real versionado.
- [ ] AI Store Architect: propuesta revisable que produce configuración versionada.
- [ ] Búsqueda: autocompletado, sinónimos, facetas, analítica y cero resultados.
- [ ] Migración Shopify/Tiendanube medida (redirects, SEO, clientes, rollback).
- [ ] B2B: empresas, compradores, catálogos/precios, mínimos, crédito, cotizaciones.
- [ ] OMS: parciales, backorder/preorder, cambios, store credit, pickup.
- [ ] Suscripciones; Core Web Vitals medidos.

**3. Operar todo en Nerqia**
- [x] Tutoriales en toda la plataforma: recorrido guiado por pantalla (propio o generado desde el menú y sus consejos), botón de ayuda único, oferta en la primera visita y Academia (`/aprender`) con progreso por usuario (`tutorial_progress`).
- [x] Perfil del menú (emprendedor / establecido / avanzado) en Ajustes › Sistema: cada destino declara su nivel (`NIVEL_DE_DESTINO`, un test lo exige), lo que no entra va a «Más herramientas» y al buscador, la página actual siempre se ve y sin perfil elegido el menú es completo (`settings.perfil_menu`, 20261010001400, aplicada).
- [ ] Packs verticales sin forks: qué pantallas y defaults trae cada rubro (además de las categorías, que ya son por rubro).
- [ ] Merchant health rojo/ámbar/verde y colas operativas en Platform.
- [ ] Eventos versionados con idempotencia, replay, DLQ y correlación.
- [ ] Apps nativas: firma, distribución, updater, impresión y hardware POS.
- [ ] Developer Platform: OAuth apps, scopes, webhooks, versiones y MCP.

**4. Saber qué hacer para ganar más**
- [ ] Profit: landed cost, fees de marketplace/pago, alertas y Margin Guardian.
- [ ] Ads read-only (Meta/Google/TikTok) y ROAS de contribución.
- [ ] Growth: inbox unificado, empresas/pipelines, formularios/landings, WhatsApp Commerce, email A/B.
- [ ] Pay: certificación real, settlement y segundo rail.
- [ ] Automate: señal → simulación → aprobación → ejecución → outcome.
- [ ] Gates de negocio: 10 comercios → 8 tiendas → 5 primeras ventas → 3 semanales.
