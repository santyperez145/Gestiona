# Gestiona Cloud — Visión y roadmap ejecutivo

**Corte:** 2026-08-22
**Estado:** documento rector de producto, ejecución y evidencia. Reemplaza la
versión anterior del roadmap. No promete fechas ni transforma hipótesis en
hechos.

## 0. Resumen ejecutivo

Gestiona construye la infraestructura operativa y comercial para PyMEs
latinoamericanas. Unifica operación, Commerce, Finance, pagos e inteligencia
sobre una única fuente de verdad: el mismo producto, stock, cliente, proveedor,
orden, costo, cobro y margen en todos los canales.

La propuesta no es «otro ERP», «otra tienda online» ni «una plataforma con IA».
Es esta:

> Gestiona permite crear, operar, vender, cobrar, controlar y hacer crecer un
> negocio desde un solo Business Graph, y demuestra qué decisión mejora su
> rentabilidad.

La visión es grande; la ejecución se ordena por evidencia:

~~~text
verdad operacional
  → activación repetible
  → margen utilizado para decidir
  → Finance procesando documentos reales
  → migración de un comercio externo
  → monetización transaccional con unit economics
  → ecosistema y expansión regional
~~~

### North Star

**Active Transacting Merchants (ATM):** organizaciones distintas con al menos
una venta POS u orden online confirmada en los últimos 30 días. Cuando se sumen
canales, la definición se ampliará mediante eventos de dominio versionados.

No son North Star:

- registros creados;
- cantidad de módulos;
- tablas o Edge Functions;
- tests sin uso real;
- GMV no conciliado;
- recomendaciones de IA sin acción ni resultado.

### Etapa actual

Gestiona tiene una arquitectura avanzada para su tracción, pero todavía está en
la etapa de **demostrar verdad operacional y repetibilidad comercial**. El riesgo
principal ya no es «si se puede construir»; es si un comercio externo puede
activarse, operar, recuperarse de fallas y obtener valor sin intervención
técnica cotidiana.

### Tesis para inversión

El valor potencial se sostiene en cuatro activos que deben probarse en orden:

1. **Business Graph unificado:** operación y canales comparten entidades y
   contratos.
2. **Margin Intelligence:** landed cost, impuestos, comisión, envío y promoción
   explican contribución por SKU, orden y canal.
3. **Finance nativo:** un documento se convierte en compra, obligación, costo y
   cash-flow sin cinco integraciones intermedias.
4. **Action Loop:** un diagnóstico lleva a simular, aprobar, ejecutar y medir
   resultado.

La tesis sólo se vuelve defendible cuando la evidencia forma esta cadena:

~~~text
primer comercio confiable
→ segundo comercio sin cambios manuales de base
→ decisión de margen aplicada y medida
→ documentos Finance procesados de punta a punta
→ tienda externa migrada
→ ingresos con margen de contribución positivo
→ retención repetible
~~~

## 1. Portfolio de productos

Gestiona Cloud es una plataforma con productos conectados, no seis aplicaciones
que duplican datos.

~~~text
Gestiona Cloud
├── Gestiona Business
│   Operación, ERP, POS, CRM, compras e inventario
├── Gestiona Commerce
│   Storefront, checkout, canales, migraciones y B2B
├── Gestiona Finance
│   Documentos, gastos, payables, aprobaciones y conciliación
├── Gestiona Platform
│   Control Plane, soporte, riesgo, billing y operaciones
├── Gestiona Intelligence
│   Hallazgos, agentes, acciones y resultados
└── Gestiona Pay / Ship / Developers
    Monetización transaccional, logística y ecosistema
~~~

| Producto | Trabajo que resuelve | Evidencia antes de escalar | Monetización objetivo |
|---|---|---|---|
| **Business** | Mantener la verdad de productos, stock, ventas, compras, clientes y margen. | Dos comercios operan sin correcciones manuales. | Base de adopción; pricing definitivo por validar. |
| **Commerce** | Convertir catálogo y operación en ventas por tienda y canales. | Una tienda externa migra y vende sin perder continuidad. | Pagos, envíos, dominios y servicios de crecimiento. |
| **Finance** | Convertir documentos y gastos en obligaciones y controles auditables. | Facturas reales terminan en borradores correctos y aprobados. | Uso documental, conectores y workflows avanzados. |
| **Platform** | Operar merchants, integraciones, soporte, riesgo e incidentes. | Menos intervención y menor tiempo de resolución por comercio. | Habilita escala y margen de toda la compañía. |
| **Intelligence** | Detectar oportunidades y ejecutar acciones dentro de políticas. | AI Action Rate e impacto verificado, no contenido generado. | Incluido, por uso o premium según economics. |
| **Pay / Ship** | Orquestar cobros y logística con recuperación y conciliación. | Margen neto y cumplimiento regulatorio demostrados. | Margen transaccional sin custodia no autorizada. |
| **Developers / Apps** | Permitir que terceros amplíen la plataforma con límites. | Una app sirve a más de un merchant sin acceso a tablas. | Revenue share, partners y servicios. |

### Superficies

La topología actual se conserva:

| Superficie | Ruta actual | Usuario | Límite |
|---|---|---|---|
| Organización | / | Miembros del comercio | AppLayout; no hereda permisos de Platform. |
| Finance | /finance | Miembros con producto + `finance.view` | FinanceLayout; misma identidad/organización, sin heredar onboarding de Business. |
| Plataforma | /platform | Staff de Gestiona | PlatformLayout, MFA y auditoría. |
| Tienda pública | /tienda/:slug | Comprador | StoreLayout y superficie pública mínima. |

La evolución prevista puede separar Business, Finance, Platform, Storefront,
Auth, Developers y Status en aplicaciones o subdominios. Eso es una
**arquitectura objetivo**, no autorización para fragmentar hoy.

Si se separan subdominios:

- se mantiene un solo auth.users, profiles, organizations y memberships;
- no se comparten tokens mediante localStorage global;
- Auth usa PKCE o códigos de un solo uso y cada app obtiene su propia sesión;
- la separación inicial es por dominio, permisos, paquete y aplicación;
- otra base o proyecto sólo se justifica por regulación, carga, residencia,
  aislamiento o equipos realmente independientes.

## 2. Ventaja competitiva que se debe demostrar

El documento de referencia aporta comparaciones útiles con plataformas de
Commerce, ERP, marketplaces y gestión de gastos. Este roadmap no replica
afirmaciones volátiles sobre terceros: define el estándar propio. Las
comparativas fechadas y con fuente oficial viven en docs/ESTRATEGIA.md.

