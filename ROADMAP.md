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
  Empretienda, Mercado Libre/Mercado Pago y Mendel; traducir patrones, nunca
  copiar marca ni interfaz;
- una capacidad tiene una ruta, un contrato y una fuente de verdad;
- cerrar slices pequeños con base, UI, errores, tests, navegador, documentación,
  commit, push y deploy;
- diferenciar implementación técnica de adopción, habilitación externa o
  validación comercial; mantener los `.md` breves y vigentes;
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
- storefront con catálogo paginado, variantes, carrito server-side, identidad
  de comprador, checkout y orden canónica; precios, stock, descuentos, envío,
  impuestos y comisiones recalculados en la base;
- Mercado Pago OAuth, transferencia/efectivo, estados de pago y reintegros con
  idempotencia; retiro, zonas/tarifas, despacho, tracking, devoluciones legales
  y emails transaccionales;
- SEO, sitemap, metadata, dominio propio/subdominio, temas versionados, favicon
  por tienda y navegación SPA accesible, páginas, banners, menú, reseñas y preguntas;
- pedidos: historial filtrado en servidor, aislamiento por vitrina, cobro
  manual, SLA configurable por tienda y vista de atrasados;
- recuperación: email con `recovery_email_channel_ready`, resumen medido y
  observabilidad de salud sin exponer PII;
- analítica first-party mínima, disclosure legal, adquisición y embudo;
- varias vitrinas por organización con exactamente una principal: configuración,
  dominio, páginas, menú, pedidos, recuperación, reseñas y analítica por tienda;
  productos, stock, clientes, categorías y costos compartidos. Surtido por
  vitrina con publicación, precio comparativo, categoría, destacado y orden
  propios; el checkout y los endpoints SEO vuelven a resolver la vitrina en la base;
- migrador único en Productos para Shopify, Tiendanube y planillas propias:
  detecta origen, agrupa variantes e imágenes, conserva identidad externa,
  mueve stock por Kardex y crea redirects por vitrina dentro de una transacción;
- la ficha de producto conserva carga manual/pegado e incorpora búsqueda de
  imágenes con licencia comercial server-side, permiso owner/admin, límite de
  abuso, fuente/licencia visible y selección humana obligatoria.

**Falta:** lo detallado por fila en el estudio de faltantes (sección 6): certificar
el migrador con archivos reales, copiar imágenes a Storage, clientes en migración,
editor de bloques con config por bloque, certificación live de pagos/envíos y
métricas de campo.

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
duplicados por email/teléfono/nombre normalizado con fusión asistida de un clic
(`src/lib/customerDuplicates.ts`), panel de salud de identidad
(`IdentityHealthPanel`), RFM, CLV proyectado y riesgo de churn en `CustomersPage`.

**Pendiente:** conteo físico, primera operación externa sin corrección SQL,
catálogo polimórfico completo y evidencia de margen usado para decidir.

### Finance

Nerqia Finance tiene producto, layout, entitlement y permiso separados. Reusa
proveedores, órdenes, gastos, obligaciones, ledger y documentos del Core.

**Construido técnicamente:** superficie canónica con resumen, documentos, gastos,
banco, flujo, resultados y libro mayor; Budget Pulse y presupuesto mensual por
organización con permisos y auditoría; Document Inbox privado, extracción
estructurada, revisión, matching, aprobación e idempotencia; exportación
contable auditada desde el ledger (F5.3, 2026-09-25).

#### Contrato de paridad Mendel-class

Mendel-class como benchmark significa cubrir el trabajo, no copiar su menú. El
límite actual: sin proveedor privado de inspección/extracción configurado ni
documentos reales procesados de punta a punta; la UI lo dice, no simula éxito.

| Trabajo | Estado Nerqia | Siguiente cierre |
|---|---|---|
| Inbox y captura de comprobantes | Base técnica | Proveedor privado + factura real. |
| Solicitudes y aprobaciones | Parcial | Políticas versionadas y escalamiento. |
| Presupuestos y centros de costo | Parcial | Comprometido/disponible + alertas. |
| Gastos, reembolsos y payables | Parcial | Flujo unificado y settlement externo. |
| Conciliación y exportación contable | Export certificado | Match bancario contra extracto importado. |
| Tarjetas y reglas preventivas | Sin emisión | Primero tarjetas externas; emitir exige partner, legal, riesgo y economics. |
| IA operativa | Base transversal | Excepción → acción aprobada → resultado. |

Detalle vigente: [Finance](docs/FINANCE.md).

### Pay y Platform

Pay ya modela conexión OAuth, checkout, pago manual, QR, webhook, comisión,
settlement, refund y timeline. Faltan certificaciones live y economics con
costos reales antes de escalar comisión.

