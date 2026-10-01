# Nerqia Commerce OS — roadmap

**Estado:** canónico. **Revisión:** 2026-10-01. **Owner:** Producto / CTO.
Este documento contiene decisiones activas y próximos cierres, no un diario.
Git conserva la historia; los contratos de dominio viven en [el índice](docs/INDICE.md).

## Objetivo

Commerce y las tiendas online son el núcleo de Nerqia. Business sostiene una
fuente de verdad compartida; Finance controla gasto sin clonar Core; Profit
explica contribución y decisiones; Growth conecta captación, ventas y retención.
Completar trabajos verificables antes de ampliar el catálogo de módulos.

La referencia competitiva es Shopify/Tiendanube/Empretienda para Commerce,
Mendel para Finance, GoMarz para creadores, Clientify para Growth y Escalafy
para Profit. Cada comparación lleva fuente oficial y fecha; descripción pública
no equivale a auditoría del producto privado ni paridad demostrada.
El [estándar competitivo](docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md) gobierna UI,
investigación y tecnología. La marca y experiencia final son propias.

## 1. Decisiones de producto

- Commerce sigue siendo la puerta comercial y prioridad operacional.
- Profit se construye antes que Growth: aprovecha margen y costo existentes.
- Growth y Profit son productos fuera de Finance, sobre el mismo Graph.
- Commerce Graph es el Business Graph existente, no una segunda base.
- Una identidad, permisos, integraciones, event bus, Automation Runtime, AI
  Gateway y Page/Theme Engine; no motores separados por producto.
- Las rutas actuales siguen vigentes hasta una migración funcional con aliases.
  No se anuncian pantallas planeadas como capacidades disponibles.
- Creators mantiene seguridad, soporte y certificación; se pausa su expansión.
- Ads empieza con importación read-only; campañas, precios y dinero necesitan
  autoridad, política y aprobación antes de ejecutar.
- Comercio gratuito, standalone Profit, add-ons y Consulting son hipótesis de
  ICP/economics. Este roadmap no cambia precios ni habilita billing.
- Capital, emisión de tarjetas y custodia requieren partner, legal y riesgo.
- No se reescribe el stack por reputación; separar servicios/SSR requiere SLO
  o problema medido, owner, operación y costo de salida.

Decisión vigente: [ADR 004](docs/ADR_004_GROWTH_PROFIT_SHARED_GRAPH.md).
Actualiza parcialmente [ADR 002](docs/ADR_002_COMMERCE_OPERATING_SYSTEM.md);
no revierte multitienda, dominios ni temas ya implementados.

## 2. Autoridades y navegación

| Producto | Entrada actual / planeada | Autoridad y límite |
|---|---|---|
| Commerce | `/tienda-online`, `/pedidos-online`, `/tienda/:slug`, dominios | Vitrina, checkout, pedido, conversión y postventa sobre Core. |
| Business | `/`, catálogo, POS, compras e inventario | Producto, stock, cliente, costo y operación canónicos. |
| Finance | `/finance` | Documentos, solicitudes, políticas y control de gasto; usa obligaciones/ledger del Graph. |
| Profit | Actual `/analytics`; `/profit` planeada | Proyecciones de contribución, cobertura y alertas; no otra contabilidad. |
| Growth | Clientes/Marketing actuales; `/growth` planeada | Pipeline, seguimiento, audiencias y comunicación; no otro customer store. |
| Pay | Integrado | Orquesta/reconcilia; el proveedor acredita dinero. |
| Automate / Intelligence | Inicio e `/ia` | Señal → propuesta → aprobación → ejecución → outcome; un runtime. |
| Platform | `/platform` | Staff con MFA y scopes; no acceso automático a organizaciones. |

Cada entidad conserva su ficha canónica. CRM no vuelve a Finance; analítica no
crea un ledger. Mover navegación exige revisar permisos, deep links, búsqueda,
URL state y consumidores, no duplicar páginas.
Contratos: [Profit](docs/PROFIT.md), [Growth](docs/GROWTH.md),
[Finance](docs/FINANCE.md), [Intelligence](docs/NERQIA_INTELLIGENCE.md).

## 3. Cómo se declara el estado