| Campo competitivo | Paridad mínima | Diferencial Gestiona que debe probarse |
|---|---|---|
| ERP / operación | Productos, inventario, compras, POS, clientes y reportes confiables. | Menor implementación y verdad conectada a Commerce y Finance. |
| Commerce | Checkout, dominio, SEO, temas, migración, rendimiento y extensibilidad. | Costo y margen del mismo Core que ejecuta la venta. |
| Margen y rentabilidad | Shopify ya reporta profit por producto/orden/mercado y Odoo margen por línea/pedido; tener un reporte es paridad, no ventaja. | Cuatro fuentes persistidas —costo histórico, cobro, envío real e IVA— por venta/canal/operación, con mix, promoción y devoluciones. El POS ahora convierte cada parte del cobro en evidencia conciliable y bloquea el ticket mientras falte el arancel; la autoridad existe, pero su impacto todavía debe probarse con una decisión real. |
| Marketplace | Sincronización de catálogo, stock, órdenes y postventa. | Sistema neutral que decide canal por margen, capital y disponibilidad. |
| Spend / Finance | Odoo y QuickBooks ya reciben PDF/imagen/email, extraen, muestran revisión y buscan coincidencias; QuickBooks además separa carga, aprobación y pago. | Finance comparte proveedor, producto, compra, stock y ledger nativos. La primera superficie ya separa entitlement de permisos y no llama “Finance” al OCR precursor; falta demostrar la cadena documento → borradores aprobados. |
| IA | Asistencia dentro del flujo real. | Recomendación → aprobación → acción → resultado verificado. |
| Plataforma | Health, replay, incidentes, soporte y billing. | Evidencia por merchant sin exponer secretos ni datos crudos. |
| Monetización | Precio y costo total de cobro transparentes. | Merchant economics y platform economics separados; contribución y break-even auditables antes de activar pricing. |
| Ecosistema | API, OAuth, scopes, webhooks y sandbox. | Extensiones sobre contratos estables del Business Graph. |
| Confiabilidad | Pruebas automáticas de los recorridos que venden y operan. | Tienda desktop/móvil y panel autenticado bloquean CI; restore y trazas prueban recuperación, no sólo compilación. |
| Activación | Wizard, checklist, ayuda para publicar/cobrar y cohortes básicas. | Ocho hitos calculados por el Business Core separan formulario de resultado; la primera venta del canal elegido define activación. Cohortes mensuales usan ventanas maduras 7/14/30, distinguen autoservicio de acompañamiento y miden minutos sin PII. El diferencial no es el dashboard: es poder conectar costo de onboarding con el mismo Core que prueba la venta. |
| Migración de catálogo | Excel/CSV, mapeo de columnas y altas masivas. | Un lote se prepara sin mutar datos, resuelve altas/actualizaciones/conflictos en servidor, exige aprobación y reconcilia cada fila con stock asentado sólo por Kardex. La importación es paridad; la reversibilidad, autoridad e idempotencia son confianza operativa. |
| Configuración por rubro | Presets, campos personalizados y plantillas de catálogo. | Siete perfiles declarativos preparan tipos/atributos sin crear verticales, preservan lo propio y se aplican por RPC idempotente sobre el mismo Core. La plantilla es paridad; cambiar la forma del catálogo sin bifurcar stock, costo, orden, cliente ni margen es la tesis diferencial que aún debe probar un merchant externo. |
| Soporte remoto | Panel de cuenta, auditoría e impersonación/diagnóstico. | Se retiró la impersonación: Support solicita un snapshot agregado, owner autoriza 15/30/60 minutos, cada lectura revalida expiración/revocación y queda contada. La herramienta es paridad; consentimiento, minimización y no heredar una sesión son confianza operativa a validar con menor tiempo de soporte. |
| Alta de comercios | Cuenta, trial, invitación y panel de activación. | Platform aprovisiona org + owner + plan + settings + auditoría en una transacción idempotente, bloquea identidades ya vinculadas y envía el acceso sin mostrar el token. El alta es paridad; no corromper otro tenant ni duplicar al reintentar es confiabilidad a demostrar en el segundo merchant. |

No son diferenciales suficientes por sí solos:

- tener tienda, POS, pagos, envíos, chat o reportes;
- sumar módulos genéricos;
- generar descripciones con IA;
- mostrar un dashboard sin acción;
- afirmar amplitud sin merchants activos.

## 3. Línea de base verificable

Corte medido el **2026-08-22**. Todo número debe volver a medirse antes de
usarse en una presentación, valuación o decisión de inversión.

| Señal | Evidencia actual |
|---|---|
| Calidad técnica | 1.393 tests pasan al 2026-08-22; typecheck, lint y build verdes; 63 Edge Functions verificadas; 41 E2E críticos (32 públicos, 8 de panel y setup autenticado) pasan contra la base real. |
| Tracción | 4 organizaciones, 1 comercio real, 34 registros POS y 6 online. Es una muestra, no product-market fit. |
| Pagos | 2 pagos reales de prueba por ARS 1; matriz interna de 8 escenarios aprobada el 2026-08-21 y 0 suscripciones efectivamente cobradas. La comisión histórica fue 5% en esas pruebas; la propuesta actual de 0,5% quedó en borrador y cobra $0 hasta aprobación. Falta certificación live para probar proveedor/economics. |
| Fiscal | 1 CAE de homologación; 0 CAE de producción. |
| Ledger | 10 eventos de ledger de dominio; 0 asientos contables operativos reales. |
| Margen canónico | `20260822000004/5/6` conserva 34/34 líneas y reconstruye 34 operaciones / ARS 1.143.696 sin diferencia. Exige costo + cobro + envío real + IVA, registra fuente, mix y bloqueos. La próxima venta POS crea partes de cobro atómicas: efectivo/transferencia prueban cero; tarjeta espera liquidación real y luego calcula neto + asiento + auditoría. Además persiste ingreso posterior a descuento y precio de referencia. Base histórica: 0 completas, 0% explicable, 2,9% cobertura, 0 liquidaciones POS y 0/34 baselines; no se inventó backfill. |
| Action Loop de precio | `20260822000007` convierte recomendación en propuesta aprobable, baseline canónica, aplicación, medición y reversión con guard de concurrencia. Fixture: ARS 3.000 → ARS 2.700, 100% de cobertura antes/después, cambio manual a ARS 2.600 protegido, auditoría/RLS/restos 0. Producción: 25 descartadas, 0 aplicadas, 0 outcomes; todavía no prueba impacto comercial. |
| Plataforma | Overview, Integration Registry, Merchant 360, evidencia de integración, cola operativa, reintentos auditados y control de Checkout Brick. |
| Activación | Primera venta y tiempo a vender medidos por comercio, deduplicando organizaciones multi-tienda. La migración `20260821000059` suma objetivo POS/online y ocho hitos server-side compartidos con Merchant 360. `20260821000061` agrega cohortes por mes y ventanas maduras: 4 organizaciones, 1 activada en su canal objetivo, 3 pendientes, conversión histórica 25%; a 7/14 días 0/4 y a 30 días 0/1. Son datos técnicos, no PMF. Soporte autoservicio/minutos tiene watermark desde 2026-08-22: 0 altas elegibles y 0 minutos, por lo que la UI dice “sin base” en vez de atribuir falsos ceros. |
| Importación de catálogo | La migración `20260821000060` reemplaza dos importadores client-side por un lote server-side Excel/CSV de hasta 5.000 filas: staging, preview, create/update/conflict, aprobación, aplicación atómica, retry idempotente y reconciliación. Verificación con rol `authenticated`: 1 válida + 1 inválida, bloqueo previo, 1 producto, stock 3, 1 movimiento, retry sin duplicación, anon/escritura directa sin permisos y 0 restos (2026-08-21). |
| Business Profiler | La migración `20260822000001` declara 7 perfiles, 8 tipos y 28 atributos sobre `product_types`; onboarding y reconfiguración pasan por RPC owner/admin, son atómicos e idempotentes y preservan colisiones `custom`. Verificación real: 1 tipo/4 atributos, retry 0/0, outsider bloqueado y 0 restos. Línea de base tras rollback: 0 organizaciones configuradas y 0 tipos, por lo que todavía no es adopción. |
| Soporte consentido | `20260822000002` reemplaza magic links de impersonación por solicitud Support → aprobación owner → snapshot sanitizado con expiración por lectura. Retry de solicitud conserva 1 ID; retry de aprobación no extiende la ventana; outsider bloqueado; 2 vistas auditadas; revocación efectiva y 0 restos. Línea de base: 0 solicitudes reales/0 diagnósticos consumidos. |
| Alta de comercios | `20260822000003` reemplaza escrituras parciales por un RPC superadmin: identidad técnica sin workspace prematuro; 1 org/owner/trial/settings/auditoría; retry conserva `org_id`; key con datos distintos, owner existente y outsider bloqueados; organización previa idéntica y 0 restos. El acceso se envía por email sin exponer enlace. Base real: 4 organizaciones; el segundo merchant aún no existe. |
| Finance surface | `20260822000008` agrega `/finance`, `FinanceLayout`, entitlement separado de `finance.view`, solicitud tenant, decisión Platform auditada y snapshot agregado de proveedores/órdenes/obligaciones/ledger existentes. Fixture real: owner solicita pero no autoaprueba; staff finance habilita/deshabilita; permiso, outsider y anon bloqueados; 3 eventos append-only y restos 0. Base: Business habilitado 4/4; Finance disponible 4/4, 0 solicitudes y 0 habilitaciones. |
| Finance precursor | El OCR anterior prellena una orden de compra y producción mostró un esquema distinto al archivo histórico (`extracted`, sin `document_type`). Sigue fuera del producto Finance: no cumple cadena de custodia, validación, matching, duplicados, aprobación ni payable draft. |
| Storefront | Funcional, pero aún comparte aplicación/ciclo de despliegue con el panel; falta aislamiento, dominios y carrito persistente completo. |
| Recuperación | Backups programados y restore drill de datos aprobado el 2026-08-21: snapshot v3, 147 tablas / 63 filas, 937,22 ms y cero restos. Falta reconstrucción completa para RTO/RPO contractual. |
| Observabilidad | Pagos ya conserva una correlación de checkout a ledger y ofrece timeline sin PII; faltan métricas/SLO, health checks activos y extender el contrato a los demás flujos críticos. |
| Activación comercial | La cohorte ya está instrumentada, pero no existe muestra externa suficiente: 4 organizaciones históricas, 1 activada y 0 altas posteriores al watermark de soporte. Conversión, autoservicio y costo no son todavía estimaciones defendibles. |

