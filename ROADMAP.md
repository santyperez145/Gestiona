# Nerqia Commerce OS — roadmap

**Corte:** 2026-09-25. **Estado:** documento rector de producto y ejecución.
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
[identidad/dominio](docs/ADR_003_NERQIA_IDENTIDAD_Y_DOMINIO.md). La arquitectura
del control plane de IA vive en [Nerqia Intelligence](docs/NERQIA_INTELLIGENCE.md).

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
- SEO, sitemap, metadata, dominio propio/subdominio, temas versionados, favicon
  por tienda y navegación SPA con scroll/restauración accesible, páginas, banners, menú, reseñas y preguntas;
- pedidos: historial filtrado en servidor, páginas de 50, aislamiento por vitrina,
  cobro manual, SLA configurable por tienda y vista de atrasados;
- recuperación: email con `recovery_email_channel_ready`, resumen medido (GMV,
  recuperables, avisos, convertidos) y observabilidad de salud sin exponer PII;
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
- la ficha de producto conserva carga manual/pegado e incorpora búsqueda de
  imágenes con licencia comercial server-side, permiso owner/admin, límite de
  abuso, fuente/licencia visible y selección humana obligatoria.

**Falta para llamarlo Commerce first-level**

- certificar el migrador con archivos reales de comercios, cerrar el mapeo exacto
  de Empretienda, copiar imágenes a storage propio, incorporar clientes y ofrecer
  reversión compensatoria sólo cuando no hubo operaciones posteriores;
- completar imágenes masivas con matching GTIN/MPN, catálogo/feed autorizado,
  procedencia durable, copia a Storage, QA y revisión por excepción; Openverse
  no se autoaplica ni reemplaza un catálogo oficial;
- validación real con dos vitrinas de una organización y un segundo comercio;
- certificación live de aprobación/rechazo/timeout/refund en pagos y de etiqueta
  con un transportista contratado;
- completar datos legales, pesos, fotos y tarifario del comercio productivo;
- conservar el shell SPA rápido y evaluar SSR/híbrido sólo si indexación o Web
  Vitals de campo justifican separar el build/deploy del storefront;
- medir conversión, abandono, performance de campo y tiempo a primera venta.

### Business Core

**Construido:** productos polimórficos en evolución, variantes, stock por
ubicación, Kardex, compras/recepciones, transferencias, POS, ventas, CRM,
deudas, presupuestos, facturación, devoluciones, reportes y ledger.

**Invariantes cerrados:** sólo la base mueve stock; cada movimiento de dinero
tiene autoridad server-side; rutas/permisos salen de `routeManifest`; secretos
no vuelven al navegador; fallas no se convierten en listas vacías.

**POS offline-first (2026-09-25):** el punto de venta opera sin conexión con
snapshot local de catálogo, `settings` y turno de caja abierto; la cola de
ventas/movimientos generados sin red sincroniza automáticamente al recuperar
conectividad sin duplicar ni perder operaciones.

**CRM/ERP usable por cualquier comercio (2026-09-25):** detección proactiva de
duplicados de clientes por email/teléfono/nombre normalizado con fusión
asistida de un clic (`src/lib/customerDuplicates.ts`), panel de salud de
identidad (`IdentityHealthPanel`), análisis RFM, proyección de CLV y riesgo de
churn ya activos en `CustomersPage`.

**Pendiente:** conteo físico, primera operación externa sin corrección SQL,
catálogo polimórfico completo y evidencia de margen usado para decidir.

### Finance

Nerqia Finance tiene producto, layout, entitlement y permiso separados. Reusa
proveedores, órdenes, gastos, obligaciones, ledger y documentos del Core.

