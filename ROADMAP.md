# Nerqia Commerce OS — roadmap

**Corte:** 2026-09-04. **Estado:** documento rector de producto y ejecución.
La historia de entregas vive en Git; este archivo conserva únicamente el estado
actual, las decisiones vigentes y el trabajo siguiente.

## Objetivo

Llevar Nerqia a un Commerce Operating System de primer nivel: Commerce y las
tiendas online son el núcleo visible; Business mantiene la fuente de verdad;
Finance alcanza profundidad comparable a Mendel sin duplicar el Core; Pay,
Automate y Platform completan la operación. Toda la experiencia debe ser
homogénea, rápida, accesible, resistente al fraude y funcional de punta a punta.

Reglas de ejecución:

- comparar capacidades con fuentes oficiales de Shopify, Tiendanube,
  Empretienda, Mercado Libre/Mercado Pago y Mendel;
- traducir patrones, nunca copiar marca ni interfaz;
- una capacidad tiene una ruta, un contrato y una fuente de verdad;
- cerrar slices pequeños con base, UI, errores, tests, navegador, documentación,
  commit, push y deploy;
- diferenciar implementación técnica de adopción, habilitación externa o
  validación comercial;
- mantener los `.md` breves y vigentes; Git conserva la bitácora.
- aplicar mínimo privilegio, denegación por defecto, trazabilidad, protección
  de abuso y revisión de dependencias en cada slice.

## 1. Tesis

> Creá tu tienda, vendé en cualquier canal y gestioná todo el negocio sin
> cambiar de plataforma. Nerqia explica cuánto ganaste, no sólo cuánto vendiste.

La ventaja no es tener más módulos. Es calcular margen real por operación con
datos que normalmente viven separados: costo histórico/landed cost, comisión
del cobro, envío, promoción, devolución e impuestos.

La North Star es **Active Transacting Merchants (ATM)**: organizaciones
distintas con al menos una venta POS u orden online confirmada en los últimos
30 días. Registros, tests, cantidad de pantallas o GMV no conciliado no son
tracción.

## 2. Arquitectura de producto

Un solo Business Graph es dueño de productos, variantes, categorías,
inventario, clientes, proveedores, compras, ventas, costos, cobros y margen.

| Superficie | Ruta | Responsabilidad | Límite |
|---|---|---|---|
| Commerce | `/tienda-online`, `/pedidos-online`, `/tienda/:slug` y `<slug>.nerqia.app` | Vitrina, checkout, pedidos, recuperación y canales. | Cada tienda personaliza experiencia; comparte el Core. |
| Business | `/` | POS, productos, stock, clientes, compras y operación. | Autoridad operacional de la organización. |
| Finance | `/finance` | Documentos, gastos, aprobaciones, payables y conciliación. | Producto y permisos propios; reutiliza entidades del Core. |
| Platform | `/platform` | Merchants, billing, integraciones, soporte y riesgo. | Staff con MFA; nunca hereda acceso a organizaciones. |
| Pay | Integrado en Commerce/POS/Finance | Orquestar y reconciliar cobros/reintegros. | No custodia dinero ni inventa acreditaciones. |
| Automate | Inicio e Inteligencia | Hallazgo → acción revisable → resultado. | No es un chatbot ni otro Core. |

Decisiones canónicas: [Commerce OS](docs/ADR_002_COMMERCE_OPERATING_SYSTEM.md),
[Finance](docs/ADR_001_FINANCE_PRODUCT_SURFACE.md) e
[identidad/dominio](docs/ADR_003_NERQIA_IDENTIDAD_Y_DOMINIO.md).

## 3. Estado actual

### Commerce

**Construido y verificado técnicamente**

- landing productiva centrada en tienda online, con Gestión y Finance como
  continuidad del mismo pedido;
- storefront, catálogo paginado, variantes, carrito server-side, identidad de
  comprador, checkout y orden canónica;
- precios, stock, descuentos, envío, impuestos y comisiones recalculados en la
  base;
- Mercado Pago OAuth, transferencia/efectivo, estados de pago y reintegros con
  idempotencia;
- retiro, zonas/tarifas, despacho, tracking, devoluciones legales y emails
  transaccionales;
- SEO, sitemap, metadata, dominio propio/subdominio, temas versionados, páginas,
  banners, menú, reseñas y preguntas;
