# Gestiona — estado y plan

Este documento dice qué es el producto, qué funciona hoy y qué sigue.
Lo que está acá tiene que ser verificable: nada de porcentajes inventados ni de
mercados a los que no vamos.
---
## 0.0 Plan canónico de ejecución — 2026-08-21

El archivo `C:\Users\Admin\Desktop\gestiona.txt` se incorporó como análisis de
producto y criterio de priorización. No es una instrucción de implementación
aislada: se traduce acá a slices verificables, respetando la arquitectura y los
datos reales de Gestiona.

### Orden obligatorio

El orden de producto queda fijado por impacto y dependencias. Un bloque no se
saltea para construir una pantalla más vistosa:

1. **P0.1 Product Types + Attributes.** Sacar el catálogo de la herencia de
   perfumes. El núcleo debe representar ropa, ferretería, repuestos, muebles,
   alimentos, electrónica, servicios y digitales sin agregar columnas ni ramas
   por rubro.
2. **P0.2 Identidad limpia de producto y cliente.** SKU, código de barras,
   identidad del cliente y deduplicación deben ser confiables entre POS, tienda
   y canales.
3. **P0.3 Pagos universales e idempotencia completa.** Todos los cobros,
   reintentos, reintegros y conciliaciones deben pasar por el mismo contrato.
4. **P0.4 ARCA en producción real.** La estructura ya existe; el cierre depende
   del certificado, delegación y una factura de prueba del comercio.
5. **P0.5 Segundo comercio real.** Es la puerta comercial: valida onboarding,
   permisos, catálogo, stock, caja, tienda y soporte con una organización que
   no nació de los datos de Exentry.

Después de ese gate: dominios, multi-store, themes/page builder, migradores,
Document AI y cuentas a pagar, margen por canal, MercadoLibre profundo y
onboarding universal. B2B, búsqueda dedicada, recomendaciones, experimentos,
developer platform, marketplace de apps, logística propia y automatizaciones en
lenguaje natural esperan evidencia. Pay regulado, capital, multi-región,
sharding y un ecosistema agentic son P3 y no se empiezan por anticipación.

### Slice ejecutado

**P0.1 — Commerce Kernel de catálogo (cerrado 2026-08-21).** La migración agrega `product_types`,
`attribute_definitions` y valores tipados, y vincula `products` de forma
nullable. La UI permite administrar tipos y atributos y asignarlos a una ficha.
Los productos actuales conservan `category`, `custom_fields` y todo su flujo;
no hay backfill inventado ni cambios de stock, precios o catálogo público.

**Salida verificada:** `npm run typecheck`, los 4 tests unitarios del parser y
reglas del kernel, migración registrada, objetos y RLS comprobados contra la base
vinculada, y `db push --linked --dry-run` en `upToDate`. No hubo filas `ZZ`, ni
backfill, ni cambios de inventario. Falta una pasada de navegador con sesión de
organización: este equipo no tiene `.env` local.

**P0.2.1 — Reporte de identidad y guardrail de importación (cerrado 2026-08-21).**
La migración `20260821000043_identity_review.sql` agrega normalizadores
inmutables y las vistas protegidas `product_identity_review` y
`customer_identity_review`. SKU, EAN, email, teléfono y nombre generan llaves
de revisión consistentes entre canales; los nombres solos sólo son candidatos y
no autorizan una fusión. Productos y clientes muestran la salud de identidad
desde una sección propia, y el importador CSV usa email/teléfono como claves
fuertes: no crea una ficha duplicada por reimportación, pero conserva homónimos
con contactos diferentes.

**Salida verificada:** la consulta de solo lectura de producción registró
60 productos activos, 0 colisiones exactas, 0 candidatos por nombre y 60/60
productos sin SKU/EAN; registró 33 clientes, 0 colisiones exactas, 0 candidatos
por nombre y 24/33 sin email ni teléfono. Las vistas tienen únicamente
`SELECT` para `authenticated` y ningún grant para `anon`; no hubo backfill,
merge, cambios de stock ni filas `ZZ`. P0.2 sigue abierto: completar
identificadores del catálogo, mejorar cobertura de clientes y recién después
evaluar índices únicos por organización. La verificación automática de
`db push --linked --dry-run` quedó bloqueada en esta PC por falta de
`SUPABASE_DB_PASSWORD`; migración, registro, objetos y grants sí fueron
comprobados contra la base vinculada.

**P0.2.2 — Cola de completitud accionable (cerrado 2026-08-21).** El reporte de
identidad ahora distingue una colisión de una ficha incompleta: el estado no
dice “sin conflictos” cuando faltan identificadores. Productos sin SKU/EAN y
clientes sin email, teléfono o WhatsApp aparecen en una lista breve ordenada
por nombre, con acceso directo a la ficha cuando el usuario tiene permiso de
edición. La acción sólo abre el formulario existente; no inventa valores, no
escribe por lote y no fusiona perfiles. La cobertura real sigue sin cambios a
propósito: la cola transforma la deuda medida por P0.2.1 en trabajo verificable
para el dueño del comercio.

**Salida verificada:** 7 tests unitarios cubren la selección de pendientes y
los resúmenes de identidad; la suite completa quedó en 1.177 tests verdes
(`npm test`, 2026-08-21). No hubo migración ni cambios de datos reales.

### Siguiente trabajo ya ordenado

- P0.2: usar la cola para completar SKU/EAN y cobertura de contacto con datos
  reales, revisar candidatos con evidencia y recién entonces evaluar
  restricciones únicas por organización.
- P0.3: completar el contrato de `PaymentIntent` y probar reintentos,
  reintegros y conciliación sin doble asiento.
- P0.4: ejecutar el circuito ARCA con certificado de homologación y una factura
  de prueba.
- P0.5: acompañar el alta de un segundo comercio y medir tiempo a catálogo,
  primera venta, uso POS/tienda, stock accuracy y soporte.
- P1 Document AI + Payables: PDF/imagen → extracción estructurada → revisión
  con confianza → borrador de compra/cuenta a pagar; nunca escritura directa
  del ledger por un modelo.

La estética, los tabs, los layouts y las referencias de Figma siguen siendo
criterios de experiencia: mejoran la operación del bloque prioritario, pero no
reordenan estas dependencias ni crean módulos paralelos.

---
## 0.1 Lenguaje visual y experiencia

El rediseño visual acompana la tesis del sistema operativo omnicanal: la interfaz debe ayudar a operar, comparar y decidir. Los kits de Figma se usan como referencia de jerarquia y densidad, no como una copia de pantallas.

- La organizacion abre en workspace claro y neutral, con ambar para acciones y violeta reservado al panel de plataforma; dark mode sigue disponible.
- El shell mantiene orientacion visible, busqueda global, accion primaria y estado operativo en todas las superficies.
- Las tarjetas tienen radio de hasta 8px, sombra discreta y una sola responsabilidad. No se agregan bloques decorativos que compitan con ventas, stock, margen o caja.
- El dashboard prioriza Business Core: ventas, margen real, stock, caja y tareas de hoy. Cada cifra lleva periodo o fuente.
- Mobile conserva los cinco accesos criticos: Resumen, POS, Ventas, Productos y Clientes. Las tablas se desplazan sin romper la pagina.

**Slice de rediseno 1 (2026-08-14):** tokens visuales, modo claro por defecto, topbar operativo de organizacion, headers de pagina y chrome de plataforma. La salida se valida con screenshots desktop/mobile y la puerta completa del repo.

**Slice de rediseno 2 (2026-08-14):** dashboard ordenado por Business Core, tarjetas metricas reutilizables, panel `FocoDelDia` con jerarquia de gestion y contraste corregido para el modo claro. DashStack aporta criterio de composicion; los datos y la logica siguen siendo los del producto.

**Slice de rediseno 3 (2026-08-14):** consolidacion del workspace de gestion y plataforma. El shell de organizacion ahora separa mejor navegacion, busqueda global, estado operativo y accion primaria; `PageHeader`, `MetricCard` y `KPICard` comparten una misma superficie; Productos, Ventas y Dashboard reciben jerarquia de tablas, toolbars y acciones; Plataforma conserva violeta como superficie de staff. Se toma de los kits de ecommerce/admin la densidad, el uso de tablas y la composicion por bloques, pero no se copian pantallas ni se agregan datos ficticios. Validado con typecheck, lint sin errores, 823 tests y build.

**Slice de rediseno 4 (2026-08-14):** la tienda publica deja de ser una grilla suelta y pasa a tener una jerarquia de ecommerce completa: hero, confianza, categorias, filas de producto, filtros, cards, header, footer y carrito comparten reglas visuales y responsive. `StoreLayout` conserva la separacion legal y de tema; `StoreHome`, `StoreProducts` y `ProductCard` solo reciben composicion y estados visuales, sin mover la fuente de productos, los precios ni el stock. La produccion fue comprobada antes del cambio con 42 productos visibles en el catalogo indicado. Validado con typecheck, lint sin errores, 823 tests y build.

**Slice de rediseno 5 (2026-08-14):** el POS recibe una jerarquia de mostrador: acciones y busqueda en la barra superior, categorias en una franja estable, productos como unidades escaneables y carrito separado como superficie de cobro. El total y `Confirmar venta` quedan anclados visualmente, mientras que descuentos, cliente, medios de pago, kits, turno, offline y variantes conservan sus caminos actuales. No se toca el contrato de ventas ni la autoridad de stock de la base. Validado con typecheck, lint sin errores, 823 tests y build.

**Slice de rediseno 6 (2026-08-14):** Clientes/CRM recibe una jerarquia de ficha 360: segmentos, riesgo, valor y filtros quedan visibles antes de abrir un registro; la lista se vuelve mas escaneable y el detalle se expande en contexto con sus acciones. Se aplican patrones de CRM, dashboard y marketplace de las referencias de Figma como criterio de densidad, filtros y estados, sin copiar pantallas ni introducir datos ficticios. El cambio es visual y conserva las lecturas, permisos y acciones existentes. Validado con typecheck, lint sin errores, 823 tests y build.

**Slice de rediseno 7 (2026-08-14):** Ventas pasa a una composicion de centro operativo: KPIs primero, metodos de cobro y tendencia en un bloque de insights equilibrado, y debajo presets de periodo, filtros y vistas agrupadas en una toolbar con scroll controlado. El responsive conserva la lectura en una columna y no altera calculos, permisos, exportaciones ni agrupaciones existentes. Validado con typecheck, lint sin errores, 823 tests y build.

**Slice de rediseno 8 (2026-08-14):** Productos se consolida como workspace de inventario: acciones extensas quedan contenidas, KPIs separan inventario de riesgo, aging recibe una superficie propia, filtros se comportan como toolbar y las vistas de grilla/tabla mantienen dimensiones estables. La tabla conserva scroll horizontal y encabezado visible; la barra de seleccion masiva se adapta a mobile. No se toca el movimiento de stock, los calculos de margen, permisos, edicion ni exportaciones. Validado con typecheck, lint sin errores, 823 tests y build.

**Slice de rediseno 9 (2026-08-14):** pasada de consolidacion sobre las vistas ya redisenadas. `PageHeader` limita las acciones para proteger la jerarquia del titulo; el Dashboard reubica `Business Core` junto a `FocoDelDia`, usa una toolbar de accesos consistente y aplica un ritmo vertical unico a sus widgets. La primera lectura queda orientada a ventas, margen, stock, caja y tareas, mientras que el analisis secundario conserva sus datos y acciones mas abajo. Se eliminaron emojis de acciones en favor de iconos del sistema y se mantuvo el scroll controlado en mobile. No se tocan consultas, permisos, stock ni calculos. Validado con typecheck, lint sin errores, 823 tests y build.

**Slice de rediseno 10 (2026-08-14):** navegacion interna para reducir paginas interminables. Reportes y Analytics convierten sus tiras extensas de tabs en un rail lateral sticky en desktop y una franja horizontal desplazable en mobile; Integraciones adopta el mismo shell. Ajustes agrega un indice lateral de anclas para marca, finanzas, mensajeria, alertas, descuentos, suscripcion, impuestos, sistema y herramientas. La navegacion solo reorganiza la lectura: conserva consultas, permisos, estados, formularios y acciones existentes. Validado con typecheck, lint sin errores, 823 tests y build.

**Slice de rediseno 11 (2026-08-14):** el Dashboard deja de ser un flujo vertical unico. Un rail interno con estado activo lleva a Resumen, Ventas y metas, Clientes, Inventario, Finanzas e Inteligencia; en mobile se convierte en tabs horizontales desplazables. Cada destino tiene un ancla estable y la navegacion no dispara nuevas consultas ni altera los widgets, calculos o permisos. El siguiente trabajo de producto queda alineado con Fase 1: onboarding medible, limites de plan e instrumentacion, mientras AFIP y la publicacion legal siguen bloqueados por insumos externos. Validado con typecheck, lint sin errores, 823 tests y build.

**Slice de rediseno 12 (2026-08-14):** Ajustes pasa de una pagina continua a seis tabs de dominio: Marca, Finanzas, Mensajeria, Precios, Suscripcion y Sistema. El panel de cada tab se mantiene montado para no perder entradas al cambiar de contexto, pero solo se muestra el dominio activo. Plataforma adopta sidebar violeta sticky en desktop y navegacion horizontal en mobile; sus KPIs quedan en Resumen. Administracion de la organizacion reutiliza el rail de tabs para Rendimiento, Equipo, Permisos, Metas, Auditoria y Actividad. La separacion visual no cruza RLS, roles ni contratos. Validado con typecheck, lint sin errores, 823 tests y build.

**Slice funcional 13 (2026-08-14):** el onboarding del Dashboard deja de ser una lista larga y global. `SetupChecklist` se guarda por organizacion, destaca el siguiente paso con una accion directa y muestra solo los pendientes mas cercanos hasta que el usuario expande el detalle. Usa las mismas señales reales que ya cargaba el dashboard —ajustes, productos, compras, ventas, clientes, canjes y equipo— sin crear datos ficticios ni cambiar permisos. Es una mejora de D2 y deja preparado el siguiente trabajo de Fase 1: instrumentar el tiempo desde alta hasta primera venta. Validado con typecheck, lint sin errores, 823 tests y build.

**Slice transversal 14 (2026-08-14):** las vistas de trabajo dejan de olvidar su contexto al cambiar de modulo o pestaña. `usePersistedState` centraliza la persistencia de tabs, secciones y filtros en `localStorage`, con claves por organizacion y sincronizacion entre pestañas del navegador. Se aplica a Inicio/Dashboard, Ajustes, Reportes, Analytics, Finanzas, Inventario, Compras, Marketing, Clientes/CRM, Fidelidad, Alertas, Integraciones y superficies de plataforma. La URL sigue siendo la autoridad para rutas compartibles; el almacenamiento local conserva la preferencia visual y nunca reemplaza datos, permisos ni estado transaccional. Validado con typecheck, lint sin errores, 826 tests y build.

**Slice funcional 15 (2026-08-14):** Fase 1 deja de depender de consultas manuales para saber si una organizacion llego a usar el producto. `/platform/metricas` consume la vista protegida `platform_org_health` y muestra el funnel real de alta, onboarding, catalogo, tienda activa y primer cobro; calcula tiempo promedio y mediana desde el alta hasta el primer cobro; agrupa las señales de salud y permite filtrar organizaciones para que soporte actue sobre onboarding roto o riesgo de baja. Los calculos viven en `src/lib/platformMetrics.ts` y se prueban sin datos ficticios. La pantalla identifica como pendientes, sin maquillarlas, la fecha exacta de publicacion, la adopcion POS + tienda, stock accuracy y AI Action Rate. Validado con typecheck, lint sin errores, 832 tests y build.

**Slice funcional 16 (2026-08-14):** G2 y G3 dejan de ser una promesa de roadmap. La migracion `20260814000001_platform_activation_channels.sql` agrega `ecommerce_stores.published_at` con trigger de primera publicacion y la vista protegida `platform_org_activation`, que cruza publicacion instrumentada, orden online confirmada y ventas POS marcadas. `/platform/metricas` suma la pestaña Canales con tasas online/POS/omnicanal, tiempos hasta publicar y hasta la primera orden, detalle por organizacion y estados historicos no instrumentados. El POS ahora persiste `source = pos`, y las listas de precios se alinean con el contrato vigente `discount_type/value`, `custom_price` y `min_quantity`. Las fechas historicas sin evento quedan fuera de promedios: no se rellenan con `created_at`. Validado contra la base vinculada con vista, trigger, columna y migracion registradas; `db push --dry-run` al dia; typecheck, lint sin errores, 834 tests y build/PWA.

---

**Slice funcional 17 (2026-08-14):** G7 y C2 avanzan sobre la misma fuente de verdad. `StockCountTab` deja de escribir `products.stock` y usa el circuito auditado `abrir_conteo` -> `registrar_conteo` -> `cerrar_conteo`; cada ajuste pasa por `record_stock_movement`, y una falla cancela la sesión abierta. La migración `20260814000002_platform_stock_accuracy.sql` agrega la vista protegida `platform_org_stock_accuracy`, que compara el último Kardex con el stock actual, valida productos con variantes, separa productos sin evidencia y cuenta stock negativo. `/platform/metricas` incorpora Inventario con precisión, descuadres, cobertura de Kardex, negativos y último conteo por organización. El porcentaje no convierte productos sin movimiento en coincidencias y C2 sigue dependiendo del conteo físico real del dueño. Validado contra la base vinculada: vista creada, columnas inspeccionadas, `db push --dry-run` al día, typecheck, lint sin errores, 835 tests y build/PWA.

**Slice funcional 18 (2026-08-14):** G8 deja de confundir una sugerencia con una acción. El recomendador de ofertas devuelve el id persistido y `Aplicar` invoca `apply_ai_offer_recommendation`: la base verifica owner/admin, producto activo, descuento máximo y margen mínimo antes de fijar una oferta o destacar un producto, sin tocar stock. La recomendación queda `applied` sólo después de ese cambio; el cliente sólo puede descartarla. `platform_org_ai_actions` expone al staff de plataforma el denominador, aplicadas, pendientes, descartadas y tasa agregada por organización, y `/platform/metricas` lo muestra en una pestaña propia. El alcance es deliberado: mide el recomendador de ofertas persistido, no chats ni sugerencias efímeras. Validado contra la base vinculada con RPC ejecutado como owner/admin, vista y permiso inspeccionados y filas ZZ en cero; typecheck, lint sin errores, 891 tests y build/PWA. Las 55 Edge Functions, incluido el recomendador, quedaron desplegadas.

**Slice funcional 19 (2026-08-14):** G6 deja de mirar sólo la señal de hoy. `platform_org_health_source` concentra la definición de salud y `capture_platform_org_health_snapshot` guarda la fotografía diaria por organización; una serie protegida agrega en riesgo, cayendo, dormido, sin activar y GMV expuesto para `/platform/metricas`. La primera captura real registró 4 organizaciones y el cron corre todos los días a las 03:15 ART. No hay backfill: hasta la próxima captura se muestra una única observación, no una tendencia inventada. Validado contra la base vinculada con captura sintética limpiada, primera captura real, cron, permisos de anon/authenticated y lectura como platform admin; typecheck, lint sin errores, 893 tests y build/PWA.

**Slice funcional 20 (2026-08-14):** D2 deja de terminar en un panel sin dirección. El onboarding pasa de tres a cuatro pasos y, después de guardar negocio, rubro y marca, ofrece un camino explícito: cargar el primer producto, explorar datos de ejemplo en esa misma organización o ir al panel, cuyo checklist conserva el siguiente pendiente. Elegir productos llega directo a `/productos` y explica la secuencia producto → stock/costo → primera venta; los datos de ejemplo son opt-in, nunca se cargan para quien quiere empezar con datos reales. Todo guardado —organización, ajustes, fin de onboarding y demo— informa cualquier error en lugar de marcar el alta como exitosa. Validado con typecheck, lint sin errores, 893 tests y build/PWA; sin `.env`, no se simuló una organización real desde el navegador.

**Slice funcional 21 (2026-08-14):** D4 deja de confiar en que el navegador respete el cupo. La base aplica `max_products` al insertar productos y `max_users` al crear invitaciones o membresías, serializado por organización para no perder una carrera concurrente. Una invitación vigente reserva asiento; una vencida no, y una aceptación consume su reserva en vez de duplicarla transitoriamente. La interfaz conserva el aviso temprano y no deja pasar una falla al consultar el límite. `max_sales_per_month` queda deliberadamente pendiente: `sales` guarda líneas, no órdenes, y aplicar esa columna sin una unidad de consumo común cobraría varias veces una venta con varios productos. Validado con plan/organización ZZ limpiados, ACL de las funciones internas y un insert como `authenticated`; typecheck, lint sin errores, 893 tests y build/PWA.

**Slice funcional 22 (2026-08-14):** La cobertura E2E del panel suma POS sin crear ventas: carga con una sesión real, descarta el modal local de vendedor cuando aparece, rechaza el carrito vacío y comprueba que `F2` devuelve el foco a la búsqueda con las categorías disponibles. Así protege el render que ya se rompió por el orden de `confirmDisabled` y evita que un flujo de mostrador pase meses sin navegador. El spec es condicional al usuario E2E y Playwright lo detecta junto al resto de las 41 pruebas; falta ejecutarlo con esas credenciales, que no están en este equipo.

**Slice funcional 23 (2026-08-14):** La salud de los cron deja de depender de una consulta manual de superusuario. `platform_cron_health` resume, sólo para staff de plataforma, el job, horario, actividad, último estado, último éxito y conteos de corridas/fallos de siete días; jamás expone el comando, mensajes de retorno ni respuestas HTTP. `/platform/metricas` suma Operación y ordena primero la última corrida fallida. “Sin ejecuciones” queda como información —por ejemplo para una tarea recién creada— sin inferir un atraso falso al parsear cron. Validado contra la base vinculada como `authenticated` staff: 16 jobs visibles, 15 saludables y una captura diaria aún sin historial; el rol ajeno ve cero filas y `authenticated` conserva sólo `SELECT` sobre la vista. Typecheck, lint sin errores, 894 tests y build/PWA completados.

**Slice de confiabilidad 24 (2026-08-14):** D8 deja de prometer un backup que no existía. `weekly-backup` recorría el esquema legacy por usuario, no una organización, no tenía restore y se podía invocar sin usuario real. Queda deshabilitada con JWT + `requireUser`, sin `service_role`; el panel conserva sólo los archivos históricos descargables y deriva al export portátil, sin venderlos como restaurables. La política pública deja de afirmar backups periódicos. La guarda de Edge Functions falla si vuelve el acceso global legacy. Se desplegaron las 55 funciones: `weekly-backup` quedó activa con `verify_jwt: true`. Typecheck, lint sin errores, 895 tests y build/PWA completados.