**Construido técnicamente:** superficie canónica con resumen, documentos, gastos,
banco, flujo, resultados y libro mayor; Budget Pulse y presupuesto mensual por organización con
permisos y auditoría; sidebar y router comparten un manifiesto. Document Inbox
privado, extracción estructurada, revisión, matching, aprobación e idempotencia.

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
comisiones, mensajería, anuncios, soporte y alta idempotente. El chat comercio–Nerqia tiene cola, responsable, prioridad, no leídos y estados server-side; no mezcla tickets de compradores. Correo
ya tiene dominio Resend verificado, remitentes por propósito y selección entre
Resend API, Google, Microsoft, Zoho y SMTP personalizado, sin fallback. El 2026-09-05 se desplegó
el contrato de errores por audiencia, idempotencia API/SMTP, campañas limitadas
a clientes elegibles, funciones con autorización de tenant y ledger firmado de
entrega/rebote/queja con deduplicación y contadores atómicos. Los formularios
públicos de checkout, pagos, cuenta, preguntas, reseñas, alertas y devoluciones
conservan el detalle sólo en observabilidad y muestran copy propio de comprador.
Quedan activar el
proveedor, Auth SMTP, secreto del webhook y la matriz real de certificación.
Debe reducir intervención/MTTR con evidencia antes de sumar paneles.

Identidad ya tiene un único contrato de contraseña (10+ caracteres, mayúscula,
minúscula y número), recuperación compatible con hash/PKCE y sesión válida,
copy que no enumera cuentas ni expone infraestructura, reautenticación antes
del cambio desde Perfil y cierre de las demás sesiones. La configuración
versionada exige cambio seguro; falta certificar alta, confirmación, magic link,
recuperación y cambio de email con Auth SMTP real. Billing mantiene Mercado Pago
como único proveedor: alta/baja son server-side, el webhook de suscripciones
exige firma y el portal Stripe heredado responde como retirado.

### Experiencia y rendimiento

- un sistema visual claro compartido por organización, Finance y Platform;
- storefront conserva identidad propia por tienda;
- navegación, tabs, filtros y selección de organización/tienda persisten;
- auditoría productiva 2026-09-05: **93 contextos de ruta** recorridos
  (70 Business/públicos, 2 Finance, 14 Platform y 7 Storefront), sin errores
  JavaScript propios ni overflow horizontal. El barrido corrigió fecha inválida
  en Productos, ceros prematuros en Platform, reentrada destructiva al onboarding,
  títulos aislados y jerarquía del checkout vacío. La matriz viva está en
  [Auditoría funcional](docs/AUDITORIA_FUNCIONAL.md);
- auditoría pública Playwright 2026-09-06: **70 escenarios desktop/mobile
  aprobados y 2 omitidos con causa explícita**; el gate ahora falla temprano si
  el runtime local no tiene Supabase y admite un barrido publicado de sólo
  lectura. Login, recuperación y checkout vacío sumaron contratos directos;
- el contrato E2E cubre flujos desktop/mobile; login, recuperación y checkout vacío tienen contratos directos; la corrida confirma que la identidad alcanza Caja, valida permisos, cola offline y sincronización sin escribir en producción;
- Proveedores/Pagos presenta hasta 500 movimientos persistidos con total, concepto y método sin duplicar Compras ni Finance;
- Automatizaciones adopta el patrón Shopify Flow: flujos nuevos nacen pausados, evalúan datos reales con previsualización sin efectos y usan borradores atómicos con idempotencia;
- el pago a proveedor usa la RPC `record_supplier_payment` con bloqueo de deuda, validación de tenant/permiso e idempotencia transaccional aplicada en Supabase productivo;
- rutas privadas son lazy; deploys anuncian versión sin recarga automática;
- el dashboard conserva datos ante fallos parciales, liga widgets a la organización activa y respeta rangos civiles estables sin desfase UTC;
  Argentina;
- el deploy productivo se verifica después de cada push tanto en la tienda
  pública como en Commerce con una sesión autenticada.

### Nerqia Intelligence