### Construido no significa validado

| Capacidad | Existe en código | Falta para llamarla producto probado |
|---|---|---|
| ARCA | Arquitectura, credenciales seguras y homologación. | Certificado/punto de venta productivos y factura real autorizada. |
| Ledger | Modelo de partida doble y eventos. | Asientos producidos y reconciliados por operaciones reales. |
| Payment orchestration | Estados, idempotencia, refund y fallback; matriz interna aprobada con cero restos. | Certificación real de proveedor, firma, timeout de red, rechazo y refund. |
| POS offline | Implementación disponible. | Prueba sostenida con varios comercios, reconexión y conflictos. |
| Multi-organización | RLS y permisos avanzados. | Comercios externos y soporte repetible. |
| Importación CSV/Excel | Lote auditable y reconciliado contra el Business Core. | Usarlo con un segundo comercio y medir tiempo, correcciones y abandono; todavía no prueba una migración completa de tienda, clientes, imágenes u órdenes. |
| Intelligence | Varias funciones y recomendadores. | Acciones adoptadas con impacto económico atribuible. |
| Control Plane | Superficie operativa profesional en construcción. | Menor MTTR y menor intervención manual medidos. |
| Finance OCR | Extracción/prellenado parcial. | Documento auditable que termina en compra/deuda correcta. |
| Finance product surface | Ruta, chrome, sesión compartida, entitlement, permiso y snapshot del Core. | Primer comercio habilitado y primer documento procesado; 0 adopción real al corte. |
| Sistema visual v3 Figma | El workspace claro adopta obligatoriamente la dirección de los kits CRM/marketplace compartidos: canvas casi blanco, superficies blancas, primary violeta `252 83% 62%`, secundarios turquesa/coral, rail persistente, topbar y profundidad baja; se aplica a Business y Platform sin alterar el Business Core. | Captura autenticada desktop/mobile de todas las superficies, revisión de Storefront y medición de tiempo a tarea antes de declarar la renovación visual validada. |
| Rediseño público v3 | Landing pública y Auth fueron reconstruidos el 2026-08-22 con propuesta omnicanal, preview del producto, registro directo desde CTA, responsive desktop/mobile y metadatos SEO alineados. | Validar conversión del CTA y continuar la auditoría visual de Storefront y rutas públicas de compra. |
| CRM workspace v1 | Clientes / CRM incorpora tabs persistidos `Clientes`/`Insights`, rail de segmentos, toolbar de filtros y ficha contextual 360 siguiendo la referencia CRM compartida; mantiene acciones y datos existentes. | Captura autenticada desktop/mobile, validación con un comercio real y medición de tiempo para encontrar/actuar sobre un cliente. |
| Admin/marketplace workspace v1 | `WorkspaceViewTabs` extiende el contrato Figma a Productos y Ventas: Catálogo/Operación y Ventas/Rendimiento, con contadores, meta contextual, responsive móvil y persistencia por organización; Dashboard, Settings, Admin, Integraciones, Reportes y Tienda quedan bajo el mismo contrato de tokens. | Captura autenticada de las superficies operativas y medición de tiempo a tarea antes de declarar la renovación visual validada. |

### Bloqueos externos vigentes

| Bloqueo | Qué habilita | Responsable |
|---|---|---|
| Certificado productivo ARCA y punto de venta Web Services | Primera factura real. | Dueño / responsable fiscal. |
| Razón social, CUIT, domicilio y publicación legal | Tienda presentable y proceso de venta regular. | Dueño del comercio. |
| Conteo físico y ajuste trazable | Stock confiable después del antiguo doble movimiento. | Comercio. |
| Pesos, fotos, descripciones y tarifario | Cotización y conversión representativas. | Comercio, con carga asistida. |
| Contrato/credenciales de transportista | Etiqueta y tracking probados contra operación real. | Comercio / correo. |
| Medio de pago de prueba y ventana controlada | Certificación live de aprobación, rechazo, webhook, timeout y refund. | Dueño / operación. |
| Cuenta comercial MercadoLibre | Publicación e importación reales. | Comercio. |
| Segundo comercio | Validación externa del onboarding y soporte. | Comercial / founder-led sales. |

Ninguno se cierra con una simulación. Requiere responsable, fecha, evidencia y
entorno.

## 4. Contratos de arquitectura

### Un Business Graph

Cada entidad tiene un dueño. Otros dominios consumen contratos y eventos; no
crean una copia «temporal» que se vuelve la verdad.

| Dominio | Es dueño de |
|---|---|
| Identity | Usuarios, organizaciones, membresías, roles y sesiones. |
| Party | Personas, empresas, clientes, proveedores e identidades fiscales. |
| Catalog | Productos, variantes, atributos y unidades. |
| Inventory | Movimientos, balances, reservas, ubicaciones y conteos. |
| Purchasing | Órdenes de compra y recepciones. |
| Sales | Ventas, presupuestos y condiciones comerciales. |
| Commerce | Stores, carritos, órdenes online y fulfillment. |
| Finance | Documentos, gastos, payables, aprobaciones y conciliaciones. |
| Payments | Intenciones, intentos, refunds y liquidaciones. |
| Ledger | Cuentas, asientos y partidas. |
| Platform | Merchants, health, flags, incidentes y operaciones. |
| Intelligence | Hallazgos, recomendaciones, ejecuciones y resultados. |

### Invariantes

1. El cliente no escribe stock, precios, totales, descuentos ni secretos.
2. Inventory se mueve mediante la autoridad de base y sus triggers.
3. PaymentStatus, OrderStatus, FulfillmentStatus y ReturnStatus no se reducen a
   un único estado ambiguo.
4. Una vista nueva convive con la anterior hasta completar migración segura.
5. Un fallback sólo cubre relación/función inexistente; no esconde permisos,
   timeouts ni corrupción.
6. Finance reutiliza users, organizations, suppliers, products, purchases,
   ledger y domain_events.
7. Finance no crea finance_users, finance_organizations, finance_suppliers,
   finance_products ni un ledger paralelo.
8. Documento extraído crea un borrador; una recepción real mueve stock.
9. Un LLM nunca escribe dinero, stock o precios directamente.
10. Toda acción sensible conserva actor, política, aprobación, ejecución,
    resultado y reversión.
11. Staff de Platform no obtiene permisos implícitos dentro de una organización.
12. Pay no custodia ni presta fondos sin estructura legal, capital, riesgo y
    responsables autorizados.

### Evolución del repositorio

No se hará una reescritura. La extracción será incremental:

1. mantener la aplicación actual funcionando;
2. extraer contratos y paquetes compartidos sin cambiar comportamiento;
3. separar Storefront para reducir ciclo y radio de fallos;
4. crear Finance como superficie nueva sobre el mismo Core;
5. separar Platform cuando la operación lo justifique;
6. introducir Auth central sólo cuando haya más de una app física;
7. evaluar servicios independientes después de volumen o regulación.

