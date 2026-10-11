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
- [x] Alta fiscal, primera parte (2026-10-10): «Completar con ARCA» en el emisor (razón social, domicilio y tipo de emisor desde el padrón, sin adivinar si no está inscripto) y detección de puntos de venta: la verificación devuelve los habilitados para CAE y, si el configurado no sirve, dice cuáles sí (`afip-authorize` v73 publicada). La delegación paso a paso y la verificación ya existían (`ConectarAfip`).
- [x] Alta fiscal, recorrido único (2026-10-10, vigésima corrida): «Para empezar a facturar» arriba de la página de ARCA con cinco pasos (datos del emisor/padrón → delegación → punto de venta → primera factura con CAE → producción), cuál toca ahora y un enlace a la sección donde se resuelve. Usa los mismos datos que la salud fiscal (`recorridoAltaFiscal.ts`); se esconde cuando ya factura en producción.
- [ ] Factura de homologación guiada: un botón que emita la factura de prueba sola (hoy el paso lleva a Facturas).
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
   **Destrabado 2026-10-10 (tercera corrida):** las 12 sesiones de importación de Famatina (08–10/10) se cortaban siempre entre 4.000 y 5.750 filas; el catálogo quedó con 5.500 de ~11.500. Causa: el mismo artículo dos veces en la lista (fila con código y fila sin código, mismo nombre); al aplicar, la segunda chocaba con el producto recién creado y el lote entero se revertía, con un error genérico que escondía el motivo. Migración 20261010002000: la fila repetida se omite y queda avisada, y el error del lote dice el motivo real. Simulacro de la sesión real 543b55b3 (revertido): termina 11.534/11.534, catálogo 5.500 → 11.532, 2 repetidas omitidas. `scripts/import-duplicates-matrix.sql` 9/9.
   **Acción del dueño (2 minutos):** Productos › Importar › «Importaciones recientes» › «Retomar» en «lista percios.xlsx» (aplicadas 5.500 / 11.534) › «Reanudar aplicación». No hace falta volver a subir el archivo. Después: revisar con «Ordenar categorías» y avisar para borrar `zz_backup_productos_famatina`.
   **Más rápida (2026-10-10, cuarta corrida):** casi la mitad de cada lote era `categoria_sugerida` (6 ms por producto): evaluaba 36 expresiones regulares distintas y Postgres guarda compiladas 32, así que las recompilaba en cada fila. Migración 20261010002100: una categoría genérica va directo a las reglas por nombre; resultado idéntico en 15.912 casos (`scripts/categoria-rapida-matrix.sql`) y 5,9 → 0,37 ms por fila. Reanudación simulada de la sesión real: lotes de 1–2 s; el primero, en frío, 6 s.
   ⚠️ Vigilar: el rol de la app corta cada consulta a los 8 s y el primer lote en frío anda en 6 s. Desde la quinta corrida (2026-10-10) el cliente reintenta una vez un lote cortado por tiempo o por la red (seguro: cada lote es una transacción y la base no reaplica uno ya guardado). Si aun así se corta, el próximo paso es achicar los lotes de 250 a 100 filas.
   También desde la quinta corrida el comercio ve el motivo real de un lote que no se aplica: el filtro del cliente tapaba «No se pudo aplicar el lote… Motivo: …» con un mensaje genérico; si el motivo es técnico se muestra uno legible.