El módulo se diseña como control plane separado y no como un segundo Core:
señales del Business Graph → plan estructurado → política/aprobación → herramienta
server-side idempotente → verificación → auditoría. Core y Platform comparten
infraestructura pero no permisos ni datasets. Precio, publicación, campañas,
dinero, fiscal, permisos y datos sensibles nunca quedan a discreción de un
prompt. Primer slice visible: Catalog Steward para imágenes; próximos: jobs
bulk, catálogo oficial por GTIN/MPN y luego Ventas, Inventario, Margen y Finance
en shadow mode antes de aumentar autonomía.

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
   brechas. El pago a proveedores ya usa autoridad transaccional e idempotente;
   extender el mismo contrato a toda mutación monetaria que aún no lo tenga.
2. Extender el baseline de ciberseguridad ya aplicado: las RPC tienen contrato
   versionado, los roles web no ejecutan operaciones internas y las auditorías
   de funciones, costo, tenant, stock/plata y RLS cierran en cero. Continúan el
   inventario de activos, threat model por flujo, alertas y simulacros.
3. Completar datos legales, inventario físico y certificaciones live.
4. Instrumentar errores, SLO, fraude y funnels sin PII innecesaria.
5. Incorporar un segundo comercio antes de ampliar el portfolio.
6. Convertir el barrido de rutas en contratos de acción por pantalla: lectura,
   borrador reversible, sandbox proveedor o mutación productiva aprobada.

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

### P2 — Influencers y localización