Mientras CI y despliegue usen npm, npm workspaces es la opción inicial. Cambiar
package manager, orquestador o arquitectura de servicios requiere una mejora
medida, no preferencia técnica.

## 5. Escalera de evidencia para producto e inversión

| Gate | Pregunta que responde | Evidencia mínima | Fases |
|---|---|---|---|
| **A — Verdad** | ¿La operación funciona y se recupera? | Venta → pago → stock → factura → ledger → margen → devolución, con fallas probadas. | F0 |
| **B — Repetibilidad** | ¿Otro comercio puede activarse? | Segundo y tercer merchant venden sin SQL ni cambios especiales. | F1 |
| **C — Ventaja** | ¿Gestiona cambia una decisión y crea valor? | Margen por canal usado, acción aplicada y resultado medido. | F2 |
| **D — Expansión** | ¿El mismo Core sostiene otro producto y una migración? | Finance real y tienda externa migrada. | F3–F6 |
| **E — Red** | ¿Los flujos generan economics y terceros amplían valor? | Pay/Ship con margen, app externa y retención suficiente. | F7–F9 |

No se financia una fase posterior con atención operativa que todavía necesita
la anterior.

## 6. Roadmap por fases

### F0 — Verdad operacional

**Objetivo:** demostrar que la operación actual funciona de punta a punta,
incluidos estados ambiguos y recuperación.

**Estado:** en curso.

**Entregables**

- ARCA productivo.
- Identidad legal publicada.
- Conteo físico, ajuste trazable y reconciliación stock/Kardex.
- Matriz interna de checkout, pago, webhook, timeout, refund y duplicado
  aprobada; falta certificar la misma secuencia con proveedor real.
- Entorno de validación reproducible, separado de datos reales y comparable en
  los contratos críticos; no se denomina staging hasta probar esa equivalencia.
- Restore drill de datos reproducible cerrado; falta reconstrucción completa de
  proyecto para declarar RTO/RPO contractual.
- Correlation ID desde checkout hasta proveedor, webhook, orden y ledger.
- Trazas básicas y runbooks para pagos, ARCA, cron e integraciones críticas.
- E2E críticos como puerta bloqueante de CI: 32 recorridos públicos y 8 de
  panel, más setup autenticado obligatorio, todos de sólo lectura.
- Revisión legal/económica de comisión, billing y tratamiento de datos.
- Procedimiento único de migración, verificación y rollback.

**Salida**

~~~text
venta
→ pago
→ stock
→ factura
→ ledger
→ margen
→ devolución
~~~

La cadena funciona, sus diferencias se reconcilian y cada falla ensayada tiene
recuperación documentada.

**Métricas:** checkout success, payment approval, webhook recovery, refund
success, diferencias de stock, restores exitosos, MTTR e incidentes por
merchant.

### F1 — Activación repetible

**Objetivo:** incorporar comercios que no participaron en el desarrollo.

**Estado:** en curso; primera venta/tiempo a vender, la ruta universal de ocho
hitos, Business Profiler, importación reconciliada y cohortes con costo de
acompañamiento ya están instrumentados. Falta la prueba externa con segundo y
tercer comercio.

**Entregables**

- ~~Onboarding universal basado en hitos, no un formulario terminado.~~
  **Entregado 2026-08-21:** el comercio elige POS u online; explorar no cuenta
  como activación. Los hitos distinguen requisitos comunes y los específicos
  del canal sin duplicar productos, stock ni clientes.
- ~~Business Profiler que configura capacidades mediante atributos/product
  types, sin forks por rubro.~~ **Entregado 2026-08-22:** siete presets
  declarativos crean ocho tipos y 28 atributos por RPC owner/admin; el retry es
  idempotente, las colisiones propias se preservan y cambiar de rubro no borra
  tipos ni productos. Onboarding guarda perfil, organización y ajustes en una
  sola transacción. La base sigue en 0 organizaciones configuradas: falta uso
  externo, no más infraestructura vertical.
- ~~Importador CSV/Excel con staging, preview, validación y reconciliación.~~
  **Entregado 2026-08-21:** un solo flujo acepta `.xlsx`, `.xls` y `.csv`,
  normaliza formatos numéricos locales, conserva celdas vacías, detecta
  conflictos en servidor y no toca el catálogo hasta aprobar. La aplicación
  crea en stock cero, mueve diferencias sólo por `record_stock_movement`,
  reconcilia el lote completo y hace idempotente el retry. El wizard CSV
  duplicado y las escrituras client-side de `products.stock` fueron retirados.
- ~~Checklist: identidad, catálogo, stock, canal, cobro, envío, fiscal y venta.~~
  **Entregado 2026-08-21:** se calcula en la base; logo, canjes, clientes y
  equipo dejaron de inflar el avance hacia la primera venta.
- ~~Merchant 360 orientado a activación y soporte, sin acceso directo a tablas.~~
  **Entregado para activación 2026-08-21:** comparte la misma vista agregada,
  muestra los ocho hitos y asigna el próximo bloqueo al comercio, a Gestiona o
  a ambos. Integraciones/incidentes siguen evolucionando en Platform.
- ~~Alta desde Platform atómica, idempotente y sin sesión del owner.~~
  **Entregado 2026-08-22:** org, membresía, trial, ajustes, idempotencia y
  auditoría nacen juntos; un email ya vinculado se rechaza sin modificar el
  tenant previo. El acceso viaja directo por email y el resultado abre Merchant
  360 para continuar los hitos.
- Integration health activo y evidencia fresca.
- ~~Soporte temporal, auditable y con permisos mínimos.~~ **Entregado como
  diagnóstico consentido 2026-08-22:** se retiró `Ver como`; Support solicita
  un motivo cerrado, owner aprueba 15/30/60 minutos y cada lectura revalida
  actor, rol, vencimiento y revocación. El snapshot agrega activación, catálogo,
  Kardex, cola e integraciones sin clientes, órdenes, montos, errores crudos ni
  secretos. El contador de lecturas queda visible en ambas superficies.
- Segundo y tercer comercio acompañados.
- ~~Cohortes de activación y registro de intervención manual.~~ **Entregado
  2026-08-22:** agrupa por mes de alta, usa la venta del canal objetivo, madura
  denominadores 7/14/30 y prioriza pendientes en Platform. Merchant 360
  registra hito, tipo, minutos y resultado por RPC idempotente; anular conserva
  auditoría. No hay notas libres, PII ni escrituras directas. Un watermark
  impide llamar autoservicio a la historia que no se medía.

**Salida:** un comercio externo configura o importa datos y realiza su primera
venta sin SQL, cambios manuales de base ni una rama especial de código.

**Métricas:** registro → onboarding, primer producto, primera venta, primera
orden online, intervenciones manuales, incidentes y tiempo de soporte.

### F2 — Margin Intelligence

**Objetivo:** probar el diferencial central de Gestiona.

**Entregables**

- Landed cost por compra, recepción y lote.
- Contribution margin por orden.
- Margen por SKU, canal, pago, envío y promoción.
- Calidad/confianza de cada componente del margen.
- Simulador de precio, canal y promoción.
- Alertas por variación de costo.
- Price Change Proposals con aprobación y reversión.
- Dashboard accionable que conecta hallazgo, decisión y resultado.
- Primer impact_event verificable.

**Entregado 2026-08-22:** `sale_margin_facts` unifica todas las ventas y
declara importe, fuente, faltantes y cobertura para los cuatro componentes. El
margen final queda `NULL` si falta evidencia. Analytics dejó de cruzar tablas
en el navegador y Merchant 360 recibe sólo cobertura agregada y sanitizada.
Shopify/Odoo se verificaron como paridad de reportes; la tesis diferencial queda
en procedencia omnicanal + Action Loop, no en tener un dashboard.