2. **Organización funcional del menú** (perfil emprendedor/establecido/avanzado, «Más herramientas», Reportes + Analytics en un solo destino y «Entradas y salidas» —ex Movimientos operativos, que se confundía con el Libro mayor— hechos el 2026-10-10): hoy hay ~70 destinos. Agrupar por tarea del comercio (Vender · Catálogo y stock · Clientes · Cobros y facturación · Tienda online · Marketing · Reportes · Configuración), esconder lo avanzado detrás de «Más herramientas» según el rubro y el perfil (emprendedor / establecido / avanzado), y unificar pantallas duplicadas (Ventas vs Movimientos, Reportes vs Analytics vs Inteligencia).
3. **Inicio (Dashboard) por tarea:** qué vender hoy, qué reponer, qué cobrar, qué facturar; menos widgets decorativos. Revisarlo en `/__diseno?shell=1` o con sesión real.
   Hecho 2026-10-10: el Foco del día suma «qué facturar» (mismo criterio que la bandeja fiscal) y 20 bloques de análisis pasaron a «Más indicadores», plegado. Falta revisarlo con sesión real.
4. **Productos y caja con la cara nueva:** tabla densa, filtros como chips, acciones masivas visibles; caja a pantalla completa con teclado (F1–F10) como protagonista.
5. **Revisar pantalla por pantalla con sesión real**: el dueño inicia sesión en el navegador integrado y se recorren las páginas principales en claro y oscuro.
6. Pendientes de la meta de esta lista (alta fiscal guiada del emisor, WSMTXCA/WSFEX/FCE, controlador fiscal con el equipo real, estudio de test.scadi.com.ar con sesión del dueño, B2B, OMS, Studio, Growth, Profit, Developer Platform).
7. Acciones que sólo puede hacer el dueño: asociar el certificado de la plataforma a `ws_sr_constancia_inscripcion` en ARCA (padrón), crear `VERCEL_TOKEN`, cargar secretos de Stripe / WhatsApp / Mercado Pago plataforma / Resend.

Hecho 2026-10-10 (corrida automática, E5 de [TESIS](TESIS.md) §9): **«Lo que Nerqia reemplaza» en Mi plan.** Por cada uno de los 6 productos muestra el uso medido en la base (`uso_de_nerqia`: ventas, facturas, compras, pedidos online, gastos, comprobantes, campañas y canjes, emails y contactos; 30 días, Creators 90) y deja que el dueño o un administrador anote qué herramienta usa hoy y cuánto paga por mes (`herramientas_reemplazadas`, sólo por `guardar_herramienta_reemplazada`). El ahorro contra el plan más barato con precio (Starter, $19.900) sale sólo de esos montos; no se inventan precios de terceros. Migración 20261010001800 aplicada; `scripts/replaced-tools-matrix.sql` 12/12 en simulacro y contra la base migrada.
Hecho 2026-10-10 (segunda corrida): **Platform › Métricas › «Productos por comercio»** (`platform_org_productos_nerqia`, sólo administradores de plataforma): productos Nerqia en uso por comercio (métrica de TESIS §6), comercios con 2 o más, quiénes cargaron lo que pagan y el total mensual declarado. Las señales tienen una sola definición (`_senales_uso_nerqia`), que comparten Mi plan y Platform. Migración 20261010001900 aplicada; `scripts/products-per-org-matrix.sql` 6/6 y la matriz de 001800 sigue 12/12.
Hecho 2026-10-10 (sexta corrida, TESIS §6 y E4): **origen de cada alta.** No había forma de saber cómo llegaba un comercio nuevo, así que E4 («≥ 1 marca nueva referida por sus influencers») y «altas referidas por comercio activo» no se podían medir. Ahora la app guarda el primer contacto (`?ref=`, `utm_*`, sitio de origen, página de entrada) y lo manda en el alta de comercio; `origen_de_alta` lo guarda al crearse el comercio y resuelve `ref` = slug de otro comercio → referido por ese comercio, o código de un único influencer → referido por ese influencer y su marca. Nunca frena un alta. Se ve en Platform › Métricas › «Productos por comercio» (columna «Cómo llegó» y «Altas referidas»). Migración 20261010002200 aplicada; `scripts/origen-de-alta-matrix.sql` con altas reales por `auth.users`, revertida.
Hueco conocido: las altas con Google (OAuth) no pueden llevar datos extra y quedan «directo»; si pesan, guardar el origen en el primer ingreso. Para E4: los links de invitación de influencers y de marcas tienen que llevar `?ref=<código o slug>`; el sello «Hecha con Nerqia» ya está (séptima corrida, 2026-10-10): al pie de cada tienda, enlace a la landing con `?ref=<slug del comercio>&utm_source=tienda&utm_medium=sello`; `marca_nerqia_de_tienda` (pública) lo oculta con marca propia vigente (prueba y planes pagos; lo ven los comercios gratuitos después de la prueba) y ante cualquier duda. Migración 20261010002300 aplicada; `scripts/sello-nerqia-matrix.sql` 6/6. Tickets de la caja (novena corrida): al pie, «Hecho con Nerqia · nerqia.app/?ref=<slug>», con la misma regla (`org_entitlements.branding`; ante cualquier error no va). Facturas y presupuestos PDF (decimonovena corrida): el mismo sello bajo el pie, con una sola regla para ticket, factura y presupuesto (`src/lib/selloNerqia.ts`). El canal «Hecha con Nerqia» de TESIS §5 queda completo: tienda, ticket, factura, presupuesto e invitación de creadores.
Hecho (octava corrida, 2026-10-10, E4): **los creadores invitan marcas.** En el portal del creador, «Invitá marcas a Nerqia» con su enlace propio (`?ref=@<slug público>&utm_source=creador&utm_medium=invitacion`) y cuántas marcas se dieron de alta con él (`marcas_que_trajo_el_creador`). `origen_de_alta` suma el canal «creador» (`referido_por_creador`) y Platform lo cuenta en «Altas referidas». Migración 20261010002400 aplicada; `scripts/creadores-traen-marcas-matrix.sql` 5/5 y la de origen sigue igual. **Acción del dueño para E4:** al ofrecer el portal a las 3 marcas, pedirles a sus creadores que completen el enlace público y compartan «Invitá marcas».
Siguiente para E5/E2: (a) volcar a [TESIS](TESIS.md) §2 la lectura semanal de «productos por comercio» desde esa pestaña; (b) que el dueño, al acompañar a Ferretería Famatina (E1), le pida cargar lo que paga hoy en Mi plan y ofrezca Starter a las 4 semanas de uso (~2026-10-30).