| Estado | Evidencia mínima |
|---|---|
| Planeado | Contrato, owner y gate; no se vende como disponible. |
| Implementado | Ruta/consumidor real, autoridad desplegable y estados completos. |
| Verificado internamente | Unit/integración, roles/RLS y fixtures reversibles; alcance explícito. |
| Certificado externamente | Proveedor/ambiente, webhook, reconciliación y evidencia autorizada. |
| Adoptado | Merchant real completa el trabajo sin SQL; outcome observado. |

Fixtures, Playwright con red interceptada y SQL con rollback prueban contratos,
no cobran dinero, entregan correos ni acreditan adopción. Un indicador con dato
faltante queda parcial; ausente no significa cero ni resultado conciliado.

## 4. Base disponible y evidencia pendiente

| Dominio | Base implementada / comprobación interna | Próximo gate |
|---|---|---|
| Commerce | Storefront, variantes, carrito/checkout canónicos, pedidos, recuperación, SEO, temas/páginas, dominios y surtido multitienda. | Pago/fulfillment externo y conversión/performance de campo. |
| Migración | Un staging/apply transaccional; variantes, clientes, imágenes, identidad externa y redirects. | Export real Shopify + Tiendanube, reconciliación y rollback; [C22.2](docs/C222_CERTIFICAR_MIGRACION.md). |
| Business | POS/offline, Kardex, compras, clientes, ventas, devoluciones, ledger e invariantes de stock/dinero. | Segunda organización, conteo físico y primera operación sin corrección SQL. |
| Fiscal | Factura/NC/POS con renglones, IVA, reserva/CAE y correo desde documento persistido. | ARCA A/B/C y NC, impresión y recepción reales; [contrato](docs/FACTURACION.md). |
| Finance | Inbox, aprobación versionada, comprometido/disponible, reembolsos/anticipos, dimensiones, conciliación CSV y export del ledger. | Documento y cierre reales; feeds de tarjetas externas y controles; [contrato](docs/FINANCE.md). |
| Profit | `sale_margin_facts`, `sale_margin_operations`, detalle/canal, cobertura y propuestas/outcomes. | SKU/tienda, agregado reconciliado, inventario y confianza visibles; Ads después. |
| Growth | Clientes, pipeline, seguimiento, segmentos/RFM y campañas/automatizaciones existentes. | CRM cohesivo; luego inbox, builders y marketing con consentimiento. |
| Creators | Portal autenticado, identidad/canjes, contratos, chat, evidencia privada y liquidación interna. | Payout acreditado, escaneo y social OAuth; expansión pausada; [contrato](docs/INFLUENCERS.md). |
| Pay | OAuth, checkout, webhook, manual, refund, comisión y settlement idempotentes. | Certificación por proveedor/destino; cuenta cargada no garantiza rail disponible. |
| Correo | Remitentes por propósito, baja, consentimiento, ledger de entrega e idempotencia; envío de las 08:00 retirado. | Auth SMTP/webhook y entrega/rebote/queja reales; [marketing](docs/EMAIL_MARKETING.md). |
| Platform | MFA, alta, Merchant 360, integraciones, soporte, riesgo y billing MP firmado. | SLO, economía real y operación autorizada. |

### Evidencia Finance corregida

#### Contrato de paridad Mendel-class

Cubrir captura, políticas, presupuestos, gasto, conciliación y cierre, no copiar
el menú. Primero tarjetas externas; emisión exige partner y certificación.
La matriz canónica vive en [Finance](docs/FINANCE.md).

La verificación SQL de extracción del 2026-09-25 usa un documento de prueba,
metadata de Storage y un payload de proveedor preparado, dentro de rollback.
Valida transiciones y autoridad; no invoca por sí sola OCR externo ni demuestra
el primer documento comercial persistido.

Consulta agregada a la base vinculada el 2026-10-01:
documentos Finance = 0, políticas = 0, lotes contables = 0. Reproducir con
`supabase/verificaciones/20261001_finance_product_evidence.sql`.
Esto no determina si un secreto/proveedor está configurado. Sí impide declarar
adopción a partir de fixtures. El [protocolo F5.1](docs/F5_1_PRIMER_DOCUMENTO_FINANCE_REAL.md)
sigue abierto como certificación operacional.