**Slice funcional 25 (2026-08-14):** D6/F8 deja de ser una auditoría que sólo puede ver la plataforma. Al emitir un `generateMagicLink`, la función conserva una fila por cada organización alcanzada; `organization_support_accesses` entrega a sus dueños solamente fecha, correo del staff y el evento, incluso si luego se remueve al miembro. No expone el enlace, usuario/correo destino, `details` ni otras acciones de plataforma; además deja explícito que generar un enlace no demuestra que haya sido abierto. Las migraciones probaron como `authenticated` que un usuario ajeno ve cero filas y el dueño exactamente la suya, verificaron ACL y dejaron cero logs ZZ. La tarjeta vive en Ajustes → Sistema y reporta errores en vez de convertirlos en “sin accesos”. Validado contra la base vinculada con tipo regenerado, typecheck, lint sin errores, 896 tests y build/PWA; sin `.env`, no se abrió una sesión real en el navegador.

**Slice de confiabilidad 26 (2026-08-14):** D5/F17 deja de anunciar un “export completo” que omitía tablas y transformaba cualquier fallo en vacío. El ZIP se solicita a una Edge Function que exige `owner`, filtra por `org_id` en tablas operativas y entrega `export-manifest.json` con cada tabla exportada, vacía, truncada o con error; compara el conteo exacto con las filas devueltas para que un límite del API también quede como truncamiento. Las credenciales OAuth/AFIP/API, sesiones, push y webhooks quedan excluidas, y `settings` se selecciona por una lista positiva para que una columna secreta futura no se filtre. Se comprobó contra el catálogo de la base vinculada que las tablas incluidas tienen `org_id` propio. No se vende como backup ni restore: todavía falta portar relaciones hijas sin `org_id` propio y una restauración/importación asistida. Las 56 Edge Functions se desplegaron y la nueva quedó `ACTIVE`, versión 2, con JWT. Typecheck, lint sin errores, 897 tests y build/PWA completados; sin `.env`, no se abrió una sesión real en el navegador.

**Slice de confiabilidad 27 (2026-08-14):** una revisión de C11 encontró caminos que salteaban la autoridad única del inventario: recepción de compras, devolución rápida de POS, nota de crédito, canje, edición de producto/variante, ajuste desde IA y `public-api` escribían o podían escribir stock fuera del Kardex. Compras deja que su trigger aplique el delta programada → recibida; los demás flujos usan `record_stock_movement` o el ajuste absoluto `adjust_stock`, que valida la membresía del actor y registra el movimiento. Los helpers genéricos de producto y variante rechazan ahora un campo `stock`, de modo que una nueva pantalla no pueda reintroducir la escritura directa por accidente; una guarda estática cubre ese contrato. Contra la base vinculada, un producto temporal `ZZ` pasó por ajuste absoluto (2), recepción por trigger (6) y reversión por borrado (2), con cero restos. Las 56 Edge Functions se desplegaron y `public-api` quedó `ACTIVE`, versión 19, sin JWT porque autentica por API key. Typecheck, lint sin errores, 900 tests y build/PWA completados; sin `.env`, no se abrió una sesión real en el navegador.

**Slice de confiabilidad 28 (2026-08-14):** C11 deja de ser un historial parcial y modificable. `price_history` y `stock_movements` quedan sin políticas de escritura para el cliente; el precio se registra una sola vez desde el trigger y Kardex sólo se escribe por RPCs con actor autenticado. `adjust_stock` y el movimiento manual exigen que `p_created_by` sea el JWT; retornos, notas de crédito y canjes usan `record_member_stock_movement`, que toma producto, variante y actor de la organización. Tras confirmar que Vercel ya servía el frontend compatible, `record_stock_movement` quedó revocada para `anon` y `authenticated`: sólo la usan triggers y wrappers `SECURITY DEFINER`. Productos muestra el responsable de cada precio; Kardex lo agrega a la tabla y CSV. Dos pruebas contra la base vinculada con organizaciones `ZZ` bloquearon DML directo y el RPC legacy, confirmaron actor JWT y borraron todos los restos. Typecheck, lint sin errores, 901 tests y build/PWA completados; sin `.env`, no se abrió una sesión real en el navegador.

**Slice de confiabilidad 29 (2026-08-14):** una orden `paid` de MercadoLibre ya no queda aislada en `meli_orders`: se importa atómicamente como una venta por producto, deja que el trigger existente descuente el stock una vez y registra la comisión real (`sale_fee`) en cada línea y en `payment_transactions`. El navegador sólo selecciona la orden; el RPC toma productos del vínculo publicado, precio/costo/comisión de datos persistidos y sólo puede ejecutarlo `service_role`. Órdenes y publicaciones quedan de sólo lectura para el cliente, para que nadie pueda editar un payload descargado y convertirlo en una venta falsa. La prueba ZZ creó una orden de dos líneas, verificó la idempotencia, dos movimientos de Kardex, comisión y neto, y limpió todo. El botón vive en Integraciones y `meli-sync` quedó desplegada. Falta publicar desde la ficha, cron/webhook multi-organización y el costo de envío real de ML para completar C7/E4. Typecheck, lint sin errores, 908 tests y build/PWA completados; sin `.env`, no se abrió una sesión real en el navegador.

**Slice funcional 30 (2026-08-14):** C7 ya permite publicar desde una ficha de producto guardada. La Edge Function vuelve a leer título, precio, stock e imágenes desde la base; el navegador sólo ve hasta tres categorías que devuelve el predictor oficial de MercadoLibre y exige confirmar una antes de crear el ítem. Un producto ya vinculado devuelve su publicación existente en vez de lanzar otra. Vapers siguen bloqueados en UI y servidor, y la ficha muestra el enlace de un ítem ya publicado. `meli-sync` quedó desplegada como `ACTIVE` versión 19; para publicar de verdad todavía hace falta una cuenta OAuth conectada y completar los atributos que MercadoLibre exija para la categoría. Typecheck, lint sin errores (147 avisos históricos), 911 tests y build/PWA completados; sin `.env` ni una cuenta de prueba no se hizo una publicación real desde el navegador. C7 conserva como pendientes webhook y cron multi-organización; E4 todavía necesita el costo de envío real de MercadoLibre.

**Slice de confiabilidad 31 (2026-08-14):** `meli-sync` ya puede sincronizar todas las organizaciones conectadas desde cron: actualiza publicaciones, refresca hasta 50 órdenes y permite que una orden primero `pending` llegue después como `paid` sin perder vínculos de Core. Un stock negativo deja un error visible y no se maquilla como cero al marketplace. El cron no confía en la anon key pública: `20260814000015_meli_cron_sync.sql` crea un helper que lee `MELI_CRON_SECRET` de Vault, lo manda sólo al endpoint y queda revocado para `anon`/`authenticated`; la Function compara el mismo secreto. La migración, tipos y Function `meli-sync` `ACTIVE` versión 20 se verificaron contra la base. El secreto todavía no existe en Vault, por lo que hay **0 jobs** `meli-sync-orgs` programados a propósito: el dueño debe cargar el mismo valor en Vault y Edge Functions y reejecutar la migración para activarlo. Typecheck, lint sin errores (147 avisos históricos), 913 tests y build/PWA completados; no se llamó la API real sin una cuenta OAuth de prueba. Queda el webhook de MercadoLibre para cerrar C7; E4 sigue necesitando el costo de envío real del marketplace.

**Slice de confiabilidad 32 (2026-08-14):** `pull-orders` conserva el `shipment_id` de cada orden cobrada y consulta `GET /shipments/{id}/costs` con el formato vigente de MercadoLibre. Sólo guarda `senders[].cost`, el cargo final del vendedor; ausencia de shipment y un error de API siguen siendo `NULL`/error visible, nunca cero. `apply_meli_shipping_cost` prorratea el importe entre líneas por su total, conserva el último centavo y actualiza la ganancia de una venta ya importada sin volver a tocar stock. Una orden que entra después de llegar el costo lo aplica al importar. La verificación ZZ cubre dos líneas ($2.000/$6.000), $400 de envío repartido $100/$300, ganancias corregidas y cero restos. E4 ya tiene los cuatro importes de las ventas ML que MercadoLibre logra informar; falta la pantalla por producto. Queda el webhook de MercadoLibre y el secreto del cron como cierres externos de C7.

**Slice de confiabilidad 33 (2026-08-14):** una venta cobrada en la tienda propia ya persiste `cost_of_goods_ars`: antes calculaba `profit_ars` descontando el costo pero dejaba el costo de mercadería en cero, por lo que cualquier reporte que lo sumara veía una contabilidad incompleta. El costo se toma al cobrar y se guarda hacia adelante; no se reescriben órdenes históricas con el costo actual, porque eso inventaría evidencia. La prueba ZZ cobró una orden de dos unidades, verificó costo $4, ganancia $496, un único movimiento de stock, idempotencia, permiso cerrado y cero restos. Typecheck, lint sin errores, tests y build quedan como puerta del slice.

**Slice de cumplimiento 34 (2026-08-14):** cada campaña de WhatsApp ya agrega una baja personal de un solo uso. La Edge Function no acepta teléfonos ni texto desde el navegador: relee el borrador, los ids de clientes consentidos y las bajas vigentes, y sólo owner/admin puede enviarla. El saludo automático de cumpleaños aplica la misma exclusión y enlace. La baja borra el consentimiento, deja evidencia de opt-out y sólo se revierte ante un checkbox de checkout posterior y explícito; un token no se puede inventar ni reutilizar. La verificación ZZ confirma baja, idempotencia, reconsentimiento y cero restos; la tabla de tokens tiene RLS y cero policies. F6 queda hecho; No Llame (F7) sigue congelado hasta que exista una campaña telefónica.

**Slice funcional 35 (2026-08-14):** POS lee las reservas activas nacidas de órdenes online y las conserva por producto y variante. Cuando el carrito supera el stock físico disponible después de esas reservas, avisa al agregar y exige una confirmación explícita antes de cobrar; el mostrador todavía puede resolver la venta y la base continúa siendo la única que mueve Kardex y stock. Si no puede refrescar la lectura, informa el error y conserva el último snapshot para no convertir una caída momentánea en stock ficticio. Validado contra la tabla real y con una prueba de contrato de UI; typecheck, lint, tests y build quedan como puerta. Sin `.env`, no se abrió una sesión POS real en navegador.

**Slice funcional 36 (2026-08-14):** E4 deja de depender de cruces por fecha o nombre: las líneas de venta creadas al cobrar una orden de tienda guardan `ecommerce_order_id`, y `store_order_margin_facts` prorratea por línea la comisión realmente liquidada, el IVA y el envío cobrado al comprador, absorbiendo el último centavo para que cada total cierre. No rellena los vínculos históricos ni llama “costo” al envío que pagó el cliente: el costo final del correo queda explícitamente ausente hasta que llegue una etiqueta/contrato. La vista usa `security_invoker`, sólo la leen miembros autenticados, y la prueba ZZ verificó los enlaces, $80 de comisión en $20/$60, envío $25/$75, IVA $42/$126 y cero restos. Falta la pantalla por producto y el costo real del correo para declarar E4 cerrado.

**Slice funcional 37 (2026-08-14):** Analytics suma **Margen por canal**, una tabla producto × mostrador/tienda propia/MercadoLibre que sólo agrega importes persistidos. Costo de mercadería, comisión de cobro, costo real de envío e IVA deben existir todos para mostrar “Margen final”; un `NULL` llega como “Pendiente”, no como $0 ni una estimación. MercadoLibre aporta comisión y costo de envío cuando ya los informó; POS conoce envío cero pero todavía no su liquidación por línea; la tienda propia conserva comisión e IVA pero espera el costo final del correo. La pantalla no lee datos hasta abrir su tab y respeta el período compartido. Validada con cálculos puros, importación de `AnalyticsPage`, typecheck, lint, tests y build; sin `.env`, no se abrió una sesión real en navegador.

**Slice funcional 38 (2026-08-14):** C7 deja de depender solamente de consultar cada 15 minutos: `meli-webhook` recibe el tópico `orders`, lo encola sin guardar el body crudo y confirma rápido; su tarea de fondo vuelve a pedir la orden oficial con el OAuth del vendedor antes de actualizar `meli_orders` y conciliar el costo real de envío. El callback nunca crea ventas, stock ni precios, y repetirlo no vuelve a procesar una notificación sana. Una cuenta vendedora sólo puede pertenecer a una organización, porque de otro modo un mismo pedido tendría dos Business Cores posibles. La migración quedó aplicada y registrada, la Edge Function quedó desplegada y una llamada de recurso inválido respondió 400 sin filas ZZ. Validada con typecheck, lint sin errores, 932 tests y build/PWA; sin una cuenta ML conectada no se procesó una orden real. Falta que el dueño configure la Callback URL y el tópico Orders en el DevCenter, y que cargue el secreto del cron si también quiere el polling de respaldo.

**Slice funcional 39 (2026-08-14):** E3 deja de cruzar una venta online por nombre cuando ya conoce el email del comprador. Al acreditar una orden, `mark_store_order_paid` resuelve primero el perfil de CRM por email y pasa su `customer_id` a cada línea de venta; POS y tienda comparten entonces la misma ficha e historial. Si el CRM falla, el cobro y el stock no se frenan y el trigger conserva su fallback por nombre. Una prueba ZZ con dos homónimos verifica que el email de la orden gana y deja cero restos.

**Slice funcional 40 (2026-08-14):** C8 cierra la autoridad de la recepción de órdenes de compra: `receive_purchase_order` ahora exige owner/admin —igual que las tablas que modifica—, sólo acepta órdenes confirmadas y bloquea la orden y cada renglón antes de calcular lo pendiente. Dos entregas no pueden recibir las mismas unidades a la vez; cada recepción sigue creando una `purchase` para que el trigger sea el único que mueve stock. La verificación ZZ emula un JWT ajeno rechazado, recibe una entrega parcial y otra final como owner, y deja cero restos.

**Slice funcional 41 (2026-08-15):** una recepción parcial ya no se puede desalinear desde una edición directa: los renglones con recibos quedan inmutables, `quantity_received` y los estados `partially_received`/`received` sólo los actualiza el RPC que crea la compra y su asiento de stock. La UI deja de ofrecer editar una OC parcialmente recibida. El guard conserva la eliminación en cascada de una organización, para que proteger el historial no impida portabilidad ni borrado del tenant. Verificado contra la base con cambios directos rechazados, recepción final legítima y cero filas ZZ.

**Slice funcional 42 (2026-08-15):** la tienda ya no se declara lista sólo porque puede cobrar y cotizar. Términos y privacidad tienen que existir, no conservar una plantilla y estar publicados: un borrador queda explícitamente pendiente porque el comprador todavía no puede leerlo. El generador conserva su regla de crear borradores —el sistema no firma texto legal por el comercio— y ahora avisa que hay que revisarlos y publicarlos, sin volver a pedir los datos si ya hay borradores que sólo falta revisar. El estado de tienda enlaza directamente a Páginas legales y arranca conservador si no logra leerlas. Validado con pruebas puras para texto faltante, plantilla, borrador y publicación; no se alteró ni publicó contenido legal de ningún comercio.

**Slice funcional 46 (2026-08-15):** B4 deja de ser sólo un redirect: las tarjetas se pueden tokenizar dentro de la página de pedido mediante el SDK oficial de MercadoPago. La Edge Function relee la orden, ignora el monto del formulario, usa una clave de idempotencia por intento, valida la respuesta del proveedor antes de acreditar ventas o stock y cobra `application_fee` cuando la cuenta está conectada por OAuth. Si MercadoPago queda procesando, la pantalla bloquea un segundo cobro y vuelve a consultar el pedido. Billetera, efectivo y las conexiones legadas conservan el checkout externo, por lo que la mejora no deja a nadie sin medio de pago. La liquidación se comparte con el webhook para que la comisión real no dependa del canal. Las Functions `store-pay` v22 y `mercadopago-webhook` v28 quedaron `ACTIVE`; falta una compra completa con cuenta de prueba de MercadoPago antes de cerrar B4.

**Slice de confiabilidad 47 (2026-08-15):** una reversión real de MercadoPago ya no deja una orden como “pagada” y despachable. El webhook vuelve a leer el pago oficial y delega en un RPC cerrado a `anon`/`authenticated`; `refunded` y `charged_back` quedan diferenciados en la orden y en la liquidación, cancelan la preparación que todavía no salió y avisan a owner/admin. Si el paquete ya fue enviado o entregado, el sistema no inventa una devolución logística: lo conserva para revisión y avisa al comercio. Tampoco repone stock ni borra ventas al devolver dinero —la mercadería sólo vuelve con `return_store_order_item` y su asiento de Kardex—, y esa operación sigue disponible al recibir físicamente un producto de un pago revertido. Un pago tardío aprobado no puede reactivar una orden terminal ni un comprador puede reutilizarla para intentar cobrar otra vez. El panel muestra “Pago devuelto”/“Contracargo”, bloquea despacho y la tienda deja de ofrecer un pago nuevo en esa orden. La migración verificó contra la base una devolución sin delta de stock, contracargo con envío ya salido, bloqueo de re-aprobación, ACL y restos `ZZ = 0`; Functions `mercadopago-webhook` v29 y `store-pay` v23 están `ACTIVE`. Typecheck, lint sin errores (147 avisos históricos), **962 tests** y build/PWA completados; sin `.env` no se simuló un cobro en navegador ni se inventó uno.

**Slice funcional 48 (2026-08-15):** D4 deja de cobrar un cupo por cada renglón. `sale_transactions` es ahora la unidad comercial: un carrito de POS, una venta manual, cuotas, un presupuesto convertido, un pedido de tienda, MercadoLibre o una integración API consumen un ticket aunque tengan varios productos; `sales` conserva los renglones y el trigger/Kardex sigue siendo el único que mueve stock. Las altas del panel entran por `create_sales_transaction`, que toma organización y usuario del JWT, sólo acepta canales humanos, bloquea el insert directo y hace inmutable el ticket; el límite se aplica en la base con cerradura por organización y mes argentino. POS agrupa su carrito al vender y al sincronizar offline; Ventas agrupa su formulario nuevo; Cuotas y Presupuestos usan la misma puerta. Las líneas históricas no se reagrupan sin evidencia: el medidor comienza hacia adelante, sin inventar consumo. La API pública de servidor quedó además cerrada contra un payload que reemplazara tenant, usuario o producto; sólo admite el producto persistido de la organización de su API key. La verificación `ZZ` creó POS de dos líneas y canal de dos líneas, probó cupo, RLS, inmutabilidad y limpieza; `public-api` v25 quedó `ACTIVE`. Typecheck, lint sin errores (147 avisos históricos), **968 tests** y build/PWA completados; sin `.env`, no se simuló un comercio autenticado en navegador.

**Slice funcional 49 (2026-08-15):** C9 deja de prometer desde un total ficticio cuando la tienda usa sucursales. La configuración de Tienda permite elegir el depósito que despacha; al crear un pedido la base ignora cualquier ubicación enviada por el navegador, copia esa configuración a la orden y la hace inmutable. Reserva, venta, devolución y Kardex usan esa misma foto. Se agregó `location_variant_stock`: `location_stock` sólo suma el producto y no podía saber si el talle o mililitraje exacto estaba en el depósito. El disponible localizado descuenta también reservas globales históricas de forma conservadora, nunca habilita una sobreventa. Con una sola sucursal activa, el Kardex puede asignar allí un movimiento sin ubicación; con dos o más no inventa una distribución. `mark_store_order_paid` además conserva `variant_id`, bloquea la orden frente a webhooks simultáneos y registra la venta en el depósito correcto. La verificación ZZ probó que un payload no puede desviar el depósito, que una variante reserva/vende/devuelve en la ubicación elegida, que seis unidades no se aceptan desde un depósito con cinco aunque el total sea siete, RLS sin escritura anónima y limpieza completa. Typecheck, lint sin errores (**147 avisos históricos**), **62 archivos / 972 tests** y build/PWA completados; sin `.env`, no se simuló un comercio autenticado en navegador. Falta C9a: mover variantes entre depósitos desde la operación; el transferidor anterior sólo conoce productos agregados.

**Slice funcional 50 (2026-08-15):** C9a completa el movimiento físico de variantes entre depósitos. `transfer_stock_between_locations` acepta opcionalmente `variant_id`, bloquea el saldo exacto del origen y crea las dos puntas exclusivamente con `record_stock_movement`; el total global queda igual y `location_stock`/`location_variant_stock` cierran a la vez. Si un producto tiene variantes, la transferencia agregada queda bloqueada: operación debe elegir la presentación concreta. Sucursales muestra sólo el producto simple o cada variante que realmente tiene saldo en el origen; la tabla de historial conserva la variante. La verificación ZZ movió 3 de 5 unidades, comprobó origen 2/destino 3, total global 5, dos asientos, rechazo del agregado, ACL anónima cerrada y limpieza. Typecheck, lint sin errores (**147 avisos históricos**), **63 archivos / 975 tests** y build/PWA completados; sin `.env`, no se simuló una sesión autenticada en navegador. Se agrega C9b porque dar stock inicial o ajustar una variante con varios depósitos todavía no permite declarar la ubicación: no se debe completar por inferencia.

**Slice funcional 51 (2026-08-15):** C9b cierra el último ingreso ambiguo de variantes. `adjust_stock` acepta ubicación y, si la organización tiene más de una sucursal activa, la exige para una variante incluso ante un cliente manipulado; toma el saldo actual de `location_variant_stock`, calcula sólo su delta y lo registra por Kardex. Con una sola sucursal la asigna de forma determinista; sin sucursales conserva el modo global. Sucursales & Depósitos suma “Ajustar variante”: el operador elige depósito, presentación y saldo final. La ficha de Productos deja de ofrecer inputs globales de stock para variantes cuando hay varias sucursales y bloquea eliminar/cargar stock físico sin antes moverlo por el depósito. La verificación ZZ ajustó una variante de 0 a 4 en el segundo depósito sin alterar las 2 del primero, dejó total 6, rechazó el ajuste global, cerró anon y no dejó restos. Typecheck, lint sin errores (**147 avisos históricos**), **64 archivos / 978 tests** y build/PWA completados; sin `.env`, no se simuló una sesión autenticada en navegador. C9 queda técnicamente completo; falta evidencia de uso con un segundo comercio real, no otra estructura de inventario.