**Entregado 2026-08-22, explicación de operación:** cada ticket/orden agrega
líneas y cuatro costos sin perder centavos, muestra pagos simples/divididos,
separa descuento ya incluido en ingreso de costo y declara evidencia promocional
parcial cuando falta la base histórica. Una devolución impide publicar margen
final hasta reconciliar el neto.

**Entregado 2026-08-22, cobro POS conciliable:** `create_sales_transaction_v3`
confirma venta + partes de pago en un commit. Cero de efectivo/transferencia es
evidencia; tarjeta queda pendiente y bloquea todo el componente, incluso en un
split. Finanzas puede cargar arancel + IVA reales con `payments.edit`; el
servidor calcula neto, audita y asienta. El total posterior a cupón/descuento
global y la referencia anterior al override también quedan persistidos. Fixture
real: bruto 2.700, split 1.200/1.500, arancel 100 + IVA 21, asiento 1.500/1.500,
100% de cobertura, outsider 0 y restos 0. La evidencia comercial sigue
pendiente porque la producción histórica no tiene ventas v3.

**Entregado 2026-08-22, propuesta → acción → resultado:** aplicar una oferta
congela precio, costo y ventana comparativa; el servidor revalida piso de margen,
audita y crea el evento. La medición lee hechos canónicos y sólo publica delta de
contribución con 100% de cobertura en ambos períodos. Revertir restaura el estado
anterior si nadie cambió el precio después. Todo antes/después se marca
`observed_not_causal`. Fixture real: 3.000 → 2.700, cobertura 100%, conflicto a
2.600 bloqueado, reversión exacta, outsider y restos 0. En el mismo ejercicio se
detectó y corrigió que una venta POS sin override podía fallar por el nuevo campo
`NOT NULL`. Falta aplicar una decisión comercial real.

**Salida:** un merchant cambia precio, canal, compra o promoción basándose en
Gestiona y el resultado posterior queda medido contra una línea de base.

**Métricas:** cobertura de margen explicable, decisiones aplicadas, margen
protegido/creado verificable y tiempo entre hallazgo y acción.

### F3 — Gestiona Finance MVP

**Objetivo:** lanzar la segunda superficie sin duplicar el Core.

**Entregables**

- ~~ADR de acceso por producto, roles, segregación y sesión.~~ **Entregado
  2026-08-22:** entitlement comercial, `finance.view` y feature flags quedan
  separados; misma sesión/organización con MFA y chrome propio; staff de Platform
  sin membresía no ingresa al tenant.
- ~~Finance app/surface sobre identidad y organización compartidas.~~ **Entregado
  2026-08-22:** `/finance` tiene resumen y contrato de Document Inbox; consume un
  RPC agregado sobre proveedores, órdenes, obligaciones y ledger del Business
  Core, sin tablas paralelas ni joins del navegador.
- ~~Document Inbox con storage privado, original inmutable y versiones.~~
  **Gate técnico cerrado 2026-08-22:** bucket privado, intención de carga
  server-side, paths por tenant, versiones y eventos append-only; la bandeja
  `/finance/documentos` abre sólo URLs firmadas de corta duración.
- MIME, tamaño, malware/cuarentena y hash SHA-256. **Storage cerrado; falta
  inspector server-side:** el hash hoy queda `declared` hasta ser recalculado y
  no se marca un documento como listo antes de esa inspección.
- Extracción estructurada mediante proveedor intercambiable.
- Confianza por campo, validación matemática, fiscal y de esquema.
- Detección de duplicados.
- Matching determinístico de proveedor y producto.
- Supplier product aliases aprendidos mediante confirmación.
- Purchase Draft, Supplier Invoice Draft y Payable Draft.
- Revisión/aprobación humana y audit log.
- AI Gateway mínimo para costo, versión, trazas y apagado.

**No incluye:** pagos autónomos, contabilidad completa, conciliación masiva ni
actualización automática de precios.

**Entregado 2026-08-22, límite de producto:** el owner/admin puede solicitar
Finance, pero no autoaprobarlo; sólo staff `finance`/`superadmin` decide desde
Merchant 360 y cada transición queda tanto en eventos append-only como en la
auditoría de plataforma. La base real tiene 4 Business habilitados y 4 Finance
disponibles, con 0 solicitudes/habilitaciones: existe el producto técnico, no su
adopción. Odoo/QuickBooks confirman que OCR, review y matching son paridad; el
siguiente gate es cadena de custodia y borradores conectados al Core.

**Salida:** un conjunto de facturas reales completa ingreso → extracción →
validación → matching → aprobación → compra/deuda sin SQL, duplicación ni
movimiento prematuro de stock.

**Métricas:** field accuracy, documentos sin corrección, tiempo a borrador,
duplicados bloqueados, match rate y excepciones.

### F4 — Commerce para migrar

**Objetivo:** permitir que un negocio abandone otra plataforma sin perder
operación básica.

**Entregables**

- Store como entidad separada de organization.
- Storefront físicamente separado del panel.
- Carrito persistente server-side y recuperación multidispositivo.
- Modelo canónico de cart/order y estados independientes.
- Domains Service: verificación, SSL, canonical, redirects y health.
- Theme draft/preview/publish/rollback.
- SEO, medios y performance budgets.
- Migrador inicial con extract → staging → normalize → map → validate →
  preview → approve → import → reconcile.
- Conectores priorizados por demanda real.
- Funnel y Core Web Vitals instrumentados.

**Salida:** una tienda externa migra productos, variantes, categorías, imágenes,
clientes, SEO y órdenes acordadas, conecta dominio y vende sin cortar la
operación.

**Métricas:** tiempo a migrar, registros reconciliados, redirects correctos,
rendimiento, conversión y errores de checkout.

### F5 — Finance Automation

**Objetivo:** pasar de capturar documentos a operar Finanzas por excepción.

**Entregables**

- Three-way match: purchase order, recepción y factura.
- Expense Management y centros de costo.
- Approval Engine reusable.
- AP Calendar y aging.
- Conciliación asistida.
- Audit Agent bajo herramientas autorizadas.
- Cost Intelligence por proveedor/producto.
- Email y WhatsApp ingestion.
- Supplier Portal.
- Finance Connect para un ERP externo mediante contrato estable.

**Salida:** la mayoría definida para el piloto sólo necesita intervención en
excepciones y cada automatización puede auditarse, explicarse y revertirse.

**Métricas:** straight-through processing, exception rate, aprobación,
conciliación, AP aging, anomalías confirmadas y horas evitadas verificables.

### F6 — Commerce diferencial

**Objetivo:** superar paridad funcional con razones concretas para elegir
Gestiona.

**Entregables**

- Multi-store y multi-brand.
- B2B: empresas, compradores, catálogo, listas, crédito y aprobación.
- Markets, moneda, idioma y política de inventario cuando haya demanda.
- Theme SDK y Page Builder versionado.
- SearchProvider intercambiable.
- Personalización y recomendaciones basadas en margen.
- Store Builder asistido por IA con cambios revisables.
- Experimentación sólo con tráfico y poder estadístico.

**Salida:** merchants eligen Gestiona por una ventaja de operación/margen, no
sólo por precio, y al menos una capacidad diferencial muestra adopción.

### F7 — Pay y Ship

**Objetivo:** construir monetización transaccional con riesgo controlado.

**Entregables**

- Multi-provider real.
- Provider health y routing policies.
- Reconciliation y settlement reporting.
- Risk rules, refunds y chargebacks cuando correspondan.
- Partner de embedded payments antes de infraestructura regulada propia.
- Abstracción de envíos, cotización, etiqueta, tracking y excepciones.
- Margen logístico y de pagos por merchant/proveedor.

**Salida:** Gestiona genera margen neto verificable en pagos y/o envíos sin
custodiar fondos ni asumir riesgo fuera de una estructura permitida.

### F8 — Developer Ecosystem

**Objetivo:** permitir que terceros expandan la plataforma con seguridad.

**Entregables**