### Calidad y release

- Base publicada del 2026-10-01: 3.412 tests en 394 archivos con `npm test`;
  24 escenarios de navegador desktop/mobile para landing, checkout entre
  pestañas, portal sintético y privacidad del service worker. No certifican
  pagos externos ni todos los roles del panel con una sesión real.
- Auditoría de seguridad del 2026-10-01: 15 contratos de funciones expuestas
  pendientes de revisar; no se silencian para mostrar cero.
- `npm run verify` unifica funciones, documentación, lint, TypeScript real,
  build, Vitest, dependencias y diff; CI usa el mismo plan por etapa.
- `npm run verify:ci` agrega E2E autenticado y falla si faltan sus credenciales.
  Suites públicas no sustituyen el flujo autenticado.
- Consulta GitHub del 2026-10-01: `main` no protegida. Falta configurar PR y
  checks requeridos; el auto-deploy de Vercel no depende hoy de CI completado.
- CI de `ad64eafa` falló en Critical E2E: desborde móvil/timeouts y escenarios
  del panel. Localmente header/seguimiento pasan; falta explicar y corregir la
  diferencia de entorno, no relajar aserciones ni omitir el panel.
- La aplicación no recarga automáticamente al desplegar; la caché PWA no
  almacena REST privado ni archivos firmados. Mantener aislamiento al logout.

## 5. Orden ejecutable

Un slice activo; un incidente desplaza el orden. P0 acompaña toda entrega.
No abrir más productos mientras Commerce carezca de prueba operacional.

### P0 — Seguridad, release y operación confiable

1. Resolver Critical E2E remoto, proteger `main`, requerir los checks CI y definir
   promoción/rollback: configuración real, no sólo YAML; sin cortar el deploy.
2. Revisar funciones expuestas pendientes, permisos RPC/RLS, cron, secretos,
   archivo/libro de migraciones y restauración reproducible.
3. Medir errores, SLO, LCP/INP/CLS y funnel sin PII innecesaria; estados parciales
   honestos, alerts accionables y soporte con correlación sanitizada.
4. Certificar pagos, correo, logística y fiscal por entorno/proveedor con
   evidencia autorizada; ningún simulacro mueve dinero o envía campañas.
5. Acompañar segundo merchant: onboarding, migración, publicación, primera venta
   y margen explicado sin intervención SQL.

### P1 — Commerce completo y Profit Foundation

1. Certificar migrador con archivos reales, variantes/clientes/imágenes,
   redirects, cantidades, opt-out y reversa. No crear otro importador.
2. Checkout → pago → fulfillment → devolución/refund: concurrencia, estados,
   recuperación, permisos y timeline hasta conciliación externa.
3. Mobile, búsqueda/merchandising, SEO, accesibilidad y Core Web Vitals de campo;
   mejoras guiadas por conversión, no nuevos temas sin evidencia.
4. Profit por orden/producto/canal: reusar hechos existentes, explicar fuentes,
   faltantes, moneda, período y reversas; conciliar detalle contra agregado.
5. Extender a SKU/tienda y capital en inventario con costo histórico, alertas
   explicables y una decisión observada por merchant. Una ruta `/profit` sólo
   aparece cuando contrato, navegación y permisos estén conectados.

### P2 — Finance operacional y Growth CRM

1. Finance: original privado → inspección/extracción real → revisión →
   política/presupuesto → efecto aprobado en Core → export/reconciliación.
   Políticas implementadas no significan políticas del negocio configuradas.
2. Finance: reembolso/anticipo con comprobante externo; feed de tarjetas externas
   y controles preventivos. Emisión permanece detrás del partner.
3. Growth: consolidar clientes, empresas, contactos, deals, tareas y pipeline
   con identidad compartida; email/teléfono no fusionan automáticamente tenants.
4. Ordenar la navegación sin clones; lanzamiento `/growth` tras migrar
   consumidores y probar deep links/roles. Profundidad CRM, no menús vacíos.

### P3 — Marketing, runtime visual y Ads

1. Inbox y consentimiento omnicanal; email/WhatsApp con auditoría, supresión,
   entregabilidad y canal configurado. Shopify-like checkout sigue en Commerce.