**Slice de confiabilidad 52 (2026-08-15):** D8 deja de depender de un archivo legacy por usuario. `weekly-backup` ahora crea snapshots privados por **organización** sólo para planes con `backups_enabled`: captura el contrato operativo común con D5, rechaza cualquier tabla truncada o con error, registra manifiesto, hash SHA-256, tamaño, cantidad de tablas/filas, vencimiento y quién lo inició. No expone la ruta del bucket ni el hash al navegador: el owner pide historial, verificación o una URL firmada de 60 segundos a la Edge Function; RLS deja a un dueño ver lo suyo, a un ajeno cero y a `anon` sin permiso. Cada snapshot se descarga de nuevo al crearse y el cron vuelve a validar los de la semana antes de considerar cubierta la organización. Se conservan ocho snapshots / 56 días; el cron de domingos 03:30 UTC sólo se agenda si `BACKUP_CRON_SECRET` está tanto en Vault como en la Function. Al ejercitarlo, el timeout HTTP legacy de 5 s dejó un falso fallo aunque el trabajo seguía; `weekly-org-backups` usa ahora su helper privado con ventana de 60 s y respondió 200. Contra la base vinculada se probaron RLS, ACL, cascade y limpieza `ZZ`; luego el cron protegido generó y verificó los **4** snapshots de organizaciones habilitadas, sin modificar datos comerciales. D8 no se declara terminado: falta un drill de restore aislado que pruebe recuperación sin una escritura destructiva sobre producción. Typecheck, lint sin errores (**147 avisos históricos**), **65 archivos / 981 tests** y build/PWA completados; sin `.env`, no se simuló una sesión autenticada en navegador.

**Slice de confiabilidad 53 (2026-08-15):** D7 deja de obligar al comercio a preguntar por WhatsApp si el sistema está caído. `/estado` es público y consulta sólo `get_public_service_status`: una función `SECURITY DEFINER` que devuelve tres señales agregadas —Aplicación, Tareas programadas y Respaldos— con los únicos estados `operational`, `degraded`, `unknown` o `not_applicable`. No hay uptime inventado: la aplicación está operativa sólo porque la consulta respondió; una tarea sin historial queda “sin datos” y un último fallo queda como incidencia. Tampoco se filtran organizaciones, cantidad/nombre/comando de jobs, proveedores, logs, respuestas HTTP ni errores internos. La migración verificó como `anon` ACL, contrato de tres componentes y estados permitidos; la fuente respondió las tres señales operativas contra la base vinculada. La landing enlaza al estado. Typecheck, lint sin errores (**147 avisos históricos**), **66 archivos / 987 tests** y build/PWA completados; sin `.env`, no se abrió una sesión real de navegador.

**Slice funcional 54 (2026-08-15):** D3 cierra el canal de comunicación operativa sin convertirlo en un banner de marketing ni abrir una nueva superficie pública. El superadmin administra borradores, publicaciones programadas, vigencia, CTA interna y archivo desde `/platform/anuncios`; publicar, despublicar y archivar dejan auditoría. Gestión consulta un RPC con proyección mínima y muestra sólo el aviso vigente; la tienda pública, compradores de tienda, borradores, historial y descartes de otros usuarios quedan fuera. Cada miembro puede descartar un aviso para su cuenta sin ocultarlo a otro comercio. La migración se ejercitó contra la base vinculada como roles reales: superadmin publicó, miembro vio y descartó, un usuario sin membresía no recibió filas, `anon` no puede ejecutar los RPC, el acceso directo a tablas quedó revocado y los restos `ZZ` quedaron en cero. Typecheck, lint sin errores (**147 avisos históricos**), **67 archivos / 992 tests** y build/PWA completados; sin `.env`, no se abrió una sesión autenticada para una verificación visual real.

**Slice de confiabilidad 55 (2026-08-15):** D5 deja de perder cinco relaciones operativas porque la tabla hija no tenía `org_id`: `bundle_items`, `price_list_items`, `purchase_request_items`, `customer_segment_members` y `store_order_status_email_log` se exportan desde el FK del padre que ya pertenece a la organización. Cada relación primero cuenta todos los renglones por bloques de 200 IDs; si el padre falló/truncó o la hija supera 50.000 filas, la tabla queda explícitamente incompleta y el backup no se da por válido. El contrato sube a snapshot v2, pero `validateSnapshot` conserva v1 para que una ampliación no convierta los backups históricos sanos en fallidos. La consulta de catálogo contra la base vinculada confirmó los cinco FKs y que hoy tienen 0 filas; no se alteró dato real. `export-organization-data` v10 y `weekly-backup` v31 quedaron `ACTIVE` con JWT; el cron protegido procesó las 4 organizaciones habilitadas, completó 4 snapshots v2 y dejó 0 incompletos, mientras los 4 v1 históricos siguen verificados. Falta el importador/restauración asistida y quedan otras relaciones no cubiertas: D5 continúa parcial. Typecheck, lint sin errores (**147 avisos históricos**), **68 archivos / 995 tests** y build/PWA completados; sin `.env`, no se abrió una sesión autenticada de navegador.

**Slice de confiabilidad 56 (2026-08-15):** D5 suma otros tres historiales que el comercio sí necesita recuperar: `delivery_events` desde `deliveries`, `invoice_items` desde `invoices` y `drip_send_log` desde `drip_enrollments`. Los tres FKs se comprobaron contra el catálogo y sus tablas tienen 0 filas hoy; no se tocó un dato comercial. El contrato pasa a snapshot v3 y `validateSnapshot` conserva tanto v1 como v2: los backups previos siguen siendo archivos íntegros, pero no cuentan como cobertura v3 para la siguiente corrida. `weekly-backup` v32 y `export-organization-data` v11 quedaron `ACTIVE` con JWT; el cron protegido 2741 procesó 4 organizaciones, completó 4 snapshots v3 y dejó 0 incompletos, conservando 4 snapshots verificados de cada versión anterior. D5 continúa parcial hasta que un importador/restauración asistida cubra las demás relaciones sin `org_id`; no se promete restore. Typecheck, lint sin errores (**147 avisos históricos**), **68 archivos / 995 tests** y build/PWA completados; sin `.env`, no se abrió una sesión autenticada de navegador.

**Actualización de foco (2026-08-15):** este documento queda reconciliado hasta el slice 56. La base técnica de MercadoLibre ya publica, importa órdenes `paid`, concilia comisión/envío del vendedor, recibe el webhook y tiene cron multi-organización protegido; todavía no es evidencia comercial hasta conectar una cuenta real, configurar Callback URL + tópico `Orders` y cargar el secreto del cron. El Brick de tarjeta ya reduce un salto del checkout y ahora conserva una reversión sin dejar despachos engañosos, pero no se declara completo hasta verificar aprobado, rechazado, pendiente y reversión con credenciales de prueba sin tocar una tarjeta ni una orden real. D4 ya mide la unidad que el comercio y el inversor entienden —tickets, no líneas—; su único remanente es decidir y aplicar una cuota de tiendas por plan, que requiere una decisión explícita de packaging/precio. C9 ya tiene cadena completa —ingreso/ajuste, transferencia, reserva, venta y devolución por depósito— y queda pendiente sólo de uso real con un segundo comercio. D3 y D7 dan un canal visible y un lugar público honesto para comunicar una incidencia; D5 ahora conserva ocho relaciones operativas sin confundirlo con un restore. D8 aporta evidencia de recuperación de archivo, no evidencia de restore: el proyecto no tiene ramas preview ni Docker local, por lo que D8b necesita un sandbox explícito antes de poder ensayarse. Para inversión, el próximo hito no es otra pantalla sino evidencia fechada: AFIP homologado, segundo comercio real activado, una primera venta omnicanal medida y un restore drill aprobado.

## 1. Qué es

Una plataforma para comercios argentinos, con tres partes:

1. **Gestión** — stock con variantes, POS con caja, ventas, compras, clientes,
   deudas, finanzas, canjes con influencers y marketing. Es el núcleo y lo más
   maduro.
2. **Tienda online** — cada organización tiene su vitrina que vende de verdad,
   con carrito, cupones, envíos, cobro y cuentas de comprador.
3. **Plataforma** — el panel desde donde se administran todas las
   organizaciones del SaaS.

El caso de uso que lo originó y lo sigue guiando: **importación y venta de
perfumes y vapers**. Cuando una decisión de producto está en duda, gana la que
sirve a ese negocio.

📌 **Tesis 2026-08-14.** Gestiona no es una alternativa a Tiendanube: es el
**sistema operativo para comercios que venden en múltiples canales**. La tienda
es una superficie. El producto es el núcleo que une inventario, ventas,
clientes, pagos, costos, impuestos y margen en una sola verdad operativa.

---

## 2. Contra quién compite

⚠️ **Esta sección estuvo mal planteada y se corrigió en la sesión 111.** El
posicionamiento, la competencia real y qué habría que medir viven ahora en
**[docs/ESTRATEGIA.md](docs/ESTRATEGIA.md)**, que separa lo medido de lo
supuesto. Acá queda sólo lo que afecta decisiones de código.