Platform tiene shell, MFA, Merchant 360, métricas, operaciones, integraciones,
comisiones, mensajería, anuncios, soporte y alta idempotente. El chat
comercio–Nerqia tiene cola, responsable, prioridad, no leídos y estados
server-side. Correo tiene dominio Resend verificado, remitentes por propósito,
contrato de errores por audiencia e idempotencia API/SMTP con ledger firmado de
entrega/rebote/queja; quedan activar Auth SMTP, secreto del webhook y la
certificación real. Identidad tiene contrato único de contraseña y
reautenticación antes del cambio; falta certificar el circuito con Auth SMTP.
Billing mantiene Mercado Pago como único proveedor con webhook firmado; el
portal Stripe heredado responde como retirado.

### Experiencia y rendimiento

- un sistema visual claro compartido por organización, Finance y Platform;
  storefront conserva identidad propia por tienda;
- navegación, tabs, filtros y selección de organización/tienda persisten;
- auditorías productivas 2026-09-05/06: 93 contextos de ruta y 70 escenarios
  Playwright desktop/mobile aprobados; matriz viva en
  [Auditoría funcional](docs/AUDITORIA_FUNCIONAL.md);
- el contrato E2E cubre flujos desktop/mobile; identidad alcanza Caja, valida
  permisos, cola offline y sincronización sin escribir en producción;
- Automatizaciones adopta el patrón Shopify Flow (flujos nacen pausados,
  previsualizan sin efectos, borradores atómicos idempotentes); el pago a
  proveedor usa `record_supplier_payment` con bloqueo de deuda, tenant/permiso
  e idempotencia transaccional;
- rutas privadas son lazy; deploys anuncian versión sin recarga automática;
- el dashboard conserva datos ante fallos parciales, liga widgets a la
  organización activa y respeta rangos civiles estables sin desfase UTC;
- el deploy productivo se verifica después de cada push tanto en la tienda
  pública como en Commerce con una sesión autenticada.

### Nerqia Intelligence

Control plane separado, no un segundo Core: señales del Business Graph → plan
estructurado → política/aprobación → herramienta server-side idempotente →
verificación → auditoría. Precio, publicación, campañas, dinero, fiscal,
permisos y datos sensibles nunca quedan a discreción de un prompt. Primer slice
visible: Catalog Steward para imágenes; luego Ventas, Inventario, Margen y
Finance en shadow mode antes de aumentar autonomía.

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
   brechas; extender el contrato transaccional e idempotente a toda mutación
   monetaria que aún no lo tenga.
2. Extender el baseline de ciberseguridad: RPC con contrato versionado, roles
   web sin operaciones internas, auditorías en cero; continuar inventario de
   activos, threat model, alertas y simulacros.
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