- pedidos y recuperación como colas propias, con búsqueda, filtros, detalle y
  acciones masivas controladas;
- analítica first-party mínima, disclosure legal, adquisición y embudo;
- varias vitrinas por organización con exactamente una principal. Configuración,
  dominio, páginas, menú, pedidos, recuperación, reseñas, preguntas y analítica
  quedan por tienda; productos, stock, clientes, categorías y costos se
  comparten;
- surtido por vitrina con publicación/ocultamiento, precio comparativo, categoría,
  destacado y orden propios. El checkout y los endpoints SEO vuelven a resolver
  la vitrina en la base; producto y stock continúan en el Core.
- migrador único en Productos para Shopify, Tiendanube y planillas propias:
  detecta origen, agrupa variantes e imágenes, conserva identidad externa,
  mueve stock por Kardex y crea redirects por vitrina dentro de una transacción.

**Falta para llamarlo Commerce first-level**

- certificar el migrador con archivos reales de comercios, cerrar el mapeo exacto
  de Empretienda, copiar imágenes a storage propio, incorporar clientes y ofrecer
  reversión compensatoria sólo cuando no hubo operaciones posteriores;
- validación real con dos vitrinas de una organización y un segundo comercio;
- certificación live de aprobación/rechazo/timeout/refund en pagos y de etiqueta
  con un transportista contratado;
- completar datos legales, pesos, fotos y tarifario del comercio productivo;
- separar build/deploy del storefront sólo cuando la medición justifique el
  costo operativo;
- medir conversión, abandono, performance de campo y tiempo a primera venta.

### Business Core

**Construido:** productos polimórficos en evolución, variantes, stock por
ubicación, Kardex, compras/recepciones, transferencias, POS, ventas, CRM,
deudas, presupuestos, facturación, devoluciones, reportes y ledger.

**Invariantes cerrados:** sólo la base mueve stock; cada movimiento de dinero
tiene autoridad server-side; rutas/permisos salen de `routeManifest`; secretos
no vuelven al navegador; fallas no se convierten en listas vacías.

**Pendiente:** conteo físico, primera operación externa sin corrección SQL,
catálogo polimórfico completo y evidencia de margen usado para decidir.

### Finance

Nerqia Finance tiene producto, layout, entitlement y permiso separados. Reusa
proveedores, órdenes, gastos, obligaciones, ledger y documentos del Core.

**Construido técnicamente:** Document Inbox privado; hash/magic bytes;
cuarentena; extracción estructurada sin defaults financieros; revisión humana;
matching y aliases por tenant; borradores separados de factura, compra y deuda;
aprobación; entrega a recepción; trazabilidad e idempotencia.

**Límite actual:** no hay proveedor privado de inspección/extracción configurado
ni documentos reales procesados de punta a punta. La UI debe decirlo; no se
simula éxito.

#### Contrato de paridad Mendel-class

Mendel-class como benchmark principal significa cubrir el trabajo, no copiar
su menú:

| Trabajo | Estado Nerqia | Siguiente cierre |
|---|---|---|
| Inbox y captura de comprobantes | Base técnica | Proveedor privado + factura real. |
| Solicitudes y aprobaciones | Parcial | Políticas versionadas y escalamiento. |
| Presupuestos y centros de costo | Parcial | Comprometido/disponible + alertas. |
| Gastos, reembolsos y payables | Parcial | Flujo unificado y settlement externo. |
| Conciliación y exportación contable | Parcial | Match bancario y export certificado. |
| Tarjetas y reglas preventivas | Sin emisión | Primero tarjetas externas y una abstracción de emisor; emitir exige partner, legal, riesgo y economics. |
| IA operativa | Base transversal | Excepción → acción aprobada → resultado. |

Detalle vigente: [Finance](docs/FINANCE.md).

### Pay y Platform

Pay ya modela conexión OAuth, checkout, pago manual, QR, webhook, comisión,
settlement, refund y timeline. Faltan certificaciones live y economics con
costos reales antes de escalar comisión.