**Lo que hay que dejar de decir: "Tiendanube no tiene POS".** Está verificado
en su [ayuda oficial](https://ayuda.tiendanube.com/pdv/que-es-punto-de-venta-de-tiendanube),
actualizada el 2026-06-02: Punto de Venta está disponible en Argentina. Por eso
la discusión no es POS sí/no, sino qué sistema mantiene una verdad operativa y
un margen por canal que pueda auditarse.

**La categoría ya existe.** Tiendanube comunica POS y stock entre canales;
Contabilium, VentaWeb, Axon y Max24 quedan como alternativas locales aún sin
verificar. Eso es buena noticia: no hay que convencer a nadie de que el
problema es real. Y es mala: **"gestión + tienda" ya no alcanza como
diferencial**.

Dónde este sistema es realmente distinto, y por qué es difícil de copiar:

| | Acá | Plataforma de ecommerce | ERP / sistema de gestión |
|---|---|---|---|
| **Costo real de la mercadería** (USD, aduana, tipo de cambio) | ✅ `total_cost_usd` | ❌ no lo conoce | ✅ |
| **Comisión del medio de pago y del marketplace** | ✅ liquidación / `sale_fee` cuando el proveedor la informa | ✅ | ❌ no la conoce |
| **Costo de envío por zona** | 🟠 ML lo concilia; tienda propia aún no recibe el costo final del correo | ✅ | parcial |
| **IVA por producto** | ✅ `products.tax_rate`: NULL hereda la tasa de la organización y 0 es exento; la orden conserva la tasa y la base por línea | parcial | ✅ |
| **→ Margen real por canal** | 🟠 muestra cada término y el faltante; falta evidencia completa en todos los canales | ❌ le falta el costo | ❌ le faltan las comisiones |

Ese es el punto: **el margen real por canal necesita las cuatro cosas a la vez**,
y cada familia de producto tiene dos o tres. Acá se pueden vincular sin salir
del Business Core; E4 ahora hace visibles los términos que ya existen y, con la
misma claridad, los que todavía faltan. Es el ítem **E4**.

---

## 3. Las tres superficies

| Superficie | Ruta | Quién entra | Aislamiento |
|---|---|---|---|
| Gestión | `/` | miembros de una org (`memberships`) | RLS por `org_id` |
| Plataforma | `/platform` | staff del SaaS (`platform_admins`) | no da permisos dentro de una org |
| Tienda pública | `/tienda/:slug` | comprador anónimo o con cuenta | RPCs `security definer` con columnas saneadas |

La separación es deliberada y está testeada. Ver [docs/permisos.md](docs/permisos.md).

### Brújula de producto

El análisis externo del 2026-08-14 dejó una advertencia útil: el riesgo no es
quedarse corto, es convertirse en una **ERP feature factory**. A partir de acá,
una mejora entra al ROADMAP sólo si fortalece uno de estos cinco pilares:

1. **Productos + inventario** — un stock, reservas claras, costos reales.
2. **POS + caja** — vender aunque internet falle, sincronizar sin duplicar.
3. **Ecommerce** — la tienda vende de verdad, pero no manda sobre el negocio.
4. **Clientes + ventas** — una ficha de cliente entre local, web y canales.
5. **Inteligencia** — no "tener IA"; decir qué hacer y medir si se hizo.

El corazón técnico se llama **Business Core**: productos, órdenes, clientes,
finanzas e inventario. POS, tienda y marketplaces son canales que escriben y
leen de ese núcleo; ninguno inventa su propio stock, precio, margen o cobro.

Antes de agregar un ítem nuevo, tiene que responder al menos una pregunta:

- ¿Acerca a un segundo comercio real a su primera venta?
- ¿Hace más confiable el stock único entre POS, tienda y marketplaces?
- ¿Hace visible el margen real por canal?
- ¿Reduce riesgo legal, fiscal, de seguridad o de operación?
- ¿Mide activación, uso omnicanal, GMV, salud, retención o una acción de IA?

Si la respuesta es "no", va a **Congelado** aunque sea una buena idea.

---

## 4. Estado por módulo

**Anda** = funciona en producción. **Parcial** = funciona y le falta algo
concreto. **Sin uso** = construido y verificado, pero ninguna operación real lo
atravesó.

| Módulo | Estado | Qué falta |
|---|---|---|
| Stock, variantes, multi-depósito | Anda | — |
| POS y caja | Parcial | **C12**: el precio y el costo todavía vienen del navegador |
| Ventas, compras, proveedores, CRM, deudas | Anda | — |
| Tienda online + checkout idempotente | Anda | Ver §5 fase 4 |
| Cobro MercadoPago (OAuth + comisión real) | Anda | — |
| **Idempotencia** | Parcial | Sólo el checkout. Falta cobro, captura, reintegro, factura, recepción (**I6**) |
| **Eventos con outbox** | Anda, sin uso real | 2 eventos emitidos, ninguno de una venta |
| **Ledger de partida doble + costo de ventas** | Anda, **sin uso real** | **0 asientos**: ninguna venta lo atravesó |
| **Billetera** | Parcial | Derivada del libro; sin movimiento real |
| **AFIP** | Parcial | ✅ CAE en homologación. Falta emitir **por la app** y pasar a producción |
| Suscripción del SaaS (MercadoPago) | Parcial | Nunca cobró una cuota real |
| Envíos por zona / correo | Parcial | Payloads según doc publicada, sin contrato real |
| MercadoLibre | Parcial | Publica e importa; falta cron multi-org |
| IA (chat, insights, OCR) | Parcial | Real desde la sesión 115. Requiere `ANTHROPIC_API_KEY` |
| Email / WhatsApp marketing | Parcial | Requieren `RESEND_API_KEY` / Evolution API |
| Permisos, MFA, auditoría, RLS | Anda | — |
| Tests | Anda | **1137** (`npm test`, 2026-08-20) + E2E de tienda |

Lo que dice "requiere una clave" no está roto: está construido esperando un
secreto. Ver [docs/CONFIGURACION.md](docs/CONFIGURACION.md).


## 5. Paridad con Tiendanube / Empretienda

### Ya está

Home con secciones · listado con filtros y orden en la URL · ficha con galería y
perfil olfativo · **variantes** con precio y stock propios · carrito persistente ·
cupones · **envío por zona, Correo Argentino y Andreani** · retiro en local ·
**cobro con MercadoPago por OAuth** (cada comercio conecta su cuenta con un
clic) · comisiones descontadas del margen · cuentas de comprador con historial ·
carritos abandonados con recuperación · emails transaccionales · SEO con Open
Graph y sitemap servidos a los bots · **píxeles de Meta, GA4 y TikTok** ·
**reseñas de compra verificada** · **páginas de contenido** (devoluciones,
FAQ, términos) con plantillas argentinas · **banners con vigencia** ·
**filtro por rango de precio** · **lista de deseos** · **aviso de reposición**
(sin necesidad de cuenta) · **etiqueta de envío imprimible y seguimiento** que
el comprador ve sin cuenta · **comisión por transacción cobrada de verdad** ·
**descuento por medio de pago** (10% con transferencia, calculado en la base) ·
**feed de productos para Google Shopping y Meta** ·
**cuotas reales de MercadoPago en la ficha** (consultadas a la cuenta del
comercio, no declaradas) · **7 temas y tipografía elegible** · dominio propio.

### El camino

📊 Antes de elegir: [docs/COMPARACION.md](docs/COMPARACION.md) tiene el
relevamiento contra Tiendanube, Empretienda y Shopify medido el 2026-08-21, y
la lista de lo que falta para operar como una empresa grande. Dos cosas de ahí
cambian el pitch: **Tiendanube ya tiene POS** (perdimos ese diferencial) y
**no factura ARCA de forma nativa** (ganamos uno mejor).


⚠️ Los bloques A–I de abajo son el **catálogo de referencia**. Esto es el plan.

---

#### Dónde estamos — medido 2026-08-20

| | |
|---|---|
| Tablas · con `org_id` | 332 · 284 |
| Tests | 1137 |
| Organizaciones | 4 · **1 vende de verdad** |
| Ventas POS · órdenes online | 34 · 6 |
| **Motores propios** | idempotencia, eventos con outbox, ledger de partida doble, ledger de stock, billetera, rate limiting |
| **AFIP** | ✅ **primer CAE obtenido** (homologación, CUIT 20446484436). ⚠️ Por `openssl`/`curl`, **no por el circuito de la app**: 0 comprobantes emitidos desde el sistema |
| Cobro | MercadoPago OAuth con comisión real · suscripción del SaaS también por MP |
| Eventos emitidos · asientos | 2 · **0** |
| **Ledger conectado a** | órdenes online **y, desde H8, mostrador**. Antes el libro no sabía del canal con el 85% de las ventas |
| Facturas · con CAE | **0 · 0** — la de la sesión 114 se emitió y después se borró desde el panel |
| **Ventas cobradas sin comprobante** | **2** (medido 2026-08-21). Desde C16 el panel de Facturas lo dice y ofrece generarlos |

⚠️ **El dato que ordena todo:** los motores existen y están verificados, pero
**el ledger tiene 0 asientos**. Ninguna venta real los atravesó. Un motor que
nunca corrió en tráfico no está probado: está escrito (R11).

---

#### FASE 0 — Vender legalmente · casi cerrada

| Qué | Estado |
|---|---|
| C1 AFIP contra el organismo | 🟡 CAE en homologación. Falta emitir **por la app** y pasar a producción |
| ~~C16~~ Las cobradas sin comprobante, visibles | ✅ Sesión 117. `ordenes_sin_facturar` existía desde C13 y **no la leía ninguna pantalla**; ahora Facturas muestra cuántas son y por cuánto, y las genera en una pasada. Una orden que falla no aborta el resto y vuelve con el motivo |
| ~~C12~~ Autoridad de precio del POS | ✅ Sesión 116. El costo y la ganancia los calcula el servidor; el precio admite override registrado |
| F1+F3 Privacidad y datos del proveedor | 🟡 Generador listo; falta cargar CUIT/domicilio y publicar |
| ~~F10~~ El flete de vuelta lo paga el vendedor | ✅ Ya estaba. Medido 2026-08-21: `return_requests` tiene `return_shipping_payer/amount/method/notes` y el trigger `trg_return_requests_return_shipping`. Esta línea decía "no modelado" mientras el bloque F lo daba por hecho |

**Salida:** una factura con CAE emitida desde el sistema, y alta de comercio sin incumplir nada.

---

#### FASE 1 — Que otro lo use, y medirlo

| Qué | Estado |
|---|---|
| D2 Onboarding guiado | 🔴 Lo más importante de esta fase |
| G1–G5 Instrumentación | 🔴 Sin esto no hay condición de salida medible |
| D4 Límites del plan | 🟠 Sólo productos |
| R12 Primera suscripción cobrada de punta a punta | 🔴 MP configurado, nunca cobró |
| ~~H8~~ El mostrador entra al libro | ✅ Sesión 117. `venta.registrada` por ticket → asiento con caja/banco/deudores, IVA según quién emite y costo de la mercadería. Fiado va a Deudores, no a Caja. Verificado con 18 pasos incluyendo cobro dividido |

**Salida:** un segundo comercio real cargó stock, publicó y cobró.

---

#### FASE 2 — Que el diferencial se vea

| Qué | Estado |
|---|---|
| **E4 Margen real por canal** ⭐ | El diferencial. Los cuatro datos ya están |
| C7 MercadoLibre completo | Publica e importa; falta cron multi-org |
| E2 Stock del local = stock de la tienda | Casi: falta avisar al vender algo reservado |
| C9 Multi-depósito en la tienda | Vende contra el total, no contra el depósito |

**Salida:** vender por dos canales con un stock y ver qué canal deja más margen.

---

#### FASE 3 — Aguantar varios comercios

D6 impersonation visible · C11 auditoría interna · D8 backup con restore probado ·
D5 portabilidad · D3 anuncios · D7 estado del servicio · F9 contrato de datos.

---

#### FASE 4 — Conversión de la tienda

Bloque B. Primeros: B3 checkout en un paso · B5 avisos de estado (ya tienen
`shipped_at`/`delivered_at`) · B13 carrito entre dispositivos.

---

#### Lo que sigue, en orden

1. ~~**I6**~~ — ✅ **Sesión 116, auditado camino por camino.** Se midió cuál faltaba en vez de envolver los cuatro: `mark_store_order_paid`, `return_store_order_item` y `facturar_orden_pagada` ya se protegen solas. **La recepción parcial de compra no**: verificado contra producción, recibir 4 de 10 dos veces dejaba **8**. Cerrado con `receive_purchase_order_idem`.
2. ~~**C12**~~ — ✅ **Sesión 116.** Verificado el agujero antes de taparlo: el navegador decía "precio 1, costo 0, ganancia 999999" sobre un producto de USD 20 que vale $100.000, y **la base guardaba eso**. `create_sales_transaction_v2` recalcula: el precio admite override del cajero y queda registrado con el que correspondía; **el costo y la ganancia se pisan siempre**. Ahora ese mismo ataque guarda ganancia −31.999, que es la pérdida real.
3. **AFIP por la app** — el CAE ya sale; falta que salga desde el circuito.
4. ~~**K1**~~ — ✅ **Sesión 2026-08-21.** `product_types`, `attribute_definitions`
   y `product_attribute_values` ya están en producción con RLS y validación de
   organización/tipo. La ficha de Producto permite asignar el tipo y persistir
   valores estructurados sin tocar `custom_fields` existentes.
5. **E4** — margen por canal.
6. **K2** — carrito del lado del servidor.
7. **I8** — moneda del costo: `cost_usd` asume dólares y no hay columna de moneda. Medido: los 59 productos son USD 7–165, así que hoy está bien; se rompe en silencio con el primero en pesos.

📌 **Los primeros tres cierran el circuito de plata. K1 abre el producto a otros
rubros.** Ese es el orden: primero que lo que hay no pierda plata, después que
sirva para otro negocio.

---

#### Commerce Kernel — medido contra la arquitectura de destino

✅ **Auditado el 2026-08-20** contra la visión de `docs/ARQUITECTURA.md`: el
storefront no puede ser una feature, tiene que ser un motor al nivel del ERP.

**Ya está** — variantes con precio y stock propios · listas de precio (2 tablas) ·
promociones declarativas con condiciones y efectos · **motor de reservas** ·
devoluciones con RMA · CMS de páginas · temas (7) · API keys · webhooks (3) ·
ledger de stock · ledger financiero · idempotencia · eventos con outbox.

**Falta, y en este orden:**

| # | Pieza | Por qué bloquea |
|---|---|---|
| **K1** | **`product_types` + `attribute_definitions`** | ✅ **Cerrado 2026-08-21.** Tipos, atributos y valores tipados viven en tablas propias, con validación de organización y compatibilidad de tipo. `category` y `custom_fields` quedan como compatibilidad para los productos existentes. |
| **K2** | **Carrito del lado del servidor** | Vive en `localStorage` por slug. Sin esto no hay carrito entre dispositivos (B13), ni carrito armado por un vendedor, ni de WhatsApp al checkout. |
| **K3** | **`domains`** — dominio propio por tienda | Tiendanube lo tiene. Necesita verificación DNS, SSL automático, redirects y resolución por hostname. **No hardcodear Vercel**: va detrás de una abstracción de proveedor. |
| **K4** | **`markets`** — país, moneda, idioma, impuestos | Hoy Argentina está en el núcleo. La fiscalidad debería salir a un *country pack* antes de que haya un segundo país. |
| **K5** | **Máquinas de estado explícitas** en orden, pago y fulfillment | Hoy son campos de texto. `order.status = input` en vez de `confirmar()` es de donde salen los estados imposibles. |
| **K6** | **Feature flags** | Sin esto, toda feature grande sale para todos a la vez. |
| **K7** | **`SearchProvider` como interfaz** | La búsqueda difusa (B10) es buena y vive en el cliente. Cuando el catálogo crezca hay que poder cambiar el motor sin tocar la tienda. |

⚠️ **K2 es la única pieza del kernel que vale antes de un segundo comercio.** K1
ya está cerrado porque define si el catálogo puede modelar otro rubro; K2 porque
el carrito en `localStorage` es una limitación que se nota vendiendo. K3 a K7 esperan
evidencia — medido: **1 tienda, 1 organización con tienda, 0 listas de precio
cargadas, 0 promociones activas**. Construir multi-market para eso es adivinar.

📌 **Regla del kernel:** el núcleo **no conoce el rubro**. Nada de
`if (categoria === 'perfume')`. Los verticales aportan atributos, defaults y
presets — nunca ramas en el motor.

---

#### Innovaciones — lo que las fundaciones habilitan

Nada de esto se empieza antes de cerrar la fase 1. Está acá porque **H2 y H3 lo
volvieron barato**, no como permiso para construirlo.

| | Qué | Por qué ahora es barato |
|---|---|---|
| I2 | Conciliación de MercadoPago contra el libro | Con el ledger es una consulta, no un proyecto |
| I3 | Reintegro real por MercadoPago | El libro sabe asentarlo; falta la llamada con idempotencia |
| I4 | Notificaciones nuevas | Pasó a ser un INSERT en `event_subscriptions` |
| I5 | Webhooks para el comercio | El outbox ya entrega con firma, reintento y descarte |
| I7 | Trazas | Falta el paso que queda del principio 11 |
| E1 | Precio único mostrador/online con margen a la vista | Consecuencia natural de E4 |

**Business Copilot** (ESTRATEGIA §2.4): la IA sobre el grafo del negocio —qué
comprar, qué canal deja menos margen, qué cliente se enfría— con acción posible
y `AI Action Rate` medido. El chat ya es real desde la sesión 115.

---

#### 🧊 Congelado

Multi-moneda · reseñas con foto · comparador · preventa · push · automatizaciones
visuales · reportes programados · marketplace de apps · LATAM · multi-store ·
dominios propios · theme engine · headless · search dedicado · multi-región.

**Todo espera un segundo comercio, no una decisión de arquitectura.** B9 va acá
por un motivo medible: la ficha olfativa está vacía en las 30 filas.

---

#### ⛔ Bloqueado por fuera del código

Certificado AFIP de **producción** · tarifas de envío reales y contrato con el
correo (B1, B2, B11, B12) · conteo físico de inventario (C2) · pesar una caja
(C3) · 10 fotos y 33 descripciones (C4) · abogado para F9 y F14.

### Los bloques, en detalle

Lo que sigue es la referencia: cada ítem dice **qué hace la competencia**, **qué
hay hoy acá** y **por qué importa**, con el estado medido contra la base.

---

#### A. El circuito de plata

Bugs y faltantes de lógica, no features. Van primero porque cada uno cobra mal
en producción.

| # | Qué | Estado |
|---|---|---|
| ~~A1~~ | ~~`min_order_value` de las promociones no se aplicaba~~ | ✅ Sesión 104. Dos pasadas: condiciones de orden primero, efectos de línea después. |
| ~~A2~~ | ~~No se reservaba stock entre la orden y el pago~~ | ✅ Se reserva al crear y se libera por vencimiento. |
| ~~A3~~ | ~~`tax_amount` siempre en cero~~ | ✅ El IVA de la orden se discrimina. |
| ~~A4~~ | ~~Cupones sin mínimo ni límite por persona~~ | ✅ Y `create_store_order` llama a `check_store_coupon` en vez de repetir la validación: el RPC es público y una llamada directa salteaba las reglas. |
| ~~A5~~ | ~~Cupón de envío gratis~~ | ✅ Sesión 98, commiteado en la sesión 111. `coupons.free_shipping` con tope opcional; se descuenta del envío y queda en `shipping_discount_ars`, separado del descuento de mercadería para no correr la base del IVA. Un cupón que no bonifica nada —retiro en tienda— se rechaza en vez de consumirse. Falta la promoción automática **acotada a categoría o producto** — "envío gratis en perfumes" sin código. |
| ~~A6~~ | ~~Devoluciones de órdenes online~~ | ✅ Sesión 106 + Slice 47, la capa de datos: `returns.ecommerce_order_id` + `return_store_order_item`, que repone el stock por `record_stock_movement`, no deja devolver más de lo comprado y también permite registrar el retorno físico después de un reembolso/contracargo. **Falta la UI y el reintegro real por MercadoPago**, que necesita el token del comercio y va en una Edge Function. |
| ~~A7~~ | ~~Las promociones no registran uso~~ | ✅ Sesión 105. Se registra el ahorro atribuible a la promoción —no el descuento total— para que la métrica no dependa de cómo pagó el comprador. |
| ~~A8~~ | ~~Precios con IVA discriminado por producto~~ | ✅ Sesión 110. `products.tax_rate`, **NULL = la de la organización** (0 es exento, que es distinto). El IVA se calcula por línea y se suma; los descuentos de orden se prorratean con `prorratear()` para que las bases sumen el total; el envío va a la tasa de la organización porque es un servicio. Verificado con tres alícuotas en una orden: 268,57 contra 520,66 de la tasa única. |
| ~~A9~~ | ~~Redondeo declarado~~ | ✅ Sesión 110. `decimales_de_moneda` / `redondear_moneda` / `prorratear` en SQL, espejados en `src/lib/rounding.ts` con 19 tests. Media unidad hacia arriba **en valor absoluto** (`Math.round(-0.5)` da `-0`, y un reintegro se redondeaba para el lado equivocado). B6 ya no está bloqueado por esto. |
| ~~A10~~ | ~~Historial de precios~~ | ✅ **Ya estaba hecho y este ROADMAP lo daba por faltante.** Medido: `price_history` tiene 656 filas, 627 con autor, último cambio 2026-08-07, trigger `trg_record_price_change` y `PriceSparkline` mostrándolo. |

**Hacia dónde va el modelo de descuentos.** Un descuento tiene *condiciones de
orden* (mínimo, primera compra, segmento) y *efectos de línea* (porcentaje,
monto, precio fijo). Acá ya se evalúa en ese orden desde A1. Lo que falta para
igualar a Shopify es el campo **`combines_with`** por promoción: hoy la regla es
"gana el mejor, nunca la suma", que es más segura pero no deja hacer "10% off +
envío gratis" a propósito. Si se agrega, va como campo explícito por promoción —
**nunca aflojando la regla general**.

---

**El bloque A está cerrado.** Lo que queda de plata es fiscal (C1, AFIP contra el organismo) y de producto, no bugs de cálculo.

---

#### B. Tienda online — lo que el comprador nota

| # | Qué | Estado | Referencia |
|---|---|---|---|
| **B1** | **Revisar las tarifas de envío** | 1 provincia de 24 tiene tarifa. `Completar el tarifario` las estima; falta contrastarlas con el correo. | Todas |
| **B2** | **Etiqueta por API del correo** | La imprimible funciona; la de Correo Argentino y Andreani necesita contrato. | Tiendanube |
| ~~B3~~ | ~~Checkout en un paso~~ | ✅ Slice 44. Un solo formulario responsive muestra datos, entrega, pago, cupón y resumen; no hay pasos ni cuenta obligatoria. El retiro se ofrece sin pedir provincia y la entrega exige domicilio utilizable. | Empretienda, Shopify |
| **B4** | **Pago embebido (Checkout Bricks)** | 🟡 Slices 46–47: tarjetas de crédito/débito/prepaga se cobran dentro de la página con el SDK oficial, total y comisión revalidados en servidor e idempotencia; refund/contracargo bloquean despacho y reintento sobre la misma orden sin inventar stock. Sólo se habilita para OAuth con clave pública; billetera, efectivo y conexiones legadas siguen por checkout externo. Falta una pasada aprobada/rechazada/pendiente/revertida con cuenta de prueba antes de cerrarlo. | Tiendanube, ML |
| ~~B5~~ | ~~Avisos de cada cambio de estado~~ | ✅ Slice 45. El operador avanza una orden preparada y paga a “en camino” y luego “entregada”; el comprador recibe un email idempotente por cada evento y conserva seguimiento sin cuenta. | Todas |
| **B6** | **Multi-moneda** | Todo en ARS. `currency` existe y no convierte. Necesita A9 primero. | Shopify |
| **B7** | **Reseñas con foto** | Hay reseñas verificadas, sin imagen. | ML |
| **B8** | **Comparador y "visto recientemente"** | No existe. | ML |
| **B9** | **Filtros por atributo en el catálogo** | Sólo categoría, precio y género. La ficha olfativa está **vacía en las 30 filas**, así que un filtro por familia filtraría sobre nada: primero hay que cargar los datos. | Tiendanube |
| ~~B10~~ | ~~Búsqueda con corrección de tipeo~~ | ✅ Sesión 110. Damerau-Levenshtein con tolerancia **por largo del término** (≤3 exacto, 4-6 un error, ≥7 dos): con tolerancia fija "oud" matchearía "sud". Literal primero y difuso **sólo si no hay ninguna** — nunca mezclados. Verificado contra producción: "lataffa" trae 7 Lattafa, "zapatillas" trae 0. | ML |
| **B11** | **Envío a domicilio con cálculo por código postal real** | Se cotiza por provincia. El CP se pide y no afina la tarifa. | Todas |
| **B12** | **Retiro en punto de entrega (pickup points)** | Hay retiro en local. Faltan sucursales de correo. | Tiendanube, ML |
| **B13** | **Carrito persistente entre dispositivos** | Vive en `localStorage`: se pierde al cambiar de teléfono a compu aunque haya sesión. | Shopify |
| **B14** | **Preventa y reservas** | Un producto sin stock ofrece aviso de reposición, no comprar por adelantado. | Tiendanube |

---

#### C. Gestión — lo que el comercio necesita

| # | Qué | Estado | Referencia |
|---|---|---|---|
| **C1** | **AFIP probado contra el organismo** | Configuración por organización activa, secretos fuera del navegador y prueba WSAA real. Falta certificado de homologación y una factura emitida. | Todas las argentinas |
| **C2** | **Contar el inventario físico** | La herramienta usa sesiones auditadas y deja visibles los descuadres. Falta que el dueño cuente y corrija los productos reales con Kardex ≠ stock. | — |
| **C3** | **Cargar el peso de los productos** | 59 de 60 en cero. El botón los estima; falta pesar una caja. | — |
| **C4** | **Fotos y descripciones** | 10 sin foto, 33 con descripción corta. El panel de calidad los rankea. | ML |
| **C5** | **App en el celular con notificaciones** | Hay PWA y POS offline. Falta el push de "vendiste" y "sin stock". | Tiendanube app |
| **C6** | **Motor visual de automatizaciones** | Existen `automations` y los crons; falta el armador de flujos. | Shopify Flow |
| **C7** | **MercadoLibre completo** | Publica desde ficha, recibe órdenes por webhook e importa las `paid` como ventas; concilia comisión + envío real del seller. Webhook y cron están listos; falta configurar la Callback URL + tópico Orders en ML y cargar el secreto del cron. | — |
| **C8** | **Compras y reposición con proveedor** | 🟡 La recepción total y parcial registra historial inmutable, entra por owner/admin, bloquea concurrencia y mueve stock sólo mediante `purchases` + trigger. Falta costo de importación por lote. | — |
| **C9** | **Multi-depósito real en la tienda** | 🟡 Slices 49–51: la tienda elige depósito de despacho; la orden toma una foto inmutable y el ingreso/ajuste, transferencia, reserva, venta, devolución y Kardex respetan esa ubicación incluso para variantes. Las reservas globales antiguas bloquean conservadoramente. Falta usarlo con un segundo comercio real. | Shopify |
| ~~C9a~~ | ~~Transferencias de variantes entre depósitos~~ | ✅ Slice 50. La operación elige una presentación física; el RPC bloquea su saldo de origen y deja dos asientos de Kardex. Un producto con variantes no se puede transferir como agregado. | — |
| ~~C9b~~ | ~~Ingreso y ajuste de variante por depósito~~ | ✅ Slice 51. `adjust_stock` exige depósito para variantes con múltiples sucursales; Sucursales permite fijar el saldo final y la ficha no ofrece un ajuste global ambiguo. | — |
| **C10** | **Reportes exportables y programados** | Hay reportes en pantalla. Falta "mandame el cierre de mes por email". | Todas |
| ~~C11~~ | ~~Auditoría de quién cambió qué~~ | ✅ Slice 28: precio y Kardex guardan actor real; el cliente sólo puede leer la evidencia. | Shopify Plus |
| **C12** | **Precio de venta calculado en servidor** | 🔴 Auditoría 2026-08-15: `create_sales_transaction` limita actor, organización, canal y stock, pero `jsonb_populate_record` aún acepta `unit_price_ars`, `total_ars`, `cost_of_goods_ars` y `profit_*` del navegador. Recalcular los importes contra producto/variante/promoción/cupón/medio de pago antes de cobrar; un override de caja debe ser una excepción autorizada y auditada, no un campo libre. | Todas |

---

#### D. Plataforma — para operar como SaaS

| # | Qué | Estado |
|---|---|---|
| **D1** | **Facturación fiscal de la suscripción** | Stripe cobra; no se emite comprobante argentino al comercio. |
| **D2** | **Onboarding guiado** | 🟡 El alta guía al primer trabajo real y el dashboard retoma los pendientes; falta medirlo con el segundo comercio. |
| ~~D3~~ | ~~Anuncios a los comercios~~ | ✅ Slice 54. Superadmin publica, programa, despublica o archiva desde Plataforma; Gestión muestra sólo comunicaciones vigentes y cada miembro las descarta para sí. RPCs con proyección mínima, tablas revocadas y auditoría evitan exponer borradores, historial o datos entre comercios. |
| **D4** | **Límites del plan aplicados** | 🟡 Productos, usuarios y tickets/mes se imponen en la base. El contador empieza hacia adelante porque no se inventan grupos históricos. Falta `D4a`: definir y aplicar cupo de tiendas por plan. |
| **D4a** | **Cupo de tiendas por plan** | 🔴 `plans` aún no expresa `max_stores`. Antes de implementarlo, decidir packaging (una tienda incluida vs. multi-tienda premium) y comunicar la migración a comercios existentes; no fijar un número arbitrario en código. |
| **D5** | **Exportar la organización entera** | 🟡 El dueño descarga datos operativos en ZIP con manifiesto de cobertura, errores y truncamientos; credenciales excluidas. Slices 55–56 suman ocho relaciones hijas operativas por FK de su padre y mantienen válidos snapshots v1/v2; faltan otras relaciones sin `org_id` e importación/restauración asistida. |
| ~~D6~~ | ~~Entrar como el comercio, auditado~~ | ✅ `generateMagicLink` se audita por organización alcanzada y los dueños ven su generación en Ajustes → Sistema, sin exponer enlace, destinatario ni detalles internos. El registro distingue generación de apertura: no inventa que el staff efectivamente consumió el enlace. |
| ~~D7~~ | ~~Estado del servicio público~~ | ✅ Slice 53. `/estado` publica sólo aplicación, cron y respaldo en estados agregados; no declara uptime ni disponibilidad de terceros sin evidencia. |
| **D8** | **Backup y restauración por organización** | 🟡 Snapshot privado semanal por organización, hash/cobertura/fila verificados, retención de 8/56 días y descarga sólo del owner. Falta el drill de restore aislado: no se vende una restauración destructiva sin haberla ensayado. |
| ~~D8a~~ | ~~Snapshot gestionado e integridad de archivo~~ | ✅ Slice 52. Owner + plan se verifican en servidor; `anon` no lee rutas ni archivos; el cron sólo corre con secreto de Vault/Function, espera hasta 60 s y rechaza artefactos truncados. |
| **D8b** | **Restore drill aislado** | 🔴 Diseñar una restauración a entorno/sandbox desechable, comparar tablas y relaciones contra el manifiesto y publicar el runbook. Al 2026-08-15 Supabase respondió 402 al crear un branch preview: requiere plan Pro o superior. Docker Desktop también requiere completar un UAC de administrador local; el instalador no puede finalizar desde la sesión. Sin uno de esos dos entornos, no se simula un restore sobre producción. No habilitar un botón que borre/mezcle producción hasta pasar ese ensayo. |

---

#### E. Lo que ninguna de las tres tiene bien, y sería la ventaja

Copiar la paridad no gana clientes: iguala. Estas tres salen del hecho de que
acá **la gestión y la tienda son el mismo sistema**, cosa que Tiendanube no
tiene y ML menos.

| # | Qué | Por qué |
|---|---|---|
| **E1** | **Precio único entre mostrador y online, con margen a la vista** | Hoy hay cuatro superficies de precio y se llegó a ellas de a una. Una pantalla que muestre, por producto, qué precio ve cada canal y cuánto margen deja **después** de comisión, envío e IVA, no existe en ninguna. |
| **E2** | **El stock del local es el stock de la tienda, con reserva** | ✅ La reserva (A2) y el multi-depósito ya estaban; POS avisa al agregar y pide una confirmación explícita antes de cobrar si una venta consume stock reservado por una orden online activa. |
| **E3** | **Un cliente, una ficha** | 🟡 La venta online acreditada ya se enlaza al mismo `customer_id` que usa POS, por email y no por nombre. Falta validar el flujo con un segundo comercio y resolver identificadores cuando una compra no trae email válido. |
| **E4** | ⭐ **Margen real por canal** | **El diferencial más defendible que tiene el producto.** Analytics ya muestra una fila por producto y canal con costo, comisión, envío e IVA, y marca “Pendiente” cuando falta evidencia. ML conserva costo, comisión y envío real cuando lo informa; la tienda enlaza líneas, liquidación e IVA, pero el costo final del correo todavía no entra; POS todavía no enlaza cada venta a su liquidación. Falta completar esas fuentes para que un número final sea verdaderamente comparable —hasta entonces la pantalla no lo promete. |

📌 **Business Copilot no es otro módulo por ahora.** Es la forma en que E1–E4 y
G1–G8 deberían aparecer: "qué compro esta semana", "qué canal me deja menos
margen", "qué clientes se están enfriando", "qué promoción liquida stock". Cada
recomendación tiene que terminar en una acción posible y una métrica de uso; si
es sólo chat, no es diferencial.

#### F. Cumplimiento legal — lo que no es opcional

Sale del relevamiento completo en **[docs/LEGAL.md](docs/LEGAL.md)**, que va
requisito por requisito contra el código. Esto no es paridad con la competencia:
es lo que hace falta para vender sin exponerse. **No es asesoramiento legal** —
cada punto conviene validarlo con un profesional.

Ordenado por riesgo dividido esfuerzo, que no es el orden en que se descubrieron:

| # | Qué | Norma | Estado |
|---|---|---|---|
| **F1** | **Página de política de privacidad**, con qué datos se guardan, para qué, cuánto tiempo y **que se alojan en Estados Unidos** | Ley 25.326 arts. 6 y 12 | 🟡 **Sesión 109:** el generador la escribe con los proveedores reales y la declaración de transferencia. Falta que el dueño cargue sus datos, la revise y la publique. |
| ~~F2~~ | ~~Botón de arrepentimiento en la primera pantalla~~ | Res. 424/2020 | ✅ **Sesión 108.** Barra superior, a 4px del tope, verificado en 1280 y 375. |
| **F3** | **Datos del proveedor**: razón social, CUIT y domicilio | Ley 24.240 art. 4 | 🟡 **Verificado: los términos publicados eran la plantilla semilla intacta.** El generador los reescribe; falta cargar los datos y publicar. |
| ~~F4~~ | ~~Link a Ventanilla Única Federal de Reclamos~~ | Comercio electrónico | ✅ **Sesión 108.** En el pie y en el formulario de arrepentimiento. |
| ~~F5~~ | ~~Consentimiento de marketing con fecha y origen, sin marcar por defecto~~ | Ley 25.326 art. 27 | ✅ `marketing_consent_at/source/order_id` se guarda por checkout opcional; campañas sólo seleccionan contactos con consentimiento. |
| ~~F6~~ | ~~Baja visible y efectiva en WhatsApp, como ya la hay en email~~ | Ley 25.326 art. 27 | ✅ Cada mensaje de campaña y cumpleaños agrega un enlace opaco de un solo uso; el servidor excluye bajas vigentes aunque el navegador proponga el id. |
| **F7** | **Registro No Llame** antes de una campaña telefónica | Ley 26.951 | 🟠 No se consulta. |
| ~~F8~~ | → **es D6**, no es otro trabajo | Transparencia | ✅ El dueño ve la generación del magic link de soporte de su organización, sin enlace ni datos de destino. |
| **F9** | **Contrato de tratamiento de datos** plataforma ↔ comercio | Ley 25.326 art. 25 | 🔴 La plataforma es *encargada*, el comercio *responsable*. Necesita abogado. |
| ~~F10~~ | ~~El costo del envío de vuelta lo paga el vendedor~~ | Ley 24.240 art. 34 | ✅ `return_requests` registra pagador, importe, método y notas; el trigger fija `seller` para arrepentimiento de una orden online. |
| ~~F11~~ | ~~Acotar la garantía a 6 meses en el reclamo por falla~~ | Ley 24.240 art. 11 | ✅ El trigger rechaza sólo reclamos por falla más de seis meses desde `delivered_at`; sin entrega registrada no vence el derecho. |
| **F12** | **CFT y precio de contado** si algún día hay cuotas con interés | Res. 51/2017 | 🟠 Hoy sólo hay "sin interés", donde el CFT es 0%. El código no distingue las dos cosas. |
| **F13** | **Procedimiento escrito de incidente de seguridad** | Res. AAIP 47/2018 | 🔴 Sin procedimiento no se cumple ningún plazo. |
| **F14** | **Consultar por el descuento según medio de pago** | Ley 25.065 art. 37 | 🟠 No es una decisión de producto. |
| **F15** | → **es C1**, no es otro trabajo | RG 4291 | 🔴 Ya está como A-pendiente; acá se anota que además es el riesgo fiscal más grande del sistema hoy. |
| **F16** | → **es D1**, no es otro trabajo | ARCA | 🟠 Stripe cobra y no se emite nada. |
| **F17** | → **es D5**, no es otro trabajo | — | 🟠 Es D5. Retenerlo por falta de herramienta es un problema legal, no sólo comercial. |

⚠️ **F1 a F4 son cuatro páginas y un link.** Juntos sacan del rojo casi todo lo
que Defensa del Consumidor y la AAIP detectan de oficio, y no dependen de
ningún trámite externo. Todo lo demás puede esperar; eso no.

**Al cierre de la sesión 109, F2 y F4 están hechos y F1 y F3 quedan a un paso:**
el texto lo genera el panel de Páginas de la tienda, y lo que falta es que el
dueño cargue razón social, CUIT, domicilio y email, lea lo generado y publique.
Se crean como **borrador** a propósito — publicar un texto legal por él sería
firmarlo en su nombre.

#### G. Instrumentación — lo que no se mide no existe

Se sabe todo del negocio del comercio y **nada del uso de la plataforma**. Los
datos ya están en la base; falta juntarlos. Detalle y por qué importa cada uno
en [docs/ESTRATEGIA.md](docs/ESTRATEGIA.md) §6.

| # | Qué | De dónde sale |
|---|---|---|
| **G1** | **Tiempo hasta la primera venta** de una organización nueva | `memberships.created_at` → primera `sales` |
| **G2** | **Tiempo hasta publicar la tienda** | `ecommerce_stores.published_at` → primera `ecommerce_orders` confirmada |
| **G3** | **Adopción omnicanal**: % que usa POS **y** tienda | `platform_org_activation`, `sales.source = 'pos'` + orden online confirmada |
| **G4** | **GMV por comercio** | `sales` + `ecommerce_orders` |
| **G5** | **Activas vs. que pagan** | `memberships`, `subscriptions` |
| **G6** | **Serie temporal de riesgo de abandono** | ✅ `platform_org_risk_series` desde snapshots diarios factuales; sin backfill de historia previa. |
| **G7** | **Stock accuracy**: % de productos cuyo stock actual coincide con Kardex | ✅ `platform_org_stock_accuracy`: `stock_movements` vs `products`/`product_variants`; sin Kardex queda fuera del porcentaje |
| **G8** | **AI Action Rate**: recomendaciones de IA que terminan en acción | ✅ `platform_org_ai_actions`: aplicadas / recomendaciones persistidas por el recomendador de ofertas; los descartes no entran en el numerador. |

⚠️ **G3 es la que representa la tesis del producto.** Si los comercios usan sólo
la tienda o sólo la gestión, el diferencial de §2 no se está usando y hay que
saberlo antes de construir encima.

Para hablar con inversores después, G1–G8 no alcanzan solos: también hay que
tener MRR, ARR, churn, CAC, LTV y margen bruto con fecha y fuente. Si CAC o LTV
vienen de una planilla externa, se registran igual; lo prohibido es citarlos sin
fecha.

#### H. Fundaciones — lo barato hoy, carísimo despues

Sale de **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)**, que fija cómo se
construye. ✅ **Medido contra la base el 2026-08-19: 323 tablas, 284 con
`org_id`.** Los tres huecos originales están cerrados (H1–H3) y endurecidos
(H4). Lo que queda —H5 a H7— ya no son fundaciones que falten sino filos de las
que se construyeron.