Hecho (decimocuarta corrida, 2026-10-10, E2): **Platform › Métricas › «Entrevistas E2».** Registro de las 15 entrevistas (puerta, comercio, rubro, herramientas, cuánto pagan, si nombran el margen real como pregunta sin respuesta, notas) y conteo contra el criterio escrito en TESIS §9: «validada» al llegar a 10 que confirman, «refutada» cuando ya no se puede llegar con las que faltan. Muestra cuántas faltan por puerta y la mediana de lo que pagan. Tabla `entrevistas_e2` sólo para administradores de plataforma (migración 20261010002600, `scripts/entrevistas-e2-matrix.sql` 5/5). **Acción del dueño:** hacer las 15 entrevistas (5 por puerta) antes del 2026-10-31 y cargarlas ahí.

Hecho (decimoquinta corrida, 2026-10-10, E3): **Platform › Métricas › «Importaciones».** Por comercio: intentos, terminadas, trabadas (sin terminar y sin avance hace más de 30 minutos), hasta dónde llegó y la importación terminada más rápida contra la meta de E3 (< 30 min). Vista `platform_importaciones_catalogo`, sólo plataforma (migración 20261010002700, `scripts/platform-importaciones-matrix.sql` 3/3). Hoy muestra a Famatina con 12 intentos, 0 terminadas y 8 trabadas: el problema que antes sólo se vio revisando la base.