- API v1 contractual.
- OAuth, scopes y revocación.
- Webhooks firmados con retry, DLQ y replay.
- SDK, CLI, sandbox y Developer Portal.
- Theme/App Marketplace y Partner Program después de demanda real.
- Revisión, versionado, rate limits y observabilidad por aplicación.

**Salida:** una aplicación externa agrega valor a más de un merchant sin acceso
directo a tablas ni excepciones internas.

### F9 — Enterprise y regionalización

**Objetivo:** ampliar el mercado manteniendo exactitud y capacidad operativa.

**Sólo después de tracción**

- country packs fiscales y legales;
- multi-moneda e idiomas;
- SSO/SAML y SCIM;
- RTO/RPO contractuales y restore drills recurrentes;
- SOC 2 u otra certificación exigida por clientes;
- residencia, multi-región o tenancy dedicado;
- capital/financiación mediante socios regulados antes de infraestructura propia.

**Salida:** cada país o segmento pasa su propia matriz legal, fiscal, seguridad,
soporte y unit economics antes de recibir tráfico comercial.

## 7. Los próximos 25 slices

Máximo tres epics activos; por defecto se toma un slice de producto a la vez.
Los bloqueos externos no autorizan saltar a la fase más atractiva: se avanza en
la siguiente tarea técnica que reduzca el mismo gate.

| # | Slice | Fase | Estado 2026-08-22 | Evidencia de cierre |
|---:|---|---|---|---|
| 1 | ARCA producción | F0 | Bloqueado externamente; homologación completa | Factura productiva autorizada y reconciliada. |
| 2 | Legal publish | F0 | Bloqueado externamente | Identidad, privacidad y términos revisados/publicados. |
| 3 | Conteo físico | F0 | Bloqueado externamente | Ajustes trazables; stock y Kardex reconciliados. |
| 4 | Restore drill | F0 | **Cerrado 2026-08-21:** v3, 147 tablas / 63 filas, RTO técnico 937,22 ms, cero restos | Repetición trimestral; reconstrucción completa queda como nivel siguiente. |
| 5 | Payment test matrix | F0 | **Interna cerrada 2026-08-21:** 8 escenarios, 2 bugs corregidos, traza completa y cero restos. Certificación live bloqueada externamente | Pago/rechazo/webhook/timeout/refund reales reconciliados sin intervención de base. |
| 6 | Correlation IDs y trazas críticas | F0 | **Cerrado para pagos 2026-08-21:** una correlación server-side une intent, attempt, metadata del proveedor, eventos, orden, settlement y ledger; timeline RLS sin PII | Matriz exige las 5 etapas y la UI reconstruye la operación desde Costos de cobro. Extender por riesgo, no como plataforma genérica. |
| 7 | E2E bloqueante | F0 | **Cerrado 2026-08-21:** 41 pruebas reales; tienda desktop/móvil y panel autenticado bloquean CI. El primer run posterior detectó usuarios Presence duplicados durante reconexión y forzó su deduplicación; además corrigió reutilización de puerto y 6 fallas ocultas iniciales. | GitHub Actions exige las 5 variables, no permite skips de auth y conserva specs de sólo lectura. |
| 8 | Comisión, billing y unit economics | F0 | **En curso:** aprobación segura + workbench de merchant/platform economics, impuesto, leakage, contribución y break-even entregados el 2026-08-21. Benchmark oficial: Tiendanube 0% con Pago Nube o 2%/1%/0,7% con proveedor externo, más su arancel. La muestra real sigue siendo 1 merchant y 2 pagos de ARS 1; faltan costos medidos, contrato y decisión | Contratos, costos, margen y pricing aprobados; ninguna comisión se activa por edición accidental y el escenario aprobado conserva contribución positiva bajo estrés. |
| 9 | Segundo comercio | F1 | **Gate técnico cerrado; pendiente comercial:** alta Platform ahora es atómica/idempotente, bloquea owners vinculados y envía acceso sin revelar sesión | Primera venta sin cambios manuales de base. |
| 10 | Onboarding universal, Business Profiler, importación, cohortes y soporte consentido | F1 | **Infraestructura cerrada 2026-08-22:** alta segura, objetivo POS/online, ocho hitos server-side, 7 perfiles declarativos, onboarding atómico, importador reconciliado, cohortes maduras y diagnóstico Support con consentimiento/expiración. Sólo faltan merchants externos | Segundo y tercer merchant reciben acceso, eligen perfil, completan hitos, importan sin SQL y reciben ayuda medible sin impersonación; la cohorte produce conversión/costo sin historia falsa. |
| 11 | Margin facts canónicos | F2 | **Cerrado 2026-08-22:** 34/34 líneas visibles; cuatro componentes con fuente, asignación exacta, cobertura y RLS; Analytics y Merchant 360 consumen la autoridad | Cobertura y fuentes reconciliadas por operación. Base inicial: 0 completas y 2,9% promedio; no se reconstruyó historia inexistente. |
| 12 | Margen SKU/orden/canal/pago/promoción | F2 | **Gate técnico cerrado; evidencia real pendiente (2026-08-22):** producto × canal y operación usan hechos canónicos. Venta v3 conserva total descontado + baseline y crea partes de cobro; split parcial bloquea, conciliación real calcula neto/asiento/auditoría. Fixture: ARS 2.700, mix 1.200/1.500, fee 121, asiento balanceado, cobertura 100%, outsider/restos 0 | Registrar y conciliar una venta POS real nueva; validar que el merchant usa la explicación sin doble conteo. |
| 13 | Pricing proposal e impact outcome | F2 | **Gate técnico cerrado; evidencia real pendiente (2026-08-22):** aprobación server-side, baseline canónica, costo revalidado, medición no causal, reversión con guard, auditoría y RLS. Fixture 3.000→2.700 con cobertura 100%, conflicto protegido y restos 0. Producción: 0/25 aplicadas | Merchant aplica una propuesta real; ventana madura con 100% de cobertura y decide mantener/revertir usando el resultado. |
| 14 | Finance ADR, shell y acceso por producto | F3 | **Gate técnico cerrado; evidencia real pendiente (2026-08-22):** `/finance`, chrome propio, sesión/org compartidas, entitlement ≠ permiso ≠ flag, solicitud y aprobación auditada. Snapshot prueba que no duplica el Core. Fixture owner/platform/outsider/anon y restos 0; producción 0/4 habilitadas | Un comercio solicita/recibe acceso y navega Finance con su rol real; medir solicitud → habilitación. |
| 15 | Document storage seguro y versiones | F3 | **Gate técnico cerrado 2026-08-22; inspección pendiente** | Original privado, intención server-side, hash declarado, MIME/tamaño, versiones y auditoría. Falta recalcular hash, antivirus y deduplicación. |
| 16 | Extracción estructurada y confidence | F3 | Precursor parcial | Campos versionados, validadores y revisión por umbral. |
| 17 | Supplier/product matching y alias memory | F3 | Pendiente | Confirmación aprendida resuelve la siguiente factura. |
| 18 | Invoice-to-purchase/payable draft | F3 | Pendiente | Factura real crea borradores sin tocar stock/deuda antes. |
| 19 | Split Storefront | F4 | Pendiente | Despliegue, SLO y fallas aislados del panel. |
| 20 | Cart y order canónicos | F4 | Pendiente | Carrito server-side y estados independientes. |
| 21 | Store first-class | F4 | Pendiente | Una organización opera dos stores sin duplicar Core. |
| 22 | Domains + migración inicial | F4 | Pendiente | Tienda externa migra, conecta SSL y vende. |
| 23 | Finance Automation piloto | F5 | Congelado hasta F3 | Documentos operan por excepción con trazabilidad. |
| 24 | Commerce diferencial | F6 | Congelado hasta F4 y demanda | Una capacidad diferencial adoptada por merchants. |
| 25 | Pay/Ship + Developer gates | F7–F8 | Congelado por volumen/regulación | Margen transaccional y app externa reales. |

### Próximo trabajo autorizado por el roadmap

Mientras los slices 1–3 esperan al dueño, el orden técnico es:

1. ~~restore drill de datos~~ — cerrado el 2026-08-21;
2. ~~payment test matrix interna~~ — cerrada; certificación live espera una operación controlada;
3. ~~correlation IDs y trazas de pagos~~ — cerrado el 2026-08-21;
4. ~~E2E bloqueante~~ — cerrado el 2026-08-21 con 41 pruebas y credenciales técnicas rotadas;
5. ~~modelo auditable de economics de comisión~~ — entregado el 2026-08-21; faltan costos medidos, contrato y decisión;
6. ~~ruta universal a la primera venta~~ — cerrada el 2026-08-21 con ocho hitos y permisos verificados;
7. ~~importación CSV/Excel con staging, preview, validación y reconciliación~~ — cerrada el 2026-08-21; prueba real 1 válida + 1 inválida, Kardex único, retry idempotente y cero restos;
8. ~~instrumentación de cohortes e intervención manual~~ — cerrada el
   2026-08-22; 4 organizaciones, 1 activada, 3 pendientes, 0 altas elegibles
   para soporte desde el watermark y verificación idempotente con cero restos;
9. ~~Business Profiler mínimo para adaptar capacidades sin crear forks por
   rubro~~ — cerrado el 2026-08-22 con 7 perfiles, 8 tipos y 28 atributos
   declarativos; onboarding transaccional, retry idempotente, custom preservado
   y verificación con cero restos;
10. ~~diagnóstico temporal de soporte sin impersonar usuarios~~ — cerrado el
    2026-08-22: consentimiento owner, ventanas 15/30/60, snapshot agregado,
    contador por lectura, revocación efectiva y magic links retirados;
11. ~~alta técnica del segundo comercio sin estados parciales ni enlace de
    sesión visible~~ — cerrada el 2026-08-22: RPC transaccional, retry
    idempotente, owner previo protegido, acceso por email y cero restos;
12. onboarding acompañado del segundo comercio y primera cohorte real.
13. ~~hechos canónicos de margen sin ceros optimistas ni ventas omitidas~~ —
    cerrado el 2026-08-22: 34/34 líneas, fuente por componente, asignaciones
    reconciliadas, RLS tenant, agregado sanitizado de plataforma y cero restos;
14. cerrar costo + cobro + envío + IVA de una operación real nueva y extender
    la explicación a orden, medio de pago y promoción. **Infraestructura
    cerrada 2026-08-22:** POS v3 persiste bruto descontado, baseline, efectivo/
    transferencia exactos y tarjeta pendiente; Finanzas concilia el arancel y
    genera asiento. Sigue faltando ejecutar una operación comercial real.
15. ~~explicación técnica por ticket, mix de cobro, promoción y devolución~~ —
    cerrada el 2026-08-22: prorrateo y sumas exactas, split 1.200/1.500,
    descuento 300 medido, cupón sin importe marcado parcial, devolución bloquea
    contribución, outsider bloqueado y cero restos. El punto 14 sigue abierto
    porque requiere una operación real, no otro fixture.
16. ~~Price Change Proposal aprobable, medible y reversible~~ — cerrado
    técnicamente el 2026-08-22: baseline con ventana equivalente, costo/margen
    revalidados en servidor, outcome observacional, guard de concurrencia,
    auditoría/RLS y cero restos. Sigue abierto el gate comercial: producción
    tiene 25 recomendaciones descartadas, 0 aplicadas y 0 outcomes.
17. ~~ADR, shell y acceso por producto de Gestiona Finance~~ — cerrado
    técnicamente el 2026-08-22: `/finance` usa sesión/organización compartidas,
    entitlement y `finance.view` independientes, decisión Platform auditada y
    snapshot agregado del mismo proveedor/compra/obligación/ledger. Producción:
    4 disponibles, 0 solicitadas, 0 habilitadas.
18. ~~Document Inbox seguro: bucket privado, original inmutable, hash
    SHA-256, MIME/tamaño, versiones y auditoría~~ — gate técnico cerrado el
    2026-08-22 con `/finance/documentos`, bucket privado, RPCs, URLs firmadas y
    cero mutación de originales.
19. Inspector server-side del Document Inbox: recalcular hash, validar MIME y
    tamaño reales, antivirus/cuarentena, deduplicación y transición auditable a
    `ready_for_extraction` antes de invocar OCR.
20. ~~Continuar el sistema visual v2 sobre Platform y Settings~~ — cerrado
    técnicamente el 2026-08-22: Platform tiene topbar/rail propio con contraste
    en tema claro y oscuro; Settings usa la cabecera compartida y mantiene sus
    seis secciones persistidas. Queda Storefront, capturas desktop/mobile y la
    medición de abandono o tiempo a tarea antes de declarar la renovación visual
    validada. Cada pantalla nueva debe cumplir `docs/INTERFAZ.md`.
21. ~~Landing y Auth con dirección visual propia~~ — cerrado técnicamente el
     2026-08-22: landing product-led con preview del Business Core, navegación
     responsive, CTA de registro directo y Auth con panel de producto, login,
     registro y recuperación bajo el mismo contrato visual. Falta medir
     conversión real; la implementación no se declara validada por una captura.
22. CRM workspace con patrón de lista, filtros y detalle contextual — cerrado
     técnicamente el 2026-08-22: `CustomersPage` conserva el Business Core y sus
     acciones, pero separa operación e insights con estado persistido por
     organización. La dirección principal es el diseño CRM compartido; falta
     capturar la vista autenticada y probar el tiempo a tarea con datos reales.
23. Admin/marketplace workspace transversal — cerrado técnicamente el
    2026-08-22 en Productos y Ventas: `WorkspaceViewTabs` aplica la misma
    navegación compacta, densidad, estados y persistencia por organización a
    Catálogo/Operación y Ventas/Rendimiento sin separar el Business Core. El
    siguiente gate es capturar todas las superficies autenticadas y medir tarea
    completa en un comercio real.

Los gates comerciales previos quedaron demostrados como externos al código: el
segundo comercio requiere founder-led sales, la operación de margen requiere una
venta/control real y el impact event requiere una decisión del merchant. Eso
habilita F3 sin declararlos cerrados. No se separa Storefront ni se salta a F4
antes de cerrar el Document Inbox y el flujo Finance aprobado.

## 8. Modelo económico objetivo

El modelo «software base gratuito o de muy baja fricción» es una **hipótesis de
distribución**, no pricing aprobado. Sólo es viable si el costo variable y el
soporte quedan controlados.

| Línea | Hipótesis de ingreso | Gate |
|---|---|---|
| Business | Base gratuita/freemium o plan simple. | Retención y costo de servir medidos. |
| Gestiona Pay | Margen dentro del precio de procesamiento, conciliación y riesgo. | Contratos upstream, aprobación, fraude, impuestos y soporte. |
| Gestiona Ship | Diferencia negociada, etiquetas y servicios logísticos. | Volumen, reclamos y costo operativo. |
| Gestiona Finance | Documentos por uso, conectores, aprobación y auditoría avanzada. | Accuracy, costo por documento y disposición a pagar. |
| Communications | WhatsApp, SMS y email de volumen. | Consentimiento, entregabilidad y margen. |
| Domains | Registro, renovación y DNS administrado. | Operación y soporte automatizados. |
| Ecosistema | Revenue share de apps/themes y partners. | Merchants y desarrolladores activos. |
| Capital | Referral/origination mediante entidad regulada. | Datos, riesgo, volumen y marco legal. |
| Enterprise | SLA, SSO, auditoría, infraestructura y soporte. | Demanda contractual y unit economics. |

### Comisión actual

La application/marketplace fee documentada no se considera modelo definitivo.
El modelo reproducible, la calidad de cada supuesto y el benchmark oficial
viven en [docs/ECONOMICS.md](docs/ECONOMICS.md).
Antes de fijar un porcentaje se deben conocer:

- costo del proveedor;
- impuestos;
- tasa de aprobación;
- fraude/chargebacks;
- refunds;
- costo de soporte;
- margen de contribución;
- valor adicional que recibe el merchant.