⚠️ **Y hay un dato que cambia qué significa "hecho" acá:** `domain_events` tiene
**0 filas** y `ledger_entries` **0 asientos**, con **0 órdenes en los últimos 7
días**. Los tres motores se verificaron con bloques de prueba contra producción
—y esa verificación es real— pero **ninguna venta genuina los atravesó
todavía**. Un motor que nunca corrió en tráfico real no está probado: está
escrito. El primer pedido de verdad es parte de la definición de terminado de
H2 y H3, y va como riesgo R10.

| # | Que | Estado |
|---|---|---|
| ~~H1~~ | ~~Idempotencia en las mutaciones criticas~~ | ✅ **Sesión 113, la primitiva y el checkout.** `idempotency_keys` + `idempotencia_reservar/completar/fallar`, y `create_store_order_idem` que **envuelve** create_store_order sin tocarla. Verificado contra producción: dos llamadas con la misma clave crean **una** orden. Falta llevarlo al cobro, la captura, el reintegro, la factura y la recepción de compra. |
| ~~H2~~ | ✅ **Eventos durables con outbox** | Hecho (sesión 112). `domain_events` append-only + `event_subscriptions` + `outbox_events`, escritos en la **misma transacción** que el cambio. Worker en `pg_cron` con backoff exponencial con techo y descarte con evidencia. Agregar un consumidor pasó a ser un INSERT. Órdenes y stock ya emiten. |
| ~~H3~~ | ✅ **Ledger financiero** | Hecho (sesión 112). Partida doble con las tres reglas en la base: todo asiento cuadra, el libro es inmutable —se corrige por contraasiento— y el saldo se deriva. La venta cobrada se asienta **por el outbox**, con el consumidor idempotente contra el libro. |
| ~~H4~~ | ✅ **Endurecer los motores** | Hecho (sesión 113). Los tres motores nacieron llamables por `anon` —Postgres otorga EXECUTE a PUBLIC por default— y **seis ataques probados funcionaron**, incluido acreditarse 20 millones en una billetera y leerlos como disponibles. Cerrado con `REVOKE FROM PUBLIC` **más** verificación adentro, constraints contra SSRF por webhook y contra apuntar un consumidor interno a cualquier función, y guarda en la ficha de las tres funciones que escribían ventas y stock para cualquier organización. Dos guardas nuevas: la vista `audit_funciones_expuestas` y `funcionesExpuestas.test.ts`. |
| **H5** | **Retención del log de eventos** | `domain_events` es append-only y crece sin techo: un negocio con movimiento de stock alto lo llena solo, porque cada movimiento emite. `outbox_limpiar` ya poda la cola —7 días lo entregado, 90 lo descartado— pero el log no tiene política. Qué se conserva y por cuánto es una decisión de negocio y contable, no técnica: un evento de orden puede hacer falta para una devolución meses después. |
| ~~H6~~ | ~~Tablero de finanzas y de la cola~~ | ✅ **Sesión 114.** `/libro`: margen bruto arriba de todo, estado de resultados, serie diaria con recharts, saldo de billetera y pendientes de la cola. ⚠️ **Si hay ventas asentadas sin costo, lo dice ARRIBA del margen, no debajo** — leído después, el número ya se creyó. La salud de la cola vive acá y no en una pantalla de sistema: si el outbox se atrasa, los asientos están incompletos, y eso es información financiera. |
| ~~H7~~ | ~~El ledger no conoce el costo de lo vendido~~ | ✅ **Sesión 114.** La venta cobrada ahora descarga `1.3.01 Mercadería` contra `5.1.01 Costo de mercadería vendida`, en el **mismo asiento** —netean entre sí, así que sigue cuadrando, y la guarda de idempotencia por orden sigue valiendo—. El costo sale de `stock_movements.unit_cost_usd`, que es el del momento de la venta: leer el de hoy haría que una lista de precios nueva reescribiera el margen de las ventas viejas. Como está en dólares, se busca la cotización del día en `exchange_rates` y se cae a `settings.exchange_rate`, **dejando escrito cuál se usó**. ⚠️ Medido: 8 de 40 movimientos no tienen costo cargado; queda contado en la metadata y sale WARNING en vez de inflar el margen en silencio. |

⚠️ **H6 es ahora el más urgente de los tres que quedan**, y es el menos
técnico. El ledger, la billetera y la salud de la cola existen y **el comercio
no ve ninguno**. Sin pantalla, un motor correcto es indistinguible de uno roto,
y todo el trabajo de H2 y H3 es invisible hasta que exista.

⚠️ **Lo que NO se construye todavia**, y esta razonado en ARQUITECTURA.md §5:
multi-store, dominios propios por tienda, theme engine, headless, marketplace de
apps, search dedicado, multi-region. Todo eso espera **un segundo comercio**, no
una decision de arquitectura. Construir multi-store para un comercio no es
arquitectura, es adivinar.

#### I. El horizonte siguiente — lo que las fundaciones habilitan

📌 **Criterio.** Nada de esto se empieza antes de que la fase 1 cierre. Está acá
porque **H2 y H3 lo volvieron barato**, y conviene que se sepa: son las razones
por las que valió la pena construir motores que no se ven.

| # | Qué | Qué lo habilita, y por qué ahora es barato |
|---|---|---|
| ~~I1~~ | ~~Estado de resultados de verdad~~ | ✅ **Sesión 114.** `ledger_resultado` y `ledger_resultado_diario`, derivados del libro. Normalizan el signo —en el libro un ingreso vive por el haber— para que ninguna pantalla tenga que acordarse de la convención y muestre el margen al revés. Excluyen anulados e informan `ventas_sin_costo`, que es lo que hace creíble al margen. La serie se agrega en la base: mandar los asientos al navegador para que los sume no escala. |
| **I2** | **Conciliación de MercadoPago contra el libro** | Con el ledger, comparar lo que MP dice que acreditó contra lo que el libro dice que se cobró es una consulta, no un proyecto. Hoy una diferencia de liquidación no la detecta nadie. |
| **I3** | **Reintegro real por MercadoPago** | La devolución ya registra el reintegro acordado (A6) y el ledger sabe asentarlo. Falta la llamada a la API con el token del comercio, en una Edge Function, con idempotencia de H1. Es de las pocas cosas donde el sistema hoy dice que devolvió y no devolvió. |
| **I4** | **Notificaciones sin tocar el centro** | Cada aviso nuevo —"en camino", "entregado", "tu pedido se demoró"— pasó a ser un INSERT en `event_subscriptions`. Antes era editar el checkout. B5 se volvió trivial y conviene aprovecharlo. |
| **I5** | **Webhooks para el comercio** | El outbox ya entrega con firma, reintento y descarte con evidencia. Exponer eso hacia afuera —que un comercio suscriba su propio endpoint— es configuración sobre un motor que ya funciona, no un desarrollo nuevo. |
| ~~I9~~ | ~~El chat de IA avanzado era una simulación~~ | ✅ **Sesión 115.** Devolvía texto enlatado tras esperar 1200ms y guardaba `tokens_used: Math.random()*500+100`. **Lo peor era el número**: quien sumara esa columna para medir costo de IA leía una cifra fabricada. Ahora llama a la Edge Function `ai-chat` real con streaming, y los tokens salen de `finalMessage().usage` — si la API no los informa se guarda `null`, que significa "no lo sé". El selector de modelo tampoco hacía nada (IDs inexistentes, y el backend tenía el modelo fijo): ahora llega al servidor, que **valida contra lista blanca** porque un string libre desde el navegador es una vía para pedir el modelo más caro. |
| **I8** | ⚠️ **La moneda del costo está hardcodeada a dólares** | `products.cost_usd` asume USD y **no hay columna de moneda**. H7 multiplica por el tipo de cambio, así que un costo cargado en pesos se asentaría multiplicado por ~1600. ✅ **Medido hoy: los 59 productos con costo van de USD 7 a 165, promedio 23 — son dólares sin ninguna duda, así que el libro está bien.** Pero se rompe en silencio el día que alguien cargue uno en pesos. Necesita `cost_currency` en el producto, un select en la ficha y que la fórmula convierta sólo cuando corresponde. |
| **I6** | **Idempotencia en el resto de los caminos** | Falta en cobro, captura, reintegro, factura y recepción de compra. La primitiva está; es aplicarla. Cada uno que falta es un doble cobro o un doble stock esperando. |
| **I7** | **Trazas** | Es el principio 11 a medias: hay Sentry y `cron.job_run_details`, no trazas. Con el outbox, una orden ya deja rastro de qué la escuchó; falta poder ver cuánto tardó cada paso. |

⚠️ **I1 e I2 son los que un comercio nota.** El resto es plomería que le
importa a quien programa. Si hay que elegir uno solo para que el trabajo de las
fundaciones se vea, es **H6 + I1**: el tablero y el margen bruto.

---

## 8. Riesgos

| ID | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R01 | Brecha entre organizaciones por un bug de RLS | Baja | Crítico | `publicSurface.test.ts` y la vista `rls_audit_open_policies` |
| R02 | Webhook duplicado cobra o descuenta stock dos veces | Media | Alto | Todos los caminos de pago son idempotentes |
| R03 | Un comercio pega mal su token y no cobra | Media | Alto | OAuth reemplazó el token a mano; se renueva solo |
| R04 | AFIP cambia su API | Media | Alto | Servicio abstraído y credenciales encerradas; **falta probarlo contra el organismo** |
| R05 | Costo de IA sin techo | Media | Alto | Falta límite por plan |
| R06 | Cotización de envío mal calculada contra el correo real | Media | Alto | Verificar contra un contrato real antes de escalar |
| R07 | Un solo desarrollador | Alta | Alto | CLAUDE.md, docs/ y commits largos a propósito |
| R08 | **Un solo comercio usándolo.** El multi-tenant está probado, no usado: un segundo comercio real destapa supuestos que ningún test encuentra | Alta | **Crítico** | Ninguna todavía. Es el riesgo más grande del proyecto y no se resuelve con código — ver [docs/ESTRATEGIA.md](docs/ESTRATEGIA.md) §5 |
| R09 | Un dato viejo de este repo citado como actual afuera (pasó: "418 tests" cuando eran 811) | Media | Medio | Los números medidos van con la fecha o con el comando al lado |
| R10 | Supabase caído | Baja | Crítico | PITR activo; sin runbook escrito |
| **R11** | **Motores construidos que nunca corrieron en tráfico real.** Eventos, ledger, billetera e idempotencia se verificaron con bloques de prueba, pero `domain_events` y `ledger_entries` están en **0** y hubo **0 órdenes en 7 días**. Un motor que nunca vio una venta genuina está escrito, no probado | **Alta** | Alto | Que la primera venta real atraviese los tres, y mirar el resultado. Es la condición de salida que falta en H2 y H3 |
| **R12** | **La suscripción del SaaS pasó de Stripe a MercadoPago** y todavía no cobró una cuota real a nadie. El camino de cobro propio es distinto del de las tiendas | Media | Alto | Cobrar la primera suscripción de prueba de punta a punta antes de dar de alta un comercio ajeno |

---

## 9. Definición de terminado

Una funcionalidad está lista cuando:

- [ ] `npm run typecheck` en 0 errores — **no `npx tsc --noEmit`**, que no chequea nada
- [ ] `npm run lint` sin errores
- [ ] `npm test` en verde
- [ ] Tests unitarios sobre los cálculos de plata, si los hay
- [ ] Toda query filtra por `org_id`
- [ ] Verificada contra la base real, con datos `ZZ` borrados al terminar
- [ ] Loading, vacío y error resueltos
- [ ] Se lee bien a 375px
- [ ] Las operaciones destructivas quedan en la auditoría
- [ ] No rompe stock, caja, deuda, reportes ni facturación
- [ ] Anotada acá con lo que se encontró en el camino

---

## 10. Principios de arquitectura

**ADR-001 — Multi-tenant por `org_id`.** Toda tabla de negocio lo tiene y lidera
su índice. Nunca filtrar sólo por `user_id`.

**ADR-002 — La lógica con secretos vive en Edge Functions.** El frontend está
optimizado para leer.

**ADR-003 — El servidor es la autoridad sobre la plata.** El checkout manda ids
y cantidades; precios, stock, cupones, envío y comisiones se recalculan en la
base. Si el precio saliera del navegador, cualquiera pagaría lo que quisiera.

**ADR-004 — Las páginas públicas no leen tablas crudas.** Van por
`src/lib/publicDataSource.ts`, y `publicSurface.test.ts` falla si alguien se
saltea la regla o pide una columna de costo, margen o credencial.

**ADR-005 — Los tokens viven en tablas con RLS y cero policies.** Sólo las Edge
Functions con `service_role` los tocan. La UI lee vistas `*_status` que dicen si
está conectado, nunca el token.

**ADR-006 — El cliente no puede asumir que la migración está aplicada.** Se
intenta lo nuevo y se cae a lo anterior sólo si la relación o la función no
existen. Nunca tragarse un error con `?? []`.

**ADR-007 — Los cálculos de plata van a funciones puras testeadas.** Cuando la
misma cuenta existe también en SQL, el comentario de cada lado dice que son
espejos.

**ADR-008 — Realtime sólo donde aporta.** Dashboard, POS, tickets y chat. No en
reportes históricos ni listas paginadas.

**ADR-009 — `localStorage` sólo para preferencias de interfaz** y el carrito de
la tienda. Los datos de negocio van a la base.

**ADR-010 — Móvil primero.** Se diseña a 375px y se escala.

---

## 11. Historial de sesiones

Lo que se hizo y —más importante— qué se encontró roto en el camino. Los
mensajes de commit son largos a propósito y amplían cada entrada.

> Resumen condensado. El registro completo detallado está en el archivo.

### Slice 47 — Una reversión no es una venta despachable ni un ajuste de stock (2026-08-15)

La liquidación ya podía anotar `refunded` y `charged_back`, pero esa evidencia
no alcanzaba si el pedido continuaba en `paid`: operación podía despacharlo y
la página pública podía ofrecer pagarlo otra vez. La nueva transición de base
es privada para las Edge Functions, bloquea la fila, conserva el tipo real de
reversión y guarda cuándo/detalle saneado de lo que confirmó el proveedor.

Una reversión que llega antes del despacho cancela la preparación y avisa a
owner/admin. Si la mercadería ya está `shipped` o `delivered`, se conserva ese
hecho físico y el aviso pide coordinar la devolución: reescribirlo como
“cancelado” sería evidencia falsa. Tampoco se toca `products.stock`, variantes
ni ventas. El descuento original ya tiene Kardex; sólo el retorno físico pasa
por `return_store_order_item` y un nuevo movimiento `return`. El RPC ahora
admite justamente esa recepción posterior a un reembolso o contracargo.

`mark_store_order_paid` rechaza una orden terminal y `store-pay` sólo habilita
`pending`/`failed`, de modo que un webhook `approved` tardío, una recarga o el
cliente no puedan revivir la transacción anterior. La operación ve etiquetas
en español y no puede abrir despacho; el comprador recibe un estado explicable,
sin formulario de pago de nuevo, pero con la vía de contacto adecuada.

`20260815000003_store_payment_reversals.sql` se aplicó y registró contra la
base vinculada. Su prueba ZZ comprobó refund sin delta de stock, contracargo
con envío ya salido, bloqueo de re-aprobación, ACL de la función y cero restos.
`mercadopago-webhook` v29 y `store-pay` v23 quedaron `ACTIVE`. La prueba de
un pago real, incluida la reversión del proveedor, sigue siendo una condición
explícita de B4; no se la simula. Typecheck, lint sin errores (147 avisos
históricos), 962 tests y build/PWA quedaron verdes. No había `.env` local, por
lo que la UI se comprobó por compilación y no contra órdenes reales.

### Slice 46 — Tarjeta sin abandonar la tienda, sin inventar una segunda fuente de verdad (2026-08-15)

El redirect a MercadoPago mantiene todos los medios, pero agrega un salto justo
antes de pagar. B4 avanza con el `Payment Brick` oficial para tarjetas de
crédito, débito y prepaga: la persona permanece en la página del pedido y los
datos sensibles se tokenizan en MercadoPago; Gestiona no ve ni guarda el número
de tarjeta.

No es un formulario que cobre lo que dice el navegador. `store-pay` vuelve a
buscar la orden, usa su total ya calculado por el Business Core, descarta
`transaction_amount` del Brick, valida token, método, cuotas y una clave de
idempotencia, y compara importe, moneda y `external_reference` de la respuesta
de MercadoPago antes de ejecutar `mark_store_order_paid`. Si el proveedor queda
procesando, la pantalla deja de ofrecer un segundo cobro y consulta el pedido
hasta que webhook/servidor lo resuelvan. El pago directo usa
`application_fee` para que la comisión de la plataforma se cobre junto con la
acreditación OAuth. La liquidación real quedó extraída a un helper que comparten
el Brick y el webhook, por lo que ambos registran la misma comisión y canal.

El camino embebido sólo aparece cuando la conexión OAuth tiene clave pública.
El checkout externo queda visible como alternativa para billetera, efectivo y
las conexiones previas por token: mejorar la conversión de tarjetas no puede
quitarle medios de cobro a un comercio. Se agregó `@mercadopago/sdk-react` y la
guarda `storePayBrickAuthority` para que una edición futura no vuelva a confiar
en precios de la pantalla ni pierda la idempotencia.

Las Functions `store-pay` v22 y `mercadopago-webhook` v28 están `ACTIVE`. Una
llamada pública deliberadamente inválida respondió `400 Body inválido`,
confirmando el código nuevo sin crear orden ni llamar a MercadoPago. Falta la
evidencia que no se puede fabricar sin una cuenta de prueba: ejecutar pagos
aprobado, rechazado y pendiente y comprobar una venta, una reserva, un Kardex y
una liquidación de comisión por caso. Hasta entonces B4 se mantiene 🟡.

### Slice 45 — El pedido sigue existiendo después de cobrar (2026-08-15)

Una venta que se cobra y después queda muda genera consultas, desconfianza y
recompras menos probables. B5 tenía el tracking visual y un email inicial, pero
no una transición operativa completa para “en camino” y “entregado”. Ahora el
diálogo de despacho sólo permite avanzar una orden pagada y ya preparada; la
base exige el orden `preparada → en camino → entregada`, guarda las fechas en
la misma transición y no deja que cargar un tracking revierta una entrega.

Cada avance intenta el email correspondiente con una Edge Function que exige
un usuario real y el permiso fino de ecommerce dentro de la organización. El registro privado por
orden/evento hace idempotente el aviso: doble click, recarga o reintento no
llenan la casilla del comprador. Si el correo no está configurado o falla, el
despacho queda registrado y la UI lo dice; no se maquilla una venta física como
si dependiera de un proveedor de email. La verificación ZZ crea una orden y una
entrega efímeras, ejecuta los dos cambios con una membresía real, confirma las
fechas, permisos anónimos cerrados y cero restos.

### Slice 44 — Checkout que se puede entregar (2026-08-15)

B3 decía que el checkout era secuencial, pero el código ya era un único
formulario con datos, entrega, pago, cupón y resumen. Se corrige el ROADMAP en
lugar de construir una segunda versión de lo que ya estaba hecho.

