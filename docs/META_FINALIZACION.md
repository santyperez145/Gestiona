# Meta de finalización

**Estado:** vigente, 2026-10-09. **Owner:** Producto / CTO.
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
- [ ] Vigencia del certificado de plataforma y alertas 60/30/7 días en Platform.
- [ ] Advertencias de CAE otorgado persistidas (tope Monotributo y otras).
- [x] Nota de Débito asociada a factura autorizada (A/B/C), con CbtesAsoc en WSFE.
- [ ] Alta fiscal guiada: padrón (`ws_sr_constancia_inscripcion`), delegación paso a paso, detección de puntos CAE, autotest y factura de homologación.
- [ ] Facturación automática configurable (Commerce/POS) y por lote con resultado por pedido.
- [ ] Asistente de renovación de certificado (60/30/7 días).
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
- [ ] POS: presentación/caja y conversión entre unidades; fiado con límite de crédito.

**2. Abrir mi tienda en minutos (P1)**
- [ ] Studio: árbol de páginas, secciones/bloques, tokens y preview real versionado.
- [ ] AI Store Architect: propuesta revisable que produce configuración versionada.
- [ ] Búsqueda: autocompletado, sinónimos, facetas, analítica y cero resultados.
- [ ] Migración Shopify/Tiendanube medida (redirects, SEO, clientes, rollback).
- [ ] B2B: empresas, compradores, catálogos/precios, mínimos, crédito, cotizaciones.
- [ ] OMS: parciales, backorder/preorder, cambios, store credit, pickup.
- [ ] Suscripciones; Core Web Vitals medidos.

**3. Operar todo en Nerqia**
- [ ] Perfiles progresivos (emprendedor / establecido / avanzado) y packs verticales sin forks.
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