Hipótesis preferida a validar: cuando el merchant usa Gestiona Pay, la plataforma
monetiza dentro del procesamiento y evita una comisión adicional poco
explicable. Con proveedor externo, cualquier cargo debe demostrar valor y
economics.

## 9. Scorecard de producto e inversión

Toda métrica lleva definición, fuente, dueño, período, denominador y consulta
reproducible. No aparece en un pitch si no se puede reconstruir.

| Grupo | Métricas |
|---|---|
| North Star | Active Transacting Merchants y crecimiento neto. |
| Activación | Registro → onboarding, primer producto, primera venta, publicación, primer pago/documento e intervención manual. |
| Retención | ATM por cohorte, segunda venta, frecuencia, churn y reactivación. |
| Negocio | GMV/TPV conciliado, ingresos, gross profit, net take rate, contribution margin y costo de servir. |
| Commerce | Conversión, add-to-cart, checkout completion, payment approval, stockout, refund y margen de contribución. |
| Finance | Documentos, field accuracy, straight-through processing, excepciones, duplicados, match rate, aprobación y AP aging. |
| Intelligence | Findings vistos, aprobados, aplicados, revertidos, AI Action Rate e impacto verificado. |
| Platform | Webhook success, queue age, DLQ, provider health, checkout error, reconciliation lag, MTTR e incidentes por merchant. |
| Calidad | E2E críticos, restore success, RTO/RPO medidos, diferencias de stock y regresiones P0. |

### Primeras definiciones

- **ATM 30d:** org_id único con venta POS u orden online confirmada en 30 días.
- **Tiempo a primera venta:** primera fecha confirmada POS/online menos alta de
  organización; organizaciones multi-tienda cuentan una vez.
- **AI Action Rate:** acciones aplicadas dividido recomendaciones persistidas;
  generar o visualizar no cuenta.
- **Verified Impact:** diferencia frente a una línea de base declarada,
  conservando fórmula, período y eventos atribuibles.
- **GMV conciliado:** suma de operaciones con estado y componentes reconciliados;
  no cualquier total guardado en cliente.

F0/F1 instrumentan líneas de base. Las metas se fijan después de cohortes
suficientes; no se optimiza una muestra de un solo comercio.

## 10. Asignación de foco

### Hasta el segundo comercio

- 50% confiabilidad, recovery y activación;
- 25% Control Plane y soporte;
- 15% Commerce Core;
- 10% discovery de Finance y Margin, sin abrir implementación extensa.

### Después del segundo comercio

- 35% Margin Intelligence y Commerce;
- 25% Finance MVP;
- 25% confiabilidad, Platform y pagos;
- 15% adquisición/onboarding y aprendizaje de mercado.

### Después de cinco ATM

Recalcular desde uso real, retención, GMV, documentos, incidentes, costo de
soporte, adopción de pagos y margen. Ningún porcentaje es una asignación eterna.

## 11. Definition of Done y actualización

Cada slice sigue:

~~~text
contrato / migración
→ verificación con rol y datos seguros
→ lógica pura y pruebas
→ UI o canal
→ observabilidad
→ typecheck + check:functions + lint + test + build
→ evidencia operativa
→ commit
→ ROADMAP actualizado
~~~

Para marcar un slice hecho debe existir:

1. problema y resultado esperado;
2. dueño de datos y amenaza/RLS revisados;
3. cálculo monetario en función pura y espejo servidor cuando aplique;
4. caso feliz, duplicado, retry, timeout y permiso probados según riesgo;
5. telemetría para detectar fallo y runbook para actuar;
6. evidencia real o fixture seguro con limpieza en cero;
7. rollback o reversión definida;
8. métrica afectada y definición;
9. roadmap actualizado en el mismo commit;
10. deuda y dependencia abiertas explícitas.

Estados permitidos:

- **Pendiente:** no iniciado.
- **En curso:** slice activo con evidencia parcial.
- **Parcial:** hay código previo, pero no cumple la salida.
- **Bloqueado:** depende de autoridad/dato externo concreto.
- **Congelado:** deliberadamente fuera de la fase actual.
- **Hecho:** cumple todas las condiciones de salida.

Máximo tres epics activos. Un incidente P0, seguridad, legal o pérdida de datos
interrumpe el orden y deja su impacto documentado.

## 12. Decisiones que no cambian sin ADR

- No reescribir el sistema.
- No crear otra identidad u organización para Finance.
- No duplicar proveedores, productos, compras, stock, clientes ni ledger.
- No permitir SQL libre a asistentes o agentes.
- No hacer que un LLM escriba dinero, stock o precio.
- No construir PSP, crédito o custodia antes de volumen y marco regulatorio.
- No lanzar marketplace sin merchants, API estable y desarrolladores.
- No expandir países antes de validar Argentina.
- No confundir instrumentación con tracción.
- No presentar paridad como diferenciación.
- No agregar módulos genéricos que no cierren un gate.
- No fijar pricing por intuición.
- No reconstruir historia inexistente para completar un gráfico.
- No contar una organización varias veces por tener varias tiendas.

## 13. Congelado deliberadamente

Hasta abrir sus gates:

- Finance Automation antes del Finance MVP;
- multi-market, A/B testing o personalización sin tráfico;
- Store Builder libre antes de temas/versiones/rollback;
- agentes autónomos sobre pagos, inventario o precios;
- Pay regulado, Capital o custodia;
- marketplace de apps/themes;
- microservicios por moda;
- multi-región, data residency o tenancy dedicado;
- country packs fuera de Argentina;
- features de ERP periféricas sin merchant ni métrica.

## 14. Fuentes, evidencia y revisión

- AGENTS.md: invariantes operativas, seguridad, migraciones y verificación.
- docs/ESTRATEGIA.md: tesis de margen y comparativas con fuente/fecha.
- docs/LEGAL.md: requisitos argentinos y estado fiscal/legal.
- Gestiona v2, análisis recibido el 2026-08-21: referencia estratégica para
  portfolio, arquitectura, Finance, Commerce, Platform y monetización.
- Build y suites locales del 2026-08-22: 1.393 tests, 63 funciones verificadas
  y 41 E2E críticos contra la base real.
- docs/PRICE_IMPACT_LOOP.md: benchmark oficial, autoridad, reversión y regla de
  no causalidad para propuestas de precio.
- docs/ADR_001_FINANCE_PRODUCT_SURFACE.md: acceso por producto, sesión,
  segregación, benchmark Odoo/QuickBooks y línea de base Finance.
- docs/MARGIN_FACTS.md: contrato de cuatro fuentes, seguridad, línea de base y
  comparación oficial con Shopify/Odoo al 2026-08-22.
- docs/E2E.md: contrato del gate, puerto estricto, variables obligatorias y
  política de sólo lectura.
- docs/IMPORTACION_PRODUCTOS.md: autoridad, estados, diagnóstico, métricas y
  reversión segura de los lotes Excel/CSV.
- docs/ACTIVACION_COHORTES.md: definición, denominadores maduros, watermark,
  costo de soporte y verificación destructiva-cero.
- docs/BUSINESS_PROFILER.md: perfiles declarativos, autoridad, idempotencia,
  límites del Core, experiencia y línea de base de adopción.
- docs/SOPORTE_DIAGNOSTICO.md: retiro de impersonación, consentimiento,
  minimización, expiración por lectura y verificación productiva.
- docs/ALTA_COMERCIOS.md: aprovisionamiento atómico/idempotente, compensación de
  identidad, entrega de acceso sin token y prueba destructiva-cero.
- Commit 13e48bd: primera venta y tiempo a vender por comercio.

Se revisa:

- al cerrar cada slice;
- al cambiar una condición externa;
- después del segundo y quinto ATM;
- ante un incidente que cambie riesgo;
- trimestralmente para competencia y monetización.

La visión puede ampliarse. El orden sólo cambia con evidencia de operación,
cliente, riesgo, tracción o economics.