La fricción real era peor: una tienda con retiro habilitado no lo mostraba hasta
que el comprador eligiera provincia, aunque retirar no depende de una zona; y
si elegía envío a domicilio podía confirmar sin calle, ciudad ni código postal.
Ahora se consulta la opción de retiro aun sin provincia, se explica dónde se
retira y se piden dirección completa sólo cuando la opción real es entrega. El
botón espera la cotización, bloquea una cobertura ausente y dice "Continuar a
MercadoPago" cuando ese es el siguiente paso. El servidor sigue calculando el
precio, la opción elegida, el stock y los descuentos; esta capa sólo evita
pedidos que el comercio no podría despachar.

`requiereDireccionDeEntrega` deja esa regla en una función pura con cuatro
casos: retiro, entrega por correo/propia y los dos estados antes de cotizar.
Además, el medio de pago se sincroniza con los medios reales de la tienda al
cargarla: una tienda que acepta sólo MercadoPago ya no intenta crear la orden
como transferencia hasta que el comprador toque un control.

### Slice 43 — AFIP real, multi-organización y sin simulaciones (2026-08-15)

La pantalla `/afip` heredada fabricaba un comprobante pendiente, le asignaba un
CAE aleatorio dos segundos después y devolvía una empresa ficticia al consultar
padrón. Eso no era una limitación visual: podía hacer que un comercio creyera
que había facturado. Se retiró ese circuito. La pantalla ahora sólo muestra el
estado seguro de conexión y las facturas reales del Business Core; solicitar un
CAE sigue ocurriendo exclusivamente desde `/facturas`, donde importes y cliente
ya existen en la base.

La prueba de conexión anterior enviaba una factura inexistente y llamaba éxito a
"Factura no encontrada", antes de contactar AFIP. Ahora pide un Ticket de
Acceso real a WSAA, sin crear comprobante, y conserva ese ticket para la primera
autorización. Falta el certificado de homologación para comprobarlo contra el
organismo: C1 no se marca como hecho por esta mejora.

También se cerró `afip_config`, tabla heredada que podía conservar PEM y clave
privada bajo una policy de miembros. La migración migra cualquier dato faltante
a `afip_credentials`, borra los secretos de la tabla vieja y le revoca acceso
al navegador. El RPC y la Edge Function ahora reciben `org_id` y validan la
membresía owner/admin de esa organización: una cuenta con varios comercios ya
no puede escribir la configuración fiscal en la primera membresía que devuelva
la base. La verificación en producción confirmó que la migración quedó anotada
como `20260815000001`, con 0 secretos en la tabla heredada, 0 CUIT malformados
y sin acceso `anon` ni `authenticated` a esa superficie.

Por último se corrigió evidencia documental obsoleta: A8 (`products.tax_rate`,
IVA por línea) ya estaba implementado desde la sesión 110, pero el resumen de
competencia y el relevamiento legal aún lo declaraban pendiente. E4 conserva
los faltantes reales: costo final de correo y liquidaciones POS.

### Sesiones 1–10 — Base técnica + módulos core
- Infraestructura: PWA, Realtime, JWT, code splitting 427kB, Sentry
- Auth: roles, invitaciones, platform admin, RLS completa
- Inventario: Kardex, ajustes auditados, alertas, toma física
- Ventas: POS, caja, presupuestos, devoluciones, cupones
- Clientes: CRM 360°, pipeline Kanban, RFM, segmentos
- Finanzas: gastos, deudas, conciliación, cheques, cuotas, AFIP
- Reportes: P&L, inventario valorado, exportaciones CSV/PDF
- IA: forecast OLS, chat generativo, análisis proactivo

### Sesiones 11–20 — IA accionable + UX empresarial
- Chat IA con acciones reales (crear venta/compra/tarea/cliente)
- Segmentos RFM en DB (migrado de localStorage)
- Kanban de tareas con subtareas y drag-drop
- Analytics: ABC analysis, cohorts, canales de venta
- POS: split de pago, variantes, offline mode, keyboard shortcuts
- Presupuestos: automatización completa + recordatorios WA
- Email: SMTP propio, branding, test-send, tracking

### Sesiones 21–40 — Enterprise features
- Facturas: notas de crédito, envío masivo, filtros
- Deals: activity timeline, deal scoring, pipeline analytics
- Clientes: CLV, churn risk score, importación CSV avanzada
- Vendedores: cuotas, leaderboard, comisiones, metas
- WhatsApp: Evolution API, campañas masivas, digest diario
- Links de pago: CRUD completo, MP integration, público
- Integraciones: Tiendanube, health checks, dead-letter queue

### Sesiones 41–60 — Diferenciación competitiva
- Dashboard: temperatura del negocio, forecast 7d, comparativa semanal
- POS: bundles/kits, VIP discount automático, recibo por email
- IA chat: análisis por segmento WA, resumen ventas/deudas/gastos
- Reportes: comparativa dual de períodos, semanas, tendencia
- Soporte: SupportPage completo (Service Cloud)
- Realtime: SSE streaming IA, Presence WebSocket, KPIs live
- Expensas: stacked chart, vencimientos recurrentes, adjuntos

### Sesiones 61–77 — Madurez del sistema
- Pages nuevas: ActivityFeed, SellerGoals, InventoryAging, FollowUp
- Pages nuevas: PricingIntelligence, TeamPerformance
- Pipeline: deal_stage_change automation, forecast chart
- CustomersPage: exportCSV 18 cols, ficha 360 PDF, estado de cuenta
- ProductsPage: vista grilla, bulk delete, precio/stock inline
- Dashboard: 8h chart, temperatura 5 señales, objetivos por vendedor
- UX audit: 0 subtitle=, 0 icon JSX, 134/146 páginas con KPICards

### Sesión 78 — Refocus de producto + rediseño visual (2026-07-24)
- Refocus de alcance: 160 → 83 páginas (bloque2/bloque3), eliminando
  módulos enterprise fuera de foco (HR/payroll, fleet, project mgmt,
  e-learning, territorios, contratos B2B, revenue recognition, etc.)
  y consolidando duplicados (fidelidad, CRM, analytics, pricing,
  inventario, marketing) en tabs dentro de páginas padre
- Nav reconstruido alrededor del alcance final: Principal / Inventario
  / Ventas & CRM / Ecommerce & Multi-Tienda / Finanzas / Marketing &
  Influencers / Analytics / Administración
- Nuevo: multi-tienda (sucursales), portal de influencers, atribución
  de campañas vía cupones, kardex de canjes con influencers
- Rediseño visual completo: tema "oscuro premium" (dorado → zafiro),
  tema claro real + toggle persistente (next-themes), sidebar con
  rail de íconos fijo en tablet (768-1023px, antes se comportaba
  igual que celular), 10 primitivos de UI + Dashboard corregidos para
  no depender de fondos oscuros hardcodeados

### Sesión 79 — ERP vertical de perfumería · Phase 1 (2026-07-24)
Foco: el diferenciador que pidió el dueño (módulo exclusivo de perfumes)
+ huecos baratos adyacentes. 3 migraciones aplicadas a producción por SQL
directo (el historial de migraciones está desincronizado: solo 85 de ~209
trackeadas, así que `db push` habría reintentado ~120 ya aplicadas).
- **Ficha premium de perfume** (`product_perfume_details`, 1:1 con products):
  familia olfativa, notas salida/corazón/fondo, duración, proyección,
  estación, ocasión, modelo, inspiración, edad recomendada. Form solo
  visible en categorías perfume.
- **Buscador por facetas** en ProductsPage (Sheet): género + familia +
  notas + estación + ocasión + precio máx → responde "masculino, dulce,
  vainilla, larga duración, hasta $80.000" al instante.
- **IA estructurada**: `generate-description` pasó a tool-use forzado y
  autocompleta la ficha (familia/notas/duración/proyección/ocasión).
- **CRM perfumería**: clientes con Instagram, WhatsApp separado, flag
  "compra vapers", preferencias olfativas (chips de taxonomía compartida).
- **Kardex**: tipos rotura/regalo/reserva + diálogo de movimiento manual
  (RPC `record_manual_stock_movement` con validación de rol).
- **Dashboard**: KPIs "Productos Nuevos" y "Próximos Ingresos".
- **Fix colateral**: el form de productos descartaba silenciosamente
  barcode/sku/lote/vencimiento/etiquetas al guardar — corregido.

**Phase 2 (misma sesión, ya hecho):**
- **Estadísticas por marca** (ReportsPage → tab "Marcas"): qué marca
  vende/rinde más, cuál es la más rentable, % que representa cada una,
  capital inmovilizado por marca + desglose por familia olfativa.
- **Enviar catálogo por WhatsApp** (CatalogPage): botón wa.me con el link
  del catálogo público prellenado.
- **IA de copy para Instagram** (`generate-social-copy` edge fn +
  SocialPlannerPage): genera título/contenido/hashtags para
  post/story/reel/carousel a partir de un producto o tema.
- **Enviar lista de precios por WhatsApp** (CatalogPage): botón "Precios
  WA" que arma la lista en texto (producto — precio) y la abre en wa.me.
- **Recomendador de perfumes similares** (`perfumeMatch.ts` +
  PerfumeRecommenderModal): similitud determinística por notas/familia/
  duración/proyección; acción "Similares" por perfume en ProductsPage.
  `recommendForPreferences()` queda lista para el lado cliente (Phase 3).
- **Prolijidad UI**: ficha de perfume reorganizada en subsecciones
  (Identidad / Perfil / Pirámide de notas / Uso ideal); charts de las
  superficies nuevas 100% theme-aware.
- **Endurecimiento UI app-wide** (legible en todos los dispositivos +
  tema claro/oscuro):
  - Colores hardcodeados de charts (147 ocurrencias / 16 archivos):
    tooltips/ejes/grillas → tokens del tema. Ya no se rompen en claro.
  - Páginas públicas (Landing/Auth/Pricing/Onboarding/NotFound/Invitación/
    Reset): fondo→--background, cards→--card, logo→--primary-foreground.
    Antes quedaban oscuras aunque el tema fuera claro.
  - 32 tablas (21 archivos) que se recortaban en móvil → overflow-x-auto
    (scroll horizontal).
  - TabsList (primitivo) → scroll horizontal: corrige los 17 páginas con
    muchas pestañas de una vez.
  - Verificado: sin desborde horizontal en 375px, colores OK en ambos
    temas, tsc/build/123 tests limpios.
### Sesión 80 — Sistemas por categoría + pulido UI (2026-07-25)
- **Markup/margen por categoría**: `settings.category_pricing` jsonb;
  el auto-cálculo de precios usa el markup y descuento propios de cada
  categoría (ej. perfumes ×2.2, vapers ×1.6) en vez del ×2 fijo.
  Config en Ajustes → "Precios por categoría".
- **Oferta masiva por categoría**: modal en Productos que aplica/quita
  descuento + vencimiento a todos los productos de una categoría.
- **Promociones aplicadas al cobrar**: la tabla `promotions` (targeting
  por categoría/producto/todo) existía pero nunca se aplicaba. Nuevo
  `src/lib/promotions.ts` (bestPromoPrice, +9 tests) + enforcement en POS
  (badge PROMO, registra promotion_usages) y catálogo interno.
- **Pulido UI sistemático** (sobre todas las páginas): toolbars de
  acciones con flex-wrap (8 páginas), sumado a lo previo (colores
  theme-aware, tablas y tabs con scroll, páginas públicas theme-aware).
- Nota verificada: el POS ya calculaba bien la ganancia (usa costo con
  aduana); no había bug.

- **Fix header (bug real reportado con captura)**: en páginas con toolbars
  largas (Productos ~10 botones) el bloque de acciones aplastaba el
  título/descripción a ~0px. PageHeader ahora limita acciones al 62% en
  desktop + flex-wrap; 29 páginas con divs de acciones sin flex-wrap
  corregidos. Sistémico → arregla todas las páginas con header compartido.
- **Recomendador por cliente** (Phase 3): en la ficha del cliente se
  muestran perfumes que matchean sus preferencias olfativas (% match) +
  modal "Ver todos" + WhatsApp de recomendación.
### Sesión 81 — Pricing por categoría end-to-end + typecheck real (2026-07-27)
- **Recalcular precios con el markup de cada categoría** (hueco reportado):
  "Recalcular Todo" usaba un ×2 hardcodeado → ignoraba category_pricing.
  Ahora usa el markup/descuento de cada categoría, preserva el % de las
  ofertas vigentes y actualiza en tandas de 25. Al guardar Ajustes, si
  cambian los precios por categoría aparece el aviso "¿Recalcular?".
- **`src/lib/pricing.ts`**: fuente de verdad del pricing (getCategoryMarkup,
  getCategoryDiscount, calcAutoSalePrice, calcAutoDiscountPrice,
  calcMarginPct) + 18 tests. Elimina 3 fórmulas de precio duplicadas
  (form de producto, recalculador, ajuste masivo).
- **Alerta `stale_price`** (Phase 3 ✅): avisa cuando el precio guardado se
  desvía >umbral% del que corresponde al dólar+markup actuales.
- **Typecheck real**: `npx tsc --noEmit` sobre el tsconfig raíz (files: [])
  NO chequeaba nada → el CI daba verde siempre. Por eso llegó a runtime un
  ReferenceError. Ahora `npm run typecheck` (tsconfig.app.json) y el CI lo
  usa. Destapó 13 errores que eran bugs reales:
  - SubscriptionsPage usaba 3 tablas + 1 RPC inexistentes → página rota.
    Creadas subscription_plans / customer_subscriptions /
    subscription_invoices + RPC renew_subscription (con RLS).
  - WhatsAppCampaignsPage filtraba `debts.paid` (columna inexistente) →
    el segmento "con deuda" quedaba vacío. Ahora usa remaining_ars > 0.
### Sesión 82 — Auditoría de esquema: 35 tablas faltantes → 0 (2026-07-28)

Al arreglar el typecheck (que no chequeaba nada) quedó expuesto que gran
parte del código consultaba tablas/columnas inexistentes. Se escribió un
auditor (`.from()`/`.rpc()` vs tipos generados) y se cerró la brecha.

**Bugs críticos encontrados y corregidos:**
- **POS crasheaba al renderizar**: `confirmDisabled` se leía en el array de
  deps de un useEffect ~600 líneas antes de declararse → ReferenceError.
  La caja no abría. Ahora usa un ref espejo.
- POS: el comando de voz armaba items de carrito malformados (sin costo ni
  TC → ganancia mal calculada); el webhook mandaba qty/price undefined.
- ReportsPage importaba `Toggle` de lucide-react (no existe) — mismo bug
  que había roto Productos con `DialogFooter`.
- Proveedores: 2 usos de una variable renombrada → crash al exportar CSV.
- Sucursales, Bundles y Listas de Precios guardaban contra columnas
  inexistentes → fallaban en silencio.
- WhatsApp Masivo: el segmento "con deuda" siempre vacío.
- P&L: pedía `expenses.amount` (es amount_ars) → quedaba sin gastos.

**Tablas creadas (20) para features que sí sirven:** fidelidad (5), lotes
y vencimientos (2), devoluciones (2), órdenes de compra (2) + numeración,
suscripciones de clientes (3) + renovación, alertas v2 (2), integraciones
(api_keys, webhook_configs), BI (saved_reports, bi_snapshots), OCR (2),
multi-divisa (multi_currency_transactions, fx_exposure, fx_rates), items de
bundles, seguimientos CRM. Todas con RLS por org.
**Vista `sale_items`** sobre `sales` (cada venta ya es una línea).
**Funciones:** generate_po_number, renew_subscription, expire_batches,
seed_return_reasons, get_audit_summary.

**Eliminadas (13 tablas) por estar fuera de alcance:** Motor de Precios
(incluía Inteligencia de Competencia y Precios Dinámicos), tab Franquicias
y tab Cotizaciones a proveedores (RFQ).

- Pendiente Phase 3: reservas reales (tabla stock_reservations), catálogo
  PDF por facetas, promos en catálogo público (path de lectura pública),
  price_lists mayorista en la ficha.
- A confirmar con el dueño: `calculateTaxes` aplica IVA sobre la ganancia
  (normalmente el IVA va sobre las ventas) — puede estar subestimando.
- Nota: las tablas nuevas están vacías; las páginas abren sin datos hasta
  que se cargue el primer registro.

### Sesión 83 — Cierre de Phase 3 + 49 → 0 errores de tipo (2026-07-28)

**Phase 3 completada:**
- **Catálogo filtrable por facetas**: género, familia olfativa, ocasión y
  notas sobre `product_perfume_details`. El PDF se arma desde `filtered`, así
  que exportar da exactamente la selección visible; la portada nombra las
  facetas activas.
- **Listas de precios en la ficha del producto** (`ProductPriceListsSection`):
  muestra el precio efectivo de cada lista mayorista y permite fijar un
  override por producto (precio fijo o %) en `price_list_items`.
- **Proveedor preferido por producto** (`products.supplier_id`) — lo pedían
  AutoRestock y las órdenes de compra, y no existía la columna.

**Bugs reales encontrados por el typecheck (49 errores → 0):**
- `sales.customer_email` no existe → CustomerRFM devolvía 400. Ahora el email
  se resuelve desde `customers`.
- `sales.method` / `expenses.amount` → la conciliación bancaria no cargaba
  ventas ni gastos (nombres reales: `payment_method`, `amount_ars`).
- `deals.amount` → el scoring de leads puntuaba todo con monto 0
  (real: `value_ars`). `products.price` → recomendador sin precios.
- `customers.segment` no existe: la campaña de WhatsApp por segmento nunca
  encontraba clientes. Ahora usa `customer_segment_members` y lista los
  segmentos reales de la organización.
- `purchases.supplier_name` → el histórico por proveedor salía vacío
  (real: `supplier`).
- `product_variants` no tenía `barcode` ni se mandaba `org_id`: la
  importación de variantes de Tiendanube fallaba entera.
- Los upserts de `settings` en Integraciones no mandaban `user_id` (NOT NULL)
  → guardar webhook / Mercado Pago / Evolution fallaba en un alta nueva.
- El log de entregas de webhooks consultaba columnas inexistentes
  (`webhook_id`, `event_type`, `status`…): se alineó al esquema real que
  escribe la Edge Function `send-webhook`.
- `price_history` no la escribía nadie → el historial de precios y el
  sparkline estaban vacíos siempre. Ahora `updateProductDB` registra el
  cambio de precio/costo.
- El medio de pago de un pago de deuda se descartaba: nueva tabla
  `debt_payments` como ledger.
- La auditoría de AdminPage filtraba por `severity` y buscaba por
  `entity_label`/`user_email`, columnas que no existían → se agregaron y
  `logAudit` las completa (severidad derivada de la acción).
- El forecast de Dashboard y Analytics pasaba `{date, amount}` cuando el
  hook espera `total_ars` → proyectaba siempre 0. `smoothingWindow` se
  aceptaba pero se ignoraba: ahora aplica media móvil centrada.
- KPIs de Lotes sin `icon`, ConfirmDialog de Devoluciones con `children` en
  vez de `trigger`, `safeChannel` sin scope en las alertas de stock.

**Promos en el catálogo público** (último pendiente de Phase 3): la RLS de
`promotions` exige auth, así que la vidriera anónima mostraba un precio y el
POS cobraba otro. Se agregó el RPC security-definer `get_public_promotions`,
que devuelve **solo** promos ya públicas por definición (activas, en ventana,
sin `coupon_code`, de tipo percentage/fixed y alcance all/products/categories)
y **nunca** el código de cupón. `PublicCatalogPage` vuelca el mejor precio
sobre `discount_price_ars`, así badges, % OFF, combos y el mensaje de WhatsApp
quedan consistentes solos.
*Verificado contra producción como rol `anon`: la promo pública se ve, la de
cupón queda filtrada, filas de prueba eliminadas.*

**Migraciones aplicadas:** `products_supplier_id`, `debt_payments`,
`audit_logs_rich_fields`, `product_variants_barcode`,
`public_promotions_rpc`.

**CI:** el typecheck pasa a bloqueante (la deuda llegó a 0, venía de ~810).

### Sesión 84 — Hardening: índices por org_id + auditoría de dependencias (2026-07-28)

**Índices por `org_id` (59 tablas → 0).** Toda policy de RLS evalúa
`is_org_member(org_id, auth.uid())` y toda query filtra por `org_id`, pero 59
tablas no tenían ningún índice que liderara con esa columna: cada lectura era
un seq scan sobre las filas de **todas** las organizaciones, o sea un costo que
crece con el total de clientes del SaaS y no con los datos del que consulta.
La migración los crea dinámicamente como `(org_id, created_at DESC)` cuando la
tabla tiene `created_at` y `(org_id)` si no. Las tablas calientes (sales,
products, customers, expenses, purchases) ya estaban bien.

**`afip_padron_cache`** tiene RLS con cero policies **a propósito**: es un caché
global con clave CUIT y sin `org_id`; una policy para `authenticated` dejaría
ver a quién le factura cada negocio. Se documentó con `COMMENT ON TABLE` para
que una auditoría futura no lo "corrija".

**Dependencias: 35 vulnerabilidades → 18, las 2 críticas eliminadas.**
En producción (lo que llega al browser): 7 → 3. Solo cambió el lockfile, ningún
salto de versión directo. Queda:
- `xlsx` (high, ReDoS + prototype pollution): **sin fix en npm** — SheetJS se
  distribuye por su propio CDN desde la 0.19. Se usa lazy-loaded en 6 lugares
  (import/export de Excel). Migrar la fuente del paquete es una decisión aparte.
- `react-router` (moderate, open redirect vía backslash en `<Link>`/`useNavigate`):
  **no es alcanzable en esta app** — se auditaron todos los `navigate()` y son
  rutas literales o mapas estáticos; el único branch con path variable
  (`action.type === "navigate"` del asistente) está declarado pero ningún código
  lo produce. El fix exige react-router 7 (major), que no se justifica por una
  vuln inalcanzable.
- El resto (15) es tooling de build: eslint 10, vite 8, `@sentry/vite-plugin` 5,
  todos majors de dev.

**CI:** nuevo job `security`. Bloqueante en `npm audit --omit=dev
--audit-level=critical` (gate que hoy pasa y frena lo urgente de verdad) más un
audit completo informativo. Subir a `high` cuando se resuelva `xlsx`.

### Sesión 85 — Seguridad enterprise, POS offline, crons y MercadoLibre (2026-07-29)

**Los 13 cron jobs estaban fallando, todos.** Apareció buscando por qué no
salían los emails de las secuencias: `cron.job_run_details` daba `failed` en
todo. La mayoría llamaba `current_setting('app.supabase_url')` y
`app.service_role_key`, ajustes nunca configurados; `send-drip-emails` tenía
literalmente los placeholders del ejemplo de la doc. No corrían alertas de
stock, avisos de deuda, reactivación, KPI diario, digest semanal,
automatizaciones ni campañas. Se unificó todo en `invoke_edge_function()`, que
lee del vault. Verificado: HTTP 200 `{"ok":true,"alerts":1}`. Ver `docs/CRON.md`.