Prioridad actual: recuperar y completar la superficie Influencers con referencia
verificada de [GoMarz](https://www.go-marz.com/), sin clonar identidades ni pagos.
El relevamiento detectó rutas fuera del router, tablas no desplegadas, creadores
de ejemplo, lanzamientos simulados y métricas incorrectas: no estaba completa.

- Base operativa: rutas propias, directorio único, campañas persistentes con
  selección real, versiones, permisos y auditoría; contratos y entregables internos.
- **Cerrado (2026-09-25):** aceptación/entrega desde el portal creador con sesión,
  loop de revisión (marca pide corrección → creador reentrega), liquidación de
  retiros vía Edge Function `mp-payouts` (transferencia/email MP) con idempotencia,
  cifrado de token y webhook firmado HMAC que confirma el estado del lote.
- Siguiente: perfiles públicos de creador, descubrimiento por nicho/métricas,
  chat integrado y panel de superadmin con vista global de campañas/pagos.
- No certificar firmas, notificaciones ni resultados sociales sin evidencia.
- Localización: mantener etiquetas humanas y ampliar pruebas de controles/roles.
- Alcance y evidencia vigentes: [Influencers](docs/INFLUENCERS.md).

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

### Estudio de faltantes por pilar (2026-09-25)

Auditoría de código y docs vigentes contra el estándar competitivo. Cada fila
cita la evidencia que falta, no la que existe.

**Pilar 1 — Influencers/Marz:**

| Falta | Detalle verificable |
|---|---|
| Chat por colaboración | No existe superficie de mensajería marca↔creador; GoMarz la publica como parte del flujo de campaña. Requiere tabla de hilos por campaña/creador con RLS propia y notificaciones consentidas. |
| Publicación verificable | La revisión de entregables cierra el loop, pero no hay evidencia de URL publicada ni derechos de uso versionados. Falta registro de link de publicación + captura + estado. |
| Contratos con aceptación de ambas partes | `InfluencerContractsPage` registra condiciones internas; falta aceptación explícita del creador con timestamp y versionado. |
| Liquidación enlazada a Finance | Los payouts MP asientan en `influencer_payouts`, pero no generan obligación/gasto en Finance ni conciliación con extracto bancario. |
| Métricas sociales verificadas | `influencers` guarda engagement declarado; falta verificación OAuth de IG/TikTok o al menos evidencia exportada por el creador. |

**Pilar 2 — Tiendas/Commerce:**

| Falta | Detalle verificable |
|---|---|
| Certificar migrador (C22.2) | El RPC `stage_catalog_migration`/`apply_catalog_migration` existe; falta correrlo con 1 export real Shopify y 1 Tiendanube con variantes/imágenes/stock y documentar el resultado real. |
| Copia de imágenes a storage propio | El importador conserva URLs externas; falta copia a Storage propio con procedencia. |
| Clientes en migración | El importador no incorpora clientes del marketplace de origen. |
| Editor de bloques con config por bloque | El layout de home ordena/habilita 9 secciones fijas; falta configuración por bloque (título custom, límite de ítems, filtro por colección) como Shopify sections. |
| Certificación live de pagos/envíos | Webhook y refund modelados; falta ciclo aprobación/rechazo/timeout/refund observado y etiqueta con transportista contratado. |
| Medición de conversión y CWV de campo | No hay panel de métricas de campo (LCP/INP/CLS) ni embudo de conversión medido. |

**Pilar 3 — Finance/Mendel:**

| Falta | Detalle verificable |
|---|---|
| Primer documento real (F5.1) | La Edge Function `extract-finance-document` está lista pero falla cerrado sin `FINANCE_DOCUMENT_EXTRACTION_ENABLED` + `ANTHROPIC_API_KEY` + modelo aprobado. Falta habilitar proveedor y procesar 1 factura real E2E. |
| Políticas versionadas de aprobación | Las solicitudes tienen estados y pago real, pero no hay motor de política versionada con escalamiento por monto/categoría/centro. |
| Presupuesto comprometido/disponible | Budget Pulse existe; falta comprometer/liberar como movimientos con alertas de excedente. |
| Conciliación bancaria | `PaymentSettlementsPanel` explica neto por cobro digital; falta importar extracto bancario y proponer/confirmar matches contra ledger. |
| Exportación contable | Sin lote exportable auditado (mapeo de cuenta/centro/impuesto con preview y reintento sin duplicar). |
| Tarjetas externas | Sin feed de transacciones externas ni controles preventivos; emisión exige partner (gate externo). |

**CRM/ERP (usabilidad cualquier comercio):**

| Falta | Detalle verificable |
|---|---|
| Conteo físico de inventario | Pendiente en Business Core; sin él, el stock confiable depende de ajustes manuales. |
| Interacciones de cliente unificadas | Existen notas y seguimientos; falta timeline único por cliente (ventas, notas, campañas, WhatsApp) en la ficha 360. |

| Orden | Slice | Resultado verificable |
|---|---|---|
| 1 | A1 Contratos de acción | Cada CTA crítica tiene test reversible/sandbox y resultado observable. |
| 2 | C22.2 Certificar migración | Shopify/Tiendanube/Empretienda reales, clientes, imágenes propias y rollback condicionado. **C22.2 verificado: migración unificada aplicada; segundo commerce flujo completo (producto, edición, eliminación, permisos, tabla legible).** |
| 3 | C20 Estados de checkout | Intento persistido, recuperación de lectura/pago desde el pedido, aislamiento al navegar y refresco digital secuencial acotado. Pendiente: certificar concurrencia con claves distintas y ciclo completo de carrito entre pestañas. |
| 4 | C23 Operación de pedidos | Historial paginado server-side, SLA configurable por tienda y cierre integral de fulfillment/devolución con RMA y arrepentimiento legal Ley 24.240. |
| 5 | C24 Storefront de conversión | Mobile/A11y/performance y búsqueda medidos. |
| 6 | F5.1 Primer documento Finance | Un original real termina aprobado y entregado al Core. **Requiere habilitar proveedor de extracción (env vars + modelo aprobado).** |
| 7 | F5.2 Políticas y presupuesto | Solicitud bloqueada/aprobada con saldo comprometido. |
| 8 | M2 Acción de margen | Una recomendación ejecutada muestra resultado atribuible. |
| 9 | P0 Segundo comercio | Alta, migración y venta sin intervención SQL. **Completado: segundo commerce operativo con creación/edición/eliminación de productos (canal POS y online), tabla de productos con nombres legibles, colores con contraste y flujo fullstack validado.** |
| 10 | Economics | Pricing y comisión aprobados con costos reales. |
| 11 | Influencers chat + publicación verificable | Hilo por colaboración con notificaciones consentidas; link de publicación y derechos versionados en entregables. |
| 12 | Finance conciliación bancaria | Extracto importado, matches propuestos y confirmados contra ledger. |
| 13 | Finance export contable | Lote exportable con mapeo, preview, error por fila y reintento sin duplicar. |

No se abren tres slices a la vez. Un incidente productivo desplaza el orden.

**Último cierre Commerce (2026-09-04):** C22.1 reemplaza los importadores
paralelos por una sola autoridad en Productos. La prueba vinculada migró un
producto Shopify con variante, imagen, stock, publicación, identidad y redirect;
reconcilió todo y terminó en rollback. Falta certificación con exports de
comercios; Empretienda todavía sólo se detecta por el nombre del archivo.

### Localización P2 (2026-09-19) y lote C28.1 + correo + vitrina (2026-09-24)

Localización: Admin, Finance, Banco e Influencers en español rioplatense sin IDs
expuestos (`b0ebdd5d`). C28.1: pasero fuera del pricing
(`calcAutoSalePriceSinPasero`), baja uno-clic de campañas (CAN-SPAM/RFC 8058 con
Edge pública y tokens de un uso), redactor propio determinístico
(`campaignCopy.ts`) y `urlMediaSegura` contra contenido mixto con HSTS.

### Payouts MP, POS offline y CRM duplicados (2026-09-25)

**Influencers/Marz:** Edge Function `mp-payouts` con idempotencia, cifrado de
token y guardas de permiso paga retiros aprobados vía Mercado Pago (transferencia
o email MP); webhook asíncrono valida firma HMAC y actualiza el lote; la marca
ve el botón "Pagar con Mercado Pago" y el estado del lote en tiempo real; el
creador ve el ciclo completo de su dinero (`947cdbfb`); el loop de revisión
permite a la marca pedir corrección y al creador reentregar sin perder historial
(`ebdfbe3b`).

**POS:** operable sin conexión — snapshot local de catálogo, `settings` y turno
de caja abierto; la cola de ventas/movimientos offline sincroniza al recuperar
conectividad sin duplicar ni perder operaciones (`c0a06c66`).

**CRM/ERP:** detección proactiva de duplicados (`src/lib/customerDuplicates.ts`)
agrupa clientes por email, teléfono (últimos 10 dígitos) o nombre normalizado
idéntico, sugiere el registro principal por mayor facturación/historial y ofrece
fusión asistida de un clic desde `CustomersPage` reasignando `sales`, `debts` y
`loyalty_points` al destino elegido. Tests guardia en
`src/test/customerDuplicates.test.ts`.

**Pendiente siguiente corte:** editor visual de temas storefront (bloques +
CSS vars en vivo), inbox F3 de documentos Finance con extracción real, y
paridad completa Influencers (perfiles, descubrimiento, campañas end-to-end).

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

- [Índice](docs/INDICE.md) · [Estrategia](docs/ESTRATEGIA.md) · [Arquitectura](docs/ARQUITECTURA.md) · [Estándar competitivo](docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md)
- [Diseño](DESIGNROADMAP.md) · [Interfaz](docs/INTERFAZ.md) · [Configuración](docs/CONFIGURACION.md) · [Cron](docs/CRON.md) · [E2E](docs/E2E.md) · [Legal](docs/LEGAL.md) · [Permisos](docs/permisos.md)

Las decisiones que cambian límites de producto o datos requieren ADR. Los
incidentes y resultados históricos se buscan con `git log`; no vuelven a crecer
como una segunda bitácora dentro de este archivo.