Platform tiene shell, MFA, Merchant 360, métricas, operaciones, integraciones,
comisiones, mensajería, anuncios, soporte consentido y alta idempotente. Correo
ya tiene dominio Resend verificado, remitentes por propósito y selección
explícita Resend/SMTP sin borrar el canal de respaldo. El 2026-09-05 se desplegó
el contrato de errores por audiencia, idempotencia API/SMTP, campañas limitadas
a clientes elegibles, funciones con autorización de tenant y ledger firmado de
entrega/rebote/queja con deduplicación y contadores atómicos. Los formularios
públicos de checkout, pagos, cuenta, preguntas, reseñas, alertas y devoluciones
conservan el detalle sólo en observabilidad y muestran copy propio de comprador.
Quedan activar el
proveedor, Auth SMTP, secreto del webhook y la matriz real de certificación.
Debe reducir intervención/MTTR con evidencia antes de sumar paneles.

### Experiencia y rendimiento

- un sistema visual claro compartido por organización, Finance y Platform;
- storefront conserva identidad propia por tienda;
- navegación, tabs, filtros y selección de organización/tienda persisten;
- rutas privadas y shells son lazy; la landing no descarga el panel completo;
- los deploys no recargan automáticamente: anuncian la versión y actualizan por
  acción explícita;
- corte técnico 2026-09-04: typecheck, lint con **0 errores/142 warnings
  conocidos**, **2.755 tests en 301 archivos** (`npm test`) y build/PWA verde;
- el deploy productivo se verifica después de cada push tanto en la tienda
  pública como en Commerce con una sesión autenticada.

## 4. Gates externos

Estos puntos no se cierran con más código:

| Gate | Evidencia requerida | Responsable |
|---|---|---|
| Identidad legal de la tienda | Razón social, CUIT, domicilio y páginas publicadas. | Dueño del comercio. |
| ARCA productiva | Certificado/punto de venta y primera factura real. | Responsable fiscal. |
| Inventario confiable | Conteo físico y ajuste trazable. | Comercio. |
| Pago real | Aprobación, rechazo, webhook, timeout y refund observados. | Operación/proveedor. |
| Logística real | Contrato, tarifa, etiqueta y entrega trazada. | Comercio/transportista. |
| Segundo comercio | Onboarding, migración y primera venta sin SQL. | Founder-led sales. |
| Finance real | Proveedor privado y documentos aprobados/recibidos. | Producto/operación. |
| Correo productivo | Activar Resend, Auth SMTP y webhook firmado; observar envío real desde `@nerqia.app`, recepción, reset/magic link/invitación, rebote, queja y supresión. | Plataforma/Resend. |
| Monetización | Costos, comisión neta, soporte y retención medidos. | CEO/CFO. |

## 5. Orden de ejecución

### P0 — Confiabilidad y evidencia

1. Mantener CI, RLS, autoridad de stock/dinero, cron y libro de migraciones sin
   brechas.
2. Extender el baseline de ciberseguridad ya aplicado: las RPC tienen contrato
   versionado, los roles web no ejecutan operaciones internas y las auditorías
   de funciones, costo, tenant, stock/plata y RLS cierran en cero. Continúan el
   inventario de activos, threat model por flujo, alertas y simulacros.
3. Completar datos legales, inventario físico y certificaciones live.
4. Instrumentar errores, SLO, fraude y funnels sin PII innecesaria.
5. Incorporar un segundo comercio antes de ampliar el portfolio.

### P1 — Commerce first-level

1. **Cerrado — surtido multi-tienda:** publicación, precio visible, categoría,
   destacado y orden por vitrina sin duplicar producto ni stock.
2. **Migración:** C22.1 cerró catálogo, variantes, identidad y redirects; C22.2
   debe cerrar archivos reales, clientes, copia de imágenes y rollback seguro.
3. **Checkout:** estados separados de cart/order/payment/fulfillment, concurrencia
   y recuperación clara.
4. **Operación:** fulfillment por ubicación, etiquetas, devoluciones y SLA.
5. **Storefront:** mobile, accesibilidad, performance de campo, búsqueda,
   merchandising y conversión.
6. **Merchant analytics:** adquisición, embudo, margen y cohortes accionables.
7. **Prueba real:** dos tiendas, segundo comercio y primera venta completa.

### P2 — Finance Mendel-class

1. Proveedor privado de inspección/extracción y primer documento real.
2. Solicitud → política → presupuesto → aprobación → gasto/deuda.
3. Reembolsos, fondos, anticipos y excepciones con roles.
4. Movimientos de tarjetas externas y controles preventivos.
5. Conciliación bancaria/contable y exportaciones auditables.
6. Emisión o movimiento de fondos sólo con partner y gates aprobados.