**2FA no protegía nada.** El perfil permitía enrolar TOTP, pero nada chequeaba
el nivel AAL de la sesión: con la contraseña sola se entraba igual. Nuevo
`MfaGate` + enforcement por organización. La decisión vive en `decideMfaState()`,
función pura con 8 tests.

**Los 16 módulos de permisos eran decorativos.** Solo 4 páginas los consultaban,
y aunque el sidebar ocultara un ítem, con la URL se entraba igual. `moduleMap`
+ `PermissionsProvider` (una query en vez de una por módulo) + `ModuleGuard`.
Alcance documentado: es una barrera de interfaz, el límite real es la RLS.

**Derecho de supresión (Ley 25.326).** RPC `anonymize_customer`: no borra las
ventas — AFIP exige conservarlas — sino que reemplaza el PII por un seudónimo
estable. No lista las tablas a mano: recorre el catálogo, así que una tabla
nueva queda cubierta sola. Más export completo a ZIP (33 tablas, 10 tests
sobre el armado del CSV).

**El POS no servía offline.** Tres bugs: las ventas offline quedaban invisibles
al reabrir (se leía la clave `...default` porque `activeOrg` aún no había
cargado, mientras se guardaba con el id real); el `Promise.all` de 5 consultas
dejaba la caja cargando para siempre sin señal; y el caché de la API duraba 5
minutos. Ahora hay snapshot local del catálogo, `allSettled`, caché de 24 h y
auto-sincronización al recuperar señal.

**Índices por `org_id`** en 59 tablas que no los tenían: cada lectura era un
seq scan sobre las filas de todas las organizaciones.

**Dependencias:** 35 vulnerabilidades → 18, las 2 críticas eliminadas. En
producción 7 → 3. Nuevo job `security` en CI.

**MercadoLibre — capa de conexión.** Esquema (`meli_connections`,
`meli_listings`, `meli_orders`), Edge Functions `meli-oauth` y `meli-sync`
(publicar, sincronizar stock/precio, bajar órdenes) y panel en Integraciones.
Los tokens viven en una tabla con RLS y cero policies: la UI lee la vista
`meli_connection_status`, que no los expone. **Bloquea la categoría `vaper`
del lado del servidor**: ANMAT los tiene prohibidos y publicarlos trae sanción.
Falta (ver `docs/MERCADOLIBRE.md`): botón de publicar en la ficha del producto
con el predictor de categorías, importar órdenes como ventas, webhook de ML y
cron multi-organización. **Bloqueado hasta que se cree la app en
developers.mercadolibre.com.ar y se carguen las credenciales.**

### Sesión 108 — Relevamiento legal de las tres superficies (2026-08-11)

Se venía construyendo funcionalidad sin revisar contra qué normativa. La sesión
anterior encodeó el arrepentimiento en el RPC; ésta fue a ver **qué más falta**,
requisito por requisito, en la tienda, el CRM y el panel de plataforma.

Resultado en [docs/LEGAL.md](docs/LEGAL.md) y como bloque **F** en §5 (17 ítems).
Lo que hay que saber sin leerlo entero:

**Lo más caro es también lo más barato de arreglar.** Los cuatro ítems en rojo
que Defensa del Consumidor y la AAIP detectan de oficio —política de privacidad,
botón de arrepentimiento en la home, datos del proveedor, link a la Ventanilla
Única— son **cuatro páginas y un link**. Ninguno depende de un trámite externo.

**No hay política de privacidad.** Medido contra `store_pages`: hay
`terminos-y-condiciones`, `cambios-y-devoluciones`, `preguntas-frecuentes` y
`sobre-nosotros`, las cuatro publicadas. Falta la de privacidad, que la Ley
25.326 exige apenas se recolecta un email — y se recolectan varios.

**Los datos se alojan en Estados Unidos y eso hay que declararlo.** Supabase
corre en AWS `us-east-1`. Para la AAIP, Estados Unidos **no** tiene nivel
adecuado de protección, así que la transferencia necesita cláusulas o
consentimiento informado. Es un párrafo en la política de privacidad, pero hay
que escribirlo a propósito: nadie lo descubre solo.

**El descuento por medio de pago toca la Ley 25.065.** El art. 37 prohíbe cobrar
más por tarjeta. Un descuento por transferencia es práctica extendida y hubo
cambios normativos, pero la lectura no es unánime. Se anota como **F14 y se
deriva a un profesional**: no es una decisión que deba tomar el código, y menos
en silencio.

**El marco de plataforma no está escrito.** La plataforma es *encargada* del
tratamiento y el comercio *responsable* (art. 25). No hay contrato entre los dos
que diga qué puede hacer la plataforma con los datos de los clientes del
comercio. Va de la mano con que el comercio pueda ver cuándo soporte entró a su
cuenta —`admin_audit_logs` ya lo registra, falta mostrárselo— y con poder llevarse
su negocio entero al irse.

**Lo que ya estaba bien, y conviene no romper:** RLS por organización verificada
con roles reales, MFA sin excepción para staff, credenciales fuera del navegador
con tablas de cero policies, export y borrado de datos por persona, baja de las
secuencias de email, y la separación entre `store_customers` y `customers` — que
es lo que evita que el comprador de un perfume termine siendo usuario del SaaS.

El documento aclara arriba de todo que **no es asesoramiento legal**. Lo que
aporta es dónde está cada cosa en el código, para que la consulta al abogado sea
corta y concreta en vez de empezar de cero.

### Sesión 103 — Las promociones, también online (2026-08-06)

`promotions` ya se aplicaba en el POS y se mostraba en los dos catálogos. La
tienda online era la única superficie que la ignoraba: el comercio creaba "20%
off en Perfume Árabe", se descontaba en el mostrador y online se cobraba pleno.

**Van tres casos iguales** —`price_2x_ars`, las categorías, y ahora esto—, así
que queda como regla: al agregar una mecánica de precio hay que revisar **las
cuatro superficies**, no la que se está tocando.

La promoción se resuelve dentro del precio de la línea y no como un descuento
aparte, porque una promoción *es* un precio: así el volumen, el cupón y el medio
de pago trabajan después sobre el número correcto. Gana el mejor, nunca la suma.

Quedan afuera a propósito las que tienen cupón (van por el flujo de cupones),
`buy_x_get_y`/`bundle`/`free_shipping` (necesitan lógica de carrito) y
`applies_to = customers` (es de orden, no de línea).

Nueve casos verificados, y la tienda muestra lo que cobra vía
`store_catalog_products.promo_price`.

### Sesión 102 — Descuento por cantidad, general (2026-08-06)

Lo único que había era `price_2x_ars`: precio fijo para dos unidades, a mano y
sólo en vapers. Ahora hay reglas: "llevando 3 o más, 15% off", con alcance
todos/categoría/producto.

**Por producto gana el mejor, nunca la suma** — misma regla que la oferta con el
medio de pago. Entre varias reglas gana la de mayor descuento, no la más
específica. La cantidad se cuenta cruzando líneas, igual que el 2x.

Verificado con siete casos: el clave es que **una regla floja no se suma al 2x**.
Y el carrito muestra lo mismo que se cobra gracias a
`get_store_quantity_discounts`: sin ese RPC el espejo del cliente no podía ver
las reglas, que es el bug que este repo evita en cada cálculo de plata.

### Sesión 101 — El buscador sugiere mientras se escribe (2026-08-06)

Antes había que escribir, apretar Enter y esperar el catálogo para saber si
existía lo buscado. **Primero marcas y categorías, después productos**: son
atajos a muchos productos y quien escribe "lattafa" quiere ver la marca, no un
perfume puntual. Verificado en la tienda: sugiere "LATTAFA · Marca · 19
productos" y recién después los perfumes.

Cuatro decisiones: con menos de dos letras no sugiere nada; no ofrece lo agotado
salvo que sea lo único que hay —la ficha ofrece avisar cuando vuelva—; la flecha
arriba desde el primero vuelve a "nada seleccionado" para que Enter no navegue a
algo que el comprador no eligió; y encuentra la categoría por su nombre visible,
no por el slug.

El desplegable usa `onMouseDown` y no `onClick`: el `blur` del input dispara
antes que el click y se cerraba sin navegar. Todo sobre el catálogo en memoria,
sin una consulta por tecla.

### Sesión 100 — Ofertas reales: cuándo el medio de pago sí se suma (2026-08-06)

La sesión anterior frenó el descuento doble, pero dejaba afuera la otra mitad:
en una liquidación de verdad el descuento por transferencia **sí** corresponde.
Un producto rebajado de 100.000 a 70.000 sigue teniendo el 20% encima.

Eso no se deduce del número: `discount_price_ars` significa las dos cosas según
qué quiso hacer el comercio. Ahora lo decide él, con
`ecommerce_stores.payment_discount_stacks` como política y
`products.offer_stacks_payment` para pisarla por producto. El default es
**false** porque los dos errores no cuestan lo mismo: cobrar de más se corrige
porque el comprador se queja; regalar margen no avisa nadie.

La base se resuelve en `store_catalog_products.payment_base_price`, no en el
cliente: así el storefront muestra el precio sin conocer la política, y la regla
queda junto a la que usa `create_store_order` al cobrar.

Dos cosas que costaron: `CREATE OR REPLACE VIEW` sólo deja agregar columnas **al
final** (42P16 si no), y la vista sólo unía `settings` — hubo que sumarle el
JOIN a `ecommerce_stores`.

### Sesión 99 — La oferta y el medio de pago dejaron de acumularse (2026-08-06)

Lo reportó el dueño mirando su propia tienda: un vaper de lista 38.640 con
oferta 30.912 (20% off) mostraba "24.730 con transferencia (20% OFF)". Son
**36% de descuento real**, no 20 — el porcentaje del medio de pago se aplicaba
sobre un subtotal que ya venía con el precio de oferta. Y el precio tachado
tampoco cerraba con nada.

**La regla: no se acumulan, se cobra el mejor.** El descuento del medio se mide
por línea contra el precio de **lista**, así que si la oferta ya deja el precio
por debajo no descuenta nada más. No es "sólo la oferta": si el medio es mejor
—oferta del 10% con transferencia del 20%— gana el medio, porque publicar "20%
OFF con transferencia" y cobrar el 10% sería romper la promesa. Los cuatro
casos verificados contra la base.

Para poder compararlo, `resolve_store_line` ahora lleva `list_price` en la
línea; con una variante que tiene `price_override`, su lista es ese precio
propio. Las dos funciones se regeneraron desde producción con script.

En la ficha el cartel del medio de pago **sólo aparece si mejora** lo que ya se
paga: anunciarlo al lado de un número idéntico hace dudar de los dos.

### Sesión 98 — Completá tu compra (2026-08-06)

En la ficha ya había "También te puede gustar", que es descubrimiento. El
carrito no ofrecía nada, y es el momento del embudo donde un agregado cuesta
menos: el comprador ya decidió.

**La regla que lo separa de una vidriera más: primero lo que completa el envío
gratis.** Si faltan $18.000, un producto de $20.000 no es otra sugerencia — es
la que convierte ese gasto en algo que además le ahorra el envío. Con tope de
1,6× lo que falta: uno que pasa el umbral por cinco veces no completa nada,
sólo parece un intento de vender más caro. Después manda la afinidad (marca,
categoría) y al final lo más vendido, que es el desempate honesto.

Dentro de cada motivo se ofrece lo más barato: es un agregado, no un reemplazo.
Un producto con variantes abre la ficha en vez de agregarse solo, porque hace
falta elegir sabor o tamaño. Verificado en el navegador: con $52.594 faltando,
sugiere tres de $52.992 a $54.464.

De paso quedó comprobado que **el panel de liquidaciones ya existía** y está
montado en Libro mayor: muestra el desglose de cada cobro y la fecha de
acreditación. Lo que se pensaba como "Gestiona Pagos" está hecho salvo la marca.

### Sesión 97 — Subcategorías y despliegue del menú (2026-08-06)

`parent_id` estaba en la tabla y en el RPC desde el principio, sin usar. Lo que
hace que sirva no es el árbol sino que **entrar al padre traiga los productos de
las hijas**: sin eso, tocar "Perfumes" da una página vacía y el comprador
concluye que no hay stock. Verificado: filtrar por el padre devuelve 55, que son
54 + 1.

El corolario apareció mirando la tienda, no el código: el menú llevaba la lista
**plana**, así que agarraba dos hijas, el padre no salía nunca y tampoco su
desplegable. Ahora lleva sólo primer nivel, contando `productosEnRama` para que
un padre sin productos propios entre igual.

El árbol aguanta ciclo (si no, bucle infinito en el render), hija con padre
ausente —pasa al esconder el padre— y elegirse a sí misma como padre. En el
celular las hijas van indentadas y visibles: no hay hover, y un submenú que pide
otro toque esconde lo que el comprador vino a buscar.

### Sesión 96 — El menú lo arma el comercio (2026-08-05)

El menú se armaba solo y no se podía tocar. Ahora se guarda en `nav_links`
(jsonb en la tienda), y **vacío significa "armalo solo"**: por eso aplicar la
migración no cambia ninguna tienda. Un paso más: si todos los links quedaron
rotos —una categoría borrada, una página despublicada— se vuelve al automático,
porque el header no puede quedarse sin forma de llegar al catálogo.

Dos cosas que valen más que la feature: sólo se aceptan http y https —un
`javascript:` en el menú es un XSS servido, y se valida al guardar **y otra vez
al mostrar**, porque una fila vieja no pasó por el formulario de hoy— y los
links externos salen del router, que con `<Link>` darían 404. El menú se dibuja
en tres lados, así que esa decisión vive en un solo componente.

`get_store_by_slug` se regeneró desde producción con la columna al final de la
firma: tiene cuatro llamadores reales y los cuatro leen por nombre de campo.

### Sesión 95 — Las categorías dejan de estar hardcodeadas (2026-08-05)

Comparando la tienda contra Tiendanube feature por feature, casi todo ya
estaba: cuotas, envío gratis con barra de progreso, reseñas, preguntas,
wishlist, cupones, carritos abandonados, feed para Google y Meta —verificado,
emite 50 ítems sanos—, sitemap, píxeles y seguimiento. Lo que faltaba era otra
cosa, y era estructural.

**El nombre de una categoría salía de un `Record` hardcodeado con cuatro
entradas de perfumería.** En una plataforma multi-tenant eso significa que
quien venda ropa ve el slug crudo, y que nadie puede renombrar, ordenar,
esconder ni ponerle una foto a una categoría sin tocar código. Es de las
primeras cosas que Tiendanube deja hacer.

La tabla `ecommerce_categories` ya existía con la forma correcta —jerárquica,
con slug, orden e imagen— **vacía y sin usar por ningún código**, y el RPC
`get_store_categories` también, del andamiaje inicial. Mismo caso que el stock
por sucursal en la sesión 92: la estructura estaba, faltaba conectarla.

Lo que **no** cambia es `products.category`: sigue guardando el slug y sigue
siendo lo que usan el POS, los precios por categoría y las ofertas masivas.
Esta migración le agrega nombre, orden y presentación a ese slug. Tocar la
columna habría obligado a migrar seis pantallas de una vez y a reescribir
`category_pricing`, que se indexa por slug.

Por eso el día que se aplica **la tienda se ve exactamente igual**: verificado
en el navegador antes y después. Sin categorías propias el menú sigue saliendo
de los slugs de los productos con los nombres viejos; con categorías cargadas
manda lo que puso el comercio. Renombrar "Vaper" y subirla al primer lugar se
propagó al menú del header y a las tarjetas de la portada.

Dos cosas que costaron y conviene no repetir:

- **El `DROP FUNCTION` de un RPC público.** Hacía falta porque cambiaba el tipo
  de retorno. Antes de dropearlo verifiqué con grep sobre `src`, `api` y las
  edge functions que **no lo llamara nadie** y que la tabla estuviera vacía. Sin
  ese chequeo, dropear un RPC público es exactamente el cambio que rompe la
  tienda en silencio.
- **Dos falsos positivos de agujero de seguridad, los dos míos.** El primero:
  un bloque `DO $` corre como superusuario y **bypassa la RLS**, así que el
  test decía que anon y otra organización leían la tabla. Corriendo con
  `SET ROLE anon` de verdad —que es lo que CLAUDE.md dice y yo me salteé— dan
  0 y 0. El segundo: el RPC público parecía devolver 0 filas para anon, y era
  que el subquery que le pasaba el slug corre en el contexto del **llamador**,
  no dentro de la función definer; con el slug literal devuelve las 3 con sus
  conteos.

### Sesión 94 — La promo que el comercio ya tenía cargada (2026-08-05)

`price_2x_ars` —el precio llevando dos— existía en la tabla, en la vista
pública `store_catalog_products`, en el select de `publicDataSource.ts` y se
mostraba en el catálogo por WhatsApp y en la página pública. **La tienda online
era la única superficie que lo ignoraba.** El comercio tenía la promo cargada,
la estaba publicando en otro lado, y su propia tienda cobraba el precio pleno.

Medido contra la base: LOST MARY DURA, oferta 26.496 c/u y 2x 36.000 — en la
tienda pagabas 52.992 por dos. ELFBAR ICE KING 40K, oferta 30.912 y 2x 42.000 —
pagabas 61.824. Alguien que vio el catálogo por WhatsApp y entró a la tienda
encontraba otro precio, que es la clase de inconsistencia que hace dudar del
resto.

**La decisión que define la implementación es que el ahorro se cuenta por
producto, cruzando líneas.** Los dos productos con promo son vapers con 9 y 10
sabores, así que la compra real —"uno de frutilla y otro de uva"— llega al RPC
como dos líneas de una unidad. Una regla que mirara `quantity >= 2` por línea
no habría disparado **nunca**, y el bug habría quedado escondido detrás de una
función que "ya lo contempla". Se verificó justamente ese caso contra
producción: dos sabores distintos descuentan 19.824.

Dónde entra en la cuenta, que tampoco es obvio: va como descuento y no bajando
el subtotal —el subtotal guardado tiene que seguir siendo la suma de los ítems
o la orden no cierra contra su propio detalle— pero se resta **antes** del
cupón, porque la promo es un precio y no una rebaja. Un 10% off sobre un precio
que nadie paga sería regalar plata. El descuento por medio de pago sigue
último.

`create_store_order` se regeneró **desde la definición que está en producción**,
insertando los cambios con un script, no reescribiéndola de memoria: es la
misma función que casi se rompe en la sesión 90 al derivarla de un fragmento.

En el navegador, con dos sabores en el carrito: subtotal 61.824, promo −19.824,
total de mercadería 42.000 — exactamente el precio 2x. El "te faltan X para el
envío gratis" también pasó a calcularse sobre el neto, que es lo que el
comprador realmente paga.

### Sesión 93 — Preguntas en la tienda, y quién factura de verdad (2026-08-05)

**Preguntar sobre un producto**, inspirada en prácticas de marketplaces; la
paridad actual de Tiendanube no estaba verificada.
En perfumería la objeción que frena la compra no es el precio: es "¿es
original?", "¿cuánto dura?". Hoy llegan por WhatsApp y se contestan de nuevo
cada vez. Dos decisiones definen el producto: **sólo se publican las
respondidas** —una tira de preguntas sin contestar dice que acá no atiende
nadie— y **preguntar pide cuenta, no compra**, que es toda la diferencia con
las reseñas: el que pregunta todavía no compró. Tope de 5 pendientes por
persona, o alguien deja cincuenta en un minuto. Del lado del comercio va en la
pestaña de Opiniones, ahora "Opiniones y preguntas", con el filtro arrancando
en "Sin responder": es lo único accionable de esa pantalla.

La verificación contra producción encontró que `RETURNS TABLE (id uuid, …)`
declara una variable `id` que choca con la columna en cualquier `SELECT` de
adentro de la función — `get_my_questions` abortaba con 42702. Y mirando la
ficha en el navegador aparecieron dos bugs viejos: `{(a?.length || b?.length)
&& …}` con las dos vacías evalúa a `0` y **React imprime el cero**, así que
había un 0 suelto en la página de casi todos los productos; y "Perfil olfativo"
se mostraba con el título y nada debajo, porque la fila de detalle se crea al
abrir la ficha en gestión aunque quede vacía.

**Negocio por comercio, en súper administración.** La plataforma cobra 5% por
venta y hasta acá sólo podía ver el total del mes: `platform_revenue_monthly`
agrupa por mes y moneda, no por comercio. La primera pregunta de cualquiera que
opera un marketplace es "¿quién me da la plata?" y la segunda "¿quién dejó de
dármela?", y ninguna se podía contestar sin escribir SQL a mano. El MRR de
suscripciones tampoco alcanza: un comercio puede estar al día con el plan y no
haber vendido en dos meses, y ése es justo el que se da de baja.

`platform_org_health` deriva una señal por comercio — `sin_activar`
(onboarding roto, no churn), `en_riesgo`, `cayendo`, `dormido`, `creciendo`,
`estable` — y la pantalla nueva (`/platform/negocio`) ordena por urgencia, no
alfabéticamente. El KPI que importa es **GMV en riesgo**, medido con el mes
anterior: lo que el comercio demostró que puede facturar es lo que se pierde si
nadie llama. La vista va **sin** `security_invoker` a propósito y filtra por
`is_platform_admin()` adentro; verificado con tres roles reales — staff ve las
4 organizaciones, el dueño de una organización ve 0, anónimo ve 0 — y el total
de comisión de la vista cuadra con la tabla cruda.

**Completar el tarifario de envíos.** El ítem #1 de §5, y lo que este documento
decía de él era falso: no es que un comprador de otra provincia reciba "No hay
envío disponible" — el retiro en local está habilitado, así que recibe **una**
opción, ir a buscarlo a CABA. Alguien en Ushuaia ve un checkout que parece
funcionar. Verificado con el RPC real `quote_store_shipping` sobre Buenos
Aires: antes 1 opción (retiro), después de cargar la tarifa 2 (retiro + Correo
Argentino a domicilio $14.000), y sobre los $150.000 las dos dan $0.

El botón nuevo estima las 6 zonas por **distancia de las provincias que
contienen**, no por el nombre de la zona. La banda de una zona es la de su
provincia más lejana y no el promedio: Patagonia tiene Neuquén y Tierra del
Fuego, y cotizar el promedio es vender a pérdida justo en el despacho más caro.
Nunca pisa lo cargado a mano y muestra las filas antes de crearlas.

El aviso amarillo de esa pantalla también era engañoso: decía "N provincias sin
zona", pero las 6 zonas por defecto cubren el país entero, así que estaba
callado mientras 23 provincias no podían comprar. Tener zona no alcanza — hace
falta que además tenga tarifa.