2. Landings/formularios/campañas reutilizan Page/Theme Engine; A/B conserva
   asignación y resultado. No builder nuevo ni atribución ficticia.
3. Runtime visual común: flujos existentes → simulación sin efectos → jobs →
   aprobación → ejecución idempotente → verificador/outcome; shadow mode primero.
4. Meta/Google/TikTok: importación read-only, gasto normalizado, identidad,
   revisión y cobertura antes de permitir cualquier mutación publicitaria.
5. Profit signal → propuesta Growth/Commerce → acción autorizada → outcome.
   Contribution ROAS y Marketing ROI tienen break-even diferentes;
   [fórmulas](docs/PROFIT.md), no confundir contribución con utilidad neta.
6. MCP comparte herramientas tipadas, scopes, auditoría y límites; sin SQL libre,
   exportación indiscriminada ni credenciales de proveedor.

### Posterior — Escala bajo demanda

Standalone Profit/Growth, Ship, Developers/apps, regiones, Consulting y Capital
exigen ICP, retención, unit economics y ownership. No se crean repositorios,
subdominios nuevos o servicios financieros sólo para completar un portfolio.

## 6. Gates externos

| Gate | Evidencia requerida | Owner |
|---|---|---|
| Legal e inventario | Identidad fiscal/domicilio publicado y conteo físico trazable. | Merchant / responsable fiscal. |
| Cobro y payouts | Aprobación/rechazo/timeout/refund, webhook y acreditación del destino. | Operación / proveedor. |
| Logística | Tarifa, etiqueta y entrega trazada con contrato vigente. | Merchant / transportista. |
| ARCA | Factura/NC autorizada y revisión de clase/IVA/documento. | Responsable fiscal. |
| Finance | Documento persistido autorizado y efecto/cierre auditados, no fixtures. | Producto / operación. |
| Correo | Recepción, Auth SMTP, baja, rebote, queja y webhook firmado. | Platform / proveedor. |
| Adopción | Segundo merchant realiza primera venta sin SQL; retención y costos medidos. | Producto / ventas. |
| Release | Branch protection + CI requerido + deploy del SHA verificado. | CTO / administrador del repo. |
| Monetización | Ingreso neto, costo, fraude, soporte y margen medidos; tarifas autorizadas. | CEO / CFO. |

## 7. Definition of Done

Autoridad y permisos server-side; tenant/input/abuso/idempotencia auditables;
loading, vacío, error recuperable, offline/stale, parcial, éxito y dirty state;
móvil/desktop/teclado; tests proporcionales; `npm run verify` verde; E2E del flujo
y roles afectados (autenticado donde corresponda); SQL reversible sin residuos
si toca DB; docs/index alineados; commit + push y SHA `Ready` verificado.

Una ausencia de credenciales o contrato externo se reporta como gate pendiente,
no prueba aprobada. Ningún test altera el negocio real sin autorización.

## 8. Métricas y documentos

North Star: **Active Transacting Merchants**, organizaciones con venta POS u
orden online confirmada durante los últimos 30 días, sin contar fixtures.

| Capa | Indicadores |
|---|---|
| Commerce | Activación, primera orden paga, conversión, abandono, fulfillment, refund, LCP/INP/CLS. |
| Profit | Cobertura de ingresos/costos, margen explicable, decisiones y resultado observado. |
| Growth | Pipeline válido, opt-in, entregabilidad, retención y contribución atribuible. |
| Finance | Tiempo de documento/aprobación/cierre, excepciones y match conciliado. |
| Automate | Acción útil, precisión, override, abstención, reversión y costo. |
| Negocio / Platform | ATM, ingreso neto, retención, soporte, MTTR y concentración. |
| Seguridad | Replay/abuso bloqueados, incidentes, exposición pendiente y recuperación. |

[Índice](docs/INDICE.md) · [Estrategia](docs/ESTRATEGIA.md) ·
[Arquitectura](docs/ARQUITECTURA.md) · [Diseño](DESIGNROADMAP.md).
Toda decisión de autoridad necesita ADR; las evidencias históricas se consultan
en Git, no se duplican como una segunda cola en el roadmap.