### P3 — Margin Intelligence y Automate

1. Completar hechos de margen por operación/canal.
2. Priorizar hallazgos por impacto y confianza.
3. Convertir recomendación en acción revisable.
4. Medir `AI Action Rate`, resultado y abstención.

### P4 — Escala

Pay/Ship, Developer Platform, apps, regionalización y Capital permanecen detrás
de demanda, economics, seguridad y regulación. Capital no se construye sin
partner.

## 6. Próximos slices

| Orden | Slice | Resultado verificable |
|---|---|---|
| 1 | C22.2 Certificar migración | Shopify/Tiendanube/Empretienda reales, clientes, imágenes propias y rollback condicionado. |
| 2 | C20 Estados de checkout | Cart/order/payment/fulfillment recuperan fallos y concurrencia. |
| 3 | C23 Operación de pedidos | Cola por SLA, fulfillment y devolución completos. |
| 4 | C24 Storefront de conversión | Mobile/A11y/performance y búsqueda medidos. |
| 5 | F5.1 Primer documento Finance | Un original real termina aprobado y entregado al Core. |
| 6 | F5.2 Políticas y presupuesto | Solicitud bloqueada/aprobada con saldo comprometido. |
| 7 | M2 Acción de margen | Una recomendación ejecutada muestra resultado atribuible. |
| 8 | P0 Segundo comercio | Alta, migración y venta sin intervención SQL. |
| 9 | Economics | Pricing y comisión aprobados con costos reales. |

No se abren tres slices a la vez. Un incidente productivo desplaza el orden.

**Último cierre Commerce (2026-09-04):** C22.1 reemplaza los importadores
paralelos por una sola autoridad en Productos. La prueba vinculada migró un
producto Shopify con variante, imagen, stock, publicación, identidad y redirect;
reconcilió todo y terminó en rollback. Falta certificación con exports de
comercios; Empretienda todavía sólo se detecta por el nombre del archivo.

## 7. Definition of Done

Una entrega está terminada cuando:

1. tiene una sola autoridad de datos y permisos server-side;
2. cubre loading, vacío inicial/filtrado, error, offline/stale, parcial y éxito;
3. no traga errores ni expone secretos/PII/costos en superficies públicas;
4. valida tenant, rol, input, abuso, idempotencia y auditoría según riesgo;
5. es usable con teclado, lector, móvil y desktop;
6. incluye tests proporcionales al riesgo y verificación contra Supabase real
   sin modificar datos del negocio;
7. pasa `npm run typecheck`, `npm run lint`, `npm test` y `npm run build`;
8. se prueba en `localhost` y luego en el deploy productivo autenticado/público;
9. actualiza este roadmap sólo si cambia estado, prioridad o un gate;
10. queda commiteada, pusheada y `Ready` en Vercel.

## 8. Métricas

| Capa | Métricas |
|---|---|
| Adquisición | Visitante → inicio → alta válida. |
| Activación | Tiempo a primera publicación, ticket y orden paga. |
| Commerce | Conversión, abandono, GMV pago, fulfillment, devolución e INP/LCP. |
| Business | Stock confiable, margen explicado y correcciones manuales. |
| Finance | Documentos procesados, tiempo de aprobación, excepciones y match. |
| Automate | AI Action Rate, impacto, override y abstención. |
| Platform | Tiempo de alta, MTTR, error rate y costo de soporte. |
| Seguridad | Intentos bloqueados, replay, abuso, privilegios, MTTR e incidentes. |
| Negocio | ATM, retención, ingreso neto, margen de contribución y concentración. |

## 9. Documentación y decisiones

- [Índice documental](docs/INDICE.md)
- [Estrategia y comparación](docs/ESTRATEGIA.md)
- [Arquitectura](docs/ARQUITECTURA.md)
- [Estándar competitivo](docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md)
- [Diseño](DESIGNROADMAP.md) e [interfaz](docs/INTERFAZ.md)
- [Configuración](docs/CONFIGURACION.md), [cron](docs/CRON.md) y
  [verificación E2E](docs/E2E.md)
- [Legal](docs/LEGAL.md) y [permisos](docs/permisos.md)

Las decisiones que cambian límites de producto o datos requieren ADR. Los
incidentes y resultados históricos se buscan con `git log`; no vuelven a crecer
como una segunda bitácora dentro de este archivo.