**Calidad de las publicaciones**, que es la herramienta de merchandising más
conocida de MercadoLibre y Tiendanube no tiene. Antes de escribirla se midió si
había algo que mostrar, y lo había: **10 de 60** productos activos publicados
**sin foto**, **59 de 60 sin peso**, 33 con descripción de menos de 80
caracteres, y las 30 filas de `product_perfume_details` que existen están
**todas vacías** — por eso no se hizo el filtro por familia olfativa que parecía
el próximo paso obvio: habría filtrado sobre nada.

El panel ordena por **impacto total** (productos × puntos), no por cuántos
productos tienen cada cosa mal. Verificado con el espejo en SQL: primero el
peso (59 × 15 = 885), último el SKU (60 × 2 = 120) aunque le falte a los 60.
Cargarle el SKU a todo el catálogo es más trabajo y rinde menos que sacarle la
foto a los diez que no la tienen. El peso además es el único ítem que cuesta
plata **en cada venta** y no ventas perdidas: sin él el envío se cotiza con los
0,5 kg por defecto.

Cada línea del ranking filtra el listado de abajo — una lista de pendientes que
no lleva a ningún lado no se completa nunca.

**Completar pesos**, que cierra ese círculo: el panel decía "59 sin peso" y
filtraba la lista, pero arreglarlo eran 59 diálogos. Se estima del contenido en
ml —los 60 lo tienen cargado, 54 son de 100 ml— con vista previa y sin pisar lo
cargado a mano. Mismo patrón que "Completar el tarifario", y por la misma
razón.

⚠️ **Y midiendo el efecto se cayó una afirmación de este mismo documento**, que
se había escrito dos commits antes sin verificarla. Decía que sin peso "cada
despacho más pesado se cobra de menos". Es al revés: los 55 perfumes estiman
**0,40 kg** contra un default de 0,50 y **ninguno lo supera**, así que la
tienda cotiza **de más**. Eso no cuesta margen, cuesta ventas — el envío caro
es de las primeras razones por las que se abandona un carrito.

Tres cosas más que aparecieron al medirlo, y que conviene tener presentes antes
de sacar conclusiones sobre envíos:

- El efecto sobre el precio hoy queda **tapado por el envío gratis desde
  $150.000**, que se alcanza a las 3 unidades. Dos cotizaciones consecutivas
  dieron $0 con y sin peso cargado por eso, no porque el peso no importe.
- La única tarifa cargada (CABA) tiene `price_per_extra_kg = 0`, así que ahí el
  excedente de peso **no se cobra en absoluto**. El peso empieza a mover el
  precio recién con las tarifas que genera "Completar el tarifario", que sí lo
  llevan.
- `store_cart_weight_kg` usa `products.weight_kg` cuando es > 0 y el default de
  la tienda si no — verificado leyendo la función, que es el eslabón del que
  depende todo lo anterior.

Por eso `kilosSubestimados` pasó a ser `diferenciaContraDefault`, que devuelve
las dos direcciones por separado: cotizar de más y cotizar de menos no son el
mismo problema, y un neto habría escondido cuál está pasando.

### Sesión 92 — El stock se movía dos veces, y nadie lo veía (2026-08-02)

Empezó siendo "stock real por depósito" del §6 y terminó destapando el bug más
caro que había en el sistema.

**Stock por sucursal.** La estructura estaba entera y sin usar: `locations`,
`location_stock`, la página, el `StoreFilter` y un selector en el POS que **ya
guardaba `sales.location_id`**. Faltaba el eslabón del medio —
`record_stock_movement` no sabía de sucursales— así que la venta sabía dónde se
hizo y el stock no.

**La transferencia entre sucursales inventaba mercadería.** Se hacía desde el
navegador con `Math.max(0, stock + delta)` en el origen y un INSERT del delta
completo en el destino. Reproducido: con 10 unidades, transferir 50 dejaba
origen 0 y destino 50, con el total todavía en 10. Cuarenta unidades de la nada.
Ahora va por RPC con `FOR UPDATE`, y `location_stock` pasó a sólo lectura para
la UI — tenía una policy `ALL`, que es por donde se colaba.

**Y el hallazgo grande: cada venta y cada compra movían el stock DOS veces.**
`addSaleDB`, `addSaleWithVariantDB` y `addPurchaseDB` ajustaban `products.stock`
después de insertar la fila, que ya había disparado el trigger. Vender 3 bajaba
6; comprar 5 subía 10. Lo usan el POS, Ventas, Presupuestos y el chat de IA — o
sea, todos los caminos de venta.

Se ve el rastro en producción: 15 productos con el Kardex distinto del stock
real, y varios con el Kardex en **negativo** y el stock positivo. La lectura es
que el doble descuento empujó los números abajo y se los venía corrigiendo a
mano, lo que no deja asiento. El pendiente de "AFNAN 9AM DIVE quedó en 7 y ese
número no es real" era un síntoma de esto.

**No se corrigieron los números.** Reconstruirlos exige saber qué ventas pasaron
por el camino duplicado y cuáles no, y es dato real del negocio: se corrige
contando el inventario. Queda como pendiente del dueño.

Al mirarlo aparecieron tres agujeros más: borrar una venta o una compra no
devolvía el stock; una compra programada sumaba mercadería el día que se pedía
en vez del día que llegaba; y editar sólo ajustaba por diferencia de cantidad,
sin cubrir el cambio de producto, de variante ni de sucursal.

La solución no fue sacar un descuento y dejar el otro, sino que **todo el
movimiento viva en la base**, en INSERT, UPDATE y DELETE. Mientras el cálculo
esté repartido entre cliente y trigger, alguno de los seis lugares que insertan
ventas se va a equivocar — y de hecho se equivocó.

Queda la vista `stock_negativo` como control, y una regla nueva en CLAUDE.md: no
tapar el resultado con `GREATEST(0, ...)`. Eso fue lo que hizo que el descuento
doble pasara desapercibido meses y lo que permitió que la transferencia inventara
unidades.

### Sesión 91 — El CRM deja de cruzar por nombre, y dos bugs mudos (2026-08-02)

Arrancó con una colisión: dos commits locales sin pushear hacían lo mismo que
dos del remoto —el CRM por `customer_id`, escrito en paralelo en las dos PCs—.
Se preguntó cuál sobrevivía, como manda CLAUDE.md, y ganó el remoto: es el
tronco compartido, ya tenía 15 commits encima y se había verificado forzando el
caso. Los locales quedaron en la rama `descartado/crm-customer-id-local` por si
hiciera falta rescatar algo. Es la segunda vez que pasa lo mismo; la regla de
traer el remoto **antes** de planificar no es ceremonia.

Después, los dos bugs que la pantalla no dejaba ver:

**Las notas de cliente decían "guardada" y no guardaban nada.** Los dos caminos
—la nota rápida y la masiva— escribían en `customer_notes` con
`onConflict: 'org_id,customer_name'`. Esa constraint no existe (la real es
`user_id,customer_name`), así que Postgres rechazaba con `42P10`. Y aun si
hubiera entrado, la ficha lee `customers.notes`, otra tabla: la nota no se vería
igual. No se notaba porque `upsert()` no lanza, devuelve el error en `.error`, y
nadie lo miraba — el `catch` nunca corría. La masiva era peor: `Promise.all`
sobre awaits que no lanzan informaba "Nota agregada a N clientes" con N =
seleccionados, aunque no hubiera entrado ninguna. La prueba de que estuvo roto
desde siempre: 26 perfiles y `customer_notes` con **0 filas**.

**Presupuestos y comunicaciones mostraban un tercio del historial.** Eran las
dos últimas tablas del CRM sin `customer_id`, y ni siquiera cruzaban igual entre
sí: `quotes` con `.ilike` y `customer_communications` con `.eq` exacto y
sensible a mayúsculas y tildes. Forzando el caso en producción —el mismo
cliente escrito "ZZ Ana Gómez", "zz ana gomez" y "ZZ  Ana  GÓMEZ"— la lectura
vieja veía **1 de 3** de cada una. No había forma de notarlo desde la UI: los
otros dos tercios no aparecían en ningún lado. Un presupuesto que no se ve es
plata que nadie cobra porque nadie lo siguió.

No hizo falta función nueva: `trg_sales_link_customer` ya era genérica, así que
ahora sirve a las cinco tablas. Del lado del cliente, `crmRowsForCustomer` hace
**dos consultas en vez de un `.or()`** — el `or` de PostgREST se arma
concatenando en una sola cadena, y un nombre con coma o paréntesis ("Pérez,
Juan", "Ana (mayorista)") rompe el filtro o lo convierte calladamente en otro.

También se limpiaron tres pendientes que ya estaban resueltos y seguían
documentados como abiertos (`send-team-invite`, los prefijos duplicados, y el
CRM por nombre).

**El libro de migraciones bajó de 168 a 32 de brecha.** Se escribió
`scripts/reconciliar-migraciones.mjs`, que deduce si una migración está aplicada
extrayendo los objetos que crea y preguntándole al catálogo cuáles existen —
ignorando lo que esté dentro de un bloque `DO`, donde el SQL se arma con
`format()` y los nombres no están en el archivo. Confirmó 131; otras 5 se
verificaron a mano una por una porque son `COMMENT`, `ALTER CONSTRAINT`,
`DROP FUNCTION`, `cron.schedule` y un `DO` dinámico, que el análisis estático no
puede leer.

Las 32 que quedan **no hay que aplicarlas**: 20 son duplicados superados (por
ejemplo `20260523000013_product_bundles` con 2/12 objetos, porque
`20260523000004` ya creó la feature con otros nombres de índice) y 11 crean
módulos que se sacaron del producto.

Y el hallazgo que cambió la evaluación del riesgo: **la migración destructiva
borraba 57 tablas que entre todas tenían 0 filas.** Estaba documentada como
"aplicarla sin backup borra datos"; no borraba ninguno. Estuvo sin correr un año
por miedo a un dato que no existía. Con eso claro se aplicó, previa verificación
de que ningún código las referenciara y posterior de que el `CASCADE` no se
hubiera llevado nada de la tienda pública — las 15 relaciones y funciones del
storefront siguen ahí y `get_store_by_slug` responde como rol `anon`.

**Y `db push` volvió a servir.** Cerrarlo necesitó dos cosas más que el libro:
registrar las 18 migraciones superadas por un duplicado, borrar del repo las 13
que crean módulos retirados (44 tablas que no existen ni usa ningún código —
dejarlas sólo servía para que un `push` las resucitara), y renombrar 12 archivos
cuya versión no tenía **14 dígitos exactos**. Eso último era el bloqueo real y
el más difícil de leer: con 8, 10 o 16 dígitos el CLI no ve el archivo, y el
error que tira —`LegacyDbPushMissingLocalError`, "remote migration versions not
found in local migrations directory"— apunta a la parte equivocada del problema.
Se renombraron preservando el orden lexicográfico y actualizando el libro en la
misma pasada. Hoy `db push --dry-run` responde
`{"upToDate":true,"migrations":[]}`.

Otra cosa que quedó documentada porque cuesta una hora descubrirla: **esta PC no
tiene `.env`**, así que el front local levanta pero no se conecta a ninguna base
y la tienda pública dice "Tienda no encontrada" teniendo la tienda activa. No es
un bug. Sin `.env`, el navegador sólo prueba que compila.

**Recepción parcial de órdenes de compra.** El ROADMAP decía "se recibe entera o
nada"; el código no recibía nada: "Marcar recibida" cambiaba el estado y la
fecha, sin tocar `quantity_received` —que existía y quedaba en 0 para siempre—
ni mover una unidad de stock. El estado `partially_received` estaba en el
vocabulario y en la UI con su color ámbar, y no había forma de alcanzarlo.

Ahora todo pasa por el RPC `receive_purchase_order`, que valida contra lo
pendiente, **inserta en `purchases`** para que `trg_purchase_stock_movement`
mueva el stock —escribirlo a mano habría duplicado el movimiento, el error que
este repo ya cometió una vez— deja la entrega en `purchase_order_receipts` y
recalcula el estado desde los renglones. Recibir de más se rechaza con el nombre
del producto y el faltante, en vez de recortar en silencio.

En el camino apareció un bug de aislamiento entre organizaciones:
`trg_purchase_stock_movement` derivaba la organización de la **primera membresía
del usuario** en vez de usar `NEW.org_id`, que existe y es NOT NULL. Para alguien
que pertenece a dos organizaciones, una compra cargada en la segunda movía el
stock de la primera. Había que arreglarlo igual, porque la recepción de OC
depende de eso.

De paso, el informe destapó que 6 tablas creadas en las sesiones 86–90
(`store_banners`, `store_pages`, `store_stock_alerts`, `store_wishlists`,
`platform_commission_rules`, `oauth_states`) habían quedado **sin índice por
`org_id`** — el mismo problema que `20260730000006` había arreglado para 59
tablas. Se volvió a correr esa migración, que es idempotente por diseño, y ahora
no queda ninguna.

Lo que **no** se verificó: el flujo logueado en el navegador. `/clientes` está
detrás del login y no corresponde que la sesión cargue credenciales, así que se
comprobó que compila y carga sin errores de consola, y el resto se verificó
contra la base ejecutando como rol `authenticated` con los claims de un miembro
real, para que la RLS se evaluara de verdad.

### Sesión 90 — La primera venta real, y los cuatro bugs que destapó (2026-07-31)

La sesión empezó queriendo cerrar el ciclo de envío y terminó siendo, sobre
todo, la primera vez que una compra de verdad recorrió el sistema entero. Dos
compras de $1, acreditadas en MercadoPago, con el `application_fee` de $0,05
derivado a la plataforma. El circuito de plata funciona.

Llegar hasta ahí destapó cosas que ninguna lectura del código encontró:

**La firma del webhook nunca validaba.** Con `MP_WEBHOOK_SECRET` configurado,
toda notificación con firma inválida devuelve 401 — y ninguna validaba jamás,
por dos causas independientes: faltaba el punto y coma final del manifiesto que
MercadoPago firma, y el parseo del header se rompía con un espacio
(`Object.fromEntries` dejaba la clave como `" v1"`). Resultado: la compra
quedaba pagada y acreditada del lado de MercadoPago y en "esperando el pago" del
lado de la tienda, para siempre. Lo peor era que **no había dónde mirar**: el
401 era mudo, `payment_transactions` vacía, y la orden simplemente no cambiaba.

**La venta online era la única que no registraba su liquidación.** La rama de
`ecom:` salía por un `return` temprano y nunca llegaba a
`recordPaymentTransaction`. Justo el canal que cobra comisión de plataforma era
el único que no la anotaba.

**La tienda decía "Activa" mientras 22 de 23 provincias no podían comprar.**
`canQuote` se conformaba con que **alguna** zona tuviera tarifa, y
`coveredProvinces` contaba provincias con zona, tuviera tarifas o no. Como las
6 zonas cubren las 23 provincias, daba cobertura completa. Se descubrió porque
la primera orden de prueba, a Santa Fe, murió antes de llegar al pago.

**El id de pago vivía en `tracking_number`.** Al comprador se le mostraba
"Seguimiento: 170468158111", un número que no le sirve a ningún correo, y al
despachar de verdad el número de envío pisaba el id de pago.

Y dos de MFA, encadenados: cancelar el alta de 2FA una sola vez dejaba un factor
sin verificar que **bloqueaba la activación para siempre** —y ese factor no se
veía en ninguna parte de la UI—; arreglarlo destapó que el QR se armaba con el
SVG del QR en vez de con la URI, lo que tiraba Perfil en pantalla blanca.
Nunca se había podido completar el alta de 2FA de punta a punta.

**Lo construido:** despachar una orden con etiqueta imprimible y seguimiento que
el comprador ve sin cuenta; el CRM cruzando por `customer_id` en vez de por
cómo se escribió el nombre; y una limpieza grande de credenciales.

**Credenciales.** Integraciones ofrecía OAuth y, más abajo, un campo para pegar
el token a mano — dos caminos para lo mismo, y el peor de los dos. Escribir el
test guardia encontró lo que la limpieza a ojo no: tres pantallas preguntaban
"¿hay MercadoPago?" mirando la columna vacía, así que respondían que no se podía
cobrar mientras la cuenta estaba conectada. Y la clave privada de AFIP vivía en
`settings`, que cualquier miembro de la organización puede leer.

**Se fueron Tiendanube (API) y Shopify**, con 0 conexiones cada una: cinco Edge
Functions borradas también de producción, tres tablas y cuatro columnas.
Sobrevive el importador de planillas, que no usa API y es el camino de entrada
para quien se cambia. **Stripe no se tocó**: parece una integración más y es la
facturación del propio SaaS, con dos suscripciones vivas.

Sobre OAuth donde se pidió: MercadoPago, MercadoLibre y Tiendanube ya lo tenían.
Correo Argentino, Andreani, AFIP y Evolution **no lo ofrecen** — no es que falte
implementarlo. Para AFIP lo más parecido es que cada comercio delegue el
servicio WSFE al CUIT de la plataforma desde "Administrador de Relaciones"; la
estructura nueva sirve para ese modelo sin cambios.

### Sesión 88 — Vitrina: banners, precio, deseos y reposición (2026-07-30)

Tres ítems de paridad, y un arreglo que apareció haciéndolos.

**Banners con vigencia** (`20260731000009`). Había un solo `banner_url` sin
enlace ni fecha. Ahora hay filas con título, CTA, orden y ventana de vigencia
resuelta en el servidor. El slider no aparece con un solo banner, frena el
autoplay al pasar el mouse y respeta `prefers-reduced-motion`.

**Filtro por rango de precio**, en la URL como el resto, con los extremos
reales del catálogo como placeholders.

**Deseos y aviso de reposición** (`20260731000010`/`11`). Los deseos piden
cuenta; el aviso, no — quien ve "sin stock" y se va ya es una venta perdida.

Haciéndolo apareció que **la tienda escondía lo agotado**: `catalog_products`
filtra `stock > 0`, así que la ficha devolvía "Producto no encontrado" y con
ella se perdían la URL indexada y la señal de qué reponer. Se agregó
`store_catalog_products`, hermana sin ese filtro — hermana y no un cambio a la
existente, que la leen el catálogo por WhatsApp y la página pública.

Dos guardas hicieron su trabajo: el test de producción encontró que
`UNIQUE (product_id, variant_id, email)` no deduplicaba con `variant_id` NULL
(NULL nunca es igual a NULL, el `ON CONFLICT` no disparaba); y
`edgeFunctionAuth.test.ts` falló apenas apareció una función que manda emails
sin declararse como cron.

### Sesión 87 — Reseñas y páginas de contenido (2026-07-30)

Dos huecos que separaban la tienda de una de Tiendanube, ninguno cosmético.

**Reseñas** (`20260731000007`). La regla es una: sólo reseña quien compró y
pagó, validado contra `ecommerce_orders`. Y se valida dos veces —
`can_review_product` decide qué mostrar, `upsert_product_review` es la barrera.
Una opinión por comprador y producto; editarla la republica. El comercio no
puede editar lo que escribió el cliente: sólo ocultarlo o responderle. En la
grilla la estrella aparece sólo si hay opiniones.

**Páginas de contenido** (`20260731000008`). No es maquillaje: la Ley 24.240
obliga a publicar el botón de arrepentimiento, y MercadoPago pide ver las
políticas antes de habilitar la cuenta de vendedor. Cuatro páginas editables
con URL propia, listadas en el footer, sembradas como borradores ya redactados
para Argentina — una tienda que arranca con las páginas vacías las deja
vacías. El markdown se parsea a elementos de React, nunca a HTML: el texto lo
escribe el comercio y se sirve con la sesión del comprador viva.
`miniMarkdown.test.tsx` fija eso como invariante.

De paso, `types.ts` dejó de estar truncado.

### Sesión 86 — Tienda online completa: de vitrina a ecommerce (2026-07-30)

**La tienda online no existía.** El panel "Tienda Online" venía guardando tema,
colores, métodos de pago y SEO desde hacía tiempo, pero **no había ruta
`/tienda/:slug`**: era un formulario de configuración de una vitrina que nunca
se renderizó, y el botón "Ver tienda" apuntaba a `gestiona.app`, un dominio
hardcodeado que no resuelve. Se construyó la tienda entera:

- Home, listado con filtros en la URL, ficha con perfil olfativo, carrito
  persistente, checkout y confirmación.
- Los 5 temas del panel ahora hacen algo: cada uno define variables CSS y el
  `primary_color` del negocio pisa el acento, con el texto encima ajustado por
  luminancia para que siga siendo legible.
- **Cobro online con MercadoPago**: la venta entra al mismo libro que el resto
  (`source='tienda_online'`), así aparece en Dashboard, Reportes y P&L sin
  tratamiento especial. Idempotente, porque MP reintenta sus webhooks.
- **Cuentas de comprador por tienda**, cupones, carritos abandonados con
  recuperación por email, emails transaccionales, y OG/sitemap servidos desde
  el borde para los bots (que no ejecutan JavaScript).
- **OAuth de MercadoPago multi-tienda**: la plataforma tiene una aplicación y
  cada comercio conecta su cuenta con un clic, como Tiendanube. El token pegado
  a mano sigue andando para no romper a quien ya lo tenía.
- **Variantes**: la organización tenía 26 cargadas y la vitrina las ignoraba.
  Ahora cada una es una línea de carrito con precio y stock propios.
- **Píxeles** de Meta, GA4 y TikTok con eventos de ecommerce completos. Los
  scripts sólo cargan si el ID está configurado, y no se envía dato personal.

**Bugs que habrían roto ventas reales, encontrados probando contra la base:**

- `sales.source` tenía un CHECK sin el canal propio: **toda** venta online
  fallaba al registrarse.
- Se descontaba stock a mano **además** del trigger `trg_sale_stock_movement`:
  con stock 2 y una compra de 2 quedaba en −2.
- Al sumarle el cupón, `create_store_order` quedó con dos firmas y PostgREST
  devolvía "Could not choose the best candidate function" — checkout entero
  caído.
- Las vistas `*_connection_status` usaban `security_invoker`, y como las tablas
  de tokens tienen RLS sin policies devolvían siempre vacío: el panel decía
  "sin conectar" con la cuenta vinculada, sin forma de desconectarla.
- `handle_new_user_create_org` le daba organización, rol `owner` y trial a
  **cada comprador** que se registraba en una tienda.
- El guard anti-loop del service worker era un flag de sesión sin vencimiento:
  tras la primera recarga, ningún deploy posterior volvía a aplicarse y la app
  quedaba mostrando código viejo indefinidamente.

**Pendiente para emparejar con Tiendanube/Empretienda**, en orden de impacto:
reseñas de productos (no existe ni la tabla), páginas de contenido editables
(Sobre nosotros, Preguntas frecuentes, Cambios y devoluciones), banner/slider
con enlaces en la home, lista de deseos y aviso de reposición, y filtro por
rango de precio.

---

---

*Última revisión: 2026-08-21*
*Para el detalle del día a día: `git log --oneline -20`.*