Prioridad actual: completar la superficie Influencers con referencia verificada
de [GoMarz](https://www.go-marz.com/), sin clonar identidades ni pagos.

- Base operativa: rutas propias, directorio único, campañas persistentes con
  selección real, versiones, permisos y auditoría; contratos y entregables internos.
- **Cerrado (2026-09-25):** aceptación/entrega desde el portal creador con sesión,
  loop de revisión (marca pide corrección → creador reentrega), liquidación de
  retiros vía Edge Function `mp-payouts` (transferencia/email MP) con idempotencia,
  cifrado de token y webhook firmado HMAC que confirma el estado del lote.
- Siguiente: perfiles públicos de creador, descubrimiento por nicho/métricas,
  chat integrado y panel de superadmin con vista global de campañas/pagos.
- No certificar firmas, notificaciones ni resultados sociales sin evidencia.
- Alcance y evidencia vigentes: [Influencers](docs/INFLUENCERS.md).

### P2 — Finance Mendel-class

1. Proveedor privado de inspección/extracción y primer documento real.
2. Solicitud → política → presupuesto → aprobación → gasto/deuda.
3. Reembolsos, fondos, anticipos y excepciones con roles.
4. Movimientos de tarjetas externas y controles preventivos; emitir sólo con partner.
5. Conciliación bancaria/contable y exportaciones auditables.

### P3/P4 — Margin Intelligence y Escala

1. Completar hechos de margen por operación/canal y priorizar hallazgos.
2. Convertir recomendación en acción revisable y medir `AI Action Rate`.
3. Pay/Ship, Developer Platform, apps, regionalización y Capital permanecen
   detrás de demanda, economics, seguridad y regulación; Capital exige partner.

## 6. Próximos slices

### Estudio de faltantes por pilar (2026-09-25)

Auditoría de código y docs vigentes contra el estándar competitivo. Cada fila
cita la evidencia que falta, no la que existe.

**Pilar 1 — Influencers/Marz:**

| Falta | Detalle verificable |
|---|---|
| Chat por colaboración | No existe mensajería marca↔creador; GoMarz la publica como parte del flujo de campaña. Requiere hilos por campaña/creador con RLS propia y notificaciones consentidas. |
| Publicación verificable | La revisión cierra el loop pero no registra URL publicada ni derechos de uso versionados (link + captura + estado). |
| Contratos con aceptación de ambas partes | `InfluencerContractsPage` registra condiciones internas; falta aceptación explícita del creador con timestamp y versionado. |
| Liquidación enlazada a Finance | Los payouts MP asientan en `influencer_payouts` pero no generan obligación/gasto en Finance ni conciliación bancaria. |
| Métricas sociales verificadas | `influencers` guarda engagement declarado; falta verificación OAuth de IG/TikTok o evidencia exportada por el creador. |

**Pilar 2 — Tiendas/Commerce:**

| Falta | Detalle verificable |
|---|---|
| Certificar migrador (C22.2) | El RPC de migración existe; falta correrlo con 1 export real Shopify y 1 Tiendanube con variantes/imágenes/stock y documentar el resultado. |
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
| Exportación contable | **Cerrado (2026-09-25):** `finance_export_batches` crea lotes desde el ledger con verificación de doble entrada, reuso idempotente y CSV para el contador (F5.3). Sigue pendiente la conciliación con extracto bancario (fila 12). |
| Tarjetas externas | Sin feed de transacciones externas ni controles preventivos; emisión exige partner (gate externo). |

**CRM/ERP (usabilidad cualquier comercio):**

| Falta | Detalle verificable |
|---|---|
| Conteo físico de inventario | Pendiente en Business Core; sin él, el stock confiable depende de ajustes manuales. |
| Interacciones de cliente unificadas | Existen notas y seguimientos; falta timeline único por cliente (ventas, notas, campañas, WhatsApp) en la ficha 360. |

| Orden | Slice | Resultado verificable |
|---|---|---|
| 1 | A1 Contratos de acción | Cada CTA crítica tiene test reversible/sandbox y resultado observable. |
| 2 | C22.2 Certificar migración | Exports reales de comercios, clientes, imágenes propias y rollback condicionado. La migración unificada ya está verificada con segundo commerce. |
| 3 | C20 Estados de checkout | Intento persistido y recuperación desde el pedido. Pendiente certificar concurrencia y ciclo completo entre pestañas. |
| 4 | C23 Operación de pedidos | Historial paginado server-side, SLA y cierre integral de fulfillment/devolución con RMA legal Ley 24.240. |
| 5 | C24 Storefront de conversión | Mobile/A11y/performance y búsqueda medidos. |
| 6 | F5.1 Primer documento Finance | Un original real aprobado; requiere habilitar proveedor de extracción. |
| 7 | F5.2 Políticas y presupuesto | Solicitud bloqueada/aprobada con saldo comprometido. |
| 8 | M2 Acción de margen | Una recomendación ejecutada muestra resultado atribuible. |
| 9 | P0 Segundo comercio | **Completado:** alta, migración y gestión de productos sin intervención SQL. |
| 10 | Economics | Pricing y comisión aprobados con costos reales. |
| 11 | Influencers chat + publicación verificable | Hilo por colaboración con notificaciones consentidas; link de publicación y derechos versionados. |
| 12 | Finance conciliación bancaria | Extracto importado, matches propuestos y confirmados contra ledger. |
| 13 | Finance export contable | **Cerrado (2026-09-25):** lotes desde el libro real con verificación de descuadre, CSV para el contador e historia de exportación. |

No se abren tres slices a la vez. Un incidente productivo desplaza el orden.

**Cierres recientes (2026-09-25):** payouts MP a creadores con webhook firmado
(`947cdbfb`), loop de revisión de entregables (`ebdfbe3b`), POS offline con
cola de sincronización (`c0a06c66`), deduplicación CRM con fusión asistida
(`8dcb19d1`), estudio de faltantes por pilar + landing actualizada
(`34c10e5b`) y exportación contable auditada F5.3. El histórico vive en `git log`.

## 7. Definition of Done

Una entrega está terminada cuando: tiene una sola autoridad de datos y permisos
server-side; cubre loading, vacío, error, offline/stale, parcial y éxito; no
traga errores ni expone secretos/PII/costos en superficies públicas; valida
tenant, rol, input, abuso, idempotencia y auditoría según riesgo; es usable con
teclado, lector, móvil y desktop; incluye tests proporcionales al riesgo y
verificación contra Supabase real sin modificar datos del negocio; pasa
`npm run typecheck`, `npm run lint`, `npm test` y `npm run build`; se prueba en
`localhost` y en el deploy productivo; actualiza este roadmap sólo si cambia
estado, prioridad o un gate; y queda commiteada, pusheada y `Ready` en Vercel.

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