Hecho (decimosexta corrida, 2026-10-10, TESIS §8 y E1): **Platform › Métricas › «Escalera de la tesis»** (primera pestaña). Los cuatro escalones en vivo con su meta (10 comercios activos → 8 tiendas → 5 con venta online → 3 vendiendo todas las semanas), cuál manda ahora, la fecha de revisión (2026-12-15) y las ventas por semana de cada comercio en 8 semanas contra la meta de E1 (≥ 20). `platform_escalera_tesis()`, sólo plataforma (migración 20261010002800, `scripts/escalera-tesis-matrix.sql` 5/5). Medido hoy: 1 tienda publicada; Famatina 2 ventas esta semana. Las metas se copian de TESIS.md y un test exige que coincidan.

Hecho (decimoséptima corrida, 2026-10-10, E5): **la oferta de Starter aparece sola a las 4 semanas.** En el Inicio, al dueño o administrador de un comercio con 4 semanas desde el alta que todavía no paga (la prueba no cuenta como pago): «Ya llevás N semanas con Nerqia» → «Ver la cuenta» abre Mi plan en «Lo que Nerqia reemplaza». «Más adelante» la esconde 14 días. Famatina la va a ver desde el 2026-10-30. La conversión se lee en suscripciones pagas por comercio con 4+ semanas (meta E5: ≥ 30%).

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
- [ ] Profit: landed cost, fees de marketplace/pago, alertas y Margin Guardian. (Comisiones de Mercado Pago y MercadoLibre ya entran al margen: liquidaciones POS confirmadas, `fee_details` del webhook y `sale_fee_ars` de MercadoLibre.)
- [x] Guardián de margen, primera parte (2026-10-10, undécima corrida): Ferretería Famatina tiene 21 productos con precio por debajo del costo (varios a $0,10). El Inicio avisa en rojo y abre `/productos?margen=negative`; Productos muestra el aviso con «Ver cuáles». Una sola regla (`guardianDeMargen.ts`, sin costo conocido no cuenta). **Acción del dueño:** revisar esos 21 con Famatina (probablemente precios de la lista mal leídos). Hecho (duodécima corrida): el ajuste de precios en bloque avisa en la vista previa y al aplicar cuántos productos quedarían por debajo del costo (migración 20261010002500, `scripts/bulk-price-below-cost-matrix.sql` 5/5 y la matriz original 6/6). Hecho (decimotercera corrida): la caja avisa al agregar un producto cuyo precio a cobrar (con lista de precios) está por debajo del costo; avisa una vez por producto y no bloquea (puede ser una liquidación). El guardián cubre Inicio, Productos, ajuste en bloque y caja.
  Diagnóstico (decimoctava corrida): los 21 de Famatina **vienen así del archivo**, no es un error de lectura. Se mapeó «PRECIO DE LISTA» como precio de venta y en esos artículos es menor que «COSTO» (p. ej. disco Norton «X 25UN»: 0,10 contra 776, probablemente costo de la caja contra precio unitario). Ahora la importación lo avisa antes de subir: resumen «N productos traen el precio de venta por debajo del costo» y marca por fila en «Revisión local». **Acción del dueño:** revisar con Famatina esas filas en su sistema anterior antes de reanudar.
- [x] Creators ↔ Profit (2026-10-10, décima corrida): «Ganancia real» en Canjes = margen de contribución de las ventas atribuidas por código (`sale_margin_facts`, la fuente de Profit) − comisiones del creador − inversión del canje. Antes sólo había ROI sobre ventas brutas, que puede mostrar ganancia donde se pierde plata. Sin costo cargado o sin permiso de analítica no hay número: dice cuántas ventas faltan.
- [ ] Ads read-only (Meta/Google/TikTok) y ROAS de contribución.
- [ ] Growth: inbox unificado, empresas/pipelines, formularios/landings, WhatsApp Commerce, email A/B.
- [ ] Pay: certificación real, settlement y segundo rail.
- [ ] Automate: señal → simulación → aprobación → ejecución → outcome.
- [ ] Gates de negocio: 10 comercios → 8 tiendas → 5 primeras ventas → 3 semanales.
