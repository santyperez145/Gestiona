# Nerqia Cloud — Visión y roadmap ejecutivo

**Corte editorial:** 2026-09-04. Categoría Commerce OS:
[`docs/ADR_002_COMMERCE_OPERATING_SYSTEM.md`](docs/ADR_002_COMMERCE_OPERATING_SYSTEM.md).
**Datos operativos:** 2026-08-22 salvo cuando una fila indique una fecha más
reciente. La separación evita presentar una medición técnica nueva como si
fuera tracción o adopción de negocio.
**Estado:** documento rector de producto, ejecución y evidencia. Reemplaza la
versión anterior del roadmap. No promete fechas ni transforma hipótesis en
hechos.

El rediseño completo se ejecuta y mide por separado en
[`DESIGNROADMAP.md`](DESIGNROADMAP.md). Este documento conserva la prioridad de
producto; ambos se actualizan juntos cuando una entrega cambia experiencia y
capacidad.

Toda pantalla, modal, segmentación o decisión de tecnología se ejecuta bajo el
[`estándar integral de experiencia competitiva`](docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md):
investigación fechada, traducción propia, cobertura de estados y una puerta
medible antes de adoptar dependencias.

## Objetivo canónico aceptado — 2026-09-03

**Nerqia Commerce OS**: convertir la tienda online en una puerta de entrada de
primer nivel y sostenerla sobre un único Business Graph; mantener Finance como
producto propio de control de gasto, comparable por flujo con Mendel, sin
clonar productos, stock, proveedores, cobros, documentos ni páginas del Core.
Ordenar y auditar todas las rutas, eliminar funciones equivalentes, completar
los flujos reales de punta a punta y elevar la presentación profesional de
Commerce, Business, Finance y Platform.

Cada decisión se contrasta con evidencia oficial y fechada de Tiendanube,
Shopify, Mercado Libre, Empretienda y Mendel, sin copiar marca ni prometer
capacidades no verificadas. La entrega exige autoridad server-side, aislamiento
multi-tenant, accesibilidad, observabilidad, estados honestos, pruebas
proporcionales al riesgo y separación explícita entre implementación técnica y
habilitación de proveedor, seguridad, legal, fiscal o regulatoria. Se trabaja
en slices completos, con documentación, commit y push, sin abrir una segunda
fuente de verdad para la misma capacidad.

## 0. Resumen ejecutivo

Nerqia construye el **Commerce Operating System** para PyMEs latinoamericanas:
tienda de entrada, operación nativa, cobros orquestados, Finance y —con
evidencia y partner— capital. Unifica esos productos sobre una única fuente de
verdad: el mismo producto, stock, cliente, proveedor, orden, costo, cobro y
margen en todos los canales. Canon: [`docs/ADR_002_COMMERCE_OPERATING_SYSTEM.md`](docs/ADR_002_COMMERCE_OPERATING_SYSTEM.md).

La propuesta no es «otro ERP», «otra tienda online», «alternativa a Tiendanube»
ni «una plataforma con IA». Es esta:

> Creá tu tienda, vendé en cualquier canal y gestioná todo tu negocio sin
> cambiar de plataforma. Nerqia no sólo registra lo que vendiste: entiende
> cuánto ganaste.

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

Nerqia tiene una arquitectura avanzada para su tracción, pero todavía está en
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

Nerqia Cloud es una plataforma con productos conectados, no seis aplicaciones
que duplican datos. Commerce es el insignia; el resto son capas. Orbit es
Automate, no un Core aparte.

~~~text
Nerqia Cloud
├── Nerqia Commerce
│   Storefront, checkout, canales, migraciones y B2B
├── Nerqia Business
│   Operación, POS, CRM, compras e inventario
├── Nerqia Pay
│   Orquestación de cobros, conciliación y reintegros
├── Nerqia Finance
│   Documentos, gastos, payables, aprobaciones y conciliación
├── Nerqia Capital
│   Crédito con socio (congelado hasta datos y regulación)
├── Nerqia Automate
│   Hallazgos, playbooks (Orbit), acciones y resultados
├── Nerqia Ship / Growth / Developers
│   Logística, consultoría productizada, API y partners
└── Nerqia Platform
    Control Plane, soporte, riesgo, billing y operaciones
~~~

| Producto | Trabajo que resuelve | Evidencia antes de escalar | Monetización objetivo |
|---|---|---|---|
| **Commerce** | Convertir catálogo y operación en ventas por tienda y canales. | Una tienda externa migra y vende sin perder continuidad. | Pagos, envíos, dominios y servicios de crecimiento. |
| **Business** | Mantener la verdad de productos, stock, ventas, compras, clientes y margen. | Dos comercios operan sin correcciones manuales. | Base de adopción; pricing definitivo por validar. |
| **Pay** | Onboard, cobrar, confirmar, conciliar, reembolsar y explicar comisión. | TPV Nerqia / GMV medible; webhooks recuperables. | Margen neto de procesamiento sin custodia. |
| **Finance** | Convertir documentos y gastos en obligaciones y controles auditables. | Facturas reales terminan en borradores correctos y aprobados. | Uso documental, conectores y workflows avanzados. |
| **Capital** | Financiar stock o adelantar ventas con uso controlado. | Partner firmante, underwriting versionado, repago por Pay. | Originación, servicing, revenue share. No VC en cartera. |
| **Automate** | Detectar oportunidades y ejecutar acciones dentro de políticas. | AI Action Rate e impacto verificado (Orbit O1+). | Incluido, por uso o premium según economics. |
| **Ship / Growth** | Etiquetas, CRO y consultoría que termina en template/workflow. | Contribución por envío; servicios que no dominan el P&L. | Margen logístico y fees de implementación. |
| **Platform** | Operar merchants, integraciones, soporte, riesgo e incidentes. | Menos intervención y menor tiempo de resolución por comercio. | Habilita escala y margen de toda la compañía. |
| **Developers / Apps** | Permitir que terceros amplíen la plataforma con límites. | Una app sirve a más de un merchant sin acceso a tablas. | Revenue share, partners y servicios. |

### Superficies

La topología lógica conserva sus límites y Commerce suma host canónico propio:

| Superficie | Ruta actual | Usuario | Límite |
|---|---|---|---|
| Organización | `nerqia.app` y objetivo `app.nerqia.app` | Miembros del comercio | AppLayout; no hereda permisos de Platform. |
| Finance | `/finance` | Miembros con producto + `finance.view` | FinanceLayout; misma identidad/organización, sin heredar onboarding de Business. |
| Plataforma | `/platform` | Staff de Nerqia | PlatformLayout, MFA y auditoría. |
| Tienda pública | `<slug>.nerqia.app`; `/tienda/:slug` compatible | Comprador | Un único StoreLayout/StoreContext y superficie pública mínima. |

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
comparativas fechadas y con fuente oficial viven en `docs/ESTRATEGIA.md`; los
patrones de producto/UX y la matriz de ejecución viven en
`docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md`.

| Campo competitivo | Paridad mínima | Diferencial Nerqia que debe probarse |
|---|---|---|
| ERP / operación | Contabilium, Xubio y Colppy ya combinan facturación argentina, compras, stock, caja/bancos, contabilidad e integraciones locales. | Menor tiempo de implementación y una verdad conectada a Commerce y Finance; la amplitud de módulos no es ventaja por sí sola. |
| Commerce | Tiendanube y Empretienda fijan la paridad local: checkout, catálogo/importación, promociones, pagos, envíos, dominio, operación mobile y stock entre ventas online/presenciales; Tiendanube suma PDV, filtros/bulk y ecosistema. | Costo y margen del mismo Core que ejecuta la venta, con migración reconciliada y una operación más simple para el segundo comercio. |
| Margen y rentabilidad | Shopify ya reporta profit por producto/orden/mercado y Odoo margen por línea/pedido; tener un reporte es paridad, no ventaja. | Cuatro fuentes persistidas —costo histórico, cobro, envío real e IVA— por venta/canal/operación, con mix, promoción y devoluciones. El POS ahora convierte cada parte del cobro en evidencia conciliable y bloquea el ticket mientras falte el arancel; la autoridad existe, pero su impacto todavía debe probarse con una decisión real. |
| Cobro QR de mostrador | Mercado Pago Orders exige QR dinámico por operación, `external_pos_id`, idempotencia y consulta del estado real antes de entregar. | Nerqia reserva sin descontar stock, acredita desde el proveedor y recién entonces crea ticket, cobro, stock y margen del Business Core; reintentos/vencimiento no duplican ni venden. Falta certificar una compra escaneada y el webhook Orders en la cuenta real. |
| Devolución de mostrador | Shopify POS fija devolución total/parcial, motivo, reposición y límite por el medio original; Square incluye el reembolso de efectivo en la sesión de caja; Mercado Pago exige refund total/parcial server-side e idempotencia. | Nerqia revierte ticket, stock, resultado y caja en una transacción; cada parte queda limitada por el cobro original y el dinero externo nace como deuda hasta tener evidencia. Para Mercado Pago deriva Order/Payment/monto desde el ticket, ejecuta o reconcilia con clave estable y sólo cancela el pasivo ante confirmación positiva. La nota interna no se presenta como fiscal. Falta certificar dinero live, no automatizarlo. |
| Marketplace | Sincronización de catálogo, stock, órdenes y postventa. | Sistema neutral que decide canal por margen, capital y disponibilidad. |
| Spend / Finance | Odoo/QuickBooks fijan OCR, revisión y matching. Mendel, Clara, Rindegastos y Concur agregan control preventivo, presupuestos/políticas, roles, reembolsos, captura mobile/offline e integración ERP. | Finance comparte proveedor, producto, compra, stock y ledger nativos. F3 demuestra documento → matching → borradores aprobados; F5 agrega política, centro de costo, presupuesto y operación por excepción. Tarjetas/custodia/viajes quedan fuera sin demanda, partner regulado y economics. |
| IA | Shopify Sidekick Pulse y QuickBooks Intuit Intelligence usan contexto de la empresa, priorización proactiva y tareas dentro del flujo; el patrón competitivo no es un chat suelto. | Contexto reconstruido server-side bajo RLS → recomendación explicable → revisión/aprobación → acción → resultado verificado. El Dashboard ya evita costo oculto y datos manipulables; falta instrumentar la acción y su outcome para que sea Business Copilot completo. |
| Plataforma | Health, replay, incidentes, soporte y billing. | Evidencia por merchant sin exponer secretos ni datos crudos. |
| Monetización | Precio y costo total de cobro transparentes. | Merchant economics y platform economics separados; contribución y break-even auditables antes de activar pricing. |
| Ecosistema | API, OAuth, scopes, webhooks y sandbox. | Extensiones sobre contratos estables del Business Graph. |
| Confiabilidad | Pruebas automáticas de los recorridos que venden y operan. | Tienda desktop/móvil y panel autenticado bloquean CI; restore y trazas prueban recuperación, no sólo compilación. |
| Activación | Wizard, checklist, ayuda para publicar/cobrar y cohortes básicas. | Ocho hitos calculados por el Business Core separan formulario de resultado; la primera venta del canal elegido define activación. Cohortes mensuales usan ventanas maduras 7/14/30, distinguen autoservicio de acompañamiento y miden minutos sin PII. El diferencial no es el dashboard: es poder conectar costo de onboarding con el mismo Core que prueba la venta. |
| Migración de catálogo | Excel/CSV, mapeo de columnas y altas masivas. | Un lote se prepara sin mutar datos, resuelve altas/actualizaciones/conflictos en servidor, exige aprobación y reconcilia cada fila con stock asentado sólo por Kardex. La importación es paridad; la reversibilidad, autoridad e idempotencia son confianza operativa. |
| Configuración por rubro | Presets, campos personalizados y plantillas de catálogo. | Nueve perfiles declarativos preparan tipos/atributos sin crear verticales y un Blueprint revisable coordina settings, roles, capabilities, ubicación y CRM con retry transaccional. La plantilla es paridad; cambiar la forma del negocio sin bifurcar stock, costo, orden, cliente ni margen es la tesis diferencial que aún debe probar un merchant externo. |
| Soporte remoto | Panel de cuenta, auditoría e impersonación/diagnóstico. | Se retiró la impersonación: Support solicita un snapshot agregado, owner autoriza 15/30/60 minutos, cada lectura revalida expiración/revocación y queda contada. La herramienta es paridad; consentimiento, minimización y no heredar una sesión son confianza operativa a validar con menor tiempo de soporte. |
| Alta de comercios | Cuenta, trial, invitación y panel de activación. | Platform aprovisiona org + owner + plan + settings + auditoría en una transacción idempotente, bloquea identidades ya vinculadas y envía el acceso sin mostrar el token. El alta es paridad; no corromper otro tenant ni duplicar al reintentar es confiabilidad a demostrar en el segundo merchant. |

### Decisión Finance 2026-08-22 — Mendel-class como benchmark principal

Mendel deja de ser una referencia regional más: es el **benchmark principal de
producto y experiencia para Nerqia Finance**. La meta es alcanzar una
experiencia comparable de control de gasto de punta a punta, no copiar su marca,
assets o pantallas. Su propuesta oficial vigente combina control preventivo,
presupuestos, reglas, aprobaciones multinivel, medios de pago, auditoría e
integración contable/ERP ([plataforma](https://mendel.com/ar/producto/),
[tarjetas](https://mendel.com/ar/producto/tarjetas-mendel/) e
[integraciones](https://mendel.com/ar/producto/integraciones/), verificadas el
2026-08-22).

El relevamiento ampliado del 2026-08-29 vive en
[`docs/FINANCE_MENDEL_BLUEPRINT.md`](docs/FINANCE_MENDEL_BLUEPRINT.md). Cubre
las superficies oficiales vigentes de plataforma, tarjetas propias y externas,
reembolsos, recuperación de facturas, categorías, viajes, flotillas,
beneficios, integraciones, Mendel AI y Mendel MCP. Esa cobertura se usa para
verificar que F5 no omita trabajos ni roles, pero no convierte claims de
marketing en evidencia de Nerqia y no adelanta capacidades reguladas.

**Contrato de paridad Mendel-class:**

| Capacidad objetivo | Comportamiento obligatorio en Nerqia Finance | Evidencia antes de declararla comparable |
|---|---|---|
| Control financiero | Inicio en tiempo real con gasto, disponible/comprometido/consumido, aprobaciones, comprobantes faltantes, anomalías y fuera de política. | Un responsable detecta y resuelve la excepción desde la misma superficie, sin planilla ni SQL. |
| Presupuestos y políticas | Presupuestos únicos o recurrentes por persona/equipo/centro/proyecto/categoría; reglas versionadas por monto, categoría, comercio, ubicación, horario y frecuencia. | El servidor explica qué regla y versión permitió, escaló o bloqueó cada solicitud/transacción. |
| Solicitudes y aprobaciones | Flujos de uno o más niveles, comentarios, rechazo, delegación, sustitución, SLA y segregación solicitante/aprobador/contabilidad/pago. | Casos felices, fuera de política, ausencia del aprobador y retry quedan auditados y tenant-safe. |
| Gasto unificado | Tarjeta propia o externa, transferencia, efectivo, reembolso, anticipo/fondo y factura convergen en un registro con evidencia y estado común. | Ningún medio crea un ledger, proveedor, centro de costo o circuito de aprobación paralelo. |
| Evidencia y conciliación | Ticket/factura, datos fiscales, categoría, centro de costo y cuenta contable se vinculan a una sola transacción; conciliación y exportación ERP son idempotentes. | No hay doble carga ni doble asiento; diferencia, retry y estado de sincronización son visibles. |
| Mobile e inteligencia | Captura, solicitud, aprobación y alertas funcionan mobile; el Copilot clasifica, explica y propone acciones sólo con permisos y auditoría. | La IA nunca salta una política ni una aprobación humana y su acción/resultados se miden. |
| Seguridad y operación | Roles mínimos, MFA para acciones sensibles, trazabilidad append-only, configuración por organización y observabilidad de integraciones. | Un usuario restringido no puede leer ni operar otra organización, credencial o etapa del flujo. |

**Diferencial propio:** Mendel-class define la paridad de Spend Management;
Nerqia debe superarla conectando ese gasto con el mismo proveedor, compra,
producto, recepción, stock, costo importado, venta y margen real del Business
Graph. Esa continuidad —documento → obligación → recepción → costo → margen— es
la tesis defendible para comercios, no tener otra tarjeta o dashboard.

**Alcance regulado:** la arquitectura y la experiencia contemplan tarjetas
físicas/virtuales y controles en tiempo real, primero mediante importación de
tarjetas externas y una abstracción de emisor. Emitir tarjetas, custodiar o
mover fondos sólo se activa con demanda, socio regulado, economics positivos,
riesgo, soporte y revisión legal. Es un gate de ejecución, no una renuncia a la
visión de paridad.

No son diferenciales suficientes por sí solos:

- tener tienda, POS, pagos, envíos, chat o reportes;
- sumar módulos genéricos;
- generar descripciones con IA;
- mostrar un dashboard sin acción;
- afirmar amplitud sin merchants activos.

## 3. Línea de base verificable

Las señales de negocio tienen corte medido el **2026-08-22**; las señales
técnicas llevan su propia fecha en cada fila. Todo número debe volver a medirse
antes de usarse en una presentación, valuación o decisión de inversión.

| Señal | Evidencia actual |
|---|---|
| Calidad técnica | 2.102 tests en 213 archivos pasan al 2026-08-30; typecheck, lint sin errores (139 warnings conocidos), build/PWA, auditoría npm sin vulnerabilidades y 74 Edge Functions versionadas/verificadas, iguales a las 74 activas en Supabase. La deriva de `extract-receipt` quedó cerrada sin habilitar transferencia documental: falta proveedor/DPA, `ANTHROPIC_API_KEY`, flag explícito y prueba con comprobantes autorizados. Hay 46 E2E críticos listados: 32 públicos, 13 de panel y 1 setup autenticado; los recorridos de Gastos, importación y turno conservan 0 escrituras. |
| Tracción | 4 organizaciones, 1 comercio real, 34 registros POS y 6 online. Es una muestra, no product-market fit. |
| Pagos | 2 pagos reales de prueba por ARS 1; matriz interna de 8 escenarios aprobada el 2026-08-21 y 0 suscripciones efectivamente cobradas. La comisión histórica fue 5% en esas pruebas; la propuesta actual de 0,5% quedó en borrador y cobra $0 hasta aprobación. Falta certificación live para probar proveedor/economics. |
| Turno POS | `20260829000044` vuelve autoritativa la caja por organización/ubicación: apertura/cierre por RPC, efectivo esperado server-side, un vínculo por ticket y una entrada por medio, vendedor, devolución y diferencia. Fixture reversible: 2 líneas → 1 ticket/entrada, ARS 10.000, esperado ARS 20.000, diferencia −ARS 100, outsider bloqueado y 0 restos. Base productiva al 2026-08-29: 0 sesiones y 0 movimientos reales; es confiabilidad técnica, todavía no uso. |
| Devolución POS | `20260829000045` agrupa cabecera, líneas y reintegros por ticket; `20260830000010` conecta la parte Mercado Pago a Orders/Payments API con IDs y monto server-side, `X-Idempotency-Key` estable, execute/reconcile, permiso `payments.edit` y deuda visible ante timeout/rechazo. Fixture inicial: stock 8→9, caja ARS 12.500, retry/outsider/exceso/ledger/0 restos. Fixture MP: modo Orders, 2 intentos con misma clave, rechazo conserva ARS 5.000 pendientes, confirmación deja pasivo 0 y restos 0. Edge `refund-pos-payment` está ACTIVE y rechaza sin JWT; base productiva: 0 cuentas MP conectadas, 0 QR completados y 0 devoluciones reales, por lo que falta certificación live y nota de crédito productiva. |
| Fiscal | 2 CAE históricos de homologación; 0 CAE de producción, medido el 2026-09-03. Configurar identidad exige `invoices.edit`, se audita sin secretos y sólo `service_role` puede confirmar una delegación tras hablar con ARCA. |
| Ledger | 10 eventos de ledger de dominio; 0 asientos contables operativos reales. |
| Margen canónico | `20260822000004/5/6` conserva 34/34 líneas y reconstruye 34 operaciones / ARS 1.143.696 sin diferencia. Exige costo + cobro + envío real + IVA, registra fuente, mix y bloqueos. La próxima venta POS crea partes de cobro atómicas: efectivo/transferencia prueban cero; tarjeta espera liquidación real y luego calcula neto + asiento + auditoría. Además persiste ingreso posterior a descuento y precio de referencia. Base histórica: 0 completas, 0% explicable, 2,9% cobertura, 0 liquidaciones POS y 0/34 baselines; no se inventó backfill. |
| Action Loop de precio | `20260822000007` convierte recomendación en propuesta aprobable, baseline canónica, aplicación, medición y reversión con guard de concurrencia. Fixture: ARS 3.000 → ARS 2.700, 100% de cobertura antes/después, cambio manual a ARS 2.600 protegido, auditoría/RLS/restos 0. Producción: 25 descartadas, 0 aplicadas, 0 outcomes; todavía no prueba impacto comercial. |
| Plataforma | Overview, Integration Registry, Merchant 360, evidencia de integración, cola operativa, reintentos auditados y control de Checkout Brick. |
| Activación | Primera venta y tiempo a vender medidos por comercio, deduplicando organizaciones multi-tienda. La migración `20260821000059` suma objetivo POS/online y ocho hitos server-side compartidos con Merchant 360. `20260821000061` agrega cohortes por mes y ventanas maduras: 4 organizaciones, 1 activada en su canal objetivo, 3 pendientes, conversión histórica 25%; a 7/14 días 0/4 y a 30 días 0/1. Son datos técnicos, no PMF. Soporte autoservicio/minutos tiene watermark desde 2026-08-22: 0 altas elegibles y 0 minutos, por lo que la UI dice “sin base” en vez de atribuir falsos ceros. |
| Importación de catálogo | La migración `20260821000060` reemplaza dos importadores client-side por un lote server-side Excel/CSV de hasta 5.000 filas: staging, preview, create/update/conflict, aprobación, aplicación atómica, retry idempotente y reconciliación. Verificación con rol `authenticated`: 1 válida + 1 inválida, bloqueo previo, 1 producto, stock 3, 1 movimiento, retry sin duplicación, anon/escritura directa sin permisos y 0 restos (2026-08-21). |
| Business Profiler | La migración `20260822000001` declara 7 perfiles, 8 tipos y 28 atributos sobre `product_types`; onboarding y reconfiguración pasan por RPC owner/admin, son atómicos e idempotentes y preservan colisiones `custom`. Verificación real: 1 tipo/4 atributos, retry 0/0, outsider bloqueado y 0 restos. Línea de base tras rollback: 0 organizaciones configuradas y 0 tipos, por lo que todavía no es adopción. |
| Capability Catalog | `20260828000130` versiona cinco entidades y cuatro capabilities piloto (`catalog.products`, `inventory.core`, `commerce.store`, `finance.documents`). Un evaluador compone activación, producto, dependencias, conflictos, rollout, membresía y permiso; Finance UI/comandos y sus dos workers delegan a él. Fixture transaccional: entitlement, dependencia, outsider, ciclo, preservación de datos y 0 restos. Base al 2026-08-28: 2 organizaciones con catálogo/inventario y 1/2 con tienda; esto es arquitectura habilitante, no adopción. |
| Blueprint y Provisioning | `20260828000140` persiste estado deseado + hash, runs idempotentes y checklist de cinco pasos; preview muestra diff sin escribir. Perfil/settings, roles, capabilities, ubicación y CRM se coordinan en una subtransacción recuperable. Fixture real: falla en paso 4 sin estado parcial, retry 2, replay 1 run, 5/5 pasos, 60+ permisos, 1 ubicación, 6 etapas, 2 capabilities, outsider bloqueado y 0 restos. Base productiva: 0 runs reales; confiabilidad, no adopción. |
| Soporte consentido | `20260822000002` reemplaza magic links de impersonación por solicitud Support → aprobación owner → snapshot sanitizado con expiración por lectura. Retry de solicitud conserva 1 ID; retry de aprobación no extiende la ventana; outsider bloqueado; 2 vistas auditadas; revocación efectiva y 0 restos. Línea de base: 0 solicitudes reales/0 diagnósticos consumidos. |
| Alta de comercios | `20260822000003` reemplaza escrituras parciales por un RPC superadmin: identidad técnica sin workspace prematuro; 1 org/owner/trial/settings/auditoría; retry conserva `org_id`; key con datos distintos, owner existente y outsider bloqueados; organización previa idéntica y 0 restos. El acceso se envía por email sin exponer enlace. Base real: 4 organizaciones; el segundo merchant aún no existe. |
| Finance surface | `20260822000008` agrega `/finance`, `FinanceLayout`, entitlement separado de `finance.view`, solicitud tenant, decisión Platform auditada y snapshot agregado de proveedores/órdenes/obligaciones/ledger existentes. Fixture real: owner solicita pero no autoaprueba; staff finance habilita/deshabilita; permiso, outsider y anon bloqueados; 3 eventos append-only y restos 0. Base: Business habilitado 4/4; Finance disponible 4/4, 0 solicitudes y 0 habilitaciones. |
| Finance Document Inbox | El original ya entra a bucket privado, queda inmutable/versionado y la Edge `inspect-finance-document` recalcula SHA-256, tamaño y magic bytes, bloquea capacidades activas de PDF, detecta duplicados por tenant y sólo `service_role` cierra un lease auditable. La migración `20260822000010` está aplicada: `authenticated` puede iniciar pero no completar, `service_role` sí, y quedaron 0 leases. El scanner privado no está configurado, por lo que ningún archivo puede llegar todavía a `ready_for_extraction`; esto es bloqueo seguro, no éxito simulado. |
| Finance matching | `20260822000012` propone proveedor/productos desde la última revisión humana con aliases o identidad exacta, guarda `none/ambiguous`, confirma por RPC y aprende vocabulario por tenant sin reasignarlo. Fixture de dos facturas: `exact_name` manual → `tax_alias` + `supplier_sku_alias`, homónimos 2 candidatos, outsider/retry/cero efectos/restos verificados. Producción: 0 runs, 0 aliases y 0 adopción. |
| Finance drafts | `20260822000013` separa Supplier Invoice/Purchase/Payable Draft, exige resolución inventario/no inventariable y aprobación owner/admin. Aprobar crea una única orden `confirmed` y una deuda; recepción, `purchases`, stock y ledger permanecen afuera. Finance ahora entrega la orden al workflow idempotente existente mediante un enlace tenant-safe: enfoca la fila, limpia filtros y abre recepción sólo en `confirmed/partially_received`, sin consultas por id ni escrituras de stock desde el cliente. Fixture productivo: outsider/retry/RLS, dos líneas, stock 7→7 y restos 0. Producción: 0 borradores reales y 0 adopción. |
| Finance precursor | El OCR anterior prellena una orden de compra y producción mostró un esquema distinto al archivo histórico (`extracted`, sin `document_type`). Sigue fuera de Finance porque no cumple custodia, revisión ni segregación, aunque el producto nuevo ya cubre extracción → matching → borradores → aprobación. |
| Storefront | Funcional y con carrito server-side canónico por dispositivo/cuenta, rehidratación contra catálogo vigente y vínculo atómico a la orden. Aún comparte aplicación/ciclo de despliegue con el panel; faltan aislamiento, dominios y prueba multidispositivo con comprador real. |
| Recuperación | Backups programados y restore drill de datos aprobado el 2026-08-21: snapshot v3, 147 tablas / 63 filas, 937,22 ms y cero restos. Falta reconstrucción completa para RTO/RPO contractual. |
| Observabilidad | Pagos ya conserva una correlación de checkout a ledger y ofrece timeline sin PII; faltan métricas/SLO, health checks activos y extender el contrato a los demás flujos críticos. |
| Activación comercial | La cohorte ya está instrumentada, pero no existe muestra externa suficiente: 4 organizaciones históricas, 1 activada y 0 altas posteriores al watermark de soporte. Conversión, autoservicio y costo no son todavía estimaciones defendibles. |

### Construido no significa validado

| Capacidad | Existe en código | Falta para llamarla producto probado |
|---|---|---|
| ARCA | Arquitectura, credenciales seguras y homologación. | Certificado/punto de venta productivos y factura real autorizada. |
| Ledger | Modelo de partida doble y eventos. | Asientos producidos y reconciliados por operaciones reales. |
| Payment orchestration | Estados, idempotencia, refund y fallback; matriz interna aprobada con cero restos. | Certificación real de proveedor, firma, timeout de red, rechazo y refund. |
| Devolución POS | Operación interna atómica por ticket, reintegro por cobro original, caja/stock/ledger y evidencia externa. Mercado Pago ya tiene ejecución/reconsulta server-side por Orders/Payments API, idempotencia estable y cierre únicamente ante evidencia positiva. | Conectar una cuenta productiva, cobrar y devolver un QR real —incluidos timeout/rechazo— y conciliar una nota de crédito productiva cuando exista CAE. |
| QR Mercado Pago en POS | Orders API, Store/POS privado, QR dinámico, polling/webhook, reserva, cierre atómico e idempotencia probados con fixture reversible. El cierre ya no depende de una pestaña: cron autenticado reconcilia Orders cada minuto y Caja recupera intentos/ventas sin mezclar el carrito nuevo. Fidelidad y alerta de venta grande también nacen una vez por ticket en servidor, incluso si acredita con Caja cerrada. | Configurar la notificación Orders en la aplicación de Mercado Pago y hacer un cobro escaneado real con settlement conciliado; la prueba interna y el cron de respaldo no sustituyen esa certificación. |
| POS offline | Implementación disponible. | Prueba sostenida con varios comercios, reconexión y conflictos. |
| Multi-organización | RLS y permisos avanzados. | Comercios externos y soporte repetible. |
| Importación CSV/Excel | Lote auditable y reconciliado contra el Business Core. | Usarlo con un segundo comercio y medir tiempo, correcciones y abandono; todavía no prueba una migración completa de tienda, clientes, imágenes u órdenes. |
| Intelligence | Varias funciones y recomendadores. | Acciones adoptadas con impacto económico atribuible. |
| Control Plane | Superficie operativa profesional en construcción. | Menor MTTR y menor intervención manual medidos. |
| Finance documental | Custodia, extracción, revisión, matching, borradores y aprobación conectada al Core. | Primera factura autorizada procesada y recibida sin SQL; proveedor privado y métricas reales siguen pendientes. |
| Finance product surface | Ruta, chrome, sesión compartida, entitlement, permiso y snapshot del Core. | Primer comercio habilitado y primer documento procesado; 0 adopción real al corte. |
| Sistema visual v3 Figma | El workspace claro adopta obligatoriamente la dirección de los kits CRM/marketplace compartidos: canvas casi blanco, superficies blancas, primary violeta `252 83% 62%`, secundarios turquesa/coral, rail persistente, topbar y profundidad baja; se aplica a Business, Finance y Platform sin alterar el Business Core. El 2026-08-22 se eliminó la mutación global que convertía el color secundario de un comercio en fondo/rail del panel: Gestión mantiene tokens oficiales y las paletas quedan limitadas a tienda pública y catálogo PDF; Finance ya no fuerza un rail negro en modo claro. El 2026-08-23 se incorporó el símbolo oficial RGBA como identidad única de Nerqia: reemplaza letras e íconos improvisados en Business, Finance, Platform, landing, acceso y rutas institucionales, además de favicon/Apple/PWA; el logo del merchant queda aislado a Storefront y documentos comerciales. Las tres superficies ahora envuelven todas sus rutas en `workspace-route-surface`, por lo que más de cien páginas heredan el contrato aunque todavía no declaren la clase; Button, Card, Input, Select, Textarea, Tabs, Table, Badge, Dialog, Popover, Tooltip, EmptyState y skeletons fueron alineados a radios, foco, profundidad, estados y contraste del Figma. Ajustes, Perfil, resumen/Document Inbox de Finance y Anuncios de Platform adoptaron `PageHeader`; POS queda documentado como workspace de caja a viewport completo. `DESIGNROADMAP.md` separa desde ahora fases, cobertura, métricas y 26 slices visuales del plan de producto. D2.2–D2.3 retiraron 30 selects nativos: 20 de páginas y 10 de componentes; el SaaS queda en cero, mientras Storefront conserva sólo 3 excepciones mobile/autofill fijadas por test. D2.4 reemplaza los cinco paginadores manuales de Admin, Productos, Compras, Reportes y Ventas por `DataPagination`, con rango real, límites, respuesta mobile y anuncio accesible; sus 82 campos temporales de 46 archivos conservan semántica nativa bajo `Input`, con cero variantes manuales y tema claro/oscuro protegido. Los 16 transportes de archivo quedaron clasificados en importación, documento/cámara e imagen/branding; las cinco importaciones estructuradas ya comparten `FilePicker` con dropzone o botón, validación por extensión/MIME, busy y error accesible sin mover la autoridad de preview/aplicación fuera de cada flujo. D2.5 crea `WorkspaceState` con los 12 estados del estándar, skeleton estable, `alert/status` accesibles y recuperación; Finance/Compras y, desde el 2026-08-29, Reportes/Intelligence ya distinguen carga/refresh, primer uso/filtro, error, offline, stale, parcial y éxito sin convertir fallas en `[]`; Reportes además conserva la última lectura durante refresh y descarta respuestas de otra organización. D2.6 migra 16 overlays manuales de 11 archivos a Dialog/Sheet/Popover y fija en CI las únicas cuatro excepciones técnicas: rail mobile y tres scanners fullscreen. Dashboard conserva seis vistas persistidas y los hashes `#dashboard-*`; Platform organiza su rail por trabajo/rol. El estándar competitivo agrega anatomía, 12 arquetipos, árbol de overlays, segmentación, cobertura por producto y adopción tecnológica con umbral verificable. | Extender D2.5 al resto de rutas, converger documentos/cámara e imagen/branding y auditar combobox/menús de D2.4, auditar Storefront en D5 y validar los overlays y Reportes migrados en desktop/mobile; captura autenticada, revisión end-to-end y medición de tiempo a tarea antes de declarar la renovación visual validada. |
| Rediseño público v3 | Landing pública y Auth fueron reconstruidos el 2026-08-22 con propuesta omnicanal, preview del producto, registro directo desde CTA, responsive desktop/mobile y metadatos SEO alineados. D5.1 agrega resiliencia transversal de medios: un banner/producto/logo roto conserva fallback de marca y acción, mientras Gestión identifica el activo inválido y bloquea reactivarlo. `e63c0ad` quedó publicado y la tienda + Banners pasaron 360/768/1024/1440 sin overflow ni logs propios. | Medir conversión del CTA y continuar la auditoría de PLP/PDP/carrito/checkout; el comercio aún debe reemplazar la URL externa inválida. |
| CRM command center v2 | Clientes / CRM reemplaza la referencia minimalista anterior por la estructura de gestión densa de Aerten y el lenguaje violeta/tintado de eMarketplace Admin, ambos inspeccionados en preview público el 2026-08-22. Incorpora resumen ejecutivo de cartera/actividad/recurrencia/riesgo, tabs persistidos, rail de segmentos, filtros, tabla responsive con relación/compras/facturación/ticket/salud y ficha 360; conserva campañas, notas, comunicaciones, permisos y el mismo Business Core. La comparativa visual y su traducción están en `docs/INTERFAZ.md`. | Captura autenticada desktop/mobile, validación con un comercio real y medición de tiempo para encontrar/actuar sobre un cliente; el rediseño está implementado, no validado comercialmente. |
| Admin/marketplace workspace v1 | `WorkspaceViewTabs` extiende el contrato Figma a Productos, Ventas y Dashboard: Catálogo/Operación, Ventas/Rendimiento y seis vistas ejecutivas con contadores, meta contextual, responsive móvil y persistencia por organización; Settings, Admin, Integraciones, Reportes y Tienda quedan bajo el mismo contrato de tokens. El shell compartido expone identidad de workspace en topbar, breadcrumb, CTA, headers con acento, métricas con estados y plataforma con consola/rail violeta. | Captura autenticada de las superficies operativas y medición de tiempo a tarea antes de declarar la renovación visual validada. |
| Deploy/PWA sin chunks huérfanos | El incidente del 2026-08-22 confirmó que una pestaña abierta podía conservar `index-Bj1ae_cF.js` y pedir chunks ya retirados (`Dashboard-DTnpFc_O.js`, `ProductsPage-COufPAuI.js`); Vercel respondía `index.html` con MIME `text/html`. La recuperación ahora escucha `vite:preloadError`, promesas rechazadas y ErrorBoundary, limpia caches/SW, usa guardia temporal en vez de bloquear toda la sesión y excluye `/assets/` del fallback SPA. `sw.js` y `registerSW.js` se sirven sin cache. | Probar dos deploys consecutivos con una pestaña autenticada abierta y verificar una sola recarga automática, ruta preservada, cero loops y chunk inexistente con HTTP 404. |

### Bloqueos externos vigentes

| Bloqueo | Qué habilita | Responsable |
|---|---|---|
| Certificado productivo ARCA y punto de venta Web Services | Primera factura real. | Dueño / responsable fiscal. |
| Razón social, CUIT, domicilio y publicación legal | Tienda presentable y proceso de venta regular. | Dueño del comercio. |
| Conteo físico y ajuste trazable | Stock confiable después del antiguo doble movimiento. | Comercio. |
| Pesos, fotos, descripciones y tarifario | Cotización y conversión representativas. | Comercio, con carga asistida. |
| Contrato/credenciales de transportista | Etiqueta y tracking probados contra operación real. | Comercio / correo. |
| Medio de pago de prueba y ventana controlada | Certificación live de aprobación, rechazo, webhook, timeout y refund. | Dueño / operación. |
| Credenciales Mercado Pago productivas + pago reembolsable | Ejecutar y observar un refund total/parcial, la consulta posterior y su conciliación sin confirmación manual. | Dueño / operación / proveedor. |
| Cuenta comercial MercadoLibre | Publicación e importación reales. | Comercio. |
| Segundo comercio | Validación externa del onboarding y soporte. | Comercial / founder-led sales. |
| ~~Reparar el costo de las 34 ventas y backfillear el ledger~~ **hecho el 2026-08-26**, con la instrucción del dueño («necesito que termines todo eso») sobre el plan explícito asentar→conciliar→cambiar lectores. Costo desde `total_ars − profit_ars` (histórico congelado, no recalculado); 48 asientos; conciliación **exacta** contra la fuente operativa y Deudores neteado a $0. Detalle abajo, en «El resultado financiero tenía cuatro calculadoras». | Que el ledger pueda ser la autoridad del P&L. | ~~Dueño~~ Ejecutado con su instrucción; revisar los números en `/pl-dashboard` y `/libro` sigue siendo suyo. |
| Limpiar 9 clientes `ZZ` de verificaciones anteriores | Que el conteo de clientes deje de estar inflado 26%. | Dueño: es un borrado, y son filas reales de su base. |

Ninguno se cierra con una simulación. Requiere responsable, fecha, evidencia y
entorno.

### AFIP quedó conectado, y la cadena tenía cinco eslabones rotos (2026-08-27)

Verificado en el navegador con la sesión real contra producción: el panel dice
**«AFIP conectado — Facturás con tu CUIT 20-44648443-6 en homologación»**.

Llegar ahí destapó cinco bugs encadenados, y ninguno se veía desde el anterior:

1. **El TRA se declaraba 3 h en el futuro.** `toISOString()` es UTC y el código
   le pegaba `-03:00` encima. Estaba así desde el primer commit de AFIP.
2. **El ticket viene escapado dentro de `loginCmsReturn`** y no se
   des-escapaba: ARCA contestaba bien y la pantalla decía que había fallado.
3. **El regex de tag no aceptaba atributos**, así que no veía
   `<faultcode xmlns:ns1="…">` —como Axis lo escribe— y la traducción de
   códigos de ARCA no habría funcionado nunca. **Lo encontró el test.**
4. **El Ticket de Acceso se podía perder**: si el guardado fallaba se lanzaba
   error, y ARCA no entrega otro por ~12 h. Un error de escritura dejaba al
   comercio sin facturar medio día.
5. **La verificación decía `ok: true` sin guardar nada.**
   `afip_marcar_delegacion` escribía `last_error`, una columna que no existía;
   el UPDATE fallaba con 42703 y el `rpc` sin `.error` se lo tragaba.

📌 **El quinto es el que más enseña:** todo lo demás ya funcionaba —el TRA era
válido, el ticket se leyó y se guardó, ARCA respondió— y el panel seguía
diciendo «falta conectar» porque el último paso fallaba en silencio. Una
función que responde `ok: true` sin haber escrito es peor que una que falla.

Además: el panel le pedía al comercio **delegar a su propio CUIT**. `motivo`
ahora distingue `sin_delegacion_necesaria` y la app confirma sola al entrar.

### El panel de AFIP mostraba un mensaje fijo en vez del de ARCA (2026-08-27)

Reportado desde la pantalla: «Falta delegar el servicio en ARCA» seguía
apareciendo con AFIP conectado. Tres errores encadenados, y el tercero es el
que importa para todo el repo.

**1. La acción equivocada.** El guardado automático llamaba `test_connection`,
que prueba el CERTIFICADO —que WSAA entregue un Ticket de Acceso— y no dice
nada sobre si el comercio puede emitir. Lo que prueba eso es
`verificar_delegacion`, que consulta `FECompUltimoAutorizado`.

**2. El mensaje equivocado.** Cualquier fallo se traducía a «falta delegar»,
incluso con `modo: propio`, donde no hay nada que delegar.

**3. ⚠️ El mensaje real no llegaba, y eso pasa en todo el repo.**
`functions.invoke` reemplaza el cuerpo de un no-2xx por
`"Edge Function returned a non-2xx status code"`. El cuerpo queda en
`error.context`, pero medido: **47 archivos invocan Edge Functions y sólo uno
lo leía**. Todos los mensajes que las funciones escriben con cuidado —«El CUIT
no está autorizado», «el punto de venta no existe»— eran invisibles.

Se cerró con `mensajeDeEdgeFunction()` en `src/lib/edgeErrors.ts` y se migraron
los sitios que mostraban el genérico de una Edge Function.

📌 **El patrón correcto existía:** `PlatformAdminPage.adminCall` leía
`error.context` desde hacía meses. Nunca se propagó. Un patrón encerrado en un
archivo no protege a nadie — por eso ahora hay una guarda que falla si alguien
vuelve a escribirlo a mano.

### Cambiarle el precio a quien ya está suscripto (2026-08-27)

Salió de una pregunta del dueño —«si modifico un valor de plan, ¿cambian las
funciones?»— y la respuesta tenía una excepción: los beneficios y límites
propagan al instante, **el precio no**.

Medido: `mp-subscribe` crea el `preapproval` de MercadoPago con el monto del día
y **nadie lo actualiza después**. Cero menciones a `preapproval` en
`platform-admin-action`. Un cambio de precio no llegaba jamás a los actuales.

⚠️ **Y el problema de raíz era anterior:** `subscriptions` no guardaba en ningún
lado cuánto acordó pagar cada comercio. Sin eso no hay aviso posible —no se
sabe desde qué precio— y `Mi plan` ni siquiera mostraba un monto: nombre, estado
y fecha de renovación. El comercio no podía ver cuánto se le cobraba.

Lo que se construyó, en orden de dependencia:

1. `subscriptions.precio_ars` — lo autorizado en MercadoPago. Backfill **sólo
   donde se puede probar** (el precio del plan no se tocó desde que se
   suscribió); donde no, NULL, que significa «no consta» y no «gratis».
   Reconstruido: 1 de 2.
2. `plan_price_changes` + `plan_price_change_targets` — la decisión con fecha y
   constancia, siguiendo el patrón de `platform_commission_rules`. Va por
   suscripción y no sólo por plan porque MercadoPago puede aceptar una y
   rechazar otra.
3. `programar_cambio_de_precio` con **30 días de preaviso para un aumento y 0
   para una baja**. ⚠️ El preaviso se mide contra lo que paga **cada uno**, no
   contra el precio de lista: a quien se le cobra menos, esto le sube aunque la
   lista baje.
4. `precio-suscripcion` (cron 9 AM ARG): avisa por mail y, el día que rige,
   aplica el `PUT /preapproval`.
5. El comercio lo ve en un banner **que no se puede descartar** y en `Mi plan`,
   que ahora dice cuánto paga de verdad.

**El invariante:** no se aplica un precio que el comercio no recibió. Probado en
producción de punta a punta.

⚠️ **Y esa prueba destapó algo que afecta a todo el producto.** Con un comercio
ZZ y un dominio reservado, la función avisó, MercadoPago no llegó a tocarse, y
el objetivo quedó `pendiente`. El motivo:

> «You can only send testing emails to your own email address. To send emails to
> other recipients, please verify a domain at resend.com/domains».

`RESEND_API_KEY` **está configurada** y aun así **ningún email llega a ningún
comercio**: campañas, secuencias, facturas, invitaciones y este aviso. La doc
decía que faltaba la clave —mirar ahí no lleva a ningún lado—. Corregido en
`docs/CONFIGURACION.md`. Espera al dueño: verificar un dominio y poner
`RESEND_FROM`.

📌 La buena noticia es que **falla cerrado**: sin aviso entregado no hay
aumento. El sistema no le sube el precio a nadie en silencio.

⚠️ **Sin verificar:** el `PUT /preapproval` sigue la documentación publicada
pero **no se probó contra una suscripción viva**. En particular, si MercadoPago
exige que el pagador vuelva a autorizar un monto mayor. Por eso la respuesta se
guarda entera y existe el estado `requiere_reautorizacion`.

📌 **Y el relevamiento legal falta:** `docs/LEGAL.md` cubre precios al
consumidor en la tienda, no la suscripción al SaaS. Los 30 días son un default
prudente elegido acá, no una norma verificada. Se cambia en un solo lugar
(`preaviso_minimo_dias`).

### No pagar no costaba nada, y la IA la pagaba la plataforma (2026-08-27)

El circuito de cobro quedó completo esa mañana —`mp-subscribe` crea el
`preapproval`, el webhook activa y corre el período— pero **cobrar y cortar son
dos cosas distintas**, y sólo estaba la primera.

Medido contra producción antes de tocar nada:

| | |
|---|---|
| Funciones que gastan `ANTHROPIC_API_KEY` | 9 |
| …que verificaban el plan del comercio | **0** |
| Pantallas que llaman IA | 13 |
| …que mostraban el motivo real de un error | **2** |

O sea: una organización con la suscripción vencida podía seguir quemando
crédito de Anthropic indefinidamente, y el único corte —el del navegador— se
podía saltear llamando la función directo. **La UI orienta, el servidor
decide**, la misma distinción de P1-04.

Lo que se construyó:

- `public.org_entitlements(org)` como **única autoridad**. Devuelve `vigente`,
  `motivo_de_corte`, `dias_de_gracia` y los beneficios/límites resueltos. La
  leen el hook del navegador y las Edge Functions; la ventana de gracia y el
  piso de límites no se escriben en ningún otro lado.
- `_shared/entitlements.ts` con `exigirBeneficio(...)` → **402**, no 403: no es
  que la persona no tenga permiso, es que el plan no lo cubre. ⚠️ Consulta con
  el **JWT del usuario**: con `service_role`, `auth.uid()` es NULL, el chequeo
  de membresía se saltea y se podría pedir prestado el plan de otro comercio.
- Las 7 funciones de IA cortadas. Las 2 restantes en allowlist con motivo:
  `platform-admin-action` es del staff, y Finance ya tiene su gate propio en
  `finance_document_can`.
- `llamarIA` en `src/lib/ia.ts`: `functions.invoke` **descarta el cuerpo** en un
  status no-2xx, así que el 402 se habría visto como «Error al generar» en 11
  de 13 pantallas — un bug donde hay una decisión de producto.

⚠️ **Lo que encontró la verificación en rojo.** Los seis guardias pasaban
saboteados: uno matcheaba el `import` en vez de la llamada, otro un comentario
(la trampa de `ledger_plan_default`, de vuelta), y el de `orgId` miraba una
ventana de 900 caracteres que atrapaba un `CACHE_KEY(orgId)` sin relación. Se
reescribieron contando paréntesis y exigiendo la llamada; los seis fallan ahora
cuando deben.

⚠️ **Y una alarma falsa que ya estaba en producción:** el banner decía «Pago
fallido. Actualizá tu método de pago» ante cualquier `past_due` — que es
**también el estado con el que nace toda suscripción**, porque `mp-subscribe` la
guarda así hasta que el webhook confirma el cobro. Al comercio que acababa de
poner la tarjeta se lo acusaba de no haber pagado. Ahora se distinguen tres
estados que se veían iguales: confirmación en curso, pago pendiente con gracia,
y beneficios apagados.

📌 **Pendiente del dueño, no del código:** `trial` (gratis) tiene IA, backups y
branding; `starter` ($19.900) no tiene ninguno. Pagar el plan más barato baja
capacidades respecto del trial. Es una decisión de precios y se corrige desde
`/platform` → Planes, que ya tiene los interruptores.

### La matriz de permisos prometía algo que el servidor no aplicaba (2026-08-27)

P1-04 de la auditoría del 24 de agosto. La primitiva ya estaba y era correcta:
`has_permission(org, módulo, acción)` lee la matriz de Admin → Permisos, es deny
by default y tiene defaults por rol. **El problema era quiénes no la llamaban.**

Probado contra producción como `authenticated` real, con una membresía
`vendedor` real, en una transacción revertida:

| | |
|---|---|
| `has_permission(org,'inventory','edit')` | `false` |
| `abrir_conteo(...)` | **PASÓ** |

Cerrar ese conteo llama a `record_stock_movement`, la única autoridad sobre el
stock. El comercio desmarcaba «Inventario» para un empleado, la pantalla
desaparecía del menú, y el empleado reescribía el stock igual por la RPC.

Cerrado con `exigir_permiso()` en nueve funciones —las cuatro de Toma Física,
transferencia entre sucursales, ubicación en posición, `adjust_stock`,
`record_member_stock_movement` y el retiro de billetera—, más el `REVOKE` de
`ledger_asentar_venta`/`_gasto`, que con `EXECUTE` para `authenticated` y sin
chequeo de membresía dejaban forzar un asiento en **otro** comercio.

Guardias: vista `audit_rpc_sin_permiso` (0) y `permisoEnElServidor.test.ts`.

**Segunda pasada:** al volver a medir quedaban seis sin puerta y dos merecían
una. `medio_de_pago_habilitar` (prende y apaga un medio de cobro) y —la que
más importaba— **`promotions`**, que no es una RPC: se escribe derecho contra la
tabla, así que la puerta es la policy, y era `ALL` con sólo membresía.
Cualquier vendedor podía crear una promoción, y **una promoción es un precio**.
Lo raro no era que faltara: `quantity_discounts` hace lo mismo y exige rol desde
el día uno, y `/promociones` ya era `SOLO_ADMIN` en el manifest.

⚠️ **La lectura no se tocó, y ahí estaba la trampa.** El POS lee `promotions`
para cobrar. Apretar la policy `ALL` entera le sacaba la lectura al vendedor
—justo quien atiende el mostrador— y el POS habría cobrado **sin la promoción**,
en silencio y a favor del comercio. Va partida en dos: SELECT para miembros,
escritura para el rol. Al cerrar una policy `ALL`, preguntar siempre quién
necesita leer eso.

⚠️ **Tres cosas que sólo aparecieron midiendo, y valen más que el arreglo:**

1. **El escaneo de texto miente en las dos direcciones.** Marcaba
   `record_stock_movement` y `ledger_contraasentar` como desprotegidas —no son
   alcanzables: `authenticated` no tiene `EXECUTE`— y `save_afip_config`, que sí
   exige owner/admin. Hay que mirar privilegios y leer el cuerpo.
2. **La primera prueba dio un falso negativo.** Asignaba el retorno a un `uuid`
   y el error de tipo caía en el mismo `EXCEPTION WHEN OTHERS`, así que el
   resultado fue "no pasó" y se habría cerrado como correcto. El **mensaje** del
   error es parte de la prueba: `payments.edit` también se frena hoy, pero por
   «conectá tu cuenta de MercadoPago», que es una precondición de negocio y no
   una autorización.
3. **La mitad que verifica que el admin SÍ puede no es decorativa.** Una guarda
   que frena a todos deja la vista igual de vacía y pasa el mismo test.

**Tercera pasada fiscal (2026-08-28):** el caso que parecía «más estricto que la
matriz» ocultaba un bypass distinto. `save_afip_config` ahora separa membresía
de `invoices.edit` y audita el cambio sin TA/certificado/clave. Más grave:
`afip_marcar_delegacion` conservaba `EXECUTE` para `anon` y su condición sólo
rechazaba cuando `auth.uid()` no era NULL; anon podía autodeclarar una
delegación como verificada. La función quedó exclusiva de `service_role`, con
guarda interna y sin contrato público para estadísticas fiscales. Fixture real:
vendedor deny/allow, cross-tenant, anon/service, auditoría y 0 restos.

**Cuarta pasada, grants internos (2026-08-28):** la auditoría de ACL real mostró
que `REVOKE ... FROM PUBLIC` no había borrado grants explícitos a `anon`.
Seis funciones documentadas como internas seguían alcanzables: lectura y
resultado de cambios de precio, consumo de IA y registro/reconciliación/poda de
telemetría. `20260828000160` las limita a `service_role` y dueño de DB tanto por
ACL como dentro del cuerpo. También retira de anon tres helpers de roles y el
cálculo de precio que mantenía roja `audit_costo_expuesto`. Fixture real:
seis ataques rechazados, service role operativo, guarda de costo en 0 y 0 restos.

### Un archivo de test estuvo sin correr y el conteo no bajó (2026-08-27)

`sinSimulacion.test.ts` leía `src/pages/AIChatAdvancedPage.tsx` en el cuerpo del
módulo. La página se fusionó en Inteligencia (`ed859f8`), el `readFileSync`
empezó a tirar ENOENT **al importar**, y sus 10 tests dejaron de correr — los que
vigilan que el chat de IA no fabrique el conteo de tokens.

📌 **Lo que lo hizo invisible: un archivo que no carga no baja el número de
tests pasados.** Baja el de archivos, que es la línea de arriba. El total siguió
subiendo y se citó como puerta verde.

Ahora el chat se busca **por lo que hace** y no por dónde está, exigiendo
exactamente una coincidencia; y `losTestsLeenArchivosQueExisten.test.ts` falla si
un test vuelve a nombrar una ruta que no existe.

### Doce páginas duplicadas dejaron de existir (2026-08-27)

El diagnóstico externo era correcto: había clusters de páginas compitiendo
por la misma tarea. Se eliminaron **12** en cinco slices, cada uno con puerta
completa y push propio:

| Cluster | Eliminadas | Ahora |
|---|---|---|
| CRM | `AdvancedCRMPage`, `CustomerRFMPage`, `FollowUpPage` | vistas de `/clientes` (Pipeline, Segmentos, Seguimientos) |
| Marketing | `SocialPlannerPage` | tab Planner de `/marketing` — desde MKT-001 mostraba la MISMA tabla que Publicaciones |
| Inventario | `AutoRestockPage`, `InventoryForecastPage`, `SmartInventoryPage` | vistas de `/planificacion` |
| Analytics | `KPIDashboardPage`, `BIReportsPage`, `SalesForecastPage` (+ el viejo `AnalyticsPage` pasó a vista Resumen) | vistas de `/analytics` |
| IA | `AIInsightsPage`, `AIChatAdvancedPage` | vistas de `/ia` (Hallazgos, Asistente) |

El mecanismo es siempre el mismo: la ruta vieja queda como **alias con
`?vista=`** en el manifest (el redirect preserva la intención, no sólo el
destino), el contenido se mueve **idéntico** a `components/<dominio>/` con
`lazy()` por vista, la jerga vieja pasa a keywords de la canónica (el
buscador sigue llegando), y el **piso del manifest baja con el porqué escrito
en el test**: 71 → 61 rutas canónicas. Bajar el piso exige que la borrada
haya quedado como alias — lo garantizan las guardas de aliases.

Los 12 enlaces internos que apuntaban a rutas viejas (Dashboard, Calendario,
FocoDelDia, widgets) se reescribieron a la canónica: un alias es para el
bookmark de un usuario, no para que la app se hable a sí misma con jerga
retirada. ⚠️ `pageGuides` se indexa por `pathname` — su clave NO puede llevar
`?vista=`, y por eso quedó fuera del reemplazo genérico.

**Los gates por rol no se pierden: se mudan.** `/rfm` y `/crm-avanzado` eran
SOLO_ADMIN y `/clientes` es AMBOS — Pipeline y Segmentos se montan sólo con
`isAdmin` dentro de la página.

📌 **Lo que se decidió NO hacer, y por qué:**

- **Mover ≠ reescribir** — y verlas juntas hizo su trabajo: ~~los tres motores
  de inventario siguen calculando cada uno lo suyo~~ **Reposición migró al
  motor el 2026-08-27** (INV-001), y conectarla destapó que
  `run_abc_analysis` no refrescaba `period_days` y que Análisis leía
  `inventory_abc` sin filtrar la fecha. Proyección sigue con su propio
  cálculo: es otra tarea (curvas futuras, no punto de pedido).
  ⚠️ **ANA-001 se midió antes de construirlo, y el diagnóstico ya no aplica:**
  después de que el ledger recibiera las operaciones, la serie mensual de
  Analytics coincide **peso por peso** con la del ledger (abril 16.784 /
  37.265; mayo 26.910 / 61.586). Unificar las métricas en un registro
  sería consistencia arquitectónica, no corrección — y este repo no construye
  por prolijidad antes de lanzar. Lo que sí se hizo es la guarda:
  `audit_resultado_divergente` tiene que estar **vacía**, y una fila significa
  que el P&L, Analytics y Reportes volvieron a mostrar números distintos para
  el mismo mes.
- **`ReportsPage` (4.386 líneas) no se tocó**: sus números ya coinciden con
  el ledger. Reducirla a exportaciones es un slice propio.
- **Admin y Equipo NO son duplicados** — se midió antes de fusionar: el tab
  «Equipo» de Admin es rendimiento de vendedores (lectura), TeamPage es
  gestión de miembros e invitaciones (escritura). Tareas distintas. De paso
  se verificó que el `from("profiles").select("*")` sin filtro de Admin no
  fuga: la RLS de `profiles` acota a compañeros de organización.
- ~~**La vista Segmentos hereda su deuda declarada**: agrupa ventas por
  nombre.~~ **Cerrado el 2026-08-27**: agrupa por `customer_id`, con fallback
  al nombre normalizado para las ventas sin enlazar y grupo propio para los
  homónimos. Era la última excepción viva a «ya no queda nada del CRM cruzando
  por nombre».

### El resultado financiero tenía cuatro calculadoras (2026-08-26)

`PLDashboardPage`, `ReportsPage`, `AnalyticsPage` y `ledger_resultado`
calculaban el resultado cada uno por su lado. No era sólo duplicación: **dos
estaban mal en pantalla** —el P&L mostraba margen bruto 100% (COGS 0 con
$616.784 vendidos en abril) y Analytics exportaba "COGS (ARS)" con las
compras del mes, que con 0 compras daba cero.

⚠️ **El plan de consolidación proponía «todos los estados salen del ledger» —
y el ledger estaba en 0 filas.** Ejecutarlo tal cual habría puesto el P&L en
cero: un número solo, confiable de aspecto, y equivocado. El orden real fue:

1. **El costo primero** (`20260826000250`): backfill de `cost_of_goods_ars`
   desde `total_ars − profit_ars` — costo histórico congelado, **no**
   `cost_usd × cotización de hoy`, que daba 8% de más y reescribía la
   historia. Tipo de cambio implícito medido: 1470–1490, coherente con
   abril–junio.
2. **El ledger recibe las operaciones** (`000260`–`000300`): asiento de
   venta, gasto y cobranza, con triggers (`trg_sale_ledger`,
   `trg_expense_ledger`, `trg_debt_ledger`). La cobranza cuelga del **delta
   de `debts.paid_ars`**, no de `debt_payments`: esa tabla tiene 0 filas con
   3 deudas pagadas, porque dos botones de `DebtsPage` marcan pagada la
   deuda sin crear el pago.
3. **Conciliar antes de cambiar lectores** (`000270`): ventas $1.143.696 =
   $1.143.696, costo $798.851 = $798.851, gastos $21.560 = $21.560, 0
   descuadrados, Deudores neteado a $0. La migración **falla** si no cierra.
4. **Recién ahí, los lectores**: el P&L lee `ledger_resultado_mensual` (el
   RPC canónico de serie mensual, `000280`) y Analytics calcula el COGS como
   `revenue − profit`, que es el número del ledger.

📌 `ReportsPage` no se tocó: sus números salen de `profit_ars` y coinciden
con el ledger — duplicado pero correcto. Migrarlo es ANA-002, no un bug.
`CashFlowPage` conserva sus proyecciones, que son suyas. El asiento de
**compras** queda escrito pero sin correr: hay 0 compras. Y el asiento de
venta **corta con error** si el emisor no es monotributo: separar IVA débito
no está implementado, y asentar el ingreso inflado sería peor que fallar.

### El contenido social tenía dos autoridades (2026-08-26)

`MarketingPage` escribía en `marketing_posts` —vía `supabaseStore.ts`— y
`SocialPlannerPage` en `social_posts`. Cerrado en `20260826000220`:
`social_posts` es la única autoridad y la otra queda deprecada, no borrada.

⚠️ **El análisis que originó este trabajo acertó el diagnóstico y erró la
premisa.** Dice que `social_posts` es más completo «y por eso» debe ser la
autoridad; es cierto en casi todo pero **no estrictamente**. Hubo que mirar las
tres columnas que sólo tenía la otra:

| columna | veredicto |
|---|---|
| `product_ids` | no lo usa nadie — los que se usan son de combos y promociones |
| `user_id` | sobra: la publicación es del comercio, no de la persona |
| `ai_generated` | **sí se usa** — KPI «Con IA» y badge de cada publicación |

Migrar sin mirar habría perdido la marca de contenido generado con IA.

La traducción entre las dos formas —`image_url` ↔ `media_urls[]`,
`scheduled_at` ↔ `scheduled_for`— vive en el store, no en las pantallas: si
cada una la conociera, volvería a haber dos verdades sobre la misma fila.

### 15 selects pedían columnas que no existen (2026-08-26)

Encontrado abriendo la ficha del cliente **en producción con una sesión real**.
La tab de Presupuestos pedía `quotes.total_ars`; esa columna se llama `total`.
PostgREST devolvía 400, el `catch` lo tapaba con un toast sin loguear, y la tab
**nunca cargó, para ningún cliente**. Compilaba, pasaba el lint y pasaba los
1.655 tests que había ese día (2026-08-26).

Al buscar el resto aparecieron **15 en 8 archivos**, todas confirmadas contra la
base (0 falsos positivos sobre 220 selects revisados):

| archivo | columna | qué rompía |
|---|---|---|
| `LibroPage` | `wallet_movimientos.saldo` | el saldo del libro mayor decía siempre «Sin movimientos» |
| `SellerCommissionsPage` | `profiles.email` | **todos** los vendedores sin nombre |
| `AnalyticsPage` | `quotes.total_ars` | el mismo bug, segunda copia |
| `PredictiveAnalyticsTab` | 6 columnas | la pestaña de IA predictiva entera |
| `IntegrationsPage` | `payment_connection_status.connected` | el estado de MercadoPago |
| `ProveedoresPage` | `purchases.supplier_name` | el nombre del proveedor |
| `InventoryValuationPage` | `purchases.exchange_rate_used` | la valuación de inventario |
| `AIChatAssistantTab` | `expenses.payment_method`, `purchases.notes` | contexto del chat |

`LibroPage` pasó a usar el RPC `wallet_saldo` —la misma autoridad que
`WalletPage`— en vez de una columna inventada: dos pantallas con el mismo número
desde fuentes distintas es exactamente cómo se llega a dos verdades.

La guarda es `columnasQueExisten.test.ts`, que compara cada `select` contra el
esquema real de `types.ts`. Se verificó que atrapa el caso original:
reintroducido, falla con `expected [ 'quotes.total_ars' ] to deeply equal []`.

⚠️ **Lo que esto dice del método.** Ninguna de las 15 era detectable sin abrir
la pantalla: el `catch` que hace sólo `toast.error` sin `console.error` las
volvía invisibles. Verificar en navegador con sesión no es un lujo — es la única
forma de encontrar esta clase.

### 9 clientes de prueba quedaron sin limpiar (2026-08-26)

La verificación de `20260826000210` los encontró de casualidad: su aserción de
restos contaba `LIKE 'ZZ %'` y devolvió **9**, ninguno creado por ella.

| creado | nombre | ventas | deudas |
|---|---|---|---|
| 2026-07-31 | ZZ Circuito Test | 0 | 0 |
| 2026-08-11 | ZZ Devolucion, ZZ Arrepentido | 0 | 0 |
| 2026-08-19 | ZZ Ledger | 0 | 0 |
| 2026-08-20 | ZZ Comprador, ZZ Dos, ZZ FALLA, ZZ Uno | 0 | 0 |
| 2026-08-26 | ZZ Comprador | 0 | 0 |

Son restos de bloques de verificación de sesiones anteriores que no borraron lo
que crearon — exactamente lo que la regla de la casa exige que dé 0.

⚠️ **No es sólo prolijidad.** `docs/CAPACIDADES.md` reporta «34 clientes» como
señal de adopción real. Nueve de esos 34 son de prueba, así que **los reales
son 25**: cualquier métrica construida sobre `customers` está inflada un 26%.

No se borraron acá porque es un borrado de filas reales de la base del dueño, y
porque hacerlo dentro de una migración de esquema mezcla dos cosas que deben
poder revertirse por separado. Los nueve tienen 0 ventas y 0 deudas, así que
borrarlos no arrastra nada.

> **Borrados el 2026-08-27** en `20260827000130`, una migración que **no toca
> esquema** — que era la condición que faltaba. Quedan **25 clientes reales**.
>
> ⚠️ Lo que NO se borró, aunque empiece con `ZZ`: el producto «ZZ NO COMPRAR -
> Prueba de pago» y sus dos ventas de $1. El prefijo engaña — no son basura de
> verificación, son **la evidencia de que el cobro real funcionó**, con su
> `application_fee` informado por MercadoPago. Un borrado por prefijo se las
> habría llevado.
>
> La guarda exige que el cliente no tenga nada colgando —ventas, deudas,
> presupuestos, comunicaciones, puntos ni oportunidades— y la verificación
> comprueba las dos mitades: que no queden de prueba **y** que los reales
> sigan, más que la guarda frena de verdad a un cliente con deuda.

### Por qué el ledger todavía no puede ser la autoridad del P&L (2026-08-26)

El bloque «Finanzas canónicas» pide que todos los estados reales salgan del
ledger. Medido antes de moverlo: `ledger_entries` tiene **0 asientos** contra
**34 ventas por $1.143.696**. Hacerlo autoridad hoy mostraría $0 de ingresos.

**El cableado no está roto.** Se probó entero con una venta `ZZ` en una
transacción revertida: venta → `sale_transactions` → evento `venta.registrada`
→ outbox → asiento cuadrado. Las 4 suscripciones están activas y los 2 triggers
emiten. El libro está vacío porque **las ventas son de abril a julio y el motor
de eventos es del 19 de agosto**: nunca pasó tráfico. La misma causa explica
las 0 facturas emitidas, porque `facturar_orden_pagada` cuelga del mismo
evento.

Lo que falta no es código, y no es una sola cosa:

1. ~~El asiento se fechaba con `CURRENT_DATE`~~ **arreglado el 2026-08-26**
   (`20260826000200`): un reintento del outbox fechaba la venta al día
   siguiente, y hacía imposible cualquier backfill.
2. **Las 34 ventas tienen `cost_of_goods_ars` en cero.** Backfillear así
   escribiría **100% de margen** sobre $1.143.696 en un libro inmutable — peor
   que dejarlo vacío.
3. **El costo real es recuperable con exactitud**, y de paso muestra que dentro
   de la misma fila hay dos costos que se contradicen: 32 de 34 tienen
   `cost_per_unit_usd` y las 34 tienen `profit_ars`. La reconciliación cierra
   **al peso en 34 de 34** con el tipo de cambio implícito de cada venta
   (`profit_ars / profit_usd`, entre 1.470 y 1.600).

   | facturado | costo recuperable | ganancia | margen |
   |---|---|---|---|
   | $1.143.696 | $798.851 | $344.845 | **30,2%** |

La secuencia correcta es reparar el costo, backfillear y recién después mover
la autoridad. Los dos primeros pasos escriben historia contable real y el libro
sólo se corrige contraasentando, así que van con decisión del dueño.

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

### Capability kernel — piloto cerrado el 2026-08-28

Una capability no es un permiso, un plan ni un feature flag. Es la composición
versionada que decide si una parte del Business Core está operativa para esa
organización y esa persona:

```text
catálogo activo
AND activación de la organización
AND producto contratado
AND dependencias listas
AND rollout habilitado
AND usuario autorizado
AND sin conflicto operativo
```

`capability_evaluate` es la única autoridad de esa composición. La UI usa un
wrapper que fija `auth.uid()`; los comandos (`product_surface_access` y
`finance_document_can`) delegan al mismo contrato; los workers de inspección y
extracción usan el wrapper exclusivo de `service_role`. Las tablas crudas no se
exponen al navegador.

Las cuatro primeras capabilities son `catalog.products`, `inventory.core`,
`commerce.store` y `finance.documents`. El grafo impide ciclos, la tienda activa
su capability al crearse y desactivar sólo cambia control: no borra productos,
documentos ni historia. P1-03 ya produce las capabilities base desde un
Blueprint idempotente generado por el Business Profiler; las activaciones
comerciales o de rollout siguen fuera del perfil y no se pueden autoaprobar.

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
| **C — Ventaja** | ¿Nerqia cambia una decisión y crea valor? | Margen por canal usado, acción aplicada y resultado medido. | F2 |
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
- E2E críticos como puerta bloqueante de CI: 32 recorridos públicos y 10 de
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
hitos, Business Profiler + Blueprint recuperable, importación reconciliada y
cohortes con costo de acompañamiento ya están instrumentados. Falta la prueba
externa con segundo y tercer comercio.

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
  sola transacción. Servicios y gastronomía elevaron el total a nueve perfiles
  sin prometer agenda/contratos que el Core aún no tiene. La base sigue en 0
  organizaciones configuradas: falta uso externo, no más infraestructura
  vertical.
- ~~Blueprint revisable y provisioning recuperable.~~ **Entregado
  2026-08-28:** preview/diff/hash, run idempotente y checklist coordinan perfil,
  settings, 60+ permisos, capabilities base, ubicación principal y pipeline de
  seis etapas. Una falla revierte el dominio completo pero deja diagnóstico y
  retry; el replay no duplica. Producción sigue en 0 runs reales.
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
  muestra los ocho hitos y asigna el próximo bloqueo al comercio, a Nerqia o
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

**Objetivo:** probar el diferencial central de Nerqia.

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
Nerqia y el resultado posterior queda medido contra una línea de base.

**Métricas:** cobertura de margen explicable, decisiones aplicadas, margen
protegido/creado verificable y tiempo entre hallazgo y acción.

### F3 — Nerqia Finance MVP

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
- ~~MIME, tamaño, malware/cuarentena y hash SHA-256.~~ **Autoridad técnica
  cerrada 2026-08-22:** `inspect-finance-document` descarga el original privado,
  recalcula SHA-256/tamaño/magic bytes, bloquea acciones activas de PDF y un RPC
  service-only deriva listo/diferido/cuarentena. El scanner privado externo aún
  no está configurado; sin resultado `clean` no existe bypass a extracción.
- ~~Extracción estructurada mediante proveedor intercambiable.~~ **Gate técnico
  cerrado 2026-08-22:** ids desde el navegador, original privado descargado en
  servidor, hash revalidado y tool call bajo JSON Schema; flag y modelo ausentes
  mantienen deshabilitada toda transferencia externa hasta aprobar privacidad y
  benchmark.
- ~~Confianza por campo, validación matemática, fiscal y de esquema.~~
  **Autoridad técnica cerrada 2026-08-22:** normalización sin ceros inventados,
  validadores espejados en base y confianza limitada a 0,69 ante cualquier
  error; desde 0,85 sin errores queda lista para revisión.
- ~~Detección de duplicados.~~ **Cerrada técnicamente:** compara hash real sólo
  dentro del tenant y deriva `duplicate` antes de OCR.
- ~~Matching determinístico de proveedor y producto.~~ **Entregado 2026-08-22:**
  sólo propone CUIT/nombre, SKU y descripción por alias confirmado o identidad
  exacta; 0 candidatos queda `none` y más de uno `ambiguous`, sin fuzzy match
  convertido en autoridad.
- ~~Supplier product aliases aprendidos mediante confirmación.~~ **Entregado
  2026-08-22:** proveedor y líneas se confirman por RPC tenant-safe; el
  vocabulario externo se aprende sin reasignaciones silenciosas y la factura
  siguiente reutiliza CUIT/SKU.
- ~~Purchase Draft, Supplier Invoice Draft y Payable Draft.~~ **Entregado
  2026-08-22:** snapshots separados, líneas inventario/no inventariable,
  vencimiento y tipo de cambio; aprobación owner/admin materializa una orden
  `confirmed` y una deuda idempotentes. `purchases`, stock y ledger esperan la
  recepción real. El resultado aprobado enlaza a esa OC, restablece la vista de
  órdenes y abre el diálogo de recepción sólo si la fila ya fue cargada bajo la
  organización activa y su estado es recibible; el ingreso físico sigue pasando
  exclusivamente por `receive_purchase_order_idem`.
- ~~Revisión humana versionada y audit log.~~ **Cerrada técnicamente:** el
  editor crea una revisión append-only con actor/nota/evento y declara cero
  efectos sobre compra, deuda, stock o ledger. Matching y borradores consumen
  esa revisión sin reescribirla; una factura aprobada queda inmutable.
- AI Gateway mínimo para costo, versión, trazas y apagado.

**No incluye:** pagos autónomos, contabilidad completa, conciliación masiva ni
actualización automática de precios.

**Entregado 2026-08-22, límite de producto:** el owner/admin puede solicitar
Finance, pero no autoaprobarlo; sólo staff `finance`/`superadmin` decide desde
Merchant 360 y cada transición queda tanto en eventos append-only como en la
auditoría de plataforma. La base real tiene 4 Business habilitados y 4 Finance
disponibles, con 0 solicitudes/habilitaciones: existe el producto técnico, no su
adopción. Odoo/QuickBooks confirman que OCR, review y matching son paridad;
Mendel/Clara/Rindegastos muestran que el producto regional maduro también
controla política, presupuesto, rol y excepción. F3 ya cerró la cadena técnica
hasta orden/deuda; no se ensancha a F5 sin facturas autorizadas, proveedor
privado y evidencia de recepción/adopción.

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
  preview → approve → import → reconcile. El primer contrato debe cubrir las
  exportaciones y semánticas verificadas de Tiendanube y Empretienda sin
  inferir campos que el origen no entregue.
- Conectores priorizados por demanda real; Mercado Libre/Mercado Pago se tratan
  como canal e infraestructura del Core, no como inventarios paralelos.
- Funnel y Core Web Vitals instrumentados.

**Salida:** una tienda externa migra productos, variantes, categorías, imágenes,
clientes, SEO y órdenes acordadas, conecta dominio y vende sin cortar la
operación.

**Métricas:** tiempo a migrar, registros reconciliados, redirects correctos,
rendimiento, conversión y errores de checkout.

**Estado slice 20, 2026-09-03 — base técnica parcial.**
`ecommerce_cart_sessions` ya es la sesión canónica de composición: guarda
referencias saneadas por `resolve_store_line`, admite capacidad anónima, se
vincula a la ficha `store_customers` de la tienda y consolida dispositivo más
cuenta sin sumar cantidades accidentalmente. La UI hidrata antes de escribir,
reconstruye precio/stock/variantes contra el catálogo vigente y declara si sólo
pudo guardar localmente. `create_store_order_from_cart_idem` delega en el
checkout idempotente existente y enlaza/convierte el carrito dentro de la misma
transacción; no existe un segundo cálculo de orden ni un segundo stock. Falta
certificar dos dispositivos con un comprador de prueba y completar las máquinas
de estados independientes de cart/order/payment/fulfillment antes de cerrar F4.

### F5 — Nerqia Finance Mendel-class

**Objetivo:** pasar de capturar documentos a una plataforma comparable con
Mendel para controlar gasto por excepción, conectada nativamente al Business
Graph de Nerqia.

**Entregables**

- Three-way match: purchase order, recepción y factura.
- Inicio Finance con gasto en tiempo real, presupuesto disponible/comprometido/
  consumido, solicitudes, aprobaciones, comprobantes faltantes y excepciones
  accionables.
- Expense Management con tarjetas propias o externas, transferencias, efectivo,
  gastos, reembolsos, anticipos/fondos y centros de costo/proyectos dentro de un
  mismo modelo y ledger.
- Políticas versionadas y presupuestos preventivos por monto, categoría,
  comercio, ubicación, horario, frecuencia, persona/equipo, centro de costo,
  proyecto y periodo; evaluación server-side explicable antes del gasto.
- Captura mobile/offline y WhatsApp/email con deduplicación, consentimiento y
  la misma cadena de custodia del Document Inbox.
- Approval Engine reusable con niveles, delegación, SLA, sustitución y
  segregación entre solicitante, aprobador, contador y pago.
- Cola de fuera de política/anomalías con causa, dueño, vencimiento, evidencia
  y resolución auditable.
- AP Calendar y aging.
- Conciliación asistida.
- Audit Agent bajo herramientas autorizadas.
- Cost Intelligence por proveedor/producto.
- Email y WhatsApp ingestion.
- Supplier Portal.
- Finance Connect para un ERP externo mediante contrato estable, exportación
  idempotente, estado de sincronización y conciliación.
- Medios de pago como abstracción de emisor: importar transacciones de tarjetas
  corporativas externas primero; habilitar emisión física/virtual y controles
  de autorización en tiempo real sólo mediante el gate regulado.

**Límite competitivo:** la paridad con Mendel incluye el trabajo completo de
controlar gasto, aunque la primera etapa sea software-first y opere medios
externos. Emisión de tarjetas, custodia, movimiento de fondos o viajes requieren
demanda real, socio regulado, economics, riesgo, soporte y revisión legal antes
de entrar a una fase. No se simula una capacidad regulada con UI.

**Salida:** un piloto completa solicitud/presupuesto/política/aprobación/gasto/
evidencia/conciliación/exportación; la mayoría definida sólo necesita
intervención en excepciones y cada automatización puede auditarse, explicarse y
revertirse.

**Métricas:** straight-through processing, exception rate, aprobación,
conciliación, AP aging, anomalías confirmadas y horas evitadas verificables.

### Innovación transversal — Nerqia Orbit / Playbooks

**Objetivo:** convertir señales correlacionadas del Business Graph en decisiones
repetibles que se puedan simular, aprobar, ejecutar y medir a través de
Business, Commerce, Finance, Platform e Intelligence. Orbit no es Mendel ni un
clon de un automatizador: su diferencial es explicar el contexto económico y
operativo completo y delegar cada efecto al dominio que tiene la autoridad.

**Estado:** discovery cerrado el 2026-08-29; implementación congelada hasta que
F0/F1, F2 y la evidencia real de F3 habiliten un piloto. Contrato completo en
[`docs/INNOVATION_ORBIT_PLAYBOOKS.md`](docs/INNOVATION_ORBIT_PLAYBOOKS.md).

**Orden autorizado cuando abra el gate:**

1. señales read-only con fuente, frescura, severidad, supresión y drill-down;
2. `Impact Preview` contra población sintética/histórica sin escribir;
3. acciones seguras: notificar, preparar borrador y solicitar aprobación;
4. acciones reversibles y conectores con retries, DLQ, replay y health;
5. IA asistida para proponer playbooks, sin autoeditar políticas ni saltar
   permisos.

**No incluye:** otro stock, ledger, proveedor, cliente, precio, documento,
workflow de pago o permisos implícitos. No agrega un canvas o runtime durable
hasta que un benchmark pruebe que mejoran tiempo de tarea y confiabilidad.

**Salida:** un piloto con tres playbooks de dominios distintos reduce tiempo a
resolución y alert fatigue, conserva `AI Action Rate` cuando interviene IA,
permite pausar/reintentar y demuestra outcome económico/operativo con datos
autorizados.

### F6 — Commerce diferencial

**Objetivo:** superar paridad funcional con razones concretas para elegir
Nerqia.

**Entregables**

- Multi-store y multi-brand.
- B2B: empresas, compradores, catálogo, listas, crédito y aprobación.
- Markets, moneda, idioma y política de inventario cuando haya demanda.
- Theme SDK y Page Builder versionado.
- SearchProvider intercambiable.
- Personalización y recomendaciones basadas en margen.
- Store Builder asistido por IA con cambios revisables.
- Experimentación sólo con tráfico y poder estadístico.

**Salida:** merchants eligen Nerqia por una ventaja de operación/margen, no
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

**Salida:** Nerqia genera margen neto verificable en pagos y/o envíos sin
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

### Matriz canónica del backlog de auditoría

El backlog del 2026-08-24 conserva el diagnóstico, criterios de aceptación y
evidencia de cada hallazgo. Desde el 2026-08-29 **no define prioridad ni estado
por separado**: sus 41 IDs están absorbidos acá. Si una etiqueta del documento
de auditoría contradice esta matriz, manda esta matriz y el gate de fase. Esto
evita llamar “completo” a un fixture técnico cuando todavía falta la prueba que
importa a producto o inversión.

Leyenda: **cerrado** = criterio técnico y resultado demostrados; **técnico** =
implementación probada, outcome externo pendiente; **parcial** = quedan
contratos técnicos; **externo** = requiere dueño/proveedor/operación real;
**congelado** = no se autoriza antes de su gate.

| Auditoría | Absorbido en | Estado canónico 2026-08-29 | Evidencia que todavía falta |
|---|---|---|---|
| P0-01 | F0 · contratos/DoD | **Cerrado** | Mantener conteos, migraciones y documentación fechados. |
| P0-02 | F0 · slice 1 | **Técnico + externo** | Primer CAE productivo reconciliado. |
| P0-03 | F0 · slice 3 | **Técnico + externo** | Conteo físico y segundo conteo de control. |
| P0-04 | F0 · slice 5 | **Técnico; live externo** | Los 16 escenarios pasan en drill; falta evidence pack contra Mercado Pago real. |
| P0-05 | F0 · infraestructura | **Externo** | Supabase/Vercel staging, secretos y cuentas sandbox separados. |
| P0-06 | F0 · slice 4 | **Parcial** | Restore integral de proyecto y repetición contractual de RTO/RPO. |
| P0-07 | F0 · slice 6 | **Parcial** | Exporter OpenTelemetry, SLO y alertas externas; correlación/P95 internos ya existen. |
| P0-08 | F0 · slice 7 | **Parcial por P0-05** | Los 46 E2E definidos bloquean; los flujos con escritura esperan staging. |
| P0-09 | F0 · slice 8 | **Técnico; decisión externa** | Costos reales, contrato y pricing aprobados; comisión sigue inactiva por defecto. |
| P0-10 | F1 · slices 9–10 | **Técnico + externo** | Segundo comercio completa primera venta/pago/factura/cierre sin SQL. |
| P1-01 | F1 · slice 10 / bitácora 39 | **Técnico** | Adopción real del Capability Catalog fuera de fixtures. |
| P1-02 | F1 · slice 10 | **Parcial** | Perfil versionado y tres negocios externos distintos; no crear presets para entidades inexistentes. |
| P1-03 | F1 · slice 10 / bitácora 40 | **Técnico** | Primer provisioning real y costo de intervención medido. |
| P1-04 | F0–F1 · bitácora 41–42/49 | **Técnico; prueba externa** | Refund ya expresa `payments.edit`; falta prueba cross-branch con dos sucursales aptas. |
| P1-05 | F1 + F4 · slices 10/22 | **Parcial** | CSV/Excel está cerrado; faltan conectores priorizados, redirects y reconciliación de migración. |
| P1-06 | F4 · slice 19 | **Pendiente** | Build/deploy/SLO del Storefront físicamente independientes. |
| P1-07 | F4 · slice 21 | **Pendiente** | Dos stores de una organización sobre el mismo Core. |
| P1-08 | F4 · slice 20 | **Parcial técnico 2026-09-03** | Sesión server-side, capacidad anónima, identidad por tienda, merge sin suma, rehidratación y orden enlazada están implementados; falta prueba real con dos dispositivos/cuenta. |
| P1-09 | F4 · slice 20 | **Parcial técnico 2026-09-03** | Cart convierte atómicamente con la orden y el checkout conserva idempotencia; faltan state machines separadas y concurrencia/partial flows de payment/fulfillment. |
| P1-10 | F4 · slice 22 | **Parcial técnico 2026-09-03** | Reclamo tenant-scoped, unicidad, challenge DNS, TLS/canonical y prevención de takeover están modelados y cableados al proveedor; falta configurar la credencial server-side y certificar un dominio externo real. |
| P1-11 | F4 · slice 22 + Design | **Parcial** | Themes existen; faltan draft/preview/publish/version/rollback y page contract. |
| P1-12 | F4 · slice 22 | **Parcial técnico 2026-09-03** | Robots, índice, JSON-LD, OG, sitemap y feed salen del borde tanto para el subdominio incluido como para el dominio propio (D5.9/D5.16). Faltan redirects, hreflang y reporte de migración. |
| P1-13 | F8 · bitácora 52 | **Cerrado técnicamente 2026-08-29** | API v1 con OpenAPI público, path obligatorio, scopes sin filtraciones, cupo durable por key, mutación atómica, precisión monetaria, política de compatibilidad/deprecation y CORS browser deshabilitado. Medir la primera key e integración reales. |
| P1-14 | F8 · bitácoras 48/50/51 | **Cerrado técnicamente 2026-08-29** | Contrato OpenAPI público, receptor HTTPS externo certificado, outbox transaccional, DLQ/replay, filtro, firma e ids estables. Mantener compatibilidad y medir primera integración real. |
| P2-01 | F2 · slices 11–12 | **Técnico** | Operación real con los cuatro costos y decisión del merchant. |
| P2-02 | F2 · slice 13 | **Técnico** | Primer `impact_event` real maduro; fixtures no prueban valor creado. |
| P2-03 | F2 · slice 13 | **Parcial** | Unificar simulación de precio/promoción/cuotas/compra/envío/mix, sin writes. |
| P2-04 | F3 · slice 16 | **Parcial** | Provider/model registry, fallback, redaction y evals; costo/cupo ya se mide. |
| P2-05 | F3 · slices 15–16 | **Externo** | Scanner, DPA, región/retención, modelo aprobado y benchmark. |
| P2-06 | F5 · slice 23 | **Congelado hasta adopción F3** | Email/WhatsApp inbound con routing, consentimiento y custodia. |
| P2-07 | F5 · slice 23 | **Congelado hasta adopción F3** | PO vs recepción vs factura, tolerancias y cola de discrepancias. |
| P2-08 | F5 · slice 23 | **Parcial/congelado** | Pagos ya concilian; falta reconciliación Finance end-to-end y piloto. |
| P2-09 | F6 · slice 24 | **Congelado hasta F4/demanda** | Contrato SearchProvider y benchmark con volumen real. |
| P2-10 | F6 · slice 24 | **Parcial/congelado** | Listas/volumen existen; faltan company/buyer/terms/credit/approval B2B. |
| P3-01 | F7 · slice 25 | **Congelado por TPV** | Segundo proveedor con failover y conciliación neutral. |
| P3-02 | F7 · slice 25 | **Congelado por volumen** | Quote/label/cancel/track y unit economics positivos. |
| P3-03 | F8 · slice 25 | **Congelado por API estable** | Identidad OAuth, scopes, install/revoke y auditoría. |
| P3-04 | F8 · slice 25 | **Congelado por demanda** | Tres integraciones externas activas antes del sandbox/portal. |
| P3-05 | F8 · slice 25 | **Congelado por escala** | 50 merchants activos y demanda repetida. |
| P3-06 | F9 | **Congelado por pipeline** | SSO/SCIM/SLA/compliance sólo ante oportunidad empresarial real. |
| P3-07 | F7 · slice 25 | **Congelado por regulación** | Partner, legal, BCRA/compliance, riesgo, capital y volumen. |

La comparación resolvió cinco contradicciones concretas:

1. P0-04 y P0-09 estaban verdes por implementación interna, pero F0 conserva
   correctamente abiertos proveedor/evidence pack y economics aprobados.
2. P1-01 y P1-03 están cerrados técnicamente, no adoptados: producción no
   convierte un fixture en segundo comercio.
3. P2-01 y P2-02 tienen autoridad y Action Loop, pero siguen sin impacto real;
   para un inversor continúan abiertos hasta demostrar valor observado.
4. P1-13 y P1-14 quedaron cerrados técnicamente como foundation de Developer
   Platform. La API y los webhooks tienen contrato y autoridad; **0 API keys
   reales** significa que adopción, OAuth de apps y marketplace siguen
   congelados hasta demanda, no que falte otro endpoint genérico.
5. Los seis “sprints inmediatos” del backlog eran la secuencia del 2026-08-24 y
   quedan sustituidos por los gates, portfolio y orden técnico de esta sección.

## 7. Portfolio de slices y bitácora de ejecución

Máximo tres epics activos; por defecto se toma un slice de producto a la vez.
Los bloqueos externos no autorizan saltar a la fase más atractiva: se avanza en
la siguiente tarea técnica que reduzca el mismo gate.

La tabla de 25 slices es el portfolio canónico. La lista numerada posterior es
la bitácora acumulativa de cortes ejecutados; su número no es una prioridad y
por eso puede crecer por encima de 25.

| # | Slice | Fase | Estado canónico 2026-08-29 | Evidencia de cierre |
|---:|---|---|---|---|
| 1 | ARCA producción | F0 | Bloqueado externamente; homologación completa | Factura productiva autorizada y reconciliada. |
| 2 | Legal publish | F0 | Bloqueado externamente | Identidad, privacidad y términos revisados/publicados. |
| 3 | Conteo físico | F0 | Bloqueado externamente | Ajustes trazables; stock y Kardex reconciliados. |
| 4 | Restore drill | F0 | **Cerrado 2026-08-21:** v3, 147 tablas / 63 filas, RTO técnico 937,22 ms, cero restos | Repetición trimestral; reconstrucción completa queda como nivel siguiente. |
| 5 | Payment test matrix | F0 | **Interna cerrada:** 16 escenarios al 2026-08-26, incluidos firma, orden fuera de secuencia, refund ambiguo/exacto, retry, reversión y conciliación; certificación live bloqueada externamente | Pago/rechazo/webhook/timeout/refund reales reconciliados sin intervención de base. |
| 6 | Correlation IDs y trazas críticas | F0 | **Cerrado para pagos 2026-08-21:** una correlación server-side une intent, attempt, metadata del proveedor, eventos, orden, settlement y ledger; timeline RLS sin PII | Matriz exige las 5 etapas y la UI reconstruye la operación desde Costos de cobro. Extender por riesgo, no como plataforma genérica. |
| 7 | E2E bloqueante | F0 | **Cerrado para los 46 recorridos definidos al 2026-08-29:** tienda desktop/móvil y panel autenticado bloquean CI. Ampliar signup/refund/ARCA/Finance con escritura depende de P0-05. | GitHub Actions exige las 5 variables, no permite skips de auth y conserva specs de sólo lectura. |
| 8 | Comisión, billing y unit economics | F0 | **En curso:** aprobación segura + workbench de merchant/platform economics, impuesto, leakage, contribución y break-even entregados el 2026-08-21. Benchmark oficial: Tiendanube 0% con Pago Nube o 2%/1%/0,7% con proveedor externo, más su arancel. La muestra real sigue siendo 1 merchant y 2 pagos de ARS 1; faltan costos medidos, contrato y decisión | Contratos, costos, margen y pricing aprobados; ninguna comisión se activa por edición accidental y el escenario aprobado conserva contribución positiva bajo estrés. |
| 9 | Segundo comercio | F1 | **Gate técnico cerrado; pendiente comercial:** alta Platform ahora es atómica/idempotente, bloquea owners vinculados y envía acceso sin revelar sesión | Primera venta sin cambios manuales de base. |
| 10 | Onboarding universal, Business Profiler, importación, cohortes y soporte consentido | F1 | **Infraestructura cerrada 2026-08-22:** alta segura, objetivo POS/online, ocho hitos server-side, 7 perfiles declarativos, onboarding atómico, importador reconciliado, cohortes maduras y diagnóstico Support con consentimiento/expiración. Sólo faltan merchants externos | Segundo y tercer merchant reciben acceso, eligen perfil, completan hitos, importan sin SQL y reciben ayuda medible sin impersonación; la cohorte produce conversión/costo sin historia falsa. |
| 11 | Margin facts canónicos | F2 | **Cerrado 2026-08-22:** 34/34 líneas visibles; cuatro componentes con fuente, asignación exacta, cobertura y RLS; Analytics y Merchant 360 consumen la autoridad | Cobertura y fuentes reconciliadas por operación. Base inicial: 0 completas y 2,9% promedio; no se reconstruyó historia inexistente. |
| 12 | Margen SKU/orden/canal/pago/promoción | F2 | **Gate técnico cerrado; evidencia real pendiente (2026-08-22):** producto × canal y operación usan hechos canónicos. Venta v3 conserva total descontado + baseline y crea partes de cobro; split parcial bloquea, conciliación real calcula neto/asiento/auditoría. Fixture: ARS 2.700, mix 1.200/1.500, fee 121, asiento balanceado, cobertura 100%, outsider/restos 0 | Registrar y conciliar una venta POS real nueva; validar que el merchant usa la explicación sin doble conteo. |
| 13 | Simulation, pricing proposal e impact outcome | F2 | **Price Action Loop técnico cerrado; Simulation Engine parcial:** aprobación server-side, baseline, reversión y outcome observado están probados. Falta un contrato único y read-only que cubra precio, promoción, cuotas, compra, envío y mix de canal. Producción: 0/25 propuestas aplicadas | Merchant simula y aplica una propuesta real; ventana madura con 100% de cobertura y decide mantener/revertir usando el resultado. |
| 14 | Finance ADR, shell y acceso por producto | F3 | **Gate técnico cerrado; evidencia real pendiente (2026-08-22):** `/finance`, chrome propio, sesión/org compartidas, entitlement ≠ permiso ≠ flag, solicitud y aprobación auditada. Snapshot prueba que no duplica el Core. Fixture owner/platform/outsider/anon y restos 0; producción 0/4 habilitadas | Un comercio solicita/recibe acceso y navega Finance con su rol real; medir solicitud → habilitación. |
| 15 | Document storage seguro, versiones e inspección | F3 | **Gate técnico cerrado 2026-08-22; scanner externo bloqueado** | Original privado, intención server-side, hash recalculado, magic bytes/tamaño, leases, cuarentena, deduplicación y auditoría. `ready_for_extraction` exige scanner privado limpio; secrets ausentes al corte. |
| 16 | Extracción estructurada y confidence | F3 | **Gate técnico cerrado 2026-08-22; proveedor/modelo bloqueados por privacidad y benchmark** | Original limpio → ids → descarga/hash privado → esquema forzado → validación/confianza → revisión append-only. Fixture con roles reales, dos revisiones, cero efectos y cero restos. |
| 17 | Supplier/product matching y alias memory | F3 | **Gate técnico cerrado 2026-08-22; evidencia real pendiente** | Primera factura exige confirmación; la segunda reutiliza CUIT/SKU. Homónimos ambiguos, retry idempotente, outsider bloqueado, cero efectos/restos. Producción: 0 runs/aliases. |
| 18 | Invoice-to-purchase/payable draft | F3 | **Gate técnico cerrado 2026-08-22; evidencia real pendiente** | Tres borradores separados; preparar deja Core en 0. Owner/admin aprueba una orden y deuda idempotentes; stock 7→7 hasta recepción, outsider/restos 0. El handoff Finance→OC valida UUID, tenant cargado y estado; abre el RPC idempotente existente y degrada a consulta si ya fue recibida/cancelada. |
| 19 | Split Storefront | F4 | Pendiente | Despliegue, SLO y fallas aislados del panel. |
| 20 | Cart y order canónicos | F4 | **Base técnica parcial 2026-09-03** | Carrito server-side por dispositivo/cuenta, merge, catálogo vigente y vínculo idempotente a orden hechos; faltan prueba real multidispositivo y estados independientes completos. |
| 21 | Store first-class | F4 | Pendiente | Una organización opera dos stores sin duplicar Core. |
| 22 | Domains + migración inicial | F4 | **Parcial técnico 2026-09-03** | Modelo, UI, Edge Function, DNS dinámico y SEO del dominio propio listos; faltan credencial server-side, certificación con un dominio externo real y migrador/redirects. |
| 23 | Finance Mendel-class piloto | F5 | Congelado hasta adopción F3 | Un piloto completa solicitud → presupuesto/política → aprobación → gasto/evidencia → conciliación/exportación; tarjetas externas primero y emisión sólo con gate regulado. |
| 24 | Commerce diferencial | F6 | Congelado hasta F4 y demanda | Una capacidad diferencial adoptada por merchants. |
| 25 | Pay/Ship + Developer gates | F7–F8 | Congelado por volumen/regulación | Margen transaccional y app externa reales. |

### Próximo trabajo autorizado por el roadmap

Mientras los slices 1–3 esperan al dueño, el orden técnico es:

1. ~~restore drill de datos~~ — cerrado el 2026-08-21;
2. ~~payment test matrix interna~~ — cerrada; certificación live espera una operación controlada;
3. ~~correlation IDs y trazas de pagos~~ — cerrado el 2026-08-21;
4. ~~E2E bloqueante~~ — cerrado para los 46 recorridos definidos al 2026-08-29 y credenciales técnicas rotadas;
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
    El follow-up de Blueprint quedó cerrado técnicamente el 2026-08-28: diff
    previo, cinco pasos, rollback, retry/replay, owner/outsider y cero restos.
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
17. ~~ADR, shell y acceso por producto de Nerqia Finance~~ — cerrado
    técnicamente el 2026-08-22: `/finance` usa sesión/organización compartidas,
    entitlement y `finance.view` independientes, decisión Platform auditada y
    snapshot agregado del mismo proveedor/compra/obligación/ledger. Producción:
    4 disponibles, 0 solicitadas, 0 habilitadas.
18. ~~Document Inbox seguro: bucket privado, original inmutable, hash
    SHA-256, MIME/tamaño, versiones y auditoría~~ — gate técnico cerrado el
    2026-08-22 con `/finance/documentos`, bucket privado, RPCs, URLs firmadas y
    cero mutación de originales.
19. ~~Inspector server-side del Document Inbox~~ — autoridad técnica cerrada el
    2026-08-22: recalcula bytes, valida SHA-256/MIME/tamaño, bloquea PDF activo,
    usa lease contra concurrencia, detecta duplicados por tenant y deriva estados
    con RPC sólo para `service_role`. Migración aplicada, Edge desplegada,
    permisos `authenticated begin=true/complete=false`, `service complete=true`
    y 0 leases remanentes. El scanner privado sigue bloqueado externamente: al
    faltar `FINANCE_DOCUMENT_SCANNER_URL/TOKEN`, la única salida es
    `scanner_unavailable`, nunca `ready_for_extraction`. Contrato y runbook en
    `docs/FINANCE_DOCUMENT_INSPECTION.md`.
20. ~~Extracción estructurada, confianza y revisión humana versionada~~ — gate
    técnico cerrado el 2026-08-22: la Edge acepta sólo ids después de inspección
    limpia, descarga el original privado, revalida el hash y exige tool call con
    esquema; la base recalcula errores/confianza y el editor crea una revisión
    append-only sin tocar compras, deudas, stock ni ledger. Fixture owner/
    service/outsider, 2 revisiones, 0 efectos y 0 restos; función activa con JWT.
    El flag y el modelo permanecen ausentes a propósito hasta aprobar DPA,
    región, retención, no-entrenamiento y benchmark de exactitud/costo. Contrato
    en `docs/FINANCE_DOCUMENT_EXTRACTION.md`.
21. ~~Continuar el sistema visual v2 sobre Platform y Settings~~ — cerrado
    técnicamente el 2026-08-22: Platform tiene topbar/rail propio con contraste
    en tema claro y oscuro; Settings usa la cabecera compartida y mantiene sus
    seis secciones persistidas. Queda Storefront, capturas desktop/mobile y la
    medición de abandono o tiempo a tarea antes de declarar la renovación visual
    validada. Cada pantalla nueva debe cumplir `docs/INTERFAZ.md`.
22. ~~Landing y Auth con dirección visual propia~~ — cerrado técnicamente el
     2026-08-22: landing product-led con preview del Business Core, navegación
     responsive, CTA de registro directo y Auth con panel de producto, login,
     registro y recuperación bajo el mismo contrato visual. Falta medir
     conversión real; la implementación no se declara validada por una captura.
23. CRM command center con patrón de tabla, señales y detalle contextual —
     cerrado técnicamente el 2026-08-22: `CustomersPage` conserva el Business
     Core y todas sus acciones, separa operación e insights con estado
     persistido y suma una lectura ejecutiva de cartera, actividad, recurrencia
     y riesgo. La referencia minimalista anterior se reemplazó por Aerten para
     densidad/jerarquía y eMarketplace Admin para color/superficies; la
     comparativa verificada vive en `docs/INTERFAZ.md`. Falta capturar la vista
     autenticada y probar el tiempo a tarea con datos reales.
24. Admin/marketplace workspace transversal — cerrado técnicamente el
    2026-08-22 en Productos, Ventas y Dashboard: `WorkspaceViewTabs` aplica la misma
    navegación compacta, densidad, estados y persistencia por organización a
    Catálogo/Operación, Ventas/Rendimiento y seis vistas ejecutivas sin separar
    el Business Core. El
    siguiente gate es capturar todas las superficies autenticadas y medir tarea
    completa en un comercio real.
    La ejecución visual detallada se trasladó a `DESIGNROADMAP.md`; D2.2 cerró
    el 2026-08-22 retirando 20 selects nativos de las 12 páginas que aún los
    usaban. D2.3 sumó 10 migraciones en 6 componentes internos: páginas y
    componentes del SaaS quedan en cero; Storefront conserva sólo 4 excepciones
    mobile/autofill enumeradas y una guarda recursiva impide ampliar la deuda.
25. Recuperación atómica entre deploys PWA — cerrado técnicamente el
    2026-08-22 después del incidente de chunks obsoletos: la salida ahora es
    común a Vite, promesas rechazadas y React; desregistra el worker, limpia
    caches y limita sólo los loops de 15 segundos. Vercel deja de devolver el
    HTML del SPA para `/assets/*` inexistentes. Falta el gate operativo de dos
    deploys seguidos con una pestaña autenticada abierta; un build aislado no
    reproduce la carrera entre dos versiones.
26. ~~CORS de acciones Platform sobre el dominio productivo~~ — incidente
    cerrado el 2026-08-22: `platform-admin-action` sólo admitía el dominio futuro
    inexistente y respondía el POST sin headers CORS, por lo que Merchant 360 no
    podía leer ni aprobar Finance desde Vercel. Preflight y respuesta real ahora
    reflejan únicamente orígenes exactos permitidos, producción/localhost están
    declarados, orígenes desconocidos reciben 403 y dominios futuros entran por
    `PLATFORM_ALLOWED_ORIGINS`; guarda dedicada impide volver al wildcard o al
    fallback incorrecto.
27. ~~Estándar integral de producto y experiencia competitiva~~ — línea de base
    cerrada y ampliada el 2026-08-22: 17 referencias oficiales —7 globales de
    operación, 4 de Finance/spend regional y 6 del ecosistema argentino— más 4
    Figma observados. El lineamiento separa evidencia/observación/decisión/
    hipótesis; define anatomía, 12 arquetipos, overlays, filtros/vistas/
    segmentos/cohortes/colas, tablas/bulk, 12 estados, responsive, WCAG,
    performance, cobertura mínima por producto y una puerta 80/100 antes de
    adoptar tecnología. Una guarda en CI exige que ROADMAP, DESIGNROADMAP,
    INTERFAZ y AGENTS sigan apuntando al estándar. D2.5 ya tiene contrato y
    adopciones en Finance/Compras, Reportes/Intelligence y Dashboard; sigue su expansión por
    riesgo. D2.6 ya
    cerró el inventario/migración de overlays de Gestión bajo guarda CI. El handoff F3 a la recepción ya quedó
    conectado y la evidencia end-to-end restante es externa, sin saltar a
    automatización F5.
28. ~~Mapa competitivo regional para Finance y comercio argentino~~ — cerrado
    documentalmente el 2026-08-22 con fuentes oficiales de Mendel, Clara,
    Rindegastos, SAP Concur Argentina, Tiendanube, Empretienda, Contabilium,
    Xubio, Colppy y Mercado Libre/Mercado Pago. Mendel queda como benchmark
    principal de Finance y el resto contrasta brechas específicas. La
    consecuencia no es agregar diez módulos: F3 conserva borradores conectados
    al Core ya entregados; F5 explicita control preventivo, políticas,
    presupuestos, aprobaciones, centros de costo, gasto multimedio, reembolsos,
    captura mobile, conciliación/ERP y cola de excepciones; F4 prioriza migración
    compatible con Tiendanube/Empretienda. Tarjetas, custodia y viajes tienen
    gates explícitos de demanda, partner regulado, economics y revisión legal.
    La guarda CI impide borrar estas referencias o volver a reducir Finance a
    OCR y Commerce a “tener tienda/POS”.
29. ~~Matching determinístico y memoria de aliases Finance~~ — gate técnico
    cerrado el 2026-08-22: cuatro tablas con RLS/ACL, propuesta por revisión,
    confirmación humana y RPC idempotentes. El fixture real hizo que una primera
    factura aprendiera nombre/CUIT y SKU/descripción de proveedor; la siguiente
    resolvió `tax_alias` + `supplier_sku_alias`, dos homónimos quedaron
    `ambiguous`, outsider bloqueado y compras/deuda/stock/ledger/restos en 0. La
    UI muestra método, candidato, selección canónica y efecto prohibido. La base
    productiva quedó en 0 runs/aliases: arquitectura probada, adopción pendiente.
    El gate siguiente dejó de ser otra tabla: facturas autorizadas deben probar
    la cadena completa y la recepción debe conservar la autoridad única de stock.
30. ~~Invoice-to-purchase/payable drafts Finance~~ — gate técnico cerrado el
    2026-08-22: cuatro tablas de preparación con RLS/ACL, identidad única por
    proveedor+número, regeneración desde la última revisión y aprobación
    owner/admin. El fixture clasificó producto+flete, creó una sola OC confirmada
    y una sola deuda aun con retry, mantuvo `purchases`/Kardex/ledger en 0, stock
    7→7, bloqueó outsider y limpió todos los restos. La UI muestra los tres
    borradores, vencimiento, TC, destinos de línea y efecto antes del CTA.
    Producción quedó en 0 borradores reales: implementación no es adopción.
31. ~~Handoff Finance → recepción del Business Core~~ — cerrado técnicamente el
    2026-08-22: la aprobación deja de terminar en IDs técnicos y ofrece una
    siguiente acción explícita. El enlace valida UUID, espera la carga de la
    organización activa, sólo enfoca una OC ya filtrada por tenant/RLS, limpia
    tabs/filtros y abre recepción en `confirmed` o `partially_received`; estados
    finales se muestran en consulta. Respuestas tardías de otra organización se
    descartan y la operación física conserva `receive_purchase_order_idem`, sin
    un segundo camino de stock. Se agregaron 6 guardas; falta ejecutar la cadena
    con una factura autorizada y medir tarea/error en desktop y mobile.
32. Estados honestos D2.5 — primera adopción cerrada el 2026-08-22:
    `WorkspaceState` fija los 12 estados del estándar con layout panel/banner,
    skeleton estructural, icono+texto+color, live regions y recuperación. Finance
    y Compras retiraron spinners/banners/vacíos locales y distinguen carga
    inicial, refresh no bloqueante, primer uso, filtro vacío, error recuperable,
    offline, stale, parcial y éxito. Reportes/Intelligence se sumó el 2026-08-29;
    Dashboard en el slice siguiente: Reportes y Dashboard cargan sus fuentes
    principales con `Promise.allSettled`, conservan la última lectura durante
    refresh, registran el fallo exacto y descartan respuestas de otra
    organización; la cobertura opcional y el stock por sucursal se declaran
    como parciales. Auditoría y Sucursales adoptan el mismo contrato.
    Compras conserva órdenes si sólo fallan proveedores/productos y lo declara
    parcial; Finance conserva documentos si falla un refresh. Escrituras de
    documento/OC/recepción quedan deshabilitadas offline. Se agregó una guarda de
    contrato; el slice sigue **parcial** hasta migrar las demás rutas y validar
    responsive/claro/oscuro con sesión autenticada.
33. ~~Contrato de paridad Mendel-class para Finance~~ — decisión documental
    cerrada el 2026-08-22 contra producto, tarjetas e integraciones oficiales de
    Mendel. Finance ya no se define como OCR + payables: el objetivo verificable
    cubre control preventivo, presupuestos, políticas, aprobaciones multinivel,
    gasto multimedio, evidencia, conciliación, ERP, mobile, roles y auditoría. La
    navegación y los estados se reflejan en D4; las tarjetas externas preceden a
    cualquier emisión y la capa regulada conserva gates de partner/economics/
    legal. La guarda documental evita degradar esta dirección a una referencia
    vaga o presentar como construida la fase F5 todavía congelada.
34. ~~Overlays canónicos D2.6 en Gestión~~ — cerrado técnicamente el 2026-08-22:
    16 implementaciones manuales en 11 archivos pasaron a Dialog, Sheet o
    Popover. Incluye resultado/devolución/variantes/turno/vendedor/atajos del POS,
    cliente, transferencia, reporte BI, tipo de cambio, bundle, promoción,
    webhook, bloqueo de sesión, notificaciones y guía contextual. El primitive
    Dialog ahora ofrece tamaños canónicos y cierre ocultable para gates no
    descartables. La guarda recursiva admite sólo cuatro fullscreen técnicos:
    rail mobile y scanners de POS, Compras y conteo. Typecheck pasó; falta la
    matriz visual autenticada 360/768/1024/1440 antes de validar experiencia.
35. ~~Paginación canónica D2.4~~ — cerrada técnicamente el 2026-08-22 en los
    cinco listados que mantenían controles propios: Admin, Productos, Compras,
    Reportes y Ventas. `DataPagination` centraliza límites, rango real,
    comportamiento responsive y anuncio `aria-live`; el cálculo puro suma 5
    pruebas y la guarda visual impide que esas páginas vuelvan a divergir. La
    extensión del mismo contrato continúa en el punto 36.
36. ~~Fechas canónicas y clasificación de archivos D2.4~~ — cerrado
    técnicamente el 2026-08-22: los 82 campos date/datetime-local/month medidos
    en 46 archivos conservan semántica del navegador bajo `Input`; Analytics,
    Deudas, Reportes, Clientes y el asistente retiraron 11 controles manuales.
    El primitive alinea indicador y `color-scheme` claro/oscuro, y una novena
    guarda visual mantiene las variantes manuales en cero. Los 16 inputs de
    archivo quedaron clasificados en 5 importaciones estructuradas, 6
    documentos/capturas y 5 imágenes/branding. La primera familia continúa en
    el punto 37; D2.4 sigue parcial por las otras dos y combobox/menús.
37. ~~Selector canónico para importaciones estructuradas D2.4~~ — cerrado
    técnicamente el 2026-08-22: catálogo general, actualización de precios,
    migración Tiendanube, clientes y extractos bancarios comparten
    `FilePicker`. El primitive ofrece dropzone o botón compacto, click/teclado,
    drag-and-drop, busy/disabled, reselección del mismo archivo, validación por
    extensión/MIME y error accesible; parsing, preview, aprobación y aplicación
    siguen en cada dominio. Cinco pruebas puras cubren aceptación/rechazo y la
    guarda visual exige adopción en los cinco flujos. Restan 11 transportes de
    documento/cámara o imagen/branding, que requieren contratos diferentes.
38. ~~Identidad oficial de Nerqia~~ — cerrada técnicamente el 2026-08-23:
    `BrandLogo` centraliza símbolo, nombre accesible y carga; Business, Finance,
    Platform, landing, Auth, MFA, onboarding, invitaciones, recuperación,
    precios, estado y legales dejan de dibujar letras o usar íconos sustitutos.
    El mismo activo RGBA alimenta favicon, Apple y PWA sobre tema claro; cinco
    guardas verifican transparencia, adopción y aislamiento del logo del
    merchant. Landing desktop y Auth desktop/390 px fueron revisados en
    localhost sin overflow; la captura autenticada de los tres shells sigue
    pendiente porque esta PC no tiene `.env`.
39. ~~Capability Catalog piloto~~ — cerrado técnicamente el 2026-08-28: cinco
    entidades, cuatro manifests v1.0.0 y un solo evaluador para UI, comandos y
    workers. Finance conserva sus contratos públicos pero ya no reconstruye
    entitlement + permiso en dos lugares; inspección y extracción vuelven a
    evaluar antes de tomar lease o descargar originales. El fixture real
    cubrió owner/outsider, entitlement, dependencia, ciclo, wrapper de worker,
    preservación de producto y 0 restos. Producción tiene 2 organizaciones:
    catálogo/inventario 2/2 y tienda 1/2. No se agregan capabilities sin
    milestone y consumidor reales.
40. ~~Blueprint y Provisioning P1-03~~ — cerrado técnicamente el 2026-08-28:
    estado deseado versionado + SHA-256, preview/diff, run idempotente y
    checklist coordinan cinco autoridades existentes. Una falla inyectada en
    ubicación revirtió perfil/settings, permisos y capabilities; retry 2 creó
    60+ permisos, una ubicación principal, pipeline de seis etapas y dos
    capabilities, y el replay conservó un run. Owner/outsider y 0 restos
    verificados. Producción quedó en 0 runs reales: el próximo paso sigue siendo
    el onboarding acompañado del segundo comercio, no más infraestructura.
41. ~~Autorización fiscal P1-04~~ — cerrado el gap medido el 2026-08-28:
    `save_afip_config` exige membresía + `invoices.edit` y audita sólo datos no
    secretos. `afip_marcar_delegacion` dejó de aceptar anon por ACL y por guarda
    interna; sólo la Edge con `service_role` confirma después de consultar
    ARCA. Cross-role/cross-tenant, auditoría, ACL y 0 restos verificados. P1-04
    continuó parcial entonces; refund se cerró en la bitácora 49 y sólo queda
    la prueba cross-branch real.
42. ~~Funciones internas realmente internas~~ — cerrado el 2026-08-28 después
    de medir ACL, no comentarios: seis RPC de precio, IA y observabilidad
    conservaban grants directos a anon/authenticated. Quedaron exclusivas de
    `service_role`, con segunda guarda interna; tres helpers de roles ya no se
    enumeran sin sesión y `audit_costo_expuesto` volvió a 0. Prueba real en los
    dos sentidos y 0 restos. La auditoría transversal queda registrada en
    `docs/auditorias/2026-08-28_auditoria_transversal.md`; dependencias cerró en
    el punto 43 y los gates abiertos pasan a Storage y fallas Edge recurrentes.
43. ~~Dependencias y bundle sin vulnerabilidades conocidas~~ — cerrado el
    2026-08-28: React Router 7.18.3, DOMPurify 3.4.14, nanoid 3.3.18 y Vite
    8.2.2 retiraron cuatro alertas productivas y las dos del tooling; `npm audit`
    completo queda en 0 y `check:dependencies` audita desde moderado sin excluir
    devDependencies. Once guardas fijan versiones, engine y el comando. Elevar
    el job bloqueante de GitHub de critical a moderate quedó pendiente porque
    la credencial OAuth de esta PC no tiene scope `workflow`; el audit completo
    informativo sigue presente. La migración descubrió y corrigió el
    plugin obsoleto de Vitest, alias ESM, selectores CSS inválidos y dos montajes
    simultáneos de Ctrl+K. Los 89 imports de páginas, 32 E2E públicos sin retry,
    typecheck, tests y build quedaron verdes; Playwright ahora prueba
    `build + vite preview`, el artefacto que realmente se deploya, y no la
    compilación caliente del dev server. El warning deprecado del service worker
    pertenece a `vite-plugin-pwa` 1.3.0 y queda visible hasta arreglo upstream.
    La guarda de peso y el E2E además evitaron dos regresiones de Rolldown:
    PDF/charts ya no capturan helpers ni se precargan en Storefront, pero los
    grafos core sí permanecen recursivos para no crear ciclos. Un intento
    intermedio quedó detenido en el splash y fue descartado. El resultado final
    pasó el entry de 185,76 a 150,45 KiB gzip y el PWA de 2.025,05 a 1.986,06
    KiB, con 32/32 recorridos públicos funcionales.
44. ~~Comprobantes de gastos privados y operables~~ — cerrado el 2026-08-29:
    la auditoría encontró que `expense-receipts` era público, el escáner usaba
    un path incompatible con su propia policy y la carga manual esquivaba el
    bucket guardando PDFs/tickets en `product-images`, público por necesidad del
    storefront. Producción tenía 0 objetos, 0 paths heredados y 0 gastos con
    comprobante, por lo que `20260828000170` fijó sin migración destructiva una
    convención `org/actor/uuid`, bucket privado de 10 MiB, MIME acotados y RLS
    por `expenses.create/view/edit/delete`. `receipt_url` conserva el nombre de
    columna pero persiste el path; al abrir emite una URL firmada por 60 s y
    vuelve a evaluar el permiso. El escáner se expande dentro del formulario sin
    anidar focus traps, mantiene el blob local hasta guardar y el formulario
    limpia el upload nuevo si falla el gasto y el anterior si un reemplazo
    termina bien. Fixture real: miembro crea/lee, carpeta de otro
    actor bloqueada, outsider con path conocido ve 0 y restos 0; bucket/ACL/libro
    verificados y `db push --dry-run` vuelve a informar brecha 0. El recorrido
    Playwright autenticado y de sólo lectura abre Gastos en localhost, confirma
    un único Dialog/focus trap, el scanner inline, tres entradas de archivo, 0
    enlaces públicos y 0 errores durante la interacción.
45. ~~Recuperar cotización y cumpleaños sin acciones fantasma~~ — autoridad
    corregida el 2026-08-29, recuperación natural pendiente de observar. La
    telemetría mostró `fetch-usd-rate` 1/1 en 401 y cumpleaños 2/2 en 500: la
    primera aceptaba al cron pero después exigía usuario y ni siquiera tenía job;
    la segunda aplicaba `LIKE` a una columna `date`, todavía exigía Evolution
    después de migrar a Meta y pretendía enviar texto libre proactivo. La
    migración `20260828000180` deja cotización diaria 08:15 AR, timeout/valor
    válido, preservación por fuente y rama cron service; la acción humana exige
    `org_id` explícito + membresía. Cumpleaños ahora resuelve candidatos por RPC
    service-only con opt-in de comercio/cliente, fecha argentina, plantilla Meta
    aprobada y claim único `org/cliente/fecha` antes del efecto externo. Sin
    canal/plantilla queda deshabilitado con 200, no simula envío. Producción:
    ambas funciones desplegadas, jobs activos, libro 483/483, 0 candidatos, 0
    entregas y plantilla NULL; un fixture transaccional seleccionó exactamente
    al consentimiento ZZ, bloqueó el segundo claim, dejó `authenticated=false`
    y 0 restos. No se invocó ninguna Edge manualmente. Falta confirmar el
    próximo resultado natural en `edge_invocation_log` antes de declarar la
    recuperación operativa cerrada.
46. ~~SMTP propio sin contraseña visible para empleados~~ — cerrado
    técnicamente el 2026-08-29. Ajustes afirmaba que la clave no llegaba al
    servidor pero escribía `settings.smtp_pass`, una fila que cualquier miembro
    de la organización puede leer. Producción tenía 0 configuraciones, por lo
    que `20260828000190/200` migraron defensivamente, crearon
    `merchant_smtp_connections` con RLS y cero policies y retiraron las siete
    columnas `smtp_*` sin `CASCADE`. La pantalla sólo consulta una vista de
    estado saneada; dueño/admin prueba contra su propio email y guarda o revoca
    mediante Edge, sin que la contraseña vuelva al navegador. Once emisores
    comparten un único helper service-role y conservan Resend como fallback.
    La guarda de columnas encontró además que el generador legal seguía pidiendo
    `smtp_from_email`: se retiró porque un remitente técnico no es el domicilio
    electrónico legal y ese dato debe declararlo el dueño. Vitest limita ahora
    su paralelismo a cuatro workers; evita falsos rojos de I/O en guardas que
    recorren el repo sin ampliar el timeout ni esconder cuelgues.
    Snapshot y restore drill excluyen la tabla privada. Verificación productiva:
    miembro ve estado pero no secreto, outsider ve 0, 0 conexiones reales,
    libro 485/485 y 0 restos; no se envió un correo de prueba a una cuenta real.
    Google y Microsoft recomiendan OAuth y credenciales específicas; App
    Password queda documentada sólo como fallback con 2FA. Falta conectar un
    proveedor real y medir entrega/rebote antes de declarar operación validada.
47. ~~Tokens heredados fuera de `settings` y links de cobro con autoridad~~ —
    cerrado técnicamente el 2026-08-29. El catálogo productivo todavía exponía
    ocho columnas históricas para API pública, Mercado Pago, MercadoLibre y
    Evolution en una tabla que leen los miembros, aunque las ocho tenían 0
    valores. `20260828000210` corta si aparece un valor, retira las columnas sin
    `CASCADE`, elimina el trigger transitorio de Evolution y conserva como únicas
    autoridades `api_keys`, `payment_connections`, `meli_connections` y
    `evolution_connections`. Las tres tablas de conexión ahora tienen RLS, cero
    policies y además cero grants para `anon/authenticated`; sus vistas saneadas
    continúan visibles para el miembro correcto. El despliegue se hizo antes del
    `DROP` en los diez consumidores y el libro quedó 486/486, dry-run sin brecha.
    La revisión encontró dos fallas adicionales en `mercadopago-link`: una sesión
    de cualquier tenant podía pedir una preferencia con el `orgId` de otro, y
    `payment_links` mandaba a Mercado Pago una referencia distinta de la que el
    webhook usa para marcarla pagada. Ahora exige usuario real + `sales.create`,
    valida tenant/monto, usa sólo OAuth, incluye `notification_url`, conserva el
    `external_ref` canónico y calcula `marketplace_fee` con la regla aprobada del
    canal. No se creó una preferencia real durante la auditoría para no producir
    un efecto externo: falta ejecutar y acreditar un link real controlado antes
    de declarar el flujo validado operacionalmente.
48. ~~Webhooks salientes privados, firmados y con una sola autoridad~~ — núcleo
    técnico cerrado el 2026-08-29; operación externa todavía pendiente. Había
    dos productos paralelos: el simple guardaba URL/secret en `settings` y el
    avanzado devolvía `secret_value` con `select('*')`; además, “Probar” hacía
    el POST desde el navegador y el backend firmaba con el `org_id` predecible
    cuando faltaba clave. Producción tenía 0 configs, 0 entregas y 0 secrets.
    `20260828000220` deja una sola suscripción por eventos reales, genera un
    secret aleatorio por endpoint en `webhook_signing_secrets` (RLS, 0 policies,
    0 grants cliente), lo muestra sólo al crear/rotar y retira seis columnas
    heredadas de `settings/webhook_configs`. Config, rotación y baja pasan por
    RPC owner/admin; historial queda read-only para miembros. Las entregas usan
    HTTPS, no siguen redirects, bloquean destinos locales obvios, firman
    `timestamp.payload` con HMAC-SHA256, incluyen versión `2026-08-29`, delivery
    id, timeout, backoff y log correlacionado. La venta y las dos funciones de
    automatización comparten el mismo transporte server-side. La auditoría
    encontró además
    **dos crons activos sobre la misma tabla**, a las 05:00 y 08:00 AR: una regla
    podía actuar dos veces. `execute-automations` queda como única autoridad a
    las 08:00; su rama humana exige `org_id` + `marketing.edit` y ya no puede
    ejecutar flujos de otro tenant. La UI eliminó el formulario
    duplicado y 16 eventos fantasma, agregó secreto one-time, rotación, prueba,
    health, latencia, historial y retry. Verificación real: owner creó/leyó,
    no leyó secret ni escribió tablas, rotó y borró; 0 restos/huérfanos. Tres
    Edge activas, un solo cron y libro 487/487. El patrón sigue
    [GitHub HMAC-SHA256](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries),
    [timestamp anti-replay de Stripe](https://docs.stripe.com/webhooks?lang=node)
    y [SSRF de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html),
    consultados el 2026-08-29. La durabilidad que faltaba se cierra en la
    bitácoras 50–51; **P1-14 queda cerrado técnicamente y conserva como métrica
    de adopción la primera integración real**.
49. ~~Refund respeta la matriz P1-04~~ — cerrado técnicamente el 2026-08-29.
    `refund-store-payment` dejó de decidir por una lista fija owner/admin: usa
    el JWT real para exigir `payments.edit` antes de crear el cliente
    `service_role`, preparar dinero o contactar Mercado Pago; quedó ACTIVE v12
    con `verify_jwt=true`. La cola RMA sólo
    ofrece ejecutar/reconciliar a quien tiene esa capacidad y, sin ella, muestra
    el estado «Sin permiso para reintegrar» con la ruta de resolución. El
    fixture productivo y destructivo-cero probó vendedor denegado, el mismo
    vendedor habilitado, admin explícitamente revocado, cross-tenant bloqueado y
    0 restos. No creó RMA ni llamó al proveedor. La prueba estática fija además
    el orden permiso → preparación → credenciales. P1-04 queda técnicamente
    cerrado en autoridad funcional; la prueba cross-branch con dos sucursales
    reales continúa como evidencia externa, no como otra implementación.
50. ~~`sale.created` vive en la outbox transaccional~~ — cerrado técnicamente
    el 2026-08-29. `20260829000010` sincroniza cada endpoint con una suscripción
    server-managed a `venta.registrada`; el trigger del ticket crea Domain Event
    y entrega en el mismo commit. `dispatch-outbound-webhook` sólo acepta la
    identidad del cron, valida evento/suscripción/tenant, relee las líneas y hace
    un único intento: backoff, máximo, DLQ y replay quedan en la outbox, no
    duplicados dentro de la Edge. El sobre y el header conservan un `event_id`
    estable para que el receptor deduplique; `delivery_id` identifica el ciclo
    de entrega y su log. El POS dejó de hacer fire-and-forget y `send-webhook` ya no acepta
    dispatch manual, sólo prueba/retry owner-admin. Además se revocó la escritura
    directa de `event_subscriptions` a roles cliente y el worker falla cerrado si
    falta `BACKUP_CRON_SECRET`. La fixture productiva probó siete invariantes —RPC
    real del POS, cola atómica, rollback sin huérfanos, líneas releíbles,
    ACL y desactivación— con 0 restos. Se retiraron 12 descartados que apuntaban
    exclusivamente a tickets de fixture sin líneas; 0 descartados con líneas
    fueron tocados. La Edge quedó ACTIVE v1, sin JWT de gateway pero con secreto
    de cron obligatorio; una llamada anónima devolvió 401. Los dos gates que
    conservaba P1-14 —receptor externo controlado y contrato público
    versionado— se cierran en la bitácora 51.
    Puerta final medida el 2026-08-29: 1.969/1.969 tests, 71 Edge tipadas,
    488/488 migraciones, build/PWA, dependencias en 0 y 63 enlaces internos.
51. ~~Contrato y receptor externo de webhooks~~ — cerrado técnicamente el
    2026-08-29. `/developer/webhooks/openapi.json` publica OpenAPI 3.1 con los
    tres requests realmente entregables, schemas, headers, HMAC, versión y
    semántica `at-least-once`/sin orden; `docs/WEBHOOKS.md` y un receptor Node
    sin dependencias explican cuerpo crudo, tolerancia de 300 segundos,
    comparación constante, deduplicación y respuesta asíncrona. El panel abre
    el contrato y la guía en un diálogo accesible, sin pedir leer el repo para
    integrar. Además, los dos productores de `automation.triggered` dejaron de
    emitir formas distintas y comparten `flow_id`, `trigger_type`,
    `entity_count` y `entities`, sin teléfono/email/metadata interna. El request
    canónico se extrajo a una función pura usada por producción y por
    `npm run certify:webhooks`. La corrida contra un token efímero de
    Webhook.site confirmó POST, cuerpo exacto, HMAC y seis headers, recibió 200
    y borró el receptor con 204; sólo viajó `test.ping` sintético. Evidencia en
    `docs/evidencias/2026-08-29_webhook_externo.md`. Referencias oficiales:
    [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.1.html#openapi-object),
    [GitHub](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks),
    [Stripe](https://docs.stripe.com/webhooks) y
    [Webhook.site](https://docs.webhook.site/api/about.html), consultadas el
    2026-08-29. P1-14 queda cerrado técnicamente; la primera integración de un
    comercio es adopción, no otro contrato por implementar. El contrato pasó
    Redocly con 0 errores/warnings, el artefacto local respondió 200
    `application/json` con tres eventos y las Edge quedaron ACTIVE:
    `send-webhook` v41 con JWT, `dispatch-outbound-webhook` v2,
    `execute-automations` v46 y `run-automation-flows` v46 con auth propia; las
    cuatro rechazaron llamada anónima con 401. Puerta final: 1.973/1.973 tests
    en 191 archivos, lint 0/140, build/PWA, 71 Edge tipadas, audit 0, 488
    migraciones y 68 enlaces internos en 41 documentos (2026-08-29).
52. ~~API pública v1 como contrato, no prototipo~~ — cerrada técnicamente el
    2026-08-29. La auditoría encontró que `rate_limit_rpm` era decorativo —el
    runtime frenaba 120 requests por IP y por instancia—, `products:read`
    filtraba stock, `sales:write` devolvía costos/margen y la venta reservaba,
    insertaba y completaba idempotencia en tres requests. `20260829000020`
    consume cupo atómico por API key en Postgres y `api_v1_crear_venta` reúne
    key/scope/tenant/producto/costos, lock de concurrencia, venta, triggers de
    stock/outbox y respuesta idempotente en una sola transacción. La Edge
    allowlistea cada respuesta por scope, exige `/v1`, UUID/fecha/límites,
    unidades enteras y montos ARS 2/USD 4 decimales; el mismo request id une
    body, header y log. CORS de navegador queda deshabilitado porque la key es
    server-to-server. `/developer/api/openapi.json`, changelog y
    `docs/API_PUBLICA.md` publican los siete métodos reales, errores, headers,
    cuota, lifecycle y soporte mínimo de 12 meses tras un sucesor. El panel no
    lee hashes ni promete campos sin backend y enlaza esos contratos. Redocly
    validó OpenAPI 3.1 sin errores/warnings; la fixture real probó replay, una
    sola venta, stock exacto, conflicto y **0 restos**. `public-api` quedó
    ACTIVE v42: `/v1/products` sin key respondió 401 con release/version y
    request id correlacionado, el alias sin versión 404, y el preflight de un
    origen ajeno 204 sin `Access-Control-Allow-Origin`. Referencias oficiales:
    [versiones de GitHub](https://docs.github.com/en/rest/about-the-rest-api/api-versions),
    [versionado de Shopify](https://shopify.dev/docs/api/usage/versioning),
    [idempotencia de Stripe](https://docs.stripe.com/api/idempotent_requests),
    [unidades monetarias de Stripe](https://docs.stripe.com/currencies#minor-units-in-api-amounts)
    y [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html), consultadas el
    2026-08-29. P1-13 queda cerrado técnicamente; la primera integración real
    es adopción y no autoriza construir un marketplace sin demanda. Puerta
    final: 1.982/1.982 tests en 192 archivos, typecheck, lint 0/140,
    build/PWA, 71 Edge tipadas, audit 0, 489/489 migraciones, dos OpenAPI
    válidos y 70 enlaces internos en 42 documentos (2026-08-29).
53. ~~API Keys validada con la sesión real del comercio~~ — cerrada el
    2026-08-29. Esta PC no tiene `.env`, pero eso sólo bloquea la base desde
    localhost: la sesión autenticada ya abierta permitió recorrer producción
    como administrador de Exentry Imports sin transferir cookies ni secretos.
    Se verificaron panel, vacío y modal en claro/oscuro y 360/768/1024/1440;
    los ocho casos conservaron título, tab y CTA, sin overflow horizontal, y
    la consola quedó en **0 warnings / 0 errors**. La captura mobile encontró
    una deuda concreta que la compilación no veía: `stock:write` recortaba
    «con asiento de Kardex», precisamente la consecuencia que debe entenderse
    antes de emitir la key. En `main` el texto ya envuelve completo y una guarda
    evita devolverle `truncate`; el fix está versionado como `76a3c4a`. El
    primer deploy fue rate-limited y producción conservó el bundle anterior;
    se documentó como pendiente en vez de presentarlo como listo. Vercel aceptó
    el siguiente commit y completó el deploy: producción carga ahora
    `assets/index-CBuC_8gZ.js`, el DOM usa `break-words` +
    `min-w-0 leading-snug`, el texto entra dentro de la fila en claro/oscuro a
    360 px, desktop conserva diálogo de 512 px y la consola volvió a **0/0**.
    Esto cierra API Keys, no la matriz de todas las Integraciones ni la
    validación con otro comercio. Evidencia reproducible en
    `docs/evidencias/2026-08-29_api_keys_visual.md`. Puerta final: 1.983/1.983
    tests en 192 archivos, typecheck, lint 0/140, build/PWA, 71 Edge tipadas,
    audit 0, 489 migraciones y 70 enlaces internos en 43 documentos
    (2026-08-29).

54. ~~Lecturas públicas resilientes ante interrupciones transitorias~~ — cerrado
    técnicamente el 2026-08-29. `retryPublicRead` reintenta sólo fallas de red,
    timeout, rate limit y respuestas 5xx en lecturas idempotentes del catálogo,
    tienda, variantes, configuración, links de pago y cotización de envío. No
    activa el fallback de migraciones ante permisos o esquemas faltantes, y no
    se usa en mutaciones del checkout. La carga inicial de la tienda y sus
    lecturas auxiliares comparten el mismo contrato. La suite quedó en
    1.986/1.986 tests al 2026-08-29; el bundle local pasó catálogo/footer en Chromium y móvil
    `4/4`, sin errores de consola. El primer E2E paralelo había demostrado el
    síntoma real (`Failed to fetch` → catálogo vacío); la corrida enfocada con
    un worker quedó estable después de la recuperación. La puerta de arranque
    E2E también amplió `build + preview` a 180 segundos para no confundir un
    build PWA lento con una pantalla rota.

55. ~~Blueprint exhaustivo de Finance Mendel-class~~ — discovery cerrado el
    2026-08-29. El inventario oficial se convirtió en un contrato de cobertura
    para plataforma, captura, documentos, matching, políticas, presupuestos,
    aprobaciones, excepciones, reembolsos, medios de pago, AP, conciliación,
    integraciones, viajes, flotillas, IA y MCP. También separa qué páginas
    actuales permanecen en Business/Core (`compras`, recepción, productos,
    stock, facturación emitida, cobros y margen) y qué vistas pueden converger
    bajo Finance cuando exista el modelo F5. La futura navegación propone
    tabs/colas/inspectores alineados a los kits Figma compartidos, sin duplicar
    autoridad ni presentar como implementado lo que depende de adopción,
    partner, regulación o economics. El siguiente paso no es agregar menús:
    es procesar una factura real autorizada y cerrar la puerta F3; luego F5
    avanza en orden hacia spend software-first, feed de tarjetas externas y
Finance Connect.

56. ~~Orbit / Playbooks: innovación transversal~~ — discovery cerrado el
    2026-08-29. La propuesta agrega un módulo de orquestación sobre eventos y
    vistas del Business Graph: correlacionar stock/ventas/margen, rescatar
    órdenes, clasificar riesgos de documentos, recuperar integraciones y
    preparar acciones para clientes o soporte. Su diferencia frente a un
    automatizador simple es `Impact Preview`, clase de riesgo, aprobación,
    idempotencia, replay, kill switch y outcome económico. La experiencia suma
    el arquetipo Workflow/Playbook al estándar competitivo. No se crea aún
    `operations.playbooks`, no se agrega una librería de canvas y no se abre un
    worker nuevo: O1 depende de F0/F1, una decisión de margen F2 y la primera
    evidencia real de Finance F3.

57. Estados honestos D2.5 en Reportes/Intelligence — slice técnico cerrado el
    2026-08-29. La pantalla ya no puede quedar en spinner indefinido si falla una
    consulta: seis fuentes principales se coordinan con `Promise.allSettled`, el
    error identifica qué conjunto no respondió y un refresh conserva la última
    lectura válida. La consulta de miembros queda declarada como cobertura
    parcial, no como lista vacía silenciosa. Auditoría y Sucursales adoptan
    carga estable, primer uso/filtro, error recuperable, stale, refresh y
    parcial; el cambio descarta respuestas posteriores al cambio de organización
    para no mezclar tenants. La guarda visual quedó en
    `src/test/workspaceState.test.tsx`; la suite cerró en 1.987/1.987 tests al
    2026-08-29, typecheck, lint 0 errores/139 warnings y build/PWA. La matriz
    autenticada 360/768/1024/1440 y la medición de tiempo a tarea continúan
    pendientes.

58. Estados honestos D2.5 en Dashboard — slice técnico cerrado el 2026-08-29.
    La entrada operativa coordina productos, ventas, compras, deudas, ajustes y
    gastos con `Promise.allSettled`; identifica la fuente que falló, conserva la
    última lectura durante refresh y descarta respuestas posteriores al cambio
    de organización. El filtro de stock por sucursal registra el error y muestra
    una vista parcial en lugar de mezclar stock global con métricas filtradas.
    La guarda de `src/test/workspaceState.test.tsx` cubre carga, refresh, error,
    offline, stale, parcial y protección de tenant. La suite quedó en
    1.988/1.988 tests al 2026-08-29; la matriz autenticada responsive y el tiempo
    a tarea siguen pendientes.

59. Estados honestos D2.5 en Productos — slice técnico cerrado el 2026-08-29.
    El catálogo ya no depende de un `Promise.all` que podía dejar la pantalla en
    skeleton infinito ni trata errores de ventas o ficha técnica como arreglos
    vacíos. Productos y ajustes de costos/precios son el conjunto crítico;
    variantes, movimiento de 60 días y ficha de perfume son enriquecimientos
    auxiliares que ahora generan estado parcial visible sin bloquear la carga.
    Un refresh conserva la última lectura válida, los fallos críticos pasan a
    error recuperable/stale, offline se distingue explícitamente y una respuesta
    tardía no puede pintar datos de la organización anterior. El vacío inicial
    respeta permisos y el vacío por filtros limpia todas las facetas en lugar de
    sugerir un alta incorrecta. La guarda de
    `src/test/workspaceState.test.tsx` suma el contrato de Productos; la barrera
    local cerró typecheck, lint con 0 errores/138 warnings conocidos,
    1.989/1.989 tests y build/PWA. Quedan la matriz autenticada
    360/768/1024/1440, editor/importador/variantes responsive y medición de
    tiempo a primera carga de producto.

60. Jerarquía operativa del encabezado de Productos — slice técnico cerrado el
    2026-08-29. La revisión autenticada de producción mostró trece botones con
    el mismo peso visual: exportaciones, etiquetas, configuración y alta
    competían por atención antes de llegar al catálogo. Se conservan todas las
    capacidades, pero el encabezado queda reducido a refresh, selector
    lista/grilla, “Más acciones” y “Nuevo”; las once herramientas secundarias se
    ordenan en “Exportar y etiquetar” y “Administrar catálogo”, respetando rol y
    permisos. Los controles icon-only tienen nombre accesible, lista/grilla
    expone `aria-pressed` y los rótulos secundarios se compactan en mobile. La
    guarda visual enumera cada acción para impedir pérdidas silenciosas. El
    bundle desplegado se validó con sesión real en desktop y 360 px: las once
    acciones siguen disponibles, el encabezado no desborda y la consola queda
    limpia. Falta medir tiempo de hallazgo del alta/importación antes de cerrar
    Productos end-to-end.

61. Editor, variantes e importación responsive de Productos — slice técnico
    cerrado el 2026-08-29. La ficha extensa ya no se comprime dentro de un
    modal angosto: alta y edición usan un workspace fullscreen sobre Dialog,
    con cabecera contextual, scroll único, ancho de lectura y footer persistente
    cuyo CTA sigue alcanzable a 360 px. La primera comprobación publicada reveló
    que el contenedor fullscreen todavía no establecía una columna flex: el
    formulario crecía por fuera del viewport y el supuesto footer fijo quedaba
    debajo del pliegue. El workspace ahora declara esa geometría de forma
    explícita y la guarda de contrato la protege. La matriz publicada
    360/768/1024/1440 cerró geometría, scroll interno y overflow tanto para el
    editor como para el importador; la misma pasada encontró que el título
    visible del wizard no estaba conectado al contrato accesible de Radix. El
    `DialogTitle` semántico ya acompaña al encabezado visual y queda bajo
    guarda. Revalidado sobre el build publicado: el diálogo expone
    `aria-labelledby` a “Importar catálogo”, conserva cero overflow a 360 px y
    no agregó errores de consola. Los pares y
    cuartetos de campos colapsan a una o
    dos columnas en mobile; variantes expone nombre, stock, precio propio y
    eliminación con labels persistentes, targets completos y cards responsive.
    El wizard Excel/CSV comparte el mismo workspace, mantiene progreso y cierre
    visibles, apila acciones en teléfono y declara el scroll horizontal de sus
    tablas comparativas. No cambia autoridad: precios/stock siguen validados
    por servidor y Kardex. La guarda de contrato bloquea el regreso al modal
    angosto, al falso sticky, al contenedor sin columna y a acciones icon-only; la barrera local cerró typecheck, lint,
    1.991/1.991 tests y build/PWA, medidos el 2026-08-29. La importación autenticada con archivo real
    quedó demostrada en el slice 64. Quedan validación publicada de la
    protección de borradores y medición de tarea antes de declarar el flujo
    adoptado.

62. Lenguaje transversal de variantes — slice técnico cerrado el 2026-08-29.
    La ficha dejó de titular el módulo como “Sabores” cuando el tipo elegido era
    sabor: el encabezado canónico, el badge de catálogo, la carga masiva y sus
    mensajes hablan de Variantes, mientras el selector conserva Sabor, Talle,
    Color o Medida sólo como tipo de cada opción. Un producto nuevo parte de
    `otro`, no de `sabor`; los vapers lo eligen por su subtipo y las variantes
    existentes conservan su dato. La guarda visual bloquea el regreso del
    rótulo heredado sin alterar stock, Kardex ni registros existentes.

63. Protección explícita de cambios sin guardar — slice técnico cerrado el
    2026-08-29. Cerrar la ficha por X, Escape o click exterior ya no descarta
    silenciosamente el trabajo: si hubo una edición abre una confirmación
    controlada con “Seguir editando” como salida segura y “Descartar cambios”
    como acción destructiva explícita. Inputs, selects Radix, switches, chips,
    imágenes, sugerencias, tags y variantes marcan el borrador; recargar o
    cerrar la pestaña activa además `beforeunload`. El guard se limpia sólo al
    guardar o descartar, no por abrir paneles auxiliares. `ConfirmDialog` admite
    ahora uso controlado sin obligar a un trigger visible, manteniendo
    compatibles sus usos anteriores. Falta revalidar el build publicado con
    teclado y teléfono antes de contar la protección como evidencia adoptada;
    el commit está en `main`, pero Vercel informó `Deployment rate limited —
    retry in 24 hours` y todavía sirve el chunk anterior.

64. Archivo real y contrato E2E del importador de Productos — evidencia cerrada
    el 2026-08-29. La versión publicada leyó
    `e2e/fixtures/productos-importacion-e2e.csv`, reconoció dos filas sintéticas,
    mostró nombre, SKU, costos, venta y stock en la vista previa y conservó
    “Preparar y validar” como frontera antes de cualquier escritura. Se canceló
    ahí: no se preparó ni aprobó ningún lote y la consola no agregó errores. En
    360 px el documento mantuvo `scrollWidth = 360`; sólo la tabla de 760 px
    hizo scroll dentro de su contenedor de 322 px y mostró la instrucción
    mobile. `e2e/panel.spec.ts` repite el recorrido autenticado, comprueba además
    que la capacidad se llame “Variantes” y jamás pulsa el RPC de preparación o
    aplicación, por lo que conserva el contrato E2E de sólo lectura.

65. Cola offline honesta y operable en POS — slice técnico cerrado el
    2026-08-29. La base persiste una línea por producto, pero el cajero vende
    tickets: el banner confundía ambas cosas y mostraba tres “ventas” para un
    carrito de tres productos; el toast de sincronización repetía el error. La
    nueva autoridad pura agrupa por `offline_transaction_id`, conserva líneas
    heredadas, y resume tickets, unidades, monto y antigüedad. Al reconectar,
    cada ticket se aplica completo e idempotente; una falla parcial queda en la
    cola con causa visible, log y retry manual, y una guarda evita el loop de
    auto-sync cada 1,5 segundos que antes golpeaba al servidor indefinidamente.
    La migración desde la clave `default` ya no borra ventas pendientes de otra
    organización. El navegador persiste antes de limpiar el carrito o mostrar
    el recibo; si `localStorage` falla, declara que la venta no se registró y
    bloquea otra operación offline. La UI responsive explica además que
    Nerqia registra el ticket, no captura una tarjeta sin conexión. La
    comparación oficial revalidada distingue [Tiendanube
    PDV](https://ayuda.tiendanube.com/pdv/que-es-punto-de-venta-de-tiendanube),
    que unifica catálogo/stock/orden, de [Square
    Offline](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode),
    que expone pendiente, riesgo, ventana y resultado sobre hardware propio.
    Nerqia adopta la transparencia de estado sin prometer ese procesamiento.
    La afirmación de idempotencia ya no depende del `id` que viajaba y se
    descartaba: `sale_transactions.client_transaction_id` tiene unicidad por
    organización, lock transaccional y comparación de renglones. El mismo
    ticket devuelve `reused=true`; la misma clave con otro contenido falla.
    Deuda, uso de cupón y atribución de canje pasaron de escrituras posteriores
    del browser al mismo commit servidor, por lo que un timeout ya no duplica
    stock, cupón ni ROI. El cupón se bloquea y consume una vez por ticket; el
    modo online aplica vigencia, cupo, mínimo y límite por cliente, mientras el
    aceptado offline conserva la política de riesgo explícita para no quedar
    trabado al reconectar. `validateCouponDB` además traduce las columnas reales
    `discount_percent`/`discount_fixed_ars` al contrato del POS: antes pedía
    `discount_type`/`discount_value`, inexistentes en la tabla, y calculaba un
    descuento `NaN`.

    Guardas puras y de integración cubren agrupación, importes, edad, datos
    inválidos, multi-organización, persistencia previa, autoridad y error
    visible. `supabase/verificaciones/20260829_pos_offline_idempotente.sql`
    ejecutó el RPC v3 dos veces como owner real dentro de una subtransacción:
    1 padre, 2 renglones, stock −3, 2 deudas, cupón +1, payload conflictivo
    rechazado y 0 restos. `db push --linked --dry-run` quedó `upToDate=true`.
    La puerta completa del 2026-08-29 cerró con typecheck, lint sin errores,
    195 archivos / 2009 tests y build PWA de producción.
    El drill E2E de navegador ya siembra dos tickets/6 unidades/$9.500 sólo en
    `localStorage`, intercepta **antes** toda llamada a v3, desconecta el
    contexto y al reconectar deja que uno pase y otro falle: exige que la UI
    conserve 1 ticket/3 unidades/$6.000, la causa y el retry. El `finally`
    vuelve a cortar la red antes de limpiar el fixture, así ni una aserción rota
    puede liberar una venta hacia producción. En esta PC quedó validado por
    compilación/listado (13 specs de panel) y guarda estática; ejecutarlo exige
    `E2E_USER`/`E2E_PASSWORD`, que no están en el entorno local. La sesión del
    navegador publicada sí confirmó `/caja` y datos reales, pero Vercel todavía
    servía el bundle anterior `index-CjoHBe1v.js`, por lo que no se marca como
    validación visual del cambio. Falta ejecutar ese spec autenticado sobre el
    bundle nuevo y medir tiempo/errores de cobro antes de cerrar D3.

66. El espejo financiero dejó de fallar en silencio — cerrado el 2026-08-29.
    La auditoría del slice encontró que `recordFinancialMovement` enviaba
    `income|expense`, canales `sale|purchase|expense` y source `purchase`, pero
    producción exige `in|out`, canales `cash|bank|card|store_credit|other` y un
    catálogo de source acotado. Supabase devolvía el error en el objeto de
    respuesta, el `try/catch` no lo veía y el comentario afirmaba que el
    movimiento existía. El adaptador ahora traduce método, dirección y source
    al contrato real y registra `console.error` si el espejo operativo falla.
    Las ventas ya no dependen de ese espejo: el asiento canónico continúa desde
    el evento del ticket en el ledger de partida doble.

67. Ventas conserva el trabajo al inspeccionar un ticket — cerrado técnicamente
    el 2026-08-29; validación visual autenticada pendiente. La lista ya no obliga
    a editar o salir para entender una operación: tabla y cards abren un Sheet
    lateral que en 360 px ocupa todo el viewport, mientras `?sale=<id>` conserva
    la selección en Back/Forward sin borrar búsqueda, filtros, agrupación ni
    página. El resumen se arma sobre **todas** las ventas tenant-scoped, nunca
    sobre la población filtrada: `sale_transaction_id` reúne las líneas del
    ticket y una venta heredada sin padre permanece aislada. Expone total,
    unidades, costo/ganancia registrados, canal, cobro, factura, devolución,
    cliente, vendedor y cada producto; si hay devolución no presenta el margen
    como una verdad final y dirige a Rendimiento. Un deep link inexistente no
    consulta otra organización ni inventa vacío: explica borrado/permisos.
    Además, las acciones de tabla dejaron de depender sólo del hover.
    Siete pruebas cubren sumas, cobro parcial, factura, devolución —incluido el
    legado sin cantidad inventada—, legacy de ticket, números inválidos y
    contrato URL/mobile. Comparativa oficial revisada el
    2026-08-29: [Shopify Orders](https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders/searching-orders)
    conserva vistas/filtros al inspeccionar pedidos; [Square Order Manager](https://squareup.com/help/us/en/article/6923-pickup-orders-on-square-point-of-sale)
    reúne canales, estados, origen/pago y actividad; [Tiendanube Ventas](https://ayuda.tiendanube.com/es_AR/123288-mis-ventas/como-buscar-y-filtrar-mis-ventas)
    fija la paridad regional de búsqueda, filtros, exportación y bulk. Nerqia
    adopta orientación operativa, pero suma el ticket y su margen del mismo Core.
    Puerta completa medida el 2026-08-29: typecheck, lint con 0 errores/138 warnings conocidos, 196
    archivos/2.016 pruebas y build PWA; el chunk de Ventas mide 83,55 kB
    (21,25 kB gzip) sin dependencia nueva.
    Falta captura autenticada 360/768/1024/1440, cobro/devolución atómicos a
    nivel ticket y timeline antes de cerrar D3.

68. Descuentos de POS con autoridad y evidencia — cerrado técnicamente el
    2026-08-29. Caja mostraba porcentajes configurables para efectivo,
    transferencia, débito y crédito, pero al vender ignoraba los cuatro y
    decidía con un booleano heredado: efectivo/transferencia podían tomar el
    precio de oferta, débito/crédito no, y ninguno aplicaba el porcentaje de
    Ajustes. El POS ahora calcula el mejor beneficio entre oferta/promoción y
    descuento del medio —sin acumularlos—, explica importe y porcentaje antes
    de cobrar, conserva el precio realmente vendido en ticket/recibo y deja el
    cobro dividido sin descuento automático ambiguo. Los porcentajes se validan
    entre 0% y 90% también al guardar.

    `20260829000040_pos_payment_method_discounts` lleva la misma regla a
    `create_sales_transaction_v2`, exige `sales.create`, vuelve a calcular
    contra producto/settings y persiste `payment_discount_percent` y
    `payment_discount_ars`: un bundle viejo que intente mandar el precio de
    lista ya no puede borrar el descuento vigente. La prueba reversible de
    producción vendió un fixture `ZZ` de ARS 10.000 con oferta ARS 9.500 y 10%
    en efectivo: cerró a ARS 9.000, registró ARS 500 de descuento incremental,
    creó el cobro aprobado por ARS 9.000, movió stock 10→9 una sola vez,
    identificó el precio cliente obsoleto y dejó 0 restos. El QR dinámico quedó
    separado deliberadamente para que acreditación, idempotencia y cierre de
    ticket fueran una única máquina de estados server-side (slice 69). Puerta
    completa: typecheck, lint sin errores (138
    warnings conocidos), 198 archivos / 2.027 pruebas y build/PWA de
    producción.

69. Cobro QR dinámico de Mercado Pago en POS — cerrado técnicamente el
    2026-08-29; certificación live pendiente. Caja ofrece QR como medio único y
    no como parte de un split: prepara el importe canónico en servidor, reserva
    disponibilidad sin tocar stock, crea una Order dinámica de Mercado Pago con
    `external_pos_id`, vencimiento de 15 minutos, idempotencia y comisión de
    plataforma congelada, y muestra el QR con importe, cuenta regresiva y
    estados accionables. El ticket, stock, cobro y margen nacen únicamente
    después de que el proveedor responde `processed`; cerrar, reintentar o
    vencer no fabrica ventas. El carrito se conserva hasta acreditar y una
    falla posterior de catálogo ya no convierte una venta cobrada en error.

    `20260829000041_pos_qr_mercadopago_orders` agrega la máquina privada
    `pos_qr_sessions`, una reserva vinculada, RPC de usuario para preparar y RPC
    sólo `service_role` para registrar/reconciliar proveedor. El total, items,
    descuento por medio, permisos y stock se recalculan en el Business Core;
    montos distintos pasan a revisión manual. La Edge Function
    `mercadopago-pos-qr` usa el OAuth privado del comercio, recupera o crea
    Store/POS mediante las APIs oficiales y consulta la Order para no confiar en
    el navegador ni en el cuerpo del webhook. `mercadopago-webhook` suma el
    tópico Orders con firma obligatoria y vuelve a consultar al proveedor.

    Prueba reversible de producción: QR ARS 9.000, reserva activa sin venta,
    acreditación → pago aprobado y stock 10→9 una sola vez, retry `completed`,
    vencimiento sin ticket y 0 restos. `db push --dry-run` quedó `upToDate`.
    Esto prueba autoridad interna, no una compra real: falta configurar el
    tópico Orders en la aplicación de Mercado Pago, escanear/acreditar un QR
    live y comprobar el settlement/arancel real. Contrato oficial consultado el
    2026-08-29: [crear Order QR](https://www.mercadopago.com.ar/developers/es/reference/in-person-payments/qr-code/orders/create-order/post),
    [procesamiento](https://www.mercadopago.com.ar/developers/es/docs/qr-code/payment-processing)
    y [Store/POS](https://www.mercadopago.com.ar/developers/es/docs/qr-code/create-store-and-pos).
    Puerta completa medida el 2026-08-29: typecheck, lint con 0 errores/139 warnings conocidos, 200
    archivos/2.037 pruebas y build PWA; `check:functions` valida las 72 Edge
    Functions. El chunk completo de POS quedó en 104,11 kB (28,94 kB gzip), sin
    incorporar un SDK pesado al navegador. La versión publicada se comprobó en
    desktop y 360 px: QR está en ambos checkouts, no hay overflow ni errores de
    consola y el sheet mobile ya expone nombres accesibles al abrir/cerrar.

70. Recuperación durable del QR — cerrada técnicamente el 2026-08-29;
    acreditación live pendiente. Una venta QR ya no depende de que el
    navegador, el diálogo o la computadora permanezcan abiertos. La migración
    `20260829000042_pos_qr_se_recupera_solo` programa cada minuto
    `mercadopago-pos-qr` mediante `invoke_edge_function`, cuyo secreto de cron
    se valida antes de leer tenants o credenciales. La Edge consulta Orders
    persistidas en lotes acotados y vuelve a pasar cada estado por el mismo
    reconciliador idempotente que usan el polling y el webhook. Un intento sin
    Order conocida conserva su identidad durante el vencimiento más 30 minutos
    —para no convertir una respuesta ambigua en rechazo— y después expira
    payment intent, attempt y reserva sin fabricar ticket.

    Al volver a Caja, `recover` devuelve sólo sesiones del mismo usuario y
    organización. Un QR abierto puede retomarse con la misma clave idempotente
    o cancelarse liberando la reserva; una acreditación ocurrida con Caja
    cerrada aparece como “Venta QR recuperada”, enlaza a Ventas y queda visible
    hasta reconocimiento explícito. Ese flujo usa importe/items de la sesión
    server-side y nunca vacía, audita ni atribuye el carrito que el cajero pudo
    empezar después. La marca `cashier_acknowledged_at` sólo confirma que la UI
    mostró el resultado; no cambia dinero, stock ni estado financiero.

    Evidencia productiva: fixture reversible ARS 9.000 con acreditación
    idempotente, cancelación antes de Order, expiración huérfana, reconocimiento,
    stock 10→9 y `0` restos. El cron quedó activo `* * * * *`; sus primeras dos
    respuestas reales fueron HTTP 200 en 0,058–0,059 s y producción conservó
    `0` sesiones QR reales. `db push --dry-run` devolvió `upToDate` y
    `check:functions` validó las 72 Edge Functions el 2026-08-29. Sigue faltando configurar
    el tópico Orders en Mercado Pago y certificar un pago escaneado con arancel
    real: la redundancia reduce riesgo operativo, no reemplaza al proveedor ni
    demuestra adopción. Puerta completa: typecheck, lint con 0 errores/139
    warnings conocidos, 200 archivos / 2.039 pruebas y build/PWA. El chunk de
    POS quedó en 108,52 kB (29,96 kB gzip): la recuperación agregó estado y UI,
    no un SDK de proveedor al navegador.

71. Efectos comerciales una vez por ticket — cerrado técnicamente el
    2026-08-29. La auditoría posterior al QR encontró tres autoridades para la
    misma venta: el trigger otorgaba fidelidad por cada renglón; Caja volvía a
    otorgarla desde el navegador usando por error el `product_id` como
    referencia; y la alerta de venta grande se insertaba por línea y también
    desde la UI. Eso podía duplicar beneficios/avisos en un ticket normal y,
    por el camino inverso, perder efectos cuando webhook o cron acreditaban un
    QR con Caja cerrada.

    `20260829000043_pos_ticket_post_sale_effects` convierte
    `sale_transactions` en la única unidad: suma el ticket completo, otorga un
    movimiento de fidelidad con referencia al ticket, crea como máximo una
    alerta grande y reconcilia ambos al editar o anular líneas. Dos índices
    parciales y `ON CONFLICT` vuelven idempotentes los reintentos; la función es
    interna a `service_role`, mientras el trigger registra `RAISE WARNING` si
    un efecto secundario falla sin deshacer una venta ya válida. Caja dejó de
    escribir puntos y notificaciones directamente.

    La fixture productiva vendió dos líneas por ARS 12.000 con tasa 2: una sola
    fila de 24 puntos y una sola alerta; el retry conservó ambas, la anulación
    parcial recalculó 12 puntos y retiró la alerta, y la total dejó 0 puntos y
    0 restos `ZZ`. El primer intento del gate expuso que el comercio nuevo trae
    10% de descuento efectivo por defecto; se aisló a 0 en la prueba en vez de
    adaptar una expectativa falsa. Producción quedó en 494 migraciones, 492
    funciones y libro `upToDate`, medidos el 2026-08-29. Puerta completa: typecheck, lint 0/139,
    201 archivos / 2.044 pruebas, build/PWA y 72 Edge Functions; el chunk POS
    bajó a 108,09 kB (29,82 kB gzip) al retirar lógica duplicada.

72. Ajustes de descuentos del POS realmente guardables — cerrado técnicamente
    el 2026-08-29. La pestaña **Precios** mostraba efectivo, transferencia,
    débito y crédito, pero el único `Guardar Configuración` pertenecía al panel
    **Finanzas** y el layout lo ocultaba al cambiar de pestaña. El usuario podía
    editar porcentajes y no tenía ninguna acción alcanzable para persistirlos.
    La sección ahora termina con `Guardar precios y descuentos`, explica que
    afecta la próxima venta y escribe únicamente descuentos, mayorista y
    márgenes de presentaciones: no confirma por accidente cambios invisibles de
    Tienda, Mensajería o Impuestos. Los cuatro controles tienen nombre
    accesible y comparten la explicación de la regla de mejor beneficio.

    `saveSettingsDB` dejó de hacer `upsert` con `user_id` del operador —eso
    reasignaba el campo “quien creó” de una configuración que es por
    organización— y ahora actualiza la fila `org_id`, exige que PostgREST
    devuelva exactamente la configuración visible y diferencia falta de
    permiso/fila de un éxito. La normalización común acepta coma decimal,
    conserva 0–90% igual que la autoridad server-side de Caja y evita umbrales
    o márgenes negativos. Verificación reversible productiva como rol
    `authenticated` owner/admin: una fila 10→10,1 dentro de transacción y
    `ROLLBACK` 10→10, con 0 cambios persistidos. Puerta completa medida el 2026-08-29: typecheck,
    lint con 0 errores/139 warnings conocidos, 202 archivos / 2.048 pruebas,
    build/PWA y 72 Edge Functions. Vercel publicó `5252e20` en 25 s y una sesión
    real de administrador confirmó el CTA, los cuatro nombres accesibles y el
    guardado completo: quedó una auditoría `settings_change/pricing` y los
    valores comerciales siguieron 10% / 5% / 0% / 0%. No se alteró una tasa
    real para probar. Queda ampliar la matriz visual de Ajustes a
    360/768/1024/1440; la tasa elegida sigue siendo decisión comercial/legal
    del dueño, no una recomendación automática de Nerqia.

73. Turno de caja autoritativo por sucursal y ticket — cerrado técnicamente el
    2026-08-29; uso real pendiente. Caja tenía dos verdades incompatibles: el
    POS llamaba “turno” a una lista en memoria que desaparecía al recargar,
    mientras `/caja/turno` escribía tablas directamente y calculaba ventas por
    hora. El trigger histórico además elegía la primera membresía del usuario y
    generaba un movimiento por renglón; en un operador multi-organización podía
    atribuir el tenant equivocado y un ticket de tres productos parecía tres
    ventas.

    `20260829000044_pos_turno_autoritativo` establece una sesión por
    organización/ubicación con lock e índice único, vincula
    `sale_transactions.cash_session_id` dentro de `create_sales_transaction_v3`
    y crea una entrada por ticket/medio desde la evidencia de cobro. Abrir y
    cerrar son RPC idempotentes con `pos.create`/`pos.edit`, auditoría y cálculo
    server-side del efectivo esperado; el rol autenticado perdió INSERT/UPDATE/
    DELETE directo sobre sesiones. La devolución de ese slice todavía buscaba
    la sesión abierta desde el navegador y podía dejar un `refund_out` sin
    conciliar; el slice 74 reemplaza ese comportamiento por una única operación
    PostgreSQL. Se conserva acá como hallazgo histórico, no como arquitectura
    vigente.

    El POS muestra sucursal y estado real sin bloquear la venta durante la
    adopción: si no hay sesión declara que el ticket quedará “sin turno”. La
    pantalla de sesión separa tickets, efectivo neto, transferencias, tarjetas,
    otros medios, vendedor, ingresos/egresos, contado y diferencia. El resumen
    local pasó a llamarse “Actividad de esta pestaña”, y se retiró la anulación
    línea por línea que podía romper stock/cobro; dirige al inspector de Ventas.

    Benchmark oficial consultado el 2026-08-29: [Square](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session)
    reúne fondo inicial, ventas/reembolsos, ingresos/retiros, esperado y conteo;
    [Shopify POS](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/register-sessions-in-shopify-pos)
    agrega ubicación, responsable, métodos no efectivo y discrepancia. Nerqia
    adopta esa paridad sobre su ticket/stock/cobro canónicos, sin presentarla como
    ventaja: producción tiene 0 sesiones y 0 movimientos reales.

    La prueba reversible con rol real abrió, enlazó dos líneas como un ticket de
    ARS 10.000, produjo una sola entrada, calculó ARS 20.000 esperados, cerró con
    diferencia −ARS 100, bloqueó otra organización y dejó 0 restos. `db push
    --linked --dry-run` quedó `upToDate=true`. Puerta completa medida el 2026-08-29: typecheck, lint
    0 errores/139 warnings conocidos, 204 archivos/2.056 pruebas, build/PWA,
    72 Edge Functions, auditoría de dependencias sin vulnerabilidades, enlaces
    internos y 46 E2E listados. Los chunks quedan en 111,00 kB para POS y 28,92
    kB para Turno, sin dependencia nueva. Falta operar y cerrar un turno real,
    validar la superficie publicada en 360/768/1024/1440 y medir diferencia,
    tiempo de cierre y ventas sin turno antes de declarar adopción.

    La primera validación publicada encontró una brecha de activación que el
    fixture no podía mostrar: las 2 organizaciones productivas tenían 0
    sucursales, por lo que la nueva sesión era correcta pero no iniciable. No se
    inventó un local ni un domicilio mediante backfill. Caja y Turno ahora
    explican que la venta seguirá “sin turno” y, para owner/admin, enlazan a
    **Configurar sucursal**; un vendedor recibe la instrucción de pedírselo a un
    administrador. El E2E de sólo lectura acepta los dos estados válidos —selector
    configurado o CTA de activación— y deja de exigir datos que producción no
    tiene.

    El despliegue `31ddc01` quedó `Ready` en 27 s y se revalidó con sesión real
    sin escribir: Turno conserva H1, CTA visible y cero overflow en
    360/768/1024/1440; Caja muestra la recuperación en el carrito mobile a 360
    px y en el panel desktop a 1440 px. El E2E codifica esa misma matriz. Su
    ejecución CLI local detectó que el estado guardado había vencido y redirigió
    correctamente a Login, por lo que no se presenta como pasada; la matriz sí
    se completó con la sesión vigente del navegador integrado. Evidencia:
    [`docs/evidencias/2026-08-29_turno_caja_visual.md`](docs/evidencias/2026-08-29_turno_caja_visual.md).

74. Devolución POS transaccional por ticket y cobro original — cerrada
    técnicamente el 2026-08-30; live externo pendiente. La pantalla anterior
    insertaba `returns`, reponía stock, marcaba la venta y recién después
    intentaba escribir Caja. Si el último paso fallaba, mostraba un warning y
    dejaba una operación partida; además permitía borrar el registro sin
    compensar stock/dinero, ofrecía un “crédito en tienda” sin ledger de saldo
    y generaba un HTML llamado nota de crédito que nunca había hablado con
    ARCA.

    `20260829000045_devolucion_pos_transaccional` vuelve al servidor autoridad:
    bloquea ticket/renglones, calcula cantidad e importe restante, limita cada
    reintegro al cobro original y usa `client_return_id` + fingerprint para que
    el retry idéntico reutilice y uno alterado falle. Efectivo requiere la caja
    abierta de la sucursal y sale en el mismo commit; transferencia, tarjeta y
    QR nacen `pending_external` contra `2.1.04 Reintegros a clientes`. Sólo una
    referencia verificable cancela el pasivo; Mercado Pago no admite cierre
    humano cuando la evidencia debe venir de su API. Stock, devolución, estado
    de venta, caja, ledger, auditoría y evento quedan atómicos. Actualizar sólo
    `returned_quantity` dejó de disparar dos movimientos Kardex falsos.

    La UI adopta un workflow claro de tres partes: buscar ticket cobrado,
    elegir unidades y revisar cómo se reparte el monto sobre los cobros
    originales. Muestra completo/pendiente, caja faltante, topes, reposición,
    referencia externa y CTA fiscal. Se retiraron eliminación, carga libre de
    producto/monto y crédito ficticio. “Comprobante interno” lleva la leyenda
    explícita de que no reemplaza un comprobante autorizado por ARCA; si la
    venta tenía CAE, la operación exige continuar en Facturación.

    Benchmark oficial consultado el 2026-08-30: [Shopify POS](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/order-management/complete-refund-orders?locale=en)
    documenta devolución parcial/total, motivo, reposición y devolución hasta
    el monto del medio original; [Square](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session)
    incluye reembolsos de efectivo en la sesión; [Mercado Pago](https://www.mercadopago.com.ar/developers/es/docs/sales-processing/cancellations-and-refunds)
    separa cancelación de refund y su [Order API](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api/refund-order/post)
    exige idempotencia. Nerqia alcanza la paridad interna y agrega el ledger
    del pendiente, pero no declara refund Mercado Pago live hasta certificarlo.

    La fixture productiva reversible abrió caja ARS 10.000, vendió 2 unidades
    por ARS 10.000 con split ARS 5.000 efectivo + ARS 5.000 transferencia y
    devolvió una por ARS 5.000: stock 10→8→9, efectivo esperado ARS 12.500, una
    línea, dos partes, retry reutilizado, contenido alterado/exceso/outsider
    bloqueados, dos asientos balanceados, pasivo pendiente cancelado y 0
    restos. El test descubrió además 175 cuentas, 7 asientos y 16 partidas de
    antiguas fixtures cuyo tenant ya no existía: se eliminaron únicamente esos
    huérfanos y las tres tablas del libro ahora tienen FK `ON DELETE CASCADE`;
    organizaciones activas quedaron intactas y el libro sigue inmutable.

    Puerta local completa medida el 2026-08-30 antes del slice 75: typecheck, lint 0 errores/139 warnings conocidos,
    206 archivos/2.064 pruebas, build/PWA, 72 Edge Functions, auditoría npm sin
    vulnerabilidades, enlaces internos y libro de migraciones `upToDate=true`.
    `dae7a0e` quedó publicado y `Ready`; la sesión vigente confirmó H1, CTA,
    modal accesible, cero overflow en 360/768/1024/1440 y cero errores/warnings
    de consola. Evidencia:
    [`docs/evidencias/2026-08-30_devolucion_pos_visual.md`](docs/evidencias/2026-08-30_devolucion_pos_visual.md).
    Falta operar una devolución real y automatizar el refund de Mercado Pago
    con consulta posterior antes de marcar adopción.

75. Reintegro Mercado Pago autoritativo para la devolución POS — cerrado
    técnicamente el 2026-08-30; certificación con dinero real pendiente.
    `20260830000010_pos_refund_mercadopago` agrega una identidad idempotente y
    observación del proveedor a cada parte externa sin abrir escrituras al
    cliente. `pos_mp_refund_prepare` bloquea y deriva organización, importe,
    Order/Payment y camino de API desde el cobro original; el navegador sólo
    puede indicar organización, devolución y acción. `pos_mp_refund_observe`
    conserva `pending_external` ante rechazo o ambigüedad: un error del
    proveedor no borra la deuda ni deja reutilizar el saldo para devolver dos
    veces.

    La Edge Function `refund-pos-payment` exige usuario real y permiso
    `payments.edit`, obtiene OAuth desde la conexión privada, soporta Orders
    para el QR actual y Payments para cobros anteriores, y usa
    `X-Idempotency-Key: pos-refund:<uuid>` tanto al ejecutar como al
    reconciliar. Timeout, `409` o `5xx` no disparan otro reintegro ciego; sólo
    `processed` en Orders o `approved` en Payments, con importe exacto, llaman
    al cierre contable existente. La UI intenta el reintegro al terminar la
    devolución cuando el rol puede, y en el detalle ofrece **Reintegrar**,
    **Reintentar** o **Verificar estado** con una explicación explícita de que
    la devolución física ya existe aunque el dinero siga pendiente.

    Benchmark oficial consultado el 2026-08-30: Mercado Pago documenta
    reembolsos hasta 180 días con saldo suficiente en
    [Cancelaciones y devoluciones](https://www.mercadopago.com.ar/developers/es/docs/sales-processing/cancellations-and-refunds),
    exige autorización e idempotencia en el
    [refund de Payments](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/create-refund/post)
    y en el
    [refund de Orders](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api/refund-order/post),
    y recomienda Webhooks sobre IPN para cambios de estado. Nerqia adopta el
    contrato y agrega pasivo/conciliación propios; no atribuye al proveedor una
    disponibilidad que todavía no observó.

    La migración quedó aplicada y el libro vuelve `upToDate=true`. La fixture
    productiva reversible preparó modo Orders dos veces con la misma clave,
    registró un rechazo que mantuvo ARS 5.000 pendientes y luego una
    confirmación que llevó el pasivo a ARS 0, con refund ID persistido y 0
    restos. La función está ACTIVE, `verify_jwt=true`, pasa Deno y una llamada
    anónima devuelve 401. La línea base real explica el límite de la evidencia:
    **0 conexiones Mercado Pago, 0 QR completados, 0 devoluciones POS y 0
    refunds**. Para cerrar el gate falta conectar una cuenta, cobrar y devolver
    total/parcial, observar rechazo/timeout y conciliar la nota de crédito ARCA
    cuando la venta tenga CAE.

    La auditoría de publicación del 2026-08-30 distinguió inicialmente 73
    funciones versionadas y aprobadas por Deno de 74 activas en Supabase:
    `extract-receipt` estaba desplegada pero no existía en `main`. El slice 76
    recuperó la fuente exacta y cerró esa deriva; este párrafo queda como el
    hallazgo que originó el trabajo, no como estado vigente.

    `1ec3c3c` quedó publicado y Vercel informó `Ready` en 26 s. La sesión real
    de administrador revalidó H1, CTA, estado vacío y modal; 360/768/1024/1440
    no presentan overflow, el CTA físico mobile abre el diálogo y no hubo
    errores ni warnings nuevos desde el reload. No se creó ninguna operación.
    Evidencia:
    [`docs/evidencias/2026-08-30_pos_refund_mercadopago.md`](docs/evidencias/2026-08-30_pos_refund_mercadopago.md).

76. Escáner de comprobantes de Gastos reconstruible, revisable y privado —
    cerrado técnicamente el 2026-08-30; proveedor documental pendiente. El
    scanner enviaba una estructura multimodal a `ai-chat`, cuyo contrato real
    es conversacional/SSE, intentaba interpretar otra respuesta y ocultaba el
    fallo detrás de un resultado vacío. Además Supabase ejecutaba
    `extract-receipt` versión 2 sin que su fuente existiera en `main`: el
    deployment no era reproducible.

    Se recuperó la fuente desplegada y se separó el caso de uso en una Edge
    Function propia. El servidor exige persona, membresía del tenant, beneficio
    y cupo de IA, flag documental independiente, clave, MIME/tamaño/base64 y
    rate limit antes de llamar al proveedor. Usa salida estructurada, no acepta
    una categoría fuera de las reales de la organización, sanea monto/fecha y
    devuelve `reviewRequired`; sólo descuenta uso después de una respuesta. El
    browser ya no inventa prompts ni traga errores: muestra el motivo real y
    conserva el camino manual.

    El diseño adopta la paridad “captura → sugerencias → revisión → registro” de
    QuickBooks sin copiar su interfaz ni confundir OCR con autoridad contable.
    La imagen queda local durante la captura/extracción, el archivo privado sólo
    se sube al confirmar el gasto y cerrar el diálogo no deja huérfanos. La UI y
    la política de privacidad declaran que, al extraer, el documento puede ir a
    Anthropic y no se anonimiza automáticamente.

    `extract-receipt` quedó ACTIVE versión 3 y `platform-admin-action` versión
    48, ambas con `verify_jwt=true`; la llamada anónima devuelve 401 y CORS `*`.
    La fuente ahora completa, al 2026-08-30, 74/74 funciones y Deno las valida.
    La puerta local del 2026-08-30 pasa typecheck, lint 0 errores/139 warnings,
    2.078 tests en 208 archivos,
    build/PWA y `check:functions`. **No se certifica extracción real:**
    `ANTHROPIC_API_KEY` y `EXPENSE_RECEIPT_EXTRACTION_ENABLED` están ausentes,
    por lo que ningún comprobante sale al proveedor. Antes de habilitar hacen
    falta DPA/región/subencargados/retención aprobados, benchmark autorizado de
    exactitud/costo y E2E autenticado con revisión humana. Evidencia:
    [`docs/evidencias/2026-08-30_escaner_comprobantes_gastos.md`](docs/evidencias/2026-08-30_escaner_comprobantes_gastos.md).

    `26e6a36` quedó publicado con el mismo chunk local
    `ExpensesPage-BkjzogkU.js`. La sesión real abrió Gastos → Nuevo Gasto →
    Escanear comprobante en 360/768/1024/1440: raíz, diálogo y scanner
    conservaron `scrollWidth = clientWidth`, el disclosure estuvo visible en
    las cuatro medidas y no aparecieron logs nuevos. La política publicada
    muestra fecha 30 de agosto, ausencia de anonimización automática y camino
    manual. Se cerró sin subir archivo ni guardar gasto.

77. Business Copilot del Dashboard con contexto server-side y costo explícito —
    cerrado técnicamente el 2026-08-30; respuesta real del proveedor pendiente.
    La observación publicada encontró un fallo que no aparecía en build ni en
    tests: al entrar al Dashboard, las seis vistas quedaban montadas aunque sólo
    una fuera visible. `AIProactiveWidget` y `AIPrediction` invocaban IA en
    segundo plano; una organización cancelada generaba
    «Tu suscripción está cancelada» en consola en cada carga. El Briefing tenía
    otro problema: armaba un prompt con cifras del browser y llamaba al contrato
    SSE anterior de `ai-chat` usando `{messages,stream}`, sin `orgId`, mientras
    la función actual espera `{message,history,orgId,model}` y emite otro evento.
    No podía producir un briefing correcto.

    El Dashboard ahora lee `org_entitlements` antes de montar una superficie
    automática: Pulso sólo existe en Resumen y Proyección sólo en Inteligencia;
    plan cancelado/impago/pausado o sin IA muestra una ruta accionable a
    **Mi plan**, no un botón que falla. Los accesos manuales al Copilot comparten
    la misma decisión visual, pero la autoridad sigue en `exigirBeneficio`.
    Error y retry son visibles; el refresh conserva el último resultado y
    declara que no pudo actualizarlo. El encabezado del pulso dejó además el
    `button` anidado inválido y separa expandir de regenerar con nombres
    accesibles.

    `ai-analysis` agrega `daily_briefing`, valida UUID, membresía y suspensión
    antes del plan, y para `daily_pulse`/`daily_briefing` ignora por contrato
    cualquier `data` del cliente. Productos, ventas, gastos, deudas y nombre del
    negocio se releen con el JWT del miembro y RLS; sólo entonces se calcula el
    resumen que recibe el prompt. El servidor devuelve al modal la misma
    evidencia agregada que usó para narrar, por lo que texto y cifras no pueden
    divergir por un filtro local. Se minimiza PII: no se seleccionan ni envían
    nombres/ids de clientes. El cache es por organización, fecha y versión.

    Benchmark oficial consultado el 2026-08-30: [Shopify Sidekick](https://help.shopify.com/en/manual/ai-powered-tools/sidekick)
    trabaja con el contexto de la tienda y
    [Sidekick Pulse](https://help.shopify.com/en/manual/ai-powered-tools/sidekick/pulse)
    investiga datos para proponer hasta cinco tareas; no cambia la tienda sin
    aprobación. [QuickBooks Intuit Intelligence](https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-assist/introducing-intuit-intelligence/L189976Da_US_en_US)
    combina IA/BI con datos de la compañía, insights y trabajo de varios pasos.
    Nerqia adopta contexto + tarea + revisión y agrega tenant/plan/costo como
    barreras explícitas; no copia composición ni atribuye impacto todavía.

    La puerta local pasa typecheck, lint 0 errores/139 warnings conocidos,
    **2.083 tests en 209 archivos**, build/PWA (18 entradas, 2.018,63 KiB),
    74 Edge Functions, `npm audit` sin vulnerabilidades, 82 enlaces internos y
    conteos 74/497. Cinco guardas nuevas fijan plan/vista, payload mínimo,
    orden membresía→plan→contexto, minimización de PII y error recuperable.
    `ANTHROPIC_API_KEY` continúa ausente al corte: no se presenta una respuesta
    del modelo como certificada y no se envió información al proveedor. Falta
    DPA/retención/subencargados aprobados, clave, un E2E de organización activa
    y medir recomendación→acción→resultado. `ai-analysis` quedó ACTIVE versión
    43, `verify_jwt=true`, CORS `*`; una llamada anónima devuelve 401.

    La primera validación publicada del cliente `7836b50` confirmó con una
    sesión real cancelada que Resumen ofrece **Activar IA**, Inteligencia
    reemplaza la proyección paga por **Ver planes y activar IA**, y desde el
    corte de observación no aparecieron errores nuevos. La matriz
    360/768/1024/1440 mantuvo `scrollWidth = clientWidth`, pero descubrió una
    deuda de navegación: en escritorio la última pestaña activa quedaba
    parcialmente fuera del contenedor por el metadato lateral. El componente
    compartido `WorkspaceViewTabs` ahora desplaza horizontalmente cada tab
    activa con `block/inline: nearest`; una guarda evita perder esa conducta.
    `d9a583e` quedó Ready en Production en 27 s. La repetición publicada dejó la
    tab activa completamente visible en las cuatro medidas —incluido el
    desplazamiento 100/950 px medido a 1440—, mantuvo
    `scrollWidth = clientWidth` y no produjo logs nuevos. La evidencia visual
    queda cerrada; el E2E del proveedor y el outcome comercial siguen abiertos.

78. Storefront D5.1: medios resilientes sin ocultar el problema operativo —
    cerrado técnicamente el 2026-08-30; reemplazo del activo a cargo del
    comercio. La auditoría de la tienda pública real encontró un
    banner activo cuya `image_url` apunta a una página HTML externa: el navegador
    midió `complete=true`, `naturalWidth=0` y `naturalHeight=0`, y mostraba un
    bloque negro con el ícono nativo de archivo roto. No se editó el contenido
    del comercio ni se usó ese dato como fixture.

    La tienda deja ahora un fallback de marca por debajo de banners, hero,
    categorías, cards y galería de producto, logo, búsqueda, carrito y venta
    sugerida. Al fallar, la etiqueta de imagen se oculta; al volver a cargar o
    cambiar la fuente responsive se recupera. En banners, título, subtítulo y
    CTA siguen siendo HTML accesible sobre el fallback, de modo que un CDN o
    una URL retirada no convierten la primera impresión en un callejón sin
    salida. `ImageUpload` muestra un alerta explícito si el activo guardado no
    responde, y Banners impide guardar o reactivar uno activo hasta reemplazar
    su imagen.

    La traducción competitiva se basa en documentación oficial consultada el
    2026-08-30: [Shopify](https://help.shopify.com/en/manual/online-store/images/theme-images)
    optimiza imágenes de tema, recomienda proporción/foco y permite preview en
    su [editor](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor);
    [Tiendanube](https://ayuda.tiendanube.com/es_ES/122998-carrusel-de-imagenes/cual-es-el-tamano-recomendado-del-slider-para-mi-tiendanube)
    contempla piezas desktop/mobile y recomienda que texto/botón se configuren
    en el editor de [banners](https://ayuda.tiendanube.com/es_CO/123046-banners/cual-es-el-tamano-recomendado-del-banner).
    Nerqia adopta preview, contenido separado y resiliencia; no copia assets
    ni afirma que la URL defectuosa quedó corregida.

    La puerta completa local del 2026-08-30 pasa typecheck, lint con 0 errores
    y 139 warnings conocidos, **2.089/2.089 pruebas en 211 archivos**,
    build/PWA con 18 entradas y 2.018,70 KiB precacheados, 74 Edge Functions,
    auditoría npm sin vulnerabilidades, 82 enlaces internos y conteos 74/497.
    `e63c0ad` quedó `Ready / Production`. En la tienda real, la misma URL
    continuó con `naturalWidth=0` pero pasó a `hidden=true` y
    `data-media-state=error`; el fallback, `wwww` y **Ver Promo** quedaron
    visibles. Tienda y Banners conservaron `bodyWidth = clientWidth` en
    360/768/1024/1440. Gestión mostró el alerta completo en los cuatro anchos,
    sin guardar ni alterar el banner. La consola tuvo 0 logs propios; tres
    errores `No Listener` provinieron de `chrome-extension://` en Brave y no
    del dominio ni del bundle de Nerqia. Evidencia:
    [`docs/evidencias/2026-08-30_storefront_media_resilience.md`](docs/evidencias/2026-08-30_storefront_media_resilience.md).

79. Storefront D5.2: el número de pedido deja de ser una credencial — P0 de
    privacidad reproducido en producción y corte preparado localmente el
    2026-08-30. Ejecutando como rol `anon`, una llamada con slug y un número
    correlativo existente devolvió 1 fila, `exposes_email=true` y
    `exposes_address=true`; la comprobación imprimió sólo booleanos, no PII, y
    terminó en `ROLLBACK`. El mismo identificador también alcanzaba
    `store-pay` y `store-order-email` mediante clientes `service_role`.

    Cada orden recibe ahora un UUID único/no nulo. El nuevo RPC exige esa
    capacidad, la sesión del comprador dueño de la orden o número + email con
    ocho intentos cada diez minutos; el RPC anterior se revoca y elimina. El
    checkout recupera la capacidad con el email recién validado, la conserva
    en `sessionStorage` y los emails la ubican en `#access`: el fragmento no
    viaja en el request HTTP ni en el `Referer` y se limpia al abrir. Enlaces
    históricos muestran un estado de verificación neutral. Pago, Brick,
    reintentos y correos comparan otra vez la capacidad en servidor; el
    `baseUrl` de los emails deja de venir del browser.

    La traducción sigue el estado preautenticado por token de
    [Shopify](https://shopify.dev/docs/apps/build/customer-accounts/order-status-page),
    el seguimiento comunicado por
    [Tiendanube](https://ayuda.tiendanube.com/es_AR/123288-mis-ventas/como-puede-mi-cliente-conocer-el-estado-de-su-compra)
    y la regla de [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html):
    un id opaco ayuda, pero no reemplaza autorización. El cliente conserva un
    fallback al RPC viejo **sólo** si falta la firma nueva, para desplegarlo
    antes del corte de base; después de crearla no vuelve a ejecutarse.

    Estado al primer commit: SQL completo ejecutado dentro de una transacción
    revertida (`old_removed=true`, `secure_created=true`, `missing_tokens=0`),
    typecheck, lint 0 errores/139 warnings conocidos, **2.096/2.096 pruebas en
    212 archivos**, build/PWA (18 entradas, 2.018,70 KiB), 74 Edge Functions,
    `npm audit` sin vulnerabilidades, 84 enlaces internos y conteos 74/498.
    `c543249` quedó `Ready / Production`; después se aplicó y registró
    `20260830000020`, y el dry-run final quedó `upToDate=true`. `store-pay` v40,
    `store-order-email` v34 y `store-order-status-email` v17 están ACTIVE. Sin
    imprimir PII, el rol `anon` demostró contrato viejo ausente, número solo 0,
    token incorrecto 0, token correcto 1 y número + email correcto 1. Las
    fronteras publicadas respondieron pago sin token 404, pago con token válido
    409 por estado final de esa orden —por lo tanto superó acceso sin iniciar
    proveedor—, email sin token 404 y aviso de estado sin sesión 401. No se
    envió email, no se creó preferencia y no se modificó ninguna orden.

    El estado neutral publicado pasó 360/768/1024/1440 con
    `scrollWidth = clientWidth`, encabezado visible, input de 42 px, CTA de
    44 px y PII ausente. Un email sintético inválido mostró el mismo alerta de
    verificación; consola 0 warnings/errors. Dos sesiones ya autenticadas como
    comprador conservaron el detalle completo, que es el estado autorizado.
    Falta una compra sandbox/real de punta a punta; no se usa el pedido
    productivo para mutar ni enviar comunicaciones.
    Evidencia:
    [`docs/evidencias/2026-08-30_store_order_access_control.md`](docs/evidencias/2026-08-30_store_order_access_control.md).

80. Storefront D5.3: una venta no puede convertirse en spam por retry — P0 de
    confiabilidad y costo cerrado localmente el 2026-08-30; publicación
    pendiente de este commit. Checkout, `store-pay` y el webhook de Mercado
    Pago pueden informar la misma orden, mientras dos operadores pueden repetir
    el aviso de despacho. La confirmación inicial no tenía deduplicación y el
    aviso logístico hacía `SELECT` seguido de `INSERT/UPDATE`: una restricción
    única evitaba dos filas, pero no dos llamadas concurrentes al proveedor.

    `20260830000021` convierte el log privado en un ledger para orden +
    audiencia + evento (`order_created`, `payment_confirmed`, `shipped`,
    `delivered`). Un RPC toma el evento con lock, token y lease de 30–900
    segundos; otro worker recibe `duplicate` o `inProgress`. La red ocurre
    **fuera** de esa transacción y `finish` sólo acepta el token del intento
    vigente. El aviso al comercio nace una vez al crear la orden; el comprador
    recibe creación y, si corresponde, confirmación de pago como eventos
    distintos. Fallos y workers caídos se reintentan con contador auditable.

    Resend recibe además una `Idempotency-Key` estable y su `messageId` se guarda
    sólo en el ledger. La [documentación oficial](https://resend.com/docs/dashboard/emails/idempotency-keys)
    mantiene esa barrera 24 horas; el ledger propio permanece como autoridad
    durable y protege también SMTP. No se afirma exactly-once sobre SMTP: ante
    una caída exacta después de aceptar el correo y antes de registrar el
    resultado, ningún protocolo genérico puede demostrarlo. La arquitectura
    reduce esa ventana sin fingir una garantía del proveedor. Los futuros
    [webhooks de entrega](https://resend.com/docs/webhooks/introduction) deberán
    deduplicar `svix-id` porque Resend declara entrega al menos una vez.

    La fixture ejecutó la migración completa dentro de `BEGIN/ROLLBACK` sobre
    una orden existente y un destinatario sintético: primer claim sí,
    simultáneo bloqueado, token ajeno bloqueado, cierre sí, reintento enviado
    deduplicado, lease vencido recuperado como intento 2, worker viejo bloqueado
    y tabla/RPC inaccesibles para `anon`/`authenticated`. No llamó a un
    proveedor, no imprimió PII y no dejó filas. Puerta completa: typecheck, lint
    0 errores/139 warnings conocidos, **2.102/2.102 pruebas en 213 archivos**,
    build/PWA (18 entradas, 2.018,70 KiB), 74 Edge Functions, `npm audit` 0,
    85 enlaces internos en 53 documentos y conteos 74/499. Falta aplicar/registrar migración,
    desplegar las dos Edges y repetir el contrato productivo sin enviar correo.
    Evidencia:
    [`docs/evidencias/2026-08-30_store_order_email_idempotency.md`](docs/evidencias/2026-08-30_store_order_email_idempotency.md).

81. Checkout D5.4: no ofrecer un cobro que no se puede ejecutar — 2026-09-01.
    Activar Nerqia Pay y marcar Mercado Pago en la tienda eran dos
    interruptores. El default trae ambos medios; con transferencia el readiness
    no bloqueaba y el comprador veía Mercado Pago aunque no hubiera token.
    `get_store_by_slug` lista sólo medios vivos (token + medio habilitado;
    Stripe/PayPal fuera). Un INSERT con `mercadopago` sin rail no entra a
    `ecommerce_orders`. El checkout ya no inventa transferencia si la lista
    viene vacía. Verificado en este recorte: 2.130/2.130 pruebas (2026-09-01).
    Migración `20260901000020` aplicada y anotada en el libro. Fixture
    reversible sobre producción: 1 tienda, 0 Mercado Pago ofrecido sin Pay,
    0 Stripe/PayPal, trigger presente, helpers revocados de `anon`, ROLLBACK.
    Falta una compra sandbox/real; este recorte cierra el medio muerto, no
    certifica el proveedor.

82. Pedidos de la tienda: buscar, filtrar y exportar lo que se ve — 2026-09-01.
    Con el cobro ya honesto, el comercio operaba la cola en chips en inglés
    (`pending`) y sin búsqueda: no encontraba un pedido, no distinguía “para
    despachar” de “pendiente de pago” y no podía llevarse el recorte a una
    planilla. La paridad de [Tiendanube Ventas](https://ayuda.tiendanube.com/es_AR/123288-mis-ventas/como-buscar-y-filtrar-mis-ventas)
    se traduce, no se copia: número / cliente / email / teléfono / monto,
    vistas en español persistidas en `?tab=orders&q=&vista=`, CSV del conjunto
    filtrado (celdas escapadas, sin fórmulas) y cards a 360 px. “Para
    despachar” es la misma regla del Foco del día (pagado y todavía no salió);
    el pendiente del dashboard aterriza en esa vista. No hay selección masiva:
    despachar sigue siendo uno por uno, con la misma autoridad de envío de
    antes. La cola lee los últimos 200; si se llena, lo dice. El inspector
    quedó en el ítem 83. Falta bulk con RPC y una cola real con más de 200
    filas. Verificado en este recorte: 2.144/2.144 pruebas en 218 archivos;
    typecheck OK.

83. Pedidos: inspeccionar sin perder la cola — 2026-09-01.
    Encontrar la orden no alcanzaba: el clic abría el envío y sólo si estaba
    paga, así que una impaga no tenía ficha y una paga tapaba la lista.
    `?pedido=` conserva búsqueda y vista, como `?sale=` en Ventas. La ficha
    muestra cliente, destino, ítems e importes del checkout; no inventa margen.
    Un id ajeno o borrado no consulta otra organización. El despacho sigue
    aparte, con la misma autoridad de siempre. Un deep link fuera de los
    últimos 200 se lee con `org_id` + `id`. Falta bulk con RPC y una cola real
    de más de 200 en uso. Verificado en este recorte: 2.152/2.152 pruebas en
    219 archivos; typecheck OK.

84. Recorrido de compra a 360 px — 2026-09-01.
    La vitrina ya vendía en desktop; en el teléfono el CTA se iba con el
    scroll: la ficha escondía Agregar detrás de la descripción, el carrito
    cerraba con un ícono de 20 px y Confirmar quedaba bajo el teclado. La
    ficha deja una barra fija con el precio; el carrito cierra/quita/termina
    a 44 px; filtros y checkout conservan la acción al pie, con safe-area.
    No se finge una compra sandbox: este recorte cierra el dedo, no el cobro
    contra Mercado Pago. Verificado en este recorte: 2.155/2.155 pruebas en
    220 archivos; typecheck OK.

85. Vitrina D5.8: skeleton y tamaño de imagen, sin chrome del SaaS —
    2026-09-01. La primera pintura era un spinner `bg-background` (tokens del
    panel) y después saltaban header, banner y grilla. El esqueleto reserva
    barra legal, header de 64 px, banner `16/7` y ocho tarjetas `1/1` con
    `--st-*` del tema minimal. Banner de home y foto de ficha piden LCP;
    cards, categorías, logo y miniaturas declaran `width`/`height`/`sizes` y
    quedan `lazy`. No se recorta el archivo del comercio ni se afirma un LCP
    de campo: este recorte cierra el salto perceptible, no la red lenta.
    Verificado en este recorte: 2.160/2.160 pruebas en 221 archivos;
    typecheck OK; lint 0 errores y 139 warnings conocidos.

86. Vitrina D5.9: que Google vea la tienda, no Nerqia — 2026-09-01.
    Search Console inspeccionaba con `Google-InspectionTool` y recibía el
    HTML de la SPA (`Nerqia`), no el de Exentry: ese UA no estaba en el
    rewrite. `robots.txt` nunca declaraba `Sitemap:`. El listado canibalizaba
    la home. La ficha decía `og:type=website` y un precio sin promoción.
    El borde ahora reconoce InspectionTool/AdsBot/Storebot/DuckDuckBot;
    `robots.txt` lista las tiendas activas vía `list_published_store_slugs`;
    PLP/páginas/legales tienen canonical y schema propios; checkout queda
    `noindex`; el precio declarado es `precioDeCatalogo`, el mismo que cobra
    `resolve_store_line`. No es SSR ni dominio propio (congelado). El primer
    deploy dejó `public/robots.txt` tapando el borde — Vercel sirve el
    estático antes del rewrite — y el archivo se retiró. Falta contrastar
    `Sitemap:` en `/robots.txt` publicado.
    Verificado en este recorte: **2.171/2.171 pruebas en 222 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos. Migración
    `20260901000030` aplicada y anotada; RPC lista `exentryimports`.

87. Vitrina D5.10: una red lenta no es un 404 — 2026-09-01.
    Después del SEO, el crawler encuentra la tienda y el comprador en 3G
    veía «Tienda no encontrada» o un catálogo en cero: `get_store_by_slug`
    y `fetchStoreProducts` convertían un corte de red en vacío. El 404
    queda para tienda inexistente; el error invita a Reintentar (el
    carrito vive en localStorage); `create_store_order_idem` reintenta
    el mismo corte con la misma clave. No se finge offline POS ni una
    compra sandbox. Verificado en este recorte: **2.177/2.177 pruebas en 223 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos.

88. Vitrina D5.11: el seguimiento tampoco miente con la red — 2026-09-01.
    D5.10 cubría la vitrina. El pedido, el carrito recuperado, la cuenta y
    el link de pago seguían convirtiendo un `Failed to fetch` en «ingresá
    el email», «carrito vencido», «no hiciste pedidos» o «link no
    encontrado». Un poll que fallaba además borraba la ficha ya vista.
    Ahora el error invita a Reintentar; el email (D5.2) sólo se pide
    cuando el servidor respondió sin capacidad. No hay bulk: las dos
    órdenes pagas son de $1 desde julio, no una cola operativa.
    Verificado en este recorte: **2.183/2.183 pruebas en 223 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos.

89. P0.1.1: el workspace de Productos no se presenta como perfumería — 2026-09-01.
    El segundo comercio (`pruebas Workspace`) no eligió rubro, tiene 0
    productos y 0 tipos, y aun así veía «Buscador perfume». Exentry sí eligió
    `perfumes` y conserva el buscador, las facetas y «similares». La ficha
    olfativa del formulario sigue gated por la categoría del producto: este
    slice no la saca ni asigna `product_type_id`. La decisión vive en
    `elCatalogoOperaPerfumes`: rubro `perfumes` o productos ya cargados
    en esa familia. No hay más chrome de vitrina.
    Verificado en este recorte: **2.187/2.187 pruebas en 224 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos.

90. P0.1.2: Clientes, catálogo interno y Reportes tampoco se presentan como perfumería — 2026-09-01.
    El mismo invariante de P0.1.1 en las otras superficies que lo nombraban
    sin preguntar. Instagram y WhatsApp se quedan: son contacto, no una
    vertical. Preferencias olfativas, «Compra vapers», el recomendador,
    «Filtros de perfume» y «Ingresos por familia olfativa» sólo si
    `elCatalogoOperaPerfumes` / `elCatalogoOperaVapers`. Guardar la ficha
    no pisa `scent_preferences` ni `buys_vapers` cuando esos campos no
    se muestran. No se asigna `product_type_id`.
    Verificado en este recorte: **2.190/2.190 pruebas en 224 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos.

91. El canal de activación no se adivina — 2026-09-01.
    El segundo comercio no terminó el onboarding y aun así
    `onboarding_goal` era `pos` (default de columna) y un `localStorage`
    lo dejaba entrar al panel. La ruta a la primera venta daba el
    mostrador por elegido. Quien no eligió está en `explore`; POS/online
    se escriben al terminar el wizard. Exentry, que sí eligió, no se
    toca. Migración `20260901000040`.
    Verificado en este recorte: **2.192/2.192 pruebas en 224 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos. Alta ZZ:
    canal `explore`, formulario sin hacer, 0 restos.

92. El wizard no deja el primer producto en un query huérfano — 2026-09-01.
    Elegir POS o tienda escribía `?onboarding=1&goal=…` y nadie lo leía:
    Productos mostraba un vacío genérico y Commerce un embudo en cero
    con el aviso de Mercado Pago primero. Ahora el catálogo vacío abre
    el formulario (una vez, si hay permiso), el copy depende del canal
    y Commerce manda a cargar producto antes de publicar. El checklist
    y el readiness de la tienda reusan `firstProductPath`. El placeholder
    del wizard dejó de ser «Perfumería Andrea».
    Verificado en este recorte: **2.200/2.200 pruebas en 225 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos.

93. El primer producto se puede vender de verdad — 2026-09-01.
    El formulario exigía costo (y lo chequeaba en USD aunque se hubiera
    cargado en pesos) y dejaba el stock en 0. Quien salía del wizard
    guardaba un SKU que el POS no podía cobrar. Ahora la puerta es nombre,
    precio de venta y unidades; el costo avisa el margen y no traba. La
    primera ficha no acepta stock 0. El placeholder dejó de ser Lattafa,
    el género arranca en `unisex` y `content_ml` ya no se siembra en 100.
    Verificado en este recorte: **2.208/2.208 pruebas en 226 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos.

94. El POS cobra el primer producto sin pedir turno — 2026-09-01.
    Guardar el primer SKU dejaba al comercio en Productos con un toast.
    El mostrador unificaba “sin catálogo”, “sin stock” y “no hay match” en
    «Sin resultados», escondía servicios (`maneja_stock = false` vive en
    stock 0) y el copy de caja cerrada sonaba a bloqueo. Ahora el primer
    producto de POS abre `/caja?onboarding=1`, la grilla muestra lo
    cobrable, el vacío manda a cargar unidades y se puede cobrar con el
    turno cerrado. El ejemplo de voz dejó de ser Lattafa.
    Verificado en este recorte: **2.217/2.217 pruebas en 227 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos.

95. El primer ticket se cierra cobrado y Ventas apunta al POS — 2026-09-01.
    El recibo de efectivo ofrecía un link de Mercado Pago (otro cobro) y
    «¿Quién atiende hoy?» tapaba la grilla al llegar del wizard. Ventas
    vacío abría un formulario paralelo, no el mostrador. El ticket cobrado
    dice que quedó en Ventas, el vendedor no bloquea la primera venta y el
    vacío manda a `/caja`.
    Verificado en este recorte: **2.223/2.223 pruebas en 228 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos.

96. La primera visita al POS no pone fiado al lado de efectivo — 2026-09-01.
    Siete medios al mismo nivel. QR pide Mercado Pago, fiado no cobra y
    mayorista no es un cobro. Quien llega del wizard ve efectivo y
    transferencia; el resto queda detrás de «Más medios». Si eligen
    fiado, el POS dice que el ticket queda a cuenta.
    Verificado en este recorte: **2.225/2.225 pruebas en 228 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos.

97. La primera venta POS se midió de punta a punta, y la ficha deja de
    ser la del importador — 2026-09-01.
    KYC, selfie, score de fraude y motor de riesgo F7 no entran: Pay no
    custodia, MercadoPago ya identifica al vendedor y `sinSimulacion`
    prohíbe un semáforo inventado. Lo que faltaba era **medir** el camino
    que el comercio recorre. `20260827_comercio_nuevo_puede_vender.sql`
    plantaba la org y escribía `products.stock` en el INSERT. La
    verificación nueva parte del alta, termina el wizard en `pos`, siembra
    Casa central, carga el SKU por `adjust_stock` y cobra efectivo **sin
    turno**. Contra producción, 2026-09-01: 20/20 ok, 0 restos. Stock
    global y de sucursal bajaron juntos; el libro asentó; la activación
    contó la venta. La ficha de primera vez muestra nombre, precio y
    unidades; foto, marca y atributos quedan un clic atrás y no traban
    el guardado. `pruebas Workspace` sigue con onboarding incompleto y 0
    productos — eso no se resuelve con un tablero de fraude.

    Verificado en este recorte: **2.234/2.234 pruebas en 229 archivos**
    (`npm test -- --maxWorkers=1 --fileParallelism=false`, 2026-09-01);
    typecheck OK; lint 0 errores y 139 warnings conocidos. Contra la base:
    20/20 pasos ok, 0 restos. El navegador de esta PC no tiene `VITE_*`:
    no se afirma la ficha compacta contra datos reales.

98. El POS puede facturar en ARCA, y el ticket 80 mm deja de parecer
    una factura — 2026-09-01.
    El mostrador cobraba y no tenía camino a ARCA: `facturar_pendientes`
    cubre órdenes de tienda, no tickets. Ahora hay un checkbox opt-in
    (apagado por default: la primera venta no se traba en AFIP). El cobro
    corre igual si ARCA falla. `facturar_venta_pos` es idempotente por
    `sale_transaction_id`, reusa `tipo_de_comprobante` y no adivina la
    condición IVA. El CAE lo pide `afip-authorize`; el cliente no escribe
    `invoices.cae`. El botón de impresión dice «Ticket 80 mm» y el pie
    aclara que no es comprobante fiscal: sale por el diálogo del sistema
    si hay una térmica instalada. Controladora fiscal: no. Es otro régimen
    y otro hardware; queda en §13.

    Verificado en este recorte: **2.244/2.244 pruebas en 230 archivos**
    (`npm test -- --maxWorkers=1 --fileParallelism=false`, 2026-09-01);
    typecheck OK; lint 0 errores y 139 warnings conocidos. Contra la base:
    15/15 ok, 0 restos (`20260901_facturar_venta_pos.sql`). El navegador
    de esta PC no tiene `VITE_*`: no se afirma el checkbox contra una
    sesión real.

99. El wizard online carga el producto, y Commerce deja de fingir un
    embudo — 2026-09-01.
    Elegir tienda mandaba a `/tienda-online` con el toast «Publicá la
    tienda». El overview abría con Revenue $0, «Checkout iniciado» =
    carritos × 0,37 y el aviso de Mercado Pago encima del catálogo.
    Transferencia ya cobra; sin producto no hay nada que publicar. Ahora
    el wizard online aterriza en Productos, igual que POS. El embudo
    cuenta sesiones, carritos y órdenes reales. Sin tráfico no se
    muestran KPIs. Pay no es el primer clic si todavía no hay catálogo.
    El tab Publicar muestra el estado de la tienda, no un dashboard
    vacío.

    Verificado en este recorte: **2.249/2.249 pruebas en 231 archivos**;
    typecheck OK; lint 0 errores y 139 warnings conocidos. El navegador
    de esta PC no tiene `VITE_*`: no se afirma el aterrizaje contra una
    sesión real.

100. La tienda no nace con la identidad de Exentry — 2026-09-01.
     Commerce sembraba «Mi Tienda Online», el dorado `#f59e0b`, envío
     $2.500 y envío gratis desde $50.000. Un Guardar sin tocar esos
     campos publicaba tarifas que nadie eligió y un slug que choca
     entre comercios. Misma familia que `industry_code = perfumes`.
     El formulario toma el nombre y el color de la organización; el
     envío vacío se guarda como $0 / NULL; una tienda nueva ofrece
     transferencia, no Mercado Pago desconectado. La base cambia el
     DEFAULT; no se backfillean vitrinas existentes.

     Verificado en este recorte: **2.259/2.259 pruebas en 233 archivos**
     (`npm test -- --maxWorkers=1 --fileParallelism=false`, 2026-09-01);
     typecheck OK; lint 0 errores y 138 warnings conocidos. Contra la
     base: defaults aplicados y anotados (`20260901000060`). El
     navegador de esta PC no tiene `VITE_*`: no se afirma el formulario
     contra una sesión real.

101. Las páginas legales leen al emisor de verdad, no al nombre de
     fantasía — 2026-09-01.
     El panel pedía razón social, CUIT, domicilio y email aunque Facturas
     ya tenía al emisor en `afip_connection_status`. Leía el espejo de
     `settings.afip_*`, usaba `business_name` como razón social (un
     workspace «pruebas» quedaba como firma) y tiraba a vacío el email
     de avisos de la tienda. Medido contra la base: Exentry tiene CUIT y
     razón en `afip_credentials`, domicilio NULL, `notification_email`
     NULL. Ahora la semilla sale de la misma vista que Facturas; el
     nombre de fantasía no es razón social; el email de avisos sí es
     contacto. Sigue siendo borrador: no se publica por el dueño.
     Domicilio y email de Exentry siguen esperando que los declare.

     Verificado en este recorte: **2.266/2.266 pruebas en 234 archivos**;
     typecheck OK; lint 0 errores y 138 warnings conocidos. El navegador
     de esta PC no tiene `VITE_*`: no se afirma el formulario contra una
     sesión real.

102. Conectar AFIP pide el domicilio fiscal, una vez — 2026-09-01.
     El formulario ya tenía el campo y `save_afip_config` lo aceptaba
     vacío. Facturas y las páginas legales leen la misma vista: Exentry
     tiene CUIT y razón, domicilio NULL. Ahora la autoridad rechaza
     razón social o domicilio vacíos, misma firma. `configured` no
     cambia: ARCA no pide domicilio para emitir CAE. No se backfillea
     ni se adivina desde el padrón, el retiro o el login. Exentry sigue
     esperando que lo declare.

     Verificado en este recorte: **2.272/2.272 pruebas en 235 archivos**
     (`npm test -- --maxWorkers=1 --fileParallelism=false`, 2026-09-01);
     typecheck OK; lint 0 errores y 138 warnings conocidos. Contra la
     base: `save_afip_config` rechaza domicilio o razón vacíos, acepta
     ambos, restos 0 (`20260901000070`). Exentry sigue con domicilio
     NULL. El navegador de esta PC no tiene `VITE_*`: no se afirma el
     formulario contra una sesión real.

103. Después del primer producto, Commerce no empuja Pay — 2026-09-02.
     El wizard online ya aterrizaba en Productos. Al volver a Commerce con
     un SKU, el overview seguía abriendo con «Activar Nerqia Pay» aunque
     el default es transferencia y el checkout no lista Mercado Pago hasta
     que Pay está vivo. El banner sólo aparece si el comercio marcó Mercado
     Pago, no hay otro medio y no hay conexión: ahí el checkout no cobra.
     Con catálogo, el overview habla de publicar (Pagos y envíos / legales).
     El aviso de `pay-rail` sigue en el estado de la tienda. Una tienda ya
     activa no vuelve a decir «activá». Recorte: `storeFirstPublish` verde.

104. Publicar escribe `is_active`, no deja el interruptor sin guardar —
     2026-09-02. El recorte 103 mandaba a Pagos y envíos. El toggle de
     «Tienda Activa» sólo mutaba el formulario: sin Guardar la vitrina
     seguía apagada. Si el checklist está listo, el CTA publica de verdad.
     Si falta algo, sigue abriendo legales y envíos. No se publica por
     el comercio cuando hay bloqueantes.

105. Una tienda nueva ofrece retiro, no espera el tarifario — 2026-09-02.
     El formulario nacía con `pickup_enabled: false` y envío plano en $0.
     Publicar sin 24 provincias dejaba al comprador sin entrega. El
     checkout ya tiene fallback si falta la dirección de retiro. No se
     backfillea: una fila guardada conserva lo que el comercio eligió.

106. Legales y AFIP comparten el domicilio — 2026-09-02.
     Generar términos con el domicilio tipado en el panel no tocaba
     `afip_credentials`: Facturas seguía sin domicilio. Si AFIP ya tiene
     CUIT y punto de venta, al generar se sincroniza razón/domicilio con
     el mismo CUIT. Link a `/afip` cuando falta identidad. Borradores:
     «Revisar y publicar» en el checklist y botón Publicar en el editor.
     Sigue sin publicarse el texto por el comercio.

107. Retiro sin dirección no publica — 2026-09-02.
     El default de retiro dejó tiendas «listas» con el checkout diciendo
     «te vamos a contactar». Ahora falta la dirección es bloqueante del
     checklist; el CTA Publicar no escribe `is_active` hasta cargarla.

108. El retiro puede tomar el domicilio fiscal — 2026-09-02.
     Con AFIP cargado y retiro vacío, Commerce ofrece «Usar domicilio
     fiscal». No se pisa una dirección ya escrita ni se inventa. Es el
     mismo texto que Facturas y legales; el local de retiro puede ser otro.

109. El checklist abre la pestaña correcta — 2026-09-02.
     «Activar Nerqia Pay», slug, SEO y envío plano mandaban a
     `/tienda-online` sin tab: el overview. Ahora van a `settings` o
     `design`, donde está el control. Pay-rail igual.

110. El checklist avisa el email de ventas — 2026-09-02.
     Sin `notification_email` los avisos caen al dueño y los
     legales piden un contacto al generar. Es warning, no bloqueo. Los
     medios de cobro del checklist también apuntan a Pagos y envíos, no
     a Integraciones.

111. El email de avisos puede tomar el de la sesión — 2026-09-02.
     Mismo patrón que el domicilio fiscal: vacío + correo de sesión con
     `@` → botón «Usar mi correo». El texto aclara que el fallback real
     es el dueño (como `store-order-email`), no «quien esté logueado».

112. El checklist se actualiza al publicar legales o conectar Pay —
     2026-09-02.
     Las señales de readiness sólo se leían al montar Commerce: generar
     legales o vincular Mercado Pago dejaba el panel mintiendo hasta un
     F5. Ahora se releen al cambiar de pestaña, al mutar páginas y al
     cambiar la conexión de Pay.

113. P0.1.3: el alta tipa el producto — 2026-09-02.
     Medido: Exentry tenía 1 tipo Perfume y 4 atributos, 0/60 productos
     con `product_type_id`. Al crear (incluida la ficha compacta) se
     asigna el default si hay un solo tipo activo o uno claro del
     perfil. Backfill idempotente para orgs con un solo tipo. No se
     inventan valores de atributos ni se migra la ficha olfativa.

114. P0.1.4: la ficha mira el tipo tipado — 2026-09-02.
     Chrome de perfume / vaper / tecnología en el formulario de Productos
     usa `laFichaEsPerfume` (y hermanas): si hay slug de
     `product_types`, ese manda; sin tipo, la categoría legacy sigue
     abriendo. Un producto tipado como plato no abre ficha olfativa
     aunque conserve un slug de perfume. No se borran tablas verticales.

115. P0.1.5: decants en Ventas miran el tipo — 2026-09-02.
     La venta por ml usaba `category === perfume_*`. Ahora
     `productoEsPerfume` resuelve el slug desde `product_type_id` (mapa
     de tipos de la org) y cae a la categoría si no hay tipo. Un plato
     con slug de perfume heredado no ofrece decant.

116. Commerce: transferencia usable de punta a punta — 2026-09-02.
     Vuelta al core de tienda (ADR 002): sin CBU/alias el default de
     cobro no cierra la primera venta. Checklist bloquea publicar,
     Commerce guarda `settings.bank_*`, el pedido público y el email
     muestran datos copiables, y `online_payment_ready` exige CBU/alias
     si el medio es transferencia. Activación apunta a
     `/tienda-online?tab=settings`, no a Integraciones. No se inventó
     tabla bancaria ni se exigió Mercado Pago.

117. UX propia: sin confirm del navegador + AI Action Rate visible — 2026-09-02.
     ~45 `confirm()`/`window.confirm` migrados a `useConfirmDialog` +
     `ConfirmDialog`. Guarda `sinConfirmDelNavegador`. Banners
     permanentes («Cómo funcionan», tips ABC/conversión, ANMAT siempre
     visible) pasaron a PageGuide o empty. El recomendador de ofertas
     pide confirmación propia al aplicar y muestra AI Action Rate (G8);
     generar sin aplicar no se presenta como éxito.

118. Pay Slice A: Nerqia Pay ≠ Mercado Pago — 2026-09-02.
     Medio canónico de tienda `gestiona_pay` (alias `mercadopago` en
     lectura). Commerce y checkout dicen «Nerqia Pay»; letter chica
     «procesado con Mercado Pago». `medios_de_pago_vivos` y el trigger
     aceptan ambos y normalizan al canónico. Rail OAuth sigue en
     `payment_connections.provider = mercadopago`. Guarda en
     `commercePayHonesty`: no vuelve «Mercado Pago (Nerqia Pay)».

119. Pay Slice B: catálogo OAuth vivo / próximamente — 2026-09-02.
     Panel de Pay lee `medios_de_pago_de`. Nerqia Pay sigue siendo la
     única activación. MODO, Naranja X y Go Cuotas se listan como
     Próximamente sin Conectar. Catálogo SQL alineado (Nerqia Pay
     producto; MP = rail). Sin segundo OAuth inventado.

120. Commerce: confirmar cobro manual de transferencia — 2026-09-02.
     Slice C de Pay (segundo OAuth) queda bloqueado sin contrato. El
     hueco medido: transferencia usable dejaba pedidos `pending` sin
     RPC autenticada para acreditar (`mark_store_order_paid` es
     service_role). `confirmar_pago_manual_tienda` + botón en el
     inspector. Sólo transferencia/efectivo; Pay sigue por webhook.

121. El Foco no grita cobros digitales muertos — 2026-09-02.
     Medido: 4 pedidos `pending` en Exentry; 3 son Mercado Pago de
     julio (preferencia vencida) y 1 transferencia. El Pulse los
     contaba a todos como críticos. Shopify Sidekick / Tiendanube
     muestran lo accionable hoy. El Foco cuenta transferencia/efectivo
     y Pay de las últimas 72 h; la cola Commerce sigue listando el
     histórico. Pulse ≤5, como Sidekick. No se partió el Core en
     microservicios: las Edge Functions ya aíslan MP/ARCA/correo.

     Verificado en este recorte: **2.367 tests** (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Esta PC no
     tiene `VITE_*`: no se afirma el Foco contra una sesión real.

122. Portada modular al estilo Tiendanube, sin theme engine — 2026-09-02.
     Tiendanube deja ordenar los bloques de Inicio. Traducción: JSON
     `storefront_layout` (vacío = automático, como `nav_links`), barra
     de anuncio, quick-add que exige variante y ATC sticky cuando el
     botón sale de vista. No hay editor en vivo ni plantillas nuevas:
     el Core sigue siendo la autoridad de stock y precio.

     Verificado en este recorte: **2.373 tests** (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Esta PC no
     tiene `VITE_*`: no se afirma la tienda pública contra una sesión
     real.

123. Galería de ficha con zoom y desliz — 2026-09-02.
     Tiendanube/Shopify abren la foto y dejan pasar entre tomas. La
     ficha ahora desliza, abre a pantalla completa, acerca 2× sobre la
     URL del comercio y pone primero la imagen de la variante. Sin CDN
     ni theme engine: el Core sigue mandando stock y precio.

     Verificado en este recorte: **2.379 tests** (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Esta PC no
     tiene `VITE_*`: no se afirma la ficha contra una sesión real.

124. El checkout no promete envío nacional sin tarifario — 2026-09-02.
     Medido: 6 zonas, tarifa en CABA. El anuncio "Envío gratis desde
     $150.000" y el selector de 24 provincias fingían cobertura. La
     vidriera ahora lista provincias con tarifa activa; Córdoba dice
     "sin envío a domicilio". Shopify/Tiendanube cotizan después de
     la ubicación. Completar tarifario sigue siendo del dueño.

     Verificado en este recorte: **2.382 tests** (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). RPC contra
     la base: Exentry expone `["AR-C"]`. Esta PC no tiene `VITE_*`: no
     se afirma el checkout contra una sesión real.

125. Córdoba puede retirar: el aviso no traba Confirmar — 2026-09-02.
     Medido: 6 zonas, tarifa en CABA, retiro en La Rioja. El checkout
     guardaba “A domicilio no llega… Podés retirar” en el mismo flag
     que apagaba el botón. Shopify/Tiendanube informan y dejan cerrar
     con pickup. Info ≠ bloqueo; un domicilio que no cotizó sigue
     sin pasar. El servidor ya rechaza un `option_id` ausente.

     Verificado en este recorte: **2.388 tests** (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Esta PC no
     tiene `VITE_*`: no se afirma el checkout contra una sesión real.

126. El retiro no se despacha — 2026-09-02.
     Medido: 2 órdenes pagas, las dos `carrier=retiro` / `sucursal`,
     fulfillment `processing`. El Foco gritaba “sin despachar”. Square
     y Shopify tienen cola de pickup. Vista `retirar`, Pulse aparte,
     RPC que cierra a `delivered` sin etiqueta. Domicilio sigue
     exigir `deliveries` + `shipped`. No se tocaron las filas ZZ.

     Verificado en este recorte: **2.394 tests** (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). RPC aplicada
     y anotada (`20260902000100`). Esta PC no tiene `VITE_*`: no se
     afirma el Foco contra una sesión real.

127. El Foco deja de mandar a POS a quien eligió tienda — 2026-09-02.
     Medido: Exentry `onboarding_goal=online`; pruebas `explore` sin
     tienda. El Pulse decía «Abrir el POS» y Alt+2 iba a `/caja`.
     Shopify/Tiendanube no mandan a un PDV a quien abrió una vitrina.
     Canal POS sigue en el mostrador; `explore` entra por Commerce.
     Tienda sin publicar gana al tarifario. Commerce copia el enlace
     público (`/tienda/:slug`); dominio propio sigue congelado (F4).

     Verificado en este recorte: **2.403 tests** (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Esta PC no
     tiene `VITE_*`: no se afirma el Foco contra una sesión real.

128. Contacto de vitrina: WhatsApp e Instagram — 2026-09-02.
     Medido: `ecommerce_stores.social_links = {}` en Exentry. El pie
     leía Instagram y Commerce nunca lo escribía. Tiendanube muestra
     WhatsApp en la tienda. El href se construye (`wa.me` / instagram.com);
     no se pega URL cruda ni se usa `settings.whatsapp_number` (digest
     del dueño). El comercio carga el número; no se inventa.

     Verificado en este recorte: **2.411 tests** (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Esta PC no
     tiene `VITE_*`: no se afirma la vitrina contra una sesión real.

129. Al nacer la tienda nacen las zonas de envío — 2026-09-02.
     Medido: pruebas Workspace 0 tiendas / 0 zonas; Exentry 1 / 6 / 1
     tarifa. Completar tarifario y el Foco de «zonas sin tarifa» no
     existen sin filas: el segundo comercio publicaba y el checkout
     sólo ofrecía retiro. Tiendanube/Shopify siembran regiones al
     crear la tienda. Trigger `AFTER INSERT` en `ecommerce_stores` →
     6 zonas AR, idempotente. La RPC del panel ahora exige membresía
     (`42501`). Foco: tienda publicada con 0 zonas → «Crear zonas».
     Readiness: el CTA no promete Completar tarifario si no hay zonas.
     Tarifario y pesos siguen siendo del dueño; no se inventan precios.

     Verificado en este recorte: **2.417 tests** / 256 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Migración
     `20260902000110` aplicada y anotada (DO: INSERT tienda → 6 zonas,
     seed idempotente, 0 restos). Esta PC no tiene `VITE_*`.

130. El título de la pestaña nombra el producto — 2026-09-02.
     La SPA dejaba `meta_title` de la tienda en ficha, listado y checkout.
     WhatsApp/Google no ejecutan JS (`api/og` ya cubre crawlers). El
     comprador sí: al compartir o volver con muchas pestañas veía
     «Tienda online». `tituloDeRutaTienda` es espejo de `parseRutaTienda`.
     No se inventa precio ni se toca el borde.

     Verificado en este recorte: **2.419 tests** / 256 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Esta PC no tiene
     `VITE_*`: no se afirma la pestaña contra una sesión real.

131. Gracias y mail no prometen envío en un retiro — 2026-09-02.
     Medido: Exentry `pickup_enabled`, dirección en La Rioja,
     `pickup_instructions` vacío, 2 órdenes pagas `carrier=retiro`.
     El recorte 126 separó la cola del comercio; la página de gracias y
     `store-order-email` seguían: «Ya estamos preparando tu envío».
     Square/Shopify confirman pickup con lugar y horario. `get_store_by_slug`
     expone `pickup_instructions` (NULL si vacío: no se inventa).
     `get_store_order_secure` expone `carrier`/`shipping_service`.
     Foco y readiness avisan «Cargar horario»; tarifario/pesos/CUIT siguen
     del dueño.

     Verificado en este recorte: **2.428 tests** / 257 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Migración
     `20260902000120` aplicada y anotada (`get_store_by_slug` expone
     `pickup_instructions`; Exentry sigue NULL — no se inventó horario).
     Deploy de `store-order-email` aparte del `git push`. Esta PC no tiene
     `VITE_*`.

132. Retiro retirado ≠ domicilio entregado — 2026-09-02.
     Medido: 2 órdenes pagas `carrier=retiro`. Al marcar «retirado» el
     mail de estado decía «fue entregado» / «en camino»; el WhatsApp del
     gracias pedía «coordinar el pago» con el cobro ya acreditado.
     `copyEstadoPedido` + `textoWhatsAppPedido` espejan `esPedidoRetiro`.
     Sin evento nuevo: sigue `delivered` en el claim. Deploy de
     `store-order-status-email` aparte del push.

     Verificado en este recorte: **2.432 tests** / 257 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Deploy de
     `store-order-status-email` aparte del push. Esta PC no tiene `VITE_*`.

133. Seguimiento de retiro no promete envío — 2026-09-02.
     Medido: 2 órdenes pagas `carrier=retiro`. Gracias/mail ya honestos
     (131–132); `OrderTracking` seguía «Preparando el envío» → «En camino».
     `get_order_tracking` devolvía carrier de `deliveries` (NULL sin
     etiqueta). Ahora cae al carrier de la orden; pasos de retiro vía
     `pasosSeguimiento`. No se inventa horario ni tarifario.

     Verificado en este recorte: **2.434 tests** / 257 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Migración
     `20260902000130` aplicada y anotada. Esta PC no tiene `VITE_*`.

134. Publicar y transferencia no mienten — 2026-09-02.
     Medido: «Publicar» exige `canPublish`; el toggle Tienda Activa +
     Guardar podía dejar `is_active=true` sin readiness. Transferencia
     sin CBU/alias seguía en la vitrina («te vamos a escribir»).
     Gate unificado en `saveStore`; `transferencia_tienda_lista` +
     `medios_de_pago_vivos` + trigger de orden. Exentry sigue con
     transferencia viva (CBU/alias cargados). Tarifario/pesos/CUIT
     siguen del dueño.

     Verificado en este recorte: **2.435 tests** / 257 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Migración
     `20260902000140` aplicada y anotada. Esta PC no tiene `VITE_*`.

135. Checkout no promete «te contactamos» con transferencia — 2026-09-02.
     Medido: con transferencia viva el checkout decía «Te contactamos
     para coordinar el pago y la entrega» aunque la gracias ya muestra
     CBU/alias; el aviso salía si *cualquier* medio offline estaba en
     la lista, incluso eligiendo Pay. Tiendanube/Shopify instruyen el
     medio elegido. `avisoCheckoutMedioPago` + rótulo de efectivo
     retiro≠domicilio. No se inventa tarifario ni horario.

     Verificado en este recorte: **2.436 tests** / 257 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Esta PC no
     tiene `VITE_*`.

136. Envío por provincia (Tiendanube traducido) — 2026-09-02.
     Medido: Exentry 6 zonas / 1 tarifa (CABA); default `shipping_mode=
     flat` hacía que las zonas sembradas no cotizaran. Tiendanube tipa
     precio por provincia. Grilla `ProvinceRatesPanel` sobre el schema
     actual (parte zona compartida si hace falta); default `zones` en
     draft + columna. No se inventan tarifas ni se toca Exentry.

     Verificado en este recorte: **2.443 tests** / 258 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-02). Migración
     `20260902000150` aplicada y anotada. Esta PC no tiene `VITE_*`.

137. Margen canónico visible en Ventas online — 2026-09-03.
     Medido: `sale_margin_operations` usa `ecommerce_order_id` para
     `tienda_online`; el inspector de Ventas pedía `detail.id`
     (ticket/línea) y el diferencial quedaba built-but-dark. Tienda
     ya leía bien. `marginOperationIdForSale` + link al pedido.
     Foco/readiness CTA → «Precios por provincia». Las 2 ventas $1
     históricas de Exentry siguen sin `ecommerce_order_id` (pre-link).

     Verificado en este recorte: **2.444 tests** / 258 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

138. Mercado de integraciones + envíos AR honestos — 2026-09-03.
     Pedido: integraciones de envío AR + “marketplace” tipo Tiendanube.
     No se inventa Envío Nube ni etiqueta live sin contrato. Vista
     `merchant_integration_catalog` (sin secretos); tab Mercado en
     `/integraciones`; siembra `gestiona_envios` (production) + OCA
     (`needs_contract`); Correo/Andreani siguen `needs_contract`.
     Transportistas: copy que no promete API verificada.

     Verificado en este recorte: **2.449 tests** / 259 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Migración
     `20260903000010` aplicada y anotada. Esta PC no tiene `VITE_*`.

139. Carrito no miente envío en modo zones — 2026-09-03.
     Medido: con `shipping_mode=zones` (default ATM) el drawer decía
     «Gratis» si `shipping_cost` era 0, mientras el checkout cotiza por
     provincia vía `quote_store_shipping`. Shopify/Tiendanube no cierran
     flete sin ubicación. `cartShippingDisplay` → «Se calcula con tu
     provincia»; el total del carrito no inventa flat. Guardas en
     `storeCartShipping` + `storefrontConversion`.

     Verificado en este recorte: **2.454 tests** / 260 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

140. Cotización por provincia en el carrito — 2026-09-03.
     ESTANDAR §5.10 / Shopify-Tiendanube: costo de envío antes de pedir
     datos de más. El drawer en modo zones pide provincia, cotiza con
     `quote_store_shipping` (autoridad server) y precarga el checkout vía
     sessionStorage. No inventa tarifas; Exentry sigue con 1 provincia
     tarifada. Allowlist select nativo en StoreLayout documentada.

     Verificado en este recorte: **2.458 tests** / 261 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

141. Checkout honesto: flete + entrega primero + autofill — 2026-09-03.
     Medido: el resumen decía «Gratis» con `envio=0` sin opción elegida
     en modo zones (misma mentira del carrito 139). `checkoutShippingDisplay`
     no cierra flete pendiente; total muestra «+ envío». Orden Entrega →
     datos (ESTANDAR §5.10) con autofill/name y copy de invitado. No
     inventa tarifario; Finance Mendel F5 sigue gated por blueprint.

     Verificado en este recorte: **2.462 tests** / 261 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

142. Cotización de envío en la ficha (PDP) — 2026-09-03.
     ESTANDAR §5.10 / Shopify: flete tras ubicación antes de Agregar.
     `StoreShippingQuote` reusa `quote_store_shipping` + provincia del
     carrito; fuera de cobertura = retiro o mensaje honesto. No inventa
     tarifas.

     Verificado en este recorte: **2.465 tests** / 261 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

143. Mini-cart al agregar + handoff catálogo sin wizard — 2026-09-03.
     Medido: `addToCart` no abría el drawer; cotización/cross-sell
     quedaban detrás del ícono. `cartRevealTick` abre el mini-cart
     (Shopify/Tiendanube), no en checkout. Commerce sin productos
     muestra CTA al catálogo sin exigir `?onboarding=1` (ATM del 2º
     comercio). No inventa tarifario ni Mendel F5.

     Verificado en este recorte: **2.467 tests** / 261 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

144. Home first-level: marca + medios honestos — 2026-09-03.
     Medido: hero decía «Catálogo oficial» y «Medios de pago seguros»
     sin evidencia; Exentry sin banner. Logo + atmósfera `--st-*`,
     `textoMediosHero`, empty de marca, CTA 44px. No inventa tarifas.

     Verificado en este recorte: **2.470 tests** / 262 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

145. Commerce vacío sin tienda + id tras guardar — 2026-09-03.
     Medido: 2º comercio sin fila veía «○ Inactiva»; tras Guardar
     `setStore(row)` sin id → Páginas/Banners pedían «Creá la tienda».
     Empty-first-use `storeMissingCopy`, badge «Sin crear», upsert
     `.select().single()`. Shopify/Tiendanube: identidad usable al
     instante. No inventa tarifario ni Mendel F5.

     Verificado en este recorte: **2.471 tests** / 262 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

146. Settings: identidad antes de Pay + handoff al catálogo — 2026-09-03.
     Medido: empty 145 mandaba a Pagos y envíos y el tab abría con
     OAuth. Shopify/Tiendanube: nombre+slug primero. Card «Crear
     tienda», Pay abajo; tras Guardar banner al primer producto.
     Transferencia ya cobra; Pay puede esperar.

     Verificado en este recorte: **2.472 tests** / 262 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

147. Catálogo público: vacío real ≠ vacío por filtros — 2026-09-03.
     Medido: PLP decía «No encontramos productos con esos filtros»
     con catálogo vacío (2º comercio / first publish). ESTANDAR /
     Shopify-Tiendanube: empty-first-use distinto. `storeCatalogEmptyKind`,
     copy honesto, `limpiar` también limpia `q`, contador de activos
     incluye búsqueda. No inventa stock ni tarifario.

     Verificado en este recorte: **2.476 tests** / 263 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

148. Home first-use sin trust/hero de conversión — 2026-09-03.
     Medido: con 0 productos la home montaba hero («0 disponibles»,
     Explorar catálogo) y trust (envío gratis / compra protegida)
     encima del vacío. ESTANDAR empty-first-use: una composición de
     marca. `storeHomeShowsCommerceChrome`. No inventa catálogo.

     Verificado en este recorte: **2.478 tests** / 263 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

149. Settings: CBU/alias antes de OAuth de Pay — 2026-09-03.
     Medido: tras crear tienda el default es transferencia y el tab
     abría con PaymentConnectionsPanel. Sin CBU el pedido dice «te
     vamos a escribir». `storeShouldLeadSettingsWithBank` + card
     persistida. Tiendanube/Shopify: medio offline usable primero.

     Verificado en este recorte: **2.479 tests** / 263 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

150. Settings: dirección de retiro antes de OAuth — 2026-09-03.
     Medido: draft con `pickup_enabled` y sin dirección bloqueaba
     publicar; Settings seguía abriendo con Pay. Square/Shopify:
     lugar del pickup primero. `storeShouldLeadSettingsWithPickup`
     después de CBU. No inventa domicilio.

     Verificado en este recorte: **2.480 tests** / 263 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

151. Seed legales al crear + Pay no bajo identidad — 2026-09-03.
     Medido: al crear tienda no corría `seed_store_pages` hasta abrir
     Páginas; checklist decía «faltan». Tiendanube: plantillas al nacer.
     Sembrar draft (no publicar). Además el pie de Settings reabría
     PaymentConnectionsPanel bajo el lead de identidad.

     Verificado en este recorte: **2.481 tests** / 263 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

152. Privacidad en seed + lead legales antes de Pay — 2026-09-03.
     Medido: `seed_store_pages` no creaba `politica-de-privacidad`
     (obligatoria Ley 25.326 / checklist). Migración + backfill draft
     con «Completá acá». Settings: lead a Páginas después de CBU/retiro.
     No publica ni inventa CUIT.

     Verificado en este recorte: **2.484 tests** / 264 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

153. Settings: email de avisos antes de OAuth — 2026-09-03.
     Medido: tras legales el tab abría Pay; el email de pedidos estaba
     abajo. Exentry sin `notification_email`. Shopify/Tiendanube:
     contacto de tienda en setup. `storeShouldLeadSettingsWithEmail`
     + sugerencia del correo de sesión. No inventa casilla.

     Verificado en este recorte: **2.485 tests** / 264 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

154. Foco/Pedidos: share accionable hacia la primera venta — 2026-09-03.
     Medido: «Compartí el enlace» iba a `/tienda-online` sin CTA de
     copiar; Pedidos empty no ofrecía el link. Shopify/Tiendanube empty
     orders + Pulse accionable. `storeFirstSaleSharePath` →
     `?tab=overview&share=1`, banner + empty Pedidos con clipboard.
     No inventa tráfico ni tarifario.

     Verificado en este recorte: **2.487 tests** / 264 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

155. Settings: horario de retiro antes de OAuth — 2026-09-03.
     Medido: Exentry con dirección y `pickup_instructions` vacío; Foco
     ya pedía horario → Settings y el tab abría Pay. Square/Shopify:
     lugar y cuándo. `storeShouldLeadSettingsWithHours` después de
     email. No inventa el texto del horario.

     Verificado en este recorte: **2.488 tests** / 264 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

156. Recovery de carritos: email en checkout + cola honesta — 2026-09-03.
     Medido: `save_store_cart` siempre con `p_email: null` → skipped;
     cola/Foco sólo `status=abandoned` mientras el cron recupera `active`
     idle. Shopify Abandoned checkouts. Checkout → `rememberCartEmail`;
     cola alineada a `pending_abandoned_carts`; sin PUBLIC_BASE_URL no
     se marca enviado. No inventa email ni tarifario.

     Verificado en este recorte: **2.489 tests** / 264 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

157. Avisos de reposición honestos + cola en Recuperación — 2026-09-03.
     Medido: storefront promete «te avisamos»; cron podía marcar enviado
     sin PUBLIC_BASE_URL; Commerce no leía `store_stock_alerts` (0 filas
     hoy). Shopify/Klaviyo Back in stock. Cron sin link no marca;
     tab Recuperación (carritos + reposición); Foco → vista=reposicion.
     Vercel: deploy CLI bloqueado (free 100/día); GitHub en 93e4006;
     último Ready ~1h atrasado — reintentar deploy cuando baje el cupo.
     No inventa stock ni tarifario.

     Verificado en este recorte: **2.492 tests** / 265 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

158. Aviso de pago confirmado al marcar cobrado (transferencia) — 2026-09-03.
     Medido: storefront promete «Cuando acredite, te avisamos»; MP dispara
     `store-order-email`; `confirmarPagoManual` sólo acreditaba. Shopify/
     Tiendanube: offline paid → confirmación. Extiende
     `store-order-status-email` con `payment_confirmed` + invoke post-RPC.
     La frontera de autenticación quedó declarada también en
     `supabase/config.toml`: el alta pública admite comprador anónimo porque
     revalida la capacidad opaca dentro de la función, mientras el cambio de
     estado exige JWT, permiso `ecommerce.edit` y organización. Una guarda
     impide invertir esos valores al desplegar desde otra PC.
     Vercel free sigue en tope 100/día. No inventa tarifario/CUIT.

     Verificado en este recorte: **2.493 tests** / 265 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03). Esta PC no
     tiene `VITE_*`.

159. Catálogo heredado: user/org y error recuperable — 2026-09-03.
     Medido: `/catalogo/:id` podía recibir el `org_id` de un enlace histórico
     mientras productos y branding se buscaban sólo por `user_id`; además un
     fallo de red quedaba indistinguible de una tienda sin productos. La
     frontera `publicDataSource` resuelve ambos scopes con columnas públicas
     explícitas, mantiene `/tienda/:slug` como tienda canónica y muestra
     Reintentar ante red/permisos en vez de afirmar «catálogo vacío». No expone
     costos, márgenes ni credenciales, y no crea otra tienda ni otra fuente de
     stock.

     Verificado en este recorte: **2.546 tests** / 271 archivos (`npm test --
     --maxWorkers=1 --fileParallelism=false`, 2026-09-03); typecheck OK, lint
     0 errores y 145 warnings conocidos, build OK, 105 enlaces internos y
     conteos sin problemas. En localhost con el `.env` del checkout, la ruta
     `/catalogo/42abf3d2-6650-407a-a5d2-9781c4ab6778` mostró marca, **42
     productos**, categorías, precios y acciones, con 0 errores de consola;
     la verificación fue de sólo lectura.

160. F4 / carrito canónico: servidor, cuenta y orden — 2026-09-03.
     Medido: `ecommerce_cart_sessions` existía, pero el RPC no guardaba nada
     hasta conocer un email, aceptaba nombre/precio/subtotal del navegador y el
     checkout convertía la sesión en un efecto best-effort separado de la
     orden. La recuperación recorría líneas llamando `addToCart` contra el
     mismo cierre React: con más de un producto sobrevivía sólo el último. La
     cuenta además hacía upsert para la tienda correcta y después tomaba la
     primera ficha del usuario sin filtrar el resultado por id/tienda.

     `20260903000060_carrito_canonico` convierte la tabla existente en la única
     sesión de carrito: capacidad anónima, vínculo a `store_customers`, un
     activo por cuenta/tienda, merge dispositivo-cuenta por máximo (no suma
     cantidades), vencimiento de 30 días y snapshot resuelto por
     `resolve_store_line`. `get_store_cart` devuelve sólo ids/variantes/cantidad,
     sin PII; la UI hidrata antes de escribir, compara timestamps, rearma contra
     catálogo actual y muestra `sincronizando/guardado/local/error`. La salida
     rota el token del dispositivo compartido. El recupero sustituye todas las
     líneas de una vez y conserva variantes.

     `create_store_order_from_cart_idem` no crea otro checkout: delega en
     `create_store_order_idem` y enlaza/convierte la sesión dentro de la misma
     transacción. Precio, promociones, stock y orden siguen teniendo una sola
     autoridad. Comparación oficial: Shopify modela Cart + BuyerIdentity + costo
     estimado; Tiendanube conserva 30 días y revalida precio/stock al retomar.

     Producción: migración aplicada, `db push --dry-run` volvió a brecha 0; como
     `anon`, token inexistente respondió `{found:false,items:[]}` y save vacío
     `{ok:true,empty:true}` sin crear filas. Localhost mostró tienda y carrito
     real con 0 errores/warnings de consola; no se creó un carrito ficticio ni
     se tocó producto/stock real. Verificado en este recorte: **2.551 tests** /
     272 archivos (`npm test -- --maxWorkers=1 --fileParallelism=false`,
     2026-09-03); typecheck OK y lint 0 errores / 143 warnings conocidos.

161. Identidad y dominio canónicos: Nerqia / `nerqia.app` — 2026-09-03.
     La marca de plataforma dejó de depender de strings dispersos: nombre,
     productos, origen y símbolo viven en `src/lib/brand.ts`; landing, Auth,
     shells, PWA, legales, emails, API, Pay y Platform usan Nerqia. Storefront y
     documentos siguen mostrando la identidad de cada comercio; se retiraron
     los fallbacks que inyectaban Exentry Imports en organizaciones sin marca.

     Vercel conserva el mismo proyecto y Project ID, renombrado a `nerqia`, con
     `nerqia.app` y `www.nerqia.app` asignados, nameservers Vercel y TLS activo.
     El origen raíz es canónico y `www` tiene redirect permanente declarado en
     `vercel.json`. Supabase Auth usa el dominio nuevo como Site URL y admite
     producción, previews y localhost; el origen anterior queda sólo durante la
     transición. Los identificadores `gestiona_pay`, claves locales y headers
     `X-Gestiona-*` no se renombran: son contratos compatibles, no copy visible.

     Las migraciones `20260903000070` y `20260903000071` alinean catálogos y
     mensajes SQL sin tocar precios, stock ni datos del comercio. `db push
     --dry-run` quedó en brecha 0, Auth remoto al día y el preflight real de
     `platform-admin-action` respondió 204 con `Access-Control-Allow-Origin:
     https://nerqia.app`. Se desplegaron **74/74 Edge Functions** (`npm run
     deploy:functions`, 2026-09-03). La landing y
     Auth pasaron inspección local 1280×720, sin solapamientos ni errores de
     consola. Puerta final: **2.554 tests / 272 archivos** (`npm test`,
     2026-09-03), typecheck OK, lint 0 errores / 144 warnings conocidos, build
     PWA, 107 enlaces internos y 529 migraciones verificadas (`npm run
     check:conteos`, 2026-09-03). Correo con `@nerqia.app` sigue pendiente de los
     registros DNS de Resend; Vercel no provee casillas.

162. Identidad visual N/Q y contrato de dominios de tienda — 2026-09-03.
     La identidad canónica ya decía Nerqia pero el PNG publicado seguía siendo
     el símbolo G anterior renombrado. Se sustituyó por el isotipo N/Q entregado
     por el dueño, recortado sobre transparencia real, y se versionó también el
     wordmark horizontal. `BrandLogo`, favicon y PWA declaran ahora la geometría
     real 389×389; una guarda valida firma PNG, alpha, dimensiones, adopción y
     aislamiento de la marca del merchant.

     El ADR 003 fija la topología que se implementará sin duplicar Commerce:
     `nerqia.app` institucional, `app.nerqia.app` autenticado,
     `<slug>.nerqia.app` como tienda incluida, dominio propio verificado como
     canónico y `/tienda/:slug` sólo como compatibilidad. StoreContext,
     StorefrontPage, catálogo, carrito, checkout, órdenes y autoridad SQL son
     los mismos en todos los hosts. La decisión se contrastó el 2026-09-03 con
     documentación oficial de Vercel for Platforms, Shopify, Tiendanube y
     Supabase Auth. Wildcard DNS observado no se declara routing ni TLS probado;
     asociación de proyecto, cuotas, verificación y correo siguen siendo gates
     operativos. Puerta local: typecheck, lint 0 errores / 143 warnings
     conocidos, **2.555 tests / 272 archivos** y build/PWA productivo
     (2026-09-03). Próximo slice: resolver host/subdominio en código, canónicos
     y redirecciones con pruebas antes de habilitar dominios propios.

163. Subdominio incluido sin duplicar Storefront — 2026-09-03.
     Implementado localmente: `storefrontHost.ts` valida labels DNS, reserva
     hosts de producto y resuelve `<slug>.nerqia.app`; `ApplicationRoutes`
     monta la misma `StorefrontPage`, mientras `StoreContext` entrega una única
     base de navegación a home, PLP, PDP, carrito, checkout, cuenta, pedido,
     preguntas y reseñas. Se retiraron doce reconstrucciones independientes de
     `/tienda/:slug`. Auth del comprador, recuperación de carrito y enlaces
     internos usan el mismo contrato.

     El borde reconoce el host para HTML de crawlers, canonical, robots,
     sitemap y feed. Los recorridos privados salen con `noindex`; el índice raíz
     enumera los sitemaps canónicos por tienda. `vercel.json` prioriza cuatro
     rewrites condicionados por host y excluye los quince nombres reservados;
     Supabase Auth declara el wildcard de callback del storefront. El vínculo
     wildcard con el proyecto Vercel, el push de Auth y la prueba HTTPS
     publicada se ejecutan después de la puerta local: hasta entonces es
     **implementación**, no dominio operativo. El dominio propio del merchant
     sigue separado: requiere modelo tenant-scoped, challenge DNS y alta
     server-side en Vercel, sin exponer su token al navegador.

     Puerta local (2026-09-03): `npm run typecheck` verde; lint 0 errores y
     143 warnings heredados; 2.566 tests verdes en 273 archivos; build/PWA
     verde; las 74 Edge Functions pasan `check:functions`; los cinco handlers
     SEO de Vercel pasan TypeScript NodeNext y bundling independiente. El
     runner local de Vercel en Windows falló al lanzar `cmd.exe` después de
     instalar dependencias, por lo que no se toma como prueba de despliegue.

164. Wildcard operativo y hallazgo de navegación real — 2026-09-03.
     El commit `4c85059` quedó `READY` en Vercel con `nerqia.app`, `www`, el
     dominio legado y `*.nerqia.app` como aliases. Vercel verificó el wildcard
     sin issues y Supabase Auth recibió `https://*.nerqia.app/**`. La única
     tienda publicada apareció en el índice como
     `https://exentryimports.nerqia.app/sitemap.xml`; home, robots, sitemap y
     feed respondieron 200 con TLS válido, URLs limpias y datos reales.

     La recorrida visual de home → PDP cargó catálogo, descuentos, cobertura,
     precio, stock, preguntas y opiniones sin errores de consola, y comprobó el
     canonical de ambas pantallas. También encontró una falla que no aparecía
     en unitarios: un ítem de menú `Inicio` con destino vacío se resolvía a la
     página actual. Se materializa `/`, se agrega la regresión, se elimina la
     contradicción `Disallow /productos` + `Allow /productos` del robots del
     subdominio y se garantiza un H1 semántico cuando el comercio oculta el
     hero. El commit `aaa4b01` quedó `READY` en Vercel después de 5 min. La
     recorrida publicada posterior confirmó `Inicio → /` tanto en home como en
     PDP, un H1 real en ambas pantallas y cero errores de consola. El robots del
     subdominio respondió 200 como `text/plain`, permite el catálogo y bloquea
     sólo checkout, cuenta, orden, carrito y seguimiento; ya no contiene el
     `Disallow /productos` heredado del panel.

165. F4 / Domains Service sin segundo storefront — 2026-09-03.
     `ecommerce_stores.custom_domain` deja de ser un string muerto y gana un
     ciclo de vida tenant-scoped: titularidad pendiente, DNS pendiente, activo,
     mal configurado o error del proveedor. Un índice case-insensitive impide
     que dos organizaciones reclamen el mismo host, y
     `get_store_slug_by_host` devuelve únicamente el slug de una tienda
     publicada y activa. La migración `20260903000080` quedó aplicada en la
     base vinculada y `db push --dry-run` confirmó brecha cero.

     La nueva sección **Dominios de la tienda** vive dentro de Publicar. Siempre
     conserva `<slug>.nerqia.app`, muestra estado y registros TXT/A/CNAME,
     permite reintentar o desconectar con confirmación y advierte propagación y
     preservación de MX/TXT. `store-domain` exige usuario real más owner/admin,
     llama a las APIs oficiales de Project Domains y Domain Configuration de
     Vercel, guarda sólo un resumen sanitizado y nunca entrega el token al
     navegador. El resolver, los crawlers, robots, sitemap y feed montan el
     mismo `StorefrontPage`/`StoreContext`; no existe otro catálogo, stock,
     carrito ni checkout. Los emails de Auth vuelven al subdominio canónico
     allowlisteado en vez de abrir Supabase a dominios arbitrarios.

     Puerta técnica previa al commit: `npm run typecheck` verde; lint con 0
     errores y 143 warnings heredados; 2.587 tests verdes en 274 archivos;
     build/PWA verde; los cinco handlers SEO pasaron TypeScript NodeNext y
     bundling independiente; las 75 Edge Functions completaron el typecheck.
     `store-domain` quedó desplegada en el proyecto vinculado,
     pero la prueba HTTP publicada respondió `402
     exceed_cached_egress_quota` antes de ejecutar la función. La capacidad
     sigue **parcial** por dos gates externos: restaurar la cuota de Supabase y
     cargar `VERCEL_TOKEN`; crear una credencial persistente requiere
     confirmación explícita. Sin ella la UI informa
     `provider_not_configured`; no simula que conectó.

166. SEO de tiendas antes del filesystem — 2026-09-03.
     La prueba publicada del commit `f8a477b` encontró una regresión crítica
     que no aparece en un build: home del subdominio devolvía a Googlebot,
     Search Console, WhatsApp y Facebook el `index.html` estático de la
     plataforma, con título Nerqia y canonical `https://nerqia.app/`. Robots,
     sitemap y feed estaban bien, pero la URL comercial principal se
     autocanonizaba fuera de la tienda.

     La causa quedó confirmada contra la documentación oficial: Vercel prioriza
     el filesystem antes de aplicar rewrites condicionales. Se reemplazan las
     tres reglas duplicadas de User-Agent por un único Routing Middleware, que
     corre antes del cache/filesystem, consume la lista canónica de crawlers y
     deriva subdominio, dominio propio o path heredado al mismo `/api/og`. El
     comprador continúa a la SPA y la query de categoría/campaña se conserva.
     `@vercel/functions` queda fijado en `3.9.5`; su instalación también refrescó
     la auditoría y se fijaron cuatro transitivas compatibles, llevando
     `npm audit` a 0 vulnerabilidades. Puerta local: typecheck verde; lint 0
     errores/143 warnings heredados; 2.592 tests verdes en 275 archivos;
     build/PWA y compilación NodeNext de middleware + handlers verdes. El
     runner local de Vercel vuelve a fallar por `spawn cmd.exe ENOENT` después
     de instalar/auditar, así que no contó como prueba del routing.

     El commit `7209c138` quedó `READY` en producción. La matriz publicada
     confirmó: Googlebot recibe home **Exentry Imports — Tienda online** con
     canonical `https://exentryimports.nerqia.app`; Google Inspection recibe la
     categoría **Perfume Árabe** con su query canónica; una persona sigue
     recibiendo la SPA; y Googlebot sobre `nerqia.app` conserva el documento de
     la plataforma. La sesión real del navegador rehidrató la tienda con ese
     mismo título/canonical, H1 **Exentry Imports**, catálogo real y cero logs de
     consola. El bug queda cerrado con evidencia publicada, no por inferencia.

167. SEO de plataforma y descubrimiento verificable — 2026-09-03.
     La medición externa `site:nerqia.app` y `"Nerqia" software comercio` no
     devolvió ninguna página propia. El hueco era real: el índice raíz sólo
     apuntaba a tiendas y Googlebot recibía un `index.html` con metadatos pero
     cuerpo vacío para la plataforma. Agregar `meta keywords` no era una salida:
     Google declara que la ignora para indexación y ranking.

     `platformSeo.ts` pasa a ser el contrato único de título, descripción, H1,
     texto útil, canonical, indexabilidad y sitemap. El mismo Routing Middleware
     ya usado por Storefront deriva bots sobre `nerqia.app` a HTML semántico con
     enlaces y JSON-LD `WebSite`/`Organization`/`SoftwareApplication`; las
     personas conservan la SPA y `PlatformSeoHead` mantiene esos metadatos al
     navegar. El contenido nombra de forma visible la propuesta que sí existe:
     gestión omnicanal para comercios argentinos, stock único, POS, tienda
     online, caja y margen por canal. Panel y legales no orientados a adquisición
     salen con `noindex`; no se intenta rankear una pantalla privada.

     El índice `sitemap.xml` ahora incluye `sitemap-platform.xml` aunque la base
     o una tienda no respondan, y después los sitemaps de cada comercio. Home,
     precios y estado son las tres URLs canónicas iniciales; `/pricing` gana un
     redirect HTTP a `/precios` y el enlace visible deja de partir señales. El
     runbook, fuentes oficiales, criterio competitivo y métricas viven en
     `docs/SEO_INDEXACION.md`. Puerta local: typecheck verde; lint 0 errores/143
     warnings heredados; **2.600 tests verdes en 276 archivos**; build/PWA y 75
     Edge Functions verdes; auditoría estándar con 0 vulnerabilidades.

     El commit `15124ccd` quedó `READY` en producción. La matriz publicada
     confirmó home/precios 200 + H1 + canonical + `index,follow`, panel privado
     con meta/header `noindex,nofollow`, `/pricing` 308 a `/precios`, SPA humana
     intacta, índice raíz con plataforma + Exentry y cero regresión del HTML de
     esa tienda. La propiedad de dominio `nerqia.app` quedó verificada en Google
     Search Console mediante un TXT visto en Vercel DNS y `8.8.8.8`; el índice
     fue enviado y figura **Índice de sitemaps · Correcto**. La home de Nerqia y
     la tienda activa fueron aceptadas en la cola prioritaria de indexación.

     Estado: **rastreabilidad, propiedad y envío cerrados; indexación externa en
     curso**. Search Console confirmó que ambas URLs todavía eran desconocidas y
     quedó procesando datos. Que Google las indexe o ubique primero sólo se
     cierra cuando aparezca medido, no por el push ni por la solicitud.

168. Contrato público honesto y telemetría minimizada — 2026-09-03.
     La auditoría posterior al SEO encontró una contradicción de lanzamiento:
     Términos prometía precios en USD y cobro con Stripe aunque la suscripción
     real usa ARS/Mercado Pago; Privacidad repetía Stripe, prometía borrado
     automático a 30 días que no existe y decía que Sentry no recibe datos
     sensibles mientras el SDK grababa 10% de las sesiones y 100% de las que
     tenían error con texto y multimedia **sin enmascarar**. También se publicaba
     un SLA de 99,5%, reintegro tras 48 horas, límite de responsabilidad y fuero
     exclusivo sin evidencia contractual ni validación profesional.

     `platformLegal.ts` pasa a ser la fuente versionada de marca, contactos,
     fecha y proveedores condicionales. Términos y Privacidad comparten un único
     `LegalDocumentLayout`, corrigen el modo claro, tienen targets táctiles,
     declaran ARS/Mercado Pago, roles responsable/encargado, alojamiento en
     `us-east-1`, transferencia a un país no adecuado, retención honesta,
     canales/plazos AAIP y ausencia de SLA salvo anexo firmado. No se inventó la
     identidad faltante: ambas páginas muestran que razón social, CUIT, domicilio
     y revisión profesional bloquean el lanzamiento comercial.

     Sentry conserva errores y una muestra de rendimiento, pero Session Replay
     queda en cero y sin integración. Antes de enviar se eliminan usuario,
     cookies, headers, cuerpos y parámetros de URL; se redactan emails/bearers y
     se descartan breadcrumbs de UI/consola. Las guardas impiden que reaparezcan
     Stripe/USD, el borrado falso, el SLA inventado o el replay desprotegido.
     Referencia oficial verificada: la AAIP exige informar finalidad,
     destinatarios, identidad/domicilio y derechos; fija 10 días corridos para
     acceso y 5 hábiles para rectificación/supresión, y ofrece cláusulas modelo
     para destinos no adecuados. Mercado Pago documenta cancelar el
     `preapproval` con estado `canceled`, que coincide con el camino real.

     Puerta local: typecheck verde; lint 0 errores/143 warnings heredados;
     **2.605 tests verdes en 277 archivos**; build/PWA, 75 Edge Functions y
     `npm audit --audit-level=high` en cero vulnerabilidades. La matriz de
     `/terminos` y `/privacidad` pasó en 360/768/1024/1440 sin overflow de
     página ni errores de consola, con tabla contenida en mobile, targets de
     44 px, títulos propios y tokens claro/oscuro distintos.

     El commit `2923f74b` quedó `READY` y fue inspeccionado en `nerqia.app`:
     Términos publica el contrato ARS/Mercado Pago y el aviso de identidad;
     Privacidad muestra seis proveedores con condición y alcance, conserva el
     canvas claro `rgb(245, 246, 249)` y no desborda el viewport. La inspección
     publicada no reemplaza la revisión profesional pendiente.

     Estado: **contradicciones técnicas cerradas; aprobación legal pendiente**.
     Siguiente slice legal: aceptación versionada server-side y cola operativa
     de derechos. Gates externos: identidad legal real, DPA, mecanismo de
     transferencia, retención, incident response, configuración Sentry del lado
     proveedor y revisión abogado/contador.

169. Caja usa el espacio operativo real y deja el cierre siempre alcanzable —
     2026-09-03. La auditoría autenticada de producción reprodujo una rotura
     estructural que no aparecía en los tests: a 1.092 px, `AppLayout` dejaba
     776 px útiles después de rail y padding, pero el POS activaba su corte
     desktop por ancho de ventana. El catálogo terminaba en 428 px, cada card
     en 137 px y el carrito tenía 804 px de alto con 923 px de contenido; el
     botón de confirmar podía quedar fuera del área recortada.

     Caja pasa a declarar `surface: immersive` en el Route Manifest: conserva
     permisos, rail, header mobile y avisos críticos, pero no duplica topbar ni
     padding editorial. El layout principal es una columna de `100dvh` y
     entrega al POS el remanente real mediante `flex-1/min-h-0`. Catálogo y
     bundles usan container queries sobre el ancho de su propio panel; ya no
     deciden columnas por el viewport completo. El modo dividido comienza en
     1.280 px, con carrito de 320 px (384 px en 2XL); debajo usa un sheet
     absoluto dentro de Caja y nunca cubre el rail.

     El carrito adopta un único scroll contenido, header sticky y CTA
     alcanzable. Se cableó el vocabulario visual `pos-*` que ya existía pero no
     tenía consumidores, sin crear otro componente ni otra ruta. Guardas
     unitarias fijan manifest, geometría y breakpoints; el E2E autenticado suma
     360/768/1024/1092/1280/1440, overflow, límites del viewport, alternancia de
     carrito y confirmación deshabilitada sin escribir una venta.

     Puerta local: typecheck verde; lint 0 errores/143 warnings heredados;
     **2.607 tests verdes en 277 archivos**; build/PWA, 75 Edge Functions y
     auditoría high en cero vulnerabilidades. El chunk POS queda en 122,17 kB
     (34,43 kB gzip); este slice no agregó una dependencia ni otro motor de
     checkout.

     La primera inspección del deploy `d7716a49` confirmó `100dvh`, documento
     sin scroll exterior y cambio correcto a carrito mobile a 1.092 px, pero
     descubrió 32 px residuales por lado: una regla histórica tardía aplicaba
     `padding: 2rem !important` a todo `.workspace-content`. La excepción
     `workspace-content--immersive` queda en el shell y al final de la cascada;
     elimina padding, ancho máximo, margen y min-height heredados sin acoplar
     `AppLayout` a clases internas del POS.

     `dd29eba8` quedó `READY` y la misma sesión autenticada repitió la medición
     en 1.092×912: wrapper/root ocupan los 844 px completos, padding 0, borde
     inferior exacto en 912, documento 1.092×912 y cards de 198 px frente a las
     137 px anteriores. El sheet mide 844×768 dentro del workspace; su panel
     tiene 731 px visibles, 1.033 px de contenido, `overflow-y:auto` y contiene
     el CTA de 46 px deshabilitado sin aumentar el documento.

     Estado: **rotura reproducida y geometría publicada cerrada en 1.092 px**.
     Falta ejecutar la matriz automatizada completa con credenciales E2E; el
     spec ya cubre seis anchos sin escribir una venta. El cierre operativo,
     descuentos, QR, turno y autoridad server-side no cambian. Siguiente slice:
     comprobante fiscal profesional e inmutable con identidad/CAE/QR derivados
     de la base y evidencia oficial ARCA.

170. La factura autorizada conserva su identidad fiscal y entrega un QR ARCA
     real — 2026-09-03. La representación descargable reconstruía CUIT, razón
     social, domicilio y punto de venta desde la configuración vigente: cambiar
     Ajustes podía redibujar un comprobante ya autorizado con otra identidad.
     Además imprimía un enlace textual al dominio anterior de AFIP, no un QR, y
     no diferenciaba visualmente homologación de producción.

     `invoices` conserva ahora un snapshot server-side del emisor, receptor,
     punto de venta, cotización y tipo de autorización al reservar el intento.
     El CAE y número completan en la base el payload QR v1; una factura con CAE
     bloquea cualquier cambio de importes, cliente, identidad o QR y exige nota
     de crédito para corregirse. La configuración fiscal segura suma Ingresos
     Brutos e inicio de actividades, obligatorios para pasar a producción, sin
     exponer certificados ni tickets al navegador. Los dos comprobantes
     históricos quedan marcados `legacy_backfill`: su identidad reconstruida
     sirve para representarlos, pero no prueba el domicilio existente al emitir.

     Facturación muestra número fiscal `00000-00000000`, emisor/receptor,
     condición IVA, domicilio, Ingresos Brutos, inicio, CAE, vencimiento y un QR
     escaneable también dentro del PDF. Homologación declara en pantalla y PDF
     que es una prueba sin valor fiscal; un borrador con letra ya no se presenta
     como «Factura original». La terminología visible pasa a ARCA, preservando
     los namespaces `afip_*` por compatibilidad técnica.

     Referencia verificada: la especificación QR oficial usa
     `https://www.arca.gob.ar/fe/qr/` y exige fecha, CUIT, punto de venta, tipo,
     número, importe, moneda/cotización y autorización; RG 1415 fija los datos
     visibles y RG 5616 exige la condición IVA del receptor. Tiendanube declara
     en su ayuda actualizada el 31/08/2026 que la plataforma no emite la factura
     de venta y deriva la automatización a aplicaciones externas. Nerqia adopta
     el patrón de emisión automática como oportunidad de producto, no como una
     capacidad productiva ya demostrada.

     Evidencia de base real: la migración `20260903000090` fue aplicada y
     reaplicada idempotentemente. Un fixture transaccional hizo
     pendiente→procesando→autorizada, verificó snapshot y QR, bloqueó la
     mutación posterior y cerró con rollback y **0 restos**. Estado medido: 2
     CAE históricos de homologación, 0 productivos; la única configuración
     existente aún carece de domicilio, Ingresos Brutos e inicio, por lo que no
     está lista para producción. Siguiente slice: consumir `factura.creada`
     desde el outbox y autorizar automáticamente sin una segunda lógica fiscal;
     la prueba contra ARCA productiva sigue siendo un gate externo.

     Puerta local: typecheck verde; lint 0 errores/143 warnings heredados;
     **2.618 tests verdes en 279 archivos**; build/PWA, 75 Edge Functions y
     `npm audit --audit-level=high` en cero vulnerabilidades. El dry-run de
     migraciones confirmó libro remoto al día y el control posterior midió 2/2
     facturas con QR, 2 de homologación, 0 productivas y 0 configuraciones con
     identidad productiva completa.

171. Facturas y notas de crédito piden CAE desde la outbox sin duplicar el
     motor fiscal — 2026-09-03. El Business Core ya emitía `factura.creada` y
     `nota_credito.creada` dentro de la transacción que crea el comprobante,
     pero nadie consumía esos eventos: vender podía generar la factura y el
     dueño igual tenía que entrar a Facturas para autorizarla. Dos
     suscripciones globales exactas llaman a la misma `afip-authorize`; no hay
     otro endpoint, página, secuencia ni modelo fiscal.

     El secreto de cron no transforma un JSON cualquiera en una orden de
     emisión. La función exige que body y headers coincidan y vuelve a leer
     evento, suscripción y entrega en `domain_events`, `event_subscriptions` y
     `outbox_events`; recién entonces toma el `invoice_id`. El camino humano
     conserva owner/admin y los RPC de reserva, candidato y error previo siguen
     siendo sólo `service_role`. Un error de identidad o comprobante queda
     visible en la factura en vez de parecer una automatización que nunca
     corrió.

     La recuperación evita el riesgo fiscal principal: si
     `FECAESolicitar` corta la conexión, ARCA puede haber emitido aunque Nerqia
     no reciba la respuesta. El número candidato se persiste antes de la llamada
     externa, sin mantener una transacción SQL abierta. En el retry se consulta
     `FECompUltimoAutorizado` y, si el número fue consumido,
     `FECompConsultar`; se recupera el CAE y se valida el importe antes de
     finalizar. Una secuencia incompatible falla cerrada y queda en
     verificación, nunca repite a ciegas. Es el procedimiento documentado por
     ARCA para una respuesta ambigua.

     La lista de Facturas expresa ahora los dos ejes sin agregar otro enum: un
     comprobante comercial `draft` con CAE se ve y filtra como **Emitida**;
     después puede pasar a enviada o pagada. Navegación, guía y conexión usan
     ARCA en la terminología visible, manteniendo `/afip`, nombres de funciones
     y columnas por compatibilidad.

     Evidencia productiva: `20260903000100` aplicada y reaplicada
     idempotentemente; dos columnas, dos suscripciones activas y cero permisos
     `authenticated` sobre los RPC internos. La Edge Function quedó activa con
     JWT. Una fixture transaccional verificó reserva del sistema, bloqueo de un
     actor ajeno, candidato persistido, error previo visible, una única entrega
     fiscal y rollback con **0 restos**. El dry-run confirmó el libro remoto al
     día. No se envió una factura ficticia a ARCA.

     Puerta local: typecheck verde; lint 0 errores/143 warnings heredados;
     **2.629 tests verdes en 281 archivos**; build/PWA y 75 Edge Functions.
     El endpoint del registro agotó tres veces el timeout en la PC, pero la
     instalación limpia del deploy auditó **911 paquetes y encontró 0
     vulnerabilidades**; Vercel terminó `READY` sobre `db6fa0b8`.

     Evidencia publicada autenticada: `/facturas` cargó 2/2 comprobantes como
     **Emitida + CAE**, con filtro Emitida y sin warnings ni errores de consola;
     `/afip` se presenta como **ARCA / Facturación electrónica**, carga 2 CAE
     autorizados, 0 pendientes y 0 con error, y el sidebar usa “ARCA y factura
     electrónica”. Ambas rutas leyeron datos reales del Business Core sin
     duplicar el documento fiscal.

     Estado: **automatización y reconciliación implementadas, desplegadas y
     probadas sin emisión falsa**. Gates externos: completar identidad fiscal,
     habilitar producción, emitir una venta y una nota de crédito reales en la
     cuenta del comercio, contrastarlas en ARCA y medir tiempo/error operativo.

172. El catálogo deja de montar toda la tienda en una sola página — D5.20,
     2026-09-03. La recorrida publicada de
     `exentryimports.nerqia.app/productos` midió **60 cards, 12.179 px de alto
     en 360 px** y ningún límite: era correcto con el catálogo actual, pero no
     escalaba a cientos de productos y variantes.

     El PLP ahora conserva una sola lectura pública del Business Core y monta
     ventanas de 20 productos. `page` queda en la URL para compartir el recorte
     y volver desde una ficha sin caer siempre al comienzo; cualquier cambio de
     búsqueda, categoría, precio, oferta, género, familia u orden vuelve a la
     primera página. Anterior/Siguiente tienen 44 px, límites deshabilitados,
     rango “1–20 de 60”, región de navegación y anuncio accesible. No aparece
     otro catálogo, endpoint ni stock: es una ventana sobre `filtrados`, y el
     checkout sigue recalculando precio y disponibilidad en servidor.

     Comparativa verificada el 2026-09-03: Tiendanube ofrece 12 —default—, 16
     o 20 productos por página y permite elegir carga progresiva o páginas en
     diseños compatibles; Shopify expone productos como conexión paginada con
     `first`/`after` y `pageInfo`. Nerqia adopta 20 por ahora para reducir DOM
     sin partir todavía la lectura que comparten home, ficha, variantes,
     recomendaciones y carrito. El siguiente escalón, cuando el catálogo real
     lo justifique, es cursor server-side sobre ese mismo contrato, no otra
     fuente de producto.

     Puerta local: typecheck verde; lint 0 errores/143 warnings heredados;
     **2.633 tests verdes en 282 archivos**, build/PWA y `npm audit` con 0
     vulnerabilidades. La prueba pura cubre página completa, remanente,
     catálogo vacío y parámetros inválidos; la guarda de conversión impide
     volver a `filtrados.map` sin límite.

     Evidencia publicada sobre `6dddf72e`: a 360 px la primera página pasó de
     60 cards/12.179 px a **20 cards/5.000 px**, sin overflow. Siguiente dejó
     `page=2`, mostró 21–40/60 y la vuelta desde el primer PDP recuperó la misma
     página con 20 cards. A 1.440 px también montó 20, ambos controles midieron
     44 px y elegir Perfume Árabe quitó `page=2`, volvió a página 1 y mostró
     1–20/54. Todo el recorrido quedó sin warnings ni errores de consola.

     Estado: **D5.20 cerrado en implementación y navegador publicado**. Aún no
     se atribuye mejora de conversión ni Web Vitals: necesitan tráfico real.
     Cursor server-side queda como umbral de volumen, no como trabajo por moda.

173. La analítica de Commerce deja de mezclar cola, cobro y atribución — D5.21,
     2026-09-04. La auditoría autenticada encontró una contradicción visible:
     la organización tenía **6 pedidos reales**, mientras el embudo decía
     “0 órdenes completadas”. La base confirmó la causa: los seis pedidos son
     anteriores al carrito canónico y tienen `cart_session_id = NULL`; las
     sesiones que sí pueden atribuirse empiezan el 3/9. Sumar 6 pedidos sobre
     7 sesiones habría publicado una conversión ficticia de 85,7%.

     `get_store_performance_snapshot` agrega ahora en servidor y por
     organización: pedidos registrados, pedidos acreditados, facturación sólo
     de `payment_status = paid`, sesiones atribuibles, sesiones con items,
     sesiones con compra y carritos todavía recuperables. La cola conserva su
     límite operativo de 200, pero ya no se usa como contador total. El RPC
     exige membresía real, `anon` no tiene `EXECUTE` y un índice parcial evita
     escanear pedidos sin carrito al crecer. La UI dice **Facturación paga**,
     **Pedidos registrados** y **Conversión medible**; los pedidos históricos
     o sin sesión siguen operables, pero una nota explica por qué no entran en
     el porcentaje. Si el contrato falla, se muestra el error en vez de ceros.

     La cola de recuperación también deja de contar carritos vencidos: cliente
     y snapshot aplican items, expiración, email e inactividad de una hora con
     la misma semántica. En producción, el rol `owner` obtuvo 6 pedidos, 2
     acreditados, ARS 2 de facturación paga, 5 sesiones medibles, 5 con items,
     0 convertidas y 0 recuperables; el mismo usuario fue bloqueado al pedir
     otra organización y el dry-run dejó el libro en brecha 0. No se alteró
     ninguna fila comercial.

     Comparativa verificada el 2026-09-04: Shopify define la conversión como
     sesiones que terminan en orden y separa el embudo en sesión, carrito,
     checkout y compra; Tiendanube separa pedidos pagos/facturación de la
     conversión del carrito y permite período/comparación. Nerqia adopta ahora
     la separación y la cobertura honesta. Faltan eventos de “checkout
     iniciado”, filtro temporal/comparación y atribución por canal antes de
     declarar paridad analítica completa.

     Puerta local: typecheck verde; lint con 0 errores/143 warnings heredados;
     **2.635 tests verdes en 282 archivos**; build/PWA y `npm audit` con 0
     vulnerabilidades. La guarda fija autorización, pago acreditado, vínculo
     carrito–pedido, corte atribuible y expiración de recuperación.

     El commit `7e2b7295` quedó `READY` y aliasado a `nerqia.app`. En la sesión
     autenticada publicada, el panel mostró **$2 / 2 pedidos acreditados**,
     **6 pedidos registrados**, **0 de 5 sesiones medibles**, **5 carritos con
     items / 0 recuperables** y el aviso de **6 pedidos anteriores o sin
     atribución**. A 1.440 px y 360 px conservó toda la jerarquía, no produjo
     overflow horizontal y la consola quedó sin warnings ni errores.

     Estado: **D5.21 cerrado en implementación, autoridad productiva y
     navegador publicado**. Todavía no se atribuye impacto sobre conversión:
     eso necesita tráfico real posterior al corte, no una cifra de prueba.

174. “Checkout iniciado” pasa de píxel externo a hecho canónico — D5.22,
     2026-09-04. Shopify ubica el inicio de checkout entre carrito y compra;
     Nerqia enviaba `begin_checkout` a Meta/GA, pero no conservaba esa etapa
     para el comercio. La auditoría encontró además que el efecto se ejecutaba
     sólo en el primer render: si el carrito todavía se estaba hidratando,
     salía vacío y el evento no volvía a intentarse.

     `start_store_checkout` persiste primero las referencias mediante
     `save_store_cart_v2` —misma normalización server-side contra precio, stock
     y disponibilidad del Business Core— y después fija
     `checkout_started_at` con `COALESCE`, una sola vez. El token de carrito
     sigue siendo la capacidad anónima, hay rate limit heredado y no se envía
     email para medir. El checkout espera slug, token y líneas hidratadas;
     registra la señal propia con un retry idempotente y recién en paralelo
     notifica a los proveedores externos. Durante una ventana de deploy guarda
     el carrito, pero no inventa la etapa.

     El snapshot incorpora `checkout_started_sessions` y el panel presenta la
     secuencia **sesión → carrito → checkout → compra**. Una orden enlazada
     también prueba que la etapa existió; el contrato exige que compra no pueda
     superar checkout. La UI declara por separado el 3/9 como inicio del
     carrito canónico y el 4/9 como comienzo de esta medición: no reconstruye
     eventos pasados.

     Verificación productiva reversible como `anon`: dos llamadas con el mismo
     token ZZ dejaron 1 sesión, 1 checkout marcado y 1 timestamp distinto; el
     `ROLLBACK` dejó **0 residuos**. Como el owner real, el snapshot final
     conservó 6 pedidos/2 pagos/ARS 2 y 5 sesiones con items, con 0 checkout y
     0 compras —la línea de base honesta antes del tráfico nuevo—. El dry-run
     del libro quedó en brecha 0.

     El commit `8ff64b65` quedó `READY`. En la tienda publicada a 360 px se
     recorrió **catálogo → agregar → carrito → checkout** sin confirmar el
     pedido: el documento no tuvo overflow ni logs. El panel autenticado pasó
     exactamente de 0/5 a **1 checkout de 6 sesiones (16,7%)**, mostró la
     cuarta etapa y las dos fechas de cobertura, también sin logs. Después se
     vació el carrito y se eliminó sólo la sesión técnica creada durante la
     prueba; quedaron 0 residuos y la línea base volvió a 0/5. No hubo pedido,
     cobro ni movimiento de stock.

     Puerta completa: typecheck; lint con 0 errores/143 warnings heredados;
     **2.635 tests en 282 archivos**; build/PWA y `npm audit` con 0
     vulnerabilidades.

     Estado: **D5.22 cerrado en autoridad productiva y navegador publicado**.
     Siguen período/comparación y canal; se construyen sobre estas etapas
     reales, no sobre porcentajes estimados.

175. Commerce compara períodos sin duplicar Analytics — D5.23, 2026-09-04.
     El mismo `get_store_performance_snapshot` acepta ahora desde/hasta; no se
     creó otra vista ni otra página. Los días cierran en
     `America/Argentina/Buenos_Aires`, pedidos y sesiones usan intervalos
     semiabiertos indexables y el período anterior tiene exactamente la misma
     cantidad de días. Sin filtro, se conserva el historial completo y no se
     presenta una comparación artificial.

     La selección reutiliza el filtro compartido, queda en `df`/`dt` de la URL
     y refresca sólo el snapshot: cambiar fechas ya no vuelve a pedir tienda,
     pedidos, sucursales, banco y configuración. Facturación paga y pedidos
     muestran tendencia cuando el período anterior ofrece base; si era cero,
     el panel lo explica y no fabrica “+100%”. La conversión mantiene su
     población de sesiones creadas dentro del período y sigue declarando los
     cortes de atribución. El control, presets y su acción de limpiar pasan a
     44 px; una URL con un solo límite se normaliza a ese día y las respuestas
     viejas ya no pueden pisar una selección más nueva.

     Producción, como owner real y en sólo lectura: sin filtro devolvió
     6 pedidos, 2 acreditados, ARS 2 y 5 sesiones, sin período/comparación. Para
     30–31/7 devolvió 4 pedidos, 2 acreditados y ARS 2; comparó contra 28–29/7,
     donde hubo 2 pedidos y ARS 0. La firma anterior quedó retirada, la nueva
     quedó disponible sólo para miembros y el libro volvió a brecha 0. La
     puerta local terminó con TypeScript, lint 0 errores/143 advertencias
     heredadas, 2.637 tests, build/PWA y auditoría de dependencias en 0.

     El commit `7ea5a0a9` quedó Ready en Vercel y servido por `nerqia.app`. Con
     la sesión real, en 360 px, `df=2026-07-30&dt=2026-07-31` sobrevivió al
     reload, presentó 4 pedidos/2 pagos frente a 2/0, dejó la facturación sin
     tendencia falsa porque la base era cero y mostró +100% sólo en pedidos.
     Selector y limpiar midieron 44 px, no hubo overflow ni logs; al limpiar,
     la URL conservó `audit` y volvió a 6 pedidos/5 sesiones. El navegador de
     esta sesión no aceptó ampliar su viewport, por lo que D5.23 queda
     certificado publicado en móvil y no se declara una recorrida desktop
     nueva. La atribución por canal sigue como próxima capa.

176. Google puede recorrer el catálogo completo, no sólo encontrar su portada
     — D5.24, 2026-09-04. La auditoría contrastó el storefront con las guías
     oficiales de arquitectura ecommerce de Google: el buscador no opera el
     search box ni botones JavaScript para descubrir inventario. La SPA humana
     tenía paginación, pero anterior/siguiente eran botones sin `href`; el HTML
     del borde sólo tenía un H1 y la página 2 canonicalizaba hacia la 1.

     `RutaTienda` incorpora la página, construye un canonical propio y agrega
     el número al título. La UI conserva navegación SPA y foco, pero expone
     enlaces `prev`/`next` reales y normaliza páginas fuera de rango. El borde
     usa el mismo `store_catalog_products`, orden y ventana canónica de 20:
     home enlaza categorías/productos y el listado enlaza exactamente las
     fichas de esa página más sus vecinas. El grafo pasa a `WebSite` +
     `OnlineStore` y suma `BreadcrumbList`, `CollectionPage` e `ItemList`; no
     inventa reseñas, disponibilidad ni otro catálogo.

     El sitemap enumera las páginas de catálogo/categoría, escapa sus queries
     y deja de emitir `changefreq`, `priority` y un `lastmod` falso igual a
     “hoy”. Sólo conserva fechas editoriales con `updated_at` real. Las fallas
     parciales de RPC/vista devuelven 503 reintentable y quedan en logs del
     borde en vez de convertirse en 404/catálogo vacío o desaparecer en un
     `catch`. Puerta completa local: typecheck; lint con 0 errores/143 warnings
     heredados; **2.642 tests en 282 archivos**; build/PWA y bundling aislado de
     ambos handlers. `npm audit` no obtuvo respuesta del endpoint del registro
     en dos intentos y se registra como evidencia no disponible, no como verde;
     las guardas de dependencias sí pasaron dentro de la suite. Pendiente:
     El commit `c68abf90` quedó `Ready` en Vercel. Googlebot recibió la home con
     12 enlaces y `OnlineStore`; las tres ventanas con 20 fichas, canonical y
     título propios, migas y vecinos correctos; `page=99` convergió a la 3. El
     sitemap publicó 75 URLs, incluyó páginas 2/3, omitió
     `changefreq`/`priority` y conservó sólo 5 fechas editoriales reales. Una
     ficha real expuso Product/Offer/migas; un UUID inexistente respondió
     404+noindex; el user-agent humano siguió recibiendo la SPA.

     La sesión publicada a 1.288 px navegó 2→3, midió 20 cards y controles de
     44 px, sin overflow ni logs. La nueva guarda E2E volvió a ejecutar el
     recorrido contra producción como Pixel 5: **1/1 verde**, 20 cards,
     anchors `prev`/`next`, página 3, targets ≥44 px, cero overflow y cero
     errores. Estado: **D5.24 cerrado y publicado**. La indexación/posición
     sigue siendo una decisión externa y no se declara cerrada por este cambio.

177. Una visita real deja de ser un carrito con otro nombre — D5.25,
     2026-09-04. La auditoría de la base encontró **7 sesiones, 7 con items y
     0 con UTM**: la población del embudo era “personas que armaron carrito”,
     no tráfico. Además sólo 1/7 pedidos estaba vinculado. Seguir agregando
     gráficos sobre esa base habría producido una demo convincente y falsa.

     Se separan las dos vidas: `ecommerce_store_visits` representa una visita
     first-party de 30 minutos y `ecommerce_cart_sessions` conserva el carrito
     recuperable de 30 días. El browser rota una capacidad por inactividad; la
     base guarda sólo SHA-256, primera fuente/medio/campaña y hostname referente.
     No se envían IP, user-agent, URL completa, email ni formulario. RLS queda
     sin lectura directa y el único snapshot privado vuelve a comprobar
     membresía. Carrito, checkout y orden sólo agregan el vínculo; precios,
     stock y creación de pedido siguen en sus autoridades existentes.

     La revisión de punta a punta encontró que el rate limit público heredado
     todavía guardaba la IP como sujeto de su contador privado durante una
     hora. D5.25 conserva la misma protección pero hashea el sujeto con SHA-256;
     se eliminaron **53 contadores transitorios legacy** y la verificación
     productiva dejó 0 claves en claro. No eran visitas ni datos del negocio.

     El mismo panel de Commerce suma canales, no otra página Analytics: directo,
     búsqueda orgánica, redes, email, referencia, pago y otros, con visitas,
     carrito, checkout, compras, conversión e ingreso acreditado. El filtro usa
     cohorte de inicio de visita para que el porcentaje no supere su denominador.
     No muestra costo ni ROAS hasta recibir gasto de una conexión publicitaria.
     La medición empieza el 4/9, no backfillea historia y poda la señal mínima a
     13 meses mediante cron. Privacidad de plataforma y el generador de la
     política del merchant lo informan, pero Nerqia no publica por el dueño.
     `set_store_first_party_analytics` exige política publicada, contenido
     mínimo, confirmación owner/admin y deja auditoría. La tienda real conserva
     su política anterior, por eso quedó correctamente en **medición pausada**:
     0 visitas persistidas y 0 aceptaciones hasta que el dueño la revise.
     Páginas detecta esa política anterior y ofrece anexar el bloque como
     **borrador**: no pisa el contenido, no publica solo y deja claro que la
     medición seguirá apagada hasta la revisión del responsable.

     Benchmark oficial: Shopify separa adquisición, marketing y ventas, ofrece
     primera/última interacción y sólo calcula costo/ROAS con una actividad
     conectada; Tiendanube exige UTM y distingue canal/calidad. Verificación
     productiva reversible: `paid` se conservó ante un segundo touch social,
     carrito y checkout enlazaron `true`, el owner vio la fila agregada, outsider
     quedó bloqueado y la última fila dio **0 residuos**. Migración aplicada y
     libro en brecha 0. Puerta dirigida: 76/76 tests. Puerta completa local:
     **2.652/2.652 tests en 284 archivos**, TypeScript, lint sin errores y
     build/PWA productivo; `npm audit` no respondió en su ventana y no se
     declara verificado.

     `bc1ef553` quedó **Ready** y aliasado a `nerqia.app`. La sesión publicada
     autenticada a 1.288 px mostró alerta pausada, embudo 0/0 y canales vacíos
     sin atribuir los 7 pedidos legacy; Páginas agregó la divulgación sólo al
     estado local de un borrador y la recarga la descartó, sin escrituras ni
     logs. La tienda pública siguió cargando su catálogo sin logs. La consulta
     posterior conservó `enabled=false`, 0 aceptaciones y 0 visitas; el rate
     limit creó 2 contadores hasheados y **0** claves legacy. Estado: corte de
     código y deploy D5.25 cerrado; quedan la matriz mobile autenticada y
     observar tráfico real después de que el dueño publique/active, que no se
     fabrican desde una prueba.

178. Ningún fixture interno queda en el escaparate — D5.26, 2026-09-04.
     La recorrida publicada de D5.25 encontró entre 60 productos visibles uno
     llamado literalmente `ZZ NO COMPRAR - Prueba de pago`. La auditoría de
     base confirmó un único match exacto: stock 0, activo desde julio y
     referenciado por dos pedidos históricos. `20260904000070` lo desactiva por
     ID + nombre + stock 0 y retira `featured`, sin borrar la fila, los pedidos
     ni tocar inventario. Aplicada en producción: fila inactiva, stock 0, dos
     referencias históricas intactas; `store_catalog_products` pasó 60→59 y
     devuelve 0 fixtures. El storefront publicado confirmó “59 productos”,
     ausencia del nombre interno y 0 logs. Estado: **D5.26 cerrado**.

179. La cola opera lotes sin inventar otra autoridad — D5.27, 2026-09-04.
     La referencia oficial de [acciones masivas de Shopify](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/bulk-actions)
     permite seleccionar recursos y actuar sobre el conjunto; su
     [fulfillment masivo](https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/bulk-fulfillment)
     omite órdenes incompatibles y reporta progreso/errores. Tiendanube permite
     [actualizar el estado de ventas de forma masiva](https://ayuda.tiendanube.com/es_CO/123288-mis-ventas/como-actualizar-el-estado-de-mis-ventas-de-forma-masiva)
     desde la selección filtrada, pero advierte que marcar pagado tiene otro
     riesgo. Nerqia traduce ese patrón al Core propio: no incluye cobro ni
     cancelación en el mismo botón y no duplica la máquina de estados.

     `bulk_update_store_order_fulfillment` acepta hasta 50 UUID del tenant,
     deduplica, exige `ecommerce.edit`, oculta la existencia de IDs externos y
     llama para cada fila a `update_store_order_fulfillment`. Por eso conserva
     pago obligatorio, retiro distinto de despacho, entrega domiciliaria
     preparada y avance sólo hacia adelante. El lote puede completar filas
     válidas y devolver `changed`/`unchanged`/`skipped`/`duplicate` por orden;
     errores inesperados no filtran detalles del esquema. Un evento de
     auditoría guarda el resumen, nunca una sucesión opaca de escrituras del
     navegador.

     Desktop y mobile seleccionan únicamente pedidos con alguna transición
     operable, limitan el alcance visible a 50 y muestran cuántos pueden pasar
     a **En camino** o **Entregado/retirado** antes de confirmar. El resultado
     persiste en la pantalla con omisiones concretas; el email se invoca sólo
     para cambios reales, en tandas de cuatro y sobre la idempotencia ya
     existente. La verificación productiva reversible mezcló domicilio
     preparado, retiro, impago, finalizado, ausente, repetido, outsider y 51
     IDs: **6/6 checks**, dos auditorías y **0 residuos**. Migración aplicada y
     libro en brecha 0. Puerta integral local: TypeScript; lint con 0 errores y
     143 warnings heredados; **2.657/2.657 tests en 285 archivos**; build/PWA
     productivo. `722c4951` quedó `success` en Vercel y el navegador autenticado
     recibió el bundle nuevo. La cola real mostró 7 pedidos —5 impagos y 2 ya
     entregados—, 15 representaciones accesibles desktop/mobile de selección
     correctamente deshabilitadas, ancho de documento = viewport y 0 logs. No
     se creó ni alteró una orden productiva para forzar el estado activo: barra,
     confirmación y resultado tienen cobertura de código/guardas, y su tarea
     interactiva queda para el primer pedido operable real. Estado: **D5.27
     cerrado y publicado**; la medición de tarea real sigue siendo gate externo.

180. La ficha decide sobre la variante real antes de prometer stock o envío —
     D5.28, 2026-09-04. Shopify asigna
     [inventario e imagen por variante](https://help.shopify.com/en/manual/products/variants)
     y actualiza la imagen al elegirla; Tiendanube recomienda
     [mostrar como botones y tachar las opciones sin stock](https://ayuda.tiendanube.com/es_ES/mostrar-las-variantes-sin-stock-tachadas-en-el-detalle-de-mis-productos)
     para no ocultar combinaciones que existen. La auditoría de Nerqia encontró
     el caso opuesto: antes de elegir sabor/talle la PDP mostraba el stock
     agregado y montaba el cotizador sin `variant_id`, aunque el SKU elegido
     después pudiera estar agotado.

     D5.28 ordena la decisión en la misma página, sin otro catálogo ni otra
     autoridad: selector semántico → disponibilidad exacta → cotización →
     cantidad/CTA. Ninguna opción queda preseleccionada. Las agotadas se ven
     tachadas y rotuladas, pero siguen siendo seleccionables para que
     `StockAlertForm` suscriba el `variant_id` correcto; una disponible informa
     su saldo real. El CTA inicial dice qué falta elegir y lleva foco al grupo,
     también en la barra móvil. El cotizador no se monta ante una variante
     ambigua o agotada, y el servidor conserva autoridad sobre precio, stock y
     orden. Las reglas de copy distinguen sabor, color, talle, medida,
     presentación y fallback genérico sin devolver todo a “sabores”.

     La primera recorrida publicada encontró una dependencia oculta: el RPC
     histórico todavía filtraba `v.stock > 0`, por lo que la interfaz no podía
     presentar el agotado. `20260904000090` entrega todas las variantes activas
     del comercio sin exponer costo, margen, proveedor u organización; comprar
     sigue revalidando el saldo en `resolve_store_line`. Aplicada y registrada
     en producción: la comparación read-only con `SET LOCAL ROLE anon` devolvió
     **26/26 activas, 6/6 agotadas, 0 diferencias** y el dry-run dejó el libro en
     brecha 0. Puerta integral posterior: TypeScript; lint con 0 errores y 143
     warnings heredados; **2.663/2.663 tests en 286 archivos**; build/PWA
     productivo.

     `8e632f80` quedó Ready. En `exentryimports.nerqia.app`, la PDP real mostró
     9 sabores —7 disponibles y 2 agotados—: `BAJA SPLASH` pasó a “Esta
     variante está agotada”, montó el formulario de aviso exacto y no montó
     envío; `CHERRY STRAZZ` mostró 2 unidades, cotización y CTA. Ancho de
     documento 1.284 px sobre viewport 1.288 y 0 logs. No se agregó al carrito,
     no se envió un email y no se alteró dato real.

     El nuevo E2E read-only reprodujo la secuencia agotada → disponible en
     Chromium y Pixel 5. Mobile pasó completo; desktop a 720 px de alto encontró
     que `IntersectionObserver` seguía observando el bloque de compra desmontado:
     el CTA reaparecía visualmente pero conservaba `aria-hidden`. La dependencia
     de `variantId` fuerza ahora cleanup + observación del nodo nuevo, con guarda
     unitaria. `940cee4a` quedó Ready y aliasado a `nerqia.app`; el E2E publicado
     repitió el flujo completo en Chromium y Pixel 5: **2/2**, sin escrituras.
     Estado: **D5.28 cerrado en autoridad, desktop, mobile y accesibilidad**.

181. Las tarjetas dejan de duplicar una ficha de producto y dicen el precio
     real de la opción — D5.29, 2026-09-04. Shopify documenta que una grilla o
     quick view puede [seleccionar variantes y actualizar sus datos](https://shopify.dev/docs/storefronts/themes/product-merchandising/variants),
     mientras Tiendanube reserva el
     [selector completo y el agotado tachado](https://ayuda.tiendanube.com/es_ES/123159-detalle-del-producto/como-mostrar-las-variantes-de-producto-como-botones)
     para el detalle. No son mandatos visuales universales: la guía oficial de
     Shopify aclara que exponer variantes en colección es útil sobre todo cuando
     hay muchas opciones similares. En Nerqia, el RPC ahora entrega también las
     agotadas y la card histórica intentaba renderizarlas todas: un producto real
     ya tenía 9 sabores, por lo que una grilla de 20 cards podía convertirse en
     otra PDP repetida y perder el CTA debajo del pliegue.

     D5.29 fija una frontera todavía más simple: la card compra directamente un
     producto simple, pero cualquier producto con variantes lleva a **Elegir
     sabor/talle/variante** en una sola PDP. El conteo visible separa disponibles
     y agotadas; si ningún SKU queda, deriva a “Ver opciones y avisos”. Si los
     SKU disponibles tienen valores distintos, la card muestra “Desde” sobre el
     menor precio comprable; nunca usa el precio menor de una variante agotada
     para atraer un clic.

     La regla de override dejó de estar copiada en Card, PDP y carrito:
     `precioDeVariante` es el espejo cliente único, mientras
     `resolve_store_line` conserva la autoridad server-side. El stock de la card
     también sale de la suma de variantes disponibles cuando existen, no del
     agregado ambiguo del producto. La guarda pura cubre agotadas, stock,
     “Desde” y fallback de precio; otra guarda y un E2E read-only fijan que la
     card no vuelva a montar radios ni quick-add de un SKU ambiguo.

     La primera versión publicada del slice (`ce81f427`) confirmó 20 cards,
     tres opciones de nueve, enlace a dos agotadas, ancho 1.284/1.284 px y 0
     logs, pero la captura encontró una fila de **612 px**: aun resumido, el
     selector duplicaba la PDP y dejaba un gran vacío bajo los productos
     simples. Esa evidencia cambió la decisión anterior por el CTA único de
     opciones.

     La puerta posterior quedó verde con TypeScript, lint sin errores y 143
     warnings heredados, **2.665/2.665 tests en 286 archivos** y build/PWA.
     `bfb1b0a7` quedó Ready y aliasado a `nerqia.app` + wildcard. La grilla real
     montó 20 cards: la de 9 sabores bajó a 459,8 px frente a 434,2 px de una
     simple —25,6 px, no 178—, mostró 7 disponibles + 2 agotadas, 0 radios, 0
     botones de agregado ambiguo y el link “Elegir un sabor”. Documento y
     viewport dieron 1.284/1.284 px y 0 logs. El E2E publicado verificó card +
     secuencia PDP agotada → disponible en Chromium y Pixel 5: **4/4**, sin
     agregar al carrito ni escribir datos. La lectura `anon` encontró tres
     productos con variantes (10/10/0, 9/7/2 y 7/3/4
     total/disponible/agotada) y 0 overrides de precio reales; por eso “Desde”
     queda cubierto por cálculo puro, no se inventó un precio productivo para
     fotografiarlo. Estado: **D5.29 cerrado en implementación, desktop, mobile
     y accesibilidad; el cobro sigue bajo autoridad server-side**.

182. El checkout móvil conserva la decisión sin tapar la compra — D5.30,
     2026-09-04. Tiendanube documenta una secuencia de
     [datos → entrega → pago](https://ayuda.tiendanube.com/123288-mis-ventas/como-es-el-proceso-de-compra-para-mi-cliente)
     y Shopify mantiene [contacto, entrega y pago](https://help.shopify.com/en/manual/checkout-settings)
     con control de inventario durante el checkout. La auditoría del código de
     Nerqia encontró una desviación de esa jerarquía: en pantallas chicas todo
     el `aside` —líneas, cupón, desglose, error y CTA— tenía `sticky bottom-0`.
     Un pedido largo podía convertirse en una capa alta sobre los campos que el
     comprador todavía necesitaba completar.

     La corrección conserva el resumen completo en el flujo normal y deja fija
     sólo una barra de decisión con **Total + Confirmar/Continuar a Nerqia Pay**,
     altura táctil de 48 px, safe area y espacio reservado al final del
     documento. Desktop conserva el resumen lateral sticky. El botón ya no
     queda mudo al bloquearse: distingue `Calculando entrega`, `Revisá la
     entrega` y `Sin medios de pago`. El total visual sigue siendo espejo; stock,
     cupón, envío, precio y orden se recalculan en las autoridades server-side
     existentes.

     La suite publicada se declaraba read-only, pero cada navegación todavía
     podía persistir visita, carrito e inicio de checkout. El E2E intercepta
     ahora esas tres escrituras first-party; continúa leyendo catálogo, stock,
     precios y cotización reales, pero no infla conversión ni deja carritos de
     prueba. La nueva prueba mide posición, alto, safe bottom, overflow y
     separación desktop/mobile sin confirmar una orden.

     Puerta local: TypeScript OK, lint **0 errores / 143 warnings heredados**,
     **2.665/2.665 tests en 286 archivos** y build/PWA. `7e5c3a22` quedó Ready
     y aliasado a `nerqia.app` + wildcard. La repetición publicada pasó **2/2**
     en Chromium y Pixel 5: resumen estático en mobile, lateral sticky en
     desktop, barra fija ≤120 px y por debajo del 70% superior del viewport,
     safe bottom, cero overflow y cero errores de consola. La captura real
     dejó visibles Entrega y Tus datos sobre Total + Confirmar; no ejecutó una
     orden y las escrituras auxiliares quedaron interceptadas. Estado:
     **D5.30 cerrado en implementación, desktop, mobile y evidencia read-only;
     la compra sandbox/real permanece como gate externo**.

183. El carrito deja de ser un overlay gigante y no cierra un total sin flete —
     D5.31, 2026-09-04. Tiendanube ofrece el
     [calculador de envío en producto, carrito y checkout](https://ayuda.tiendanube.com/es_ES/122809-informacion/orden-de-las-opciones-de-envio-cuando-el-cliente-pone-su-codigo-postal)
     y su [contador de envío gratis](https://ayuda.tiendanube.com/es_AR/123178-carrito-de-compras/como-mostrar-el-contador-de-envio-gratis-en-mi-tiendanube)
     como información previa a comprar. Shopify exige que la
     [página de carrito](https://shopify.dev/docs/storefronts/themes/architecture/templates/cart)
     permita revisar líneas, cantidades, descuentos y avanzar al checkout. La
     traducción de Nerqia conserva esas capacidades, pero elimina el panel fijo
     que contenía provincia, promoción, envío, subtotal, total y CTA a todo
     ancho incluso en desktop.

     D5.31 compone líneas y sugerencias junto a un único resumen: dentro del
     flujo en mobile y lateral sticky en desktop. Sólo **Total + Finalizar
     compra** queda fijo en el teléfono, con safe area y 48 px táctiles. Cuando
     la tienda cotiza por zona y todavía no hay tarifa, el valor dice `+ envío`;
     no presenta como total final una cifra que excluye el flete. Una caída de
     red deja error recuperable y `console.error`, en vez de volver en silencio
     a un cero ambiguo. Cotización, stock, descuento y orden continúan en sus
     autoridades server-side; no nació otro carrito ni checkout.

     Una guarda estructural evita que vuelva el panel completo `fixed`, y el
     E2E read-only mide resumen/barra, posición, alto, safe bottom, overflow,
     total pendiente y consola en desktop/Pixel 5. La puerta local pasó
     TypeScript, lint con 0 errores/143 warnings conocidos, 2.665 tests en 286
     archivos y build/PWA. Estado: **implementado y protegido localmente; falta
     la matriz publicada para cerrar D5.31**.

Los gates comerciales previos quedaron demostrados como externos al código: el
segundo comercio requiere founder-led sales, la operación de margen requiere una
venta/control real y el impact event requiere una decisión del merchant. Eso
habilitó F3 sin declararlos cerrados. Con la base técnica de Document Inbox y
aprobación ya entregada, F4 avanza por slices sin declarar adopción Finance ni
Commerce: la prueba real de dos dispositivos y una migración externa siguen
siendo gates, no casillas que el código pueda inventar.

## 8. Modelo económico objetivo

El modelo «software base gratuito o de muy baja fricción» es una **hipótesis de
distribución**, no pricing aprobado. Sólo es viable si el costo variable y el
soporte quedan controlados.

| Línea | Hipótesis de ingreso | Gate |
|---|---|---|
| Business | Base gratuita/freemium o plan simple. | Retención y costo de servir medidos. |
| Nerqia Pay | Margen dentro del precio de procesamiento, conciliación y riesgo. | Contratos upstream, aprobación, fraude, impuestos y soporte. |
| Nerqia Ship | Diferencia negociada, etiquetas y servicios logísticos. | Volumen, reclamos y costo operativo. |
| Nerqia Finance | Documentos por uso, conectores, aprobación y auditoría avanzada. | Accuracy, costo por documento y disposición a pagar. |
| Communications | WhatsApp, SMS y email de volumen. | Consentimiento, entregabilidad y margen. |
| Domains | Registro, renovación y DNS administrado. | Operación y soporte automatizados. |
| Ecosistema | Revenue share de apps/themes y partners. | Merchants y desarrolladores activos. |
| Capital | Referral/origination mediante entidad regulada. | Datos, riesgo, volumen y marco legal. |
| Enterprise | SLA, SSO, auditoría, infraestructura y soporte. | Demanda contractual y unit economics. |

### La escalera de planes, y el defecto que tenía (2026-08-28)

Medido contra la base el 2026-08-28, **pagar el plan de entrada sacaba tres
capacidades que el trial gratis daba**:

| plan | precio | IA | backups | branding | ventas/mes |
|---|---|---|---|---|---|
| trial | $0 | ✅ | ✅ | ✅ | sin límite |
| **starter** | **$19.900** | ❌ | ❌ | ❌ | 1.500 |
| pro | $34.900 | ✅ | ✅ | ✅ | 5.000 |
| business | $69.900 | ✅ | ✅ | ✅ | sin límite |

⚠️ El día 15 el comercio no elegía entre planes: elegía entre pagar y perder la
IA, o irse. Es el peor momento posible para quitar una función.

⚠️ **Y dos de las tres no existían.** `custom_branding` y `backups_enabled` se
calculan en `useEntitlements` como `canCustomBrand` y `canUseBackups`, y **no
los lee ninguna pantalla** (medido: cero consumidores fuera del propio hook).
De los tres diferenciadores que la grilla de precios promete, uno solo estaba
implementado — y el que estaba iba al revés.

**La decisión (2026-08-28): los planes se diferencian por volumen, no apagando
capacidades.** Es lo que hacen Tiendanube y Shopify. El diferenciador real pasa
a ser el **cupo mensual de IA**, que reemplaza a los dos que no existían:

| plan | acciones de IA/mes |
|---|---|
| trial | 100 |
| starter | 300 |
| pro | 2.000 |
| business | sin tope |

📌 El trial queda **por debajo** del plan de entrada a propósito: la prueba
tiene que dejar ganas, no dejar deuda.

📌 **El precio no se tocó.** Qué cobrar es del dueño; esto reparte capacidades,
que es producto. Se deshace con un `UPDATE`.

⚠️ **Y sin medición un cupo no existe.** `ai_usage_stats` estaba en la base
desde hacía meses con **0 filas**: ocho Edge Functions quemaban
`ANTHROPIC_API_KEY` y ninguna registraba una acción. Ahora se registra por
`ia_registrar_consumo` —única puerta, revocada salvo `service_role`— y
`org_entitlements` devuelve `ia_cupo_mensual`, `ia_usado` e `ia_restante`.
Guarda: `laIaSeMideYTieneTecho.test.ts`.

⚠️ **Lo que todavía NO está verificado punta a punta:** que la función
deployada registre de verdad. `ANTHROPIC_API_KEY` no está configurada (medido
el 2026-08-28 con `supabase secrets list`), así que la IA no corre en
producción. Lo verificado es el SQL —registrar descuenta, dos acciones del
mismo día suman, «sin tope» ≠ «sin cupo»—, el permiso en los dos sentidos como
rol real, y que las siete funciones deployadas sirven.

### Corrección: `cuenta_de_cobro` no tiene una divergencia contable (2026-08-28)

El 2026-08-28 se afirmó en un commit que `ledger_asentar_venta_pos` llamaba a
la versión de `cuenta_de_cobro` «que no sabe si la venta se cobró», y que por
eso **una venta fiada del mostrador entraría a Caja como cobrada**.

⚠️ **Es falso, y conviene dejarlo escrito porque el commit sigue en la
historia.** `ledger_asentar_venta_pos` resuelve el no-cobrado **antes** de
llamar a `cuenta_de_cobro`:

```sql
-- ⚠️ Fiado NO es caja. Una venta a cuenta corriente asentada como efectivo
-- infla la caja del día y esconde el crédito: son los dos errores a la vez.
-- `paid = false` manda sobre el método, siempre.
IF v_r.paid IS FALSE OR v_r.payment_method = 'fiado' THEN
  ... 1.2.01 ... CONTINUE;
END IF;
```

O sea que el POS aplica **la misma regla**, más arriba y más explícita. Las dos
versiones de `cuenta_de_cobro` conviven porque tienen contratos distintos —una
devuelve NULL ante lo desconocido para que el llamador deje rastro, la otra cae
a Caja— y cada llamador usa la correcta. Queda duplicación de **nombre**, no de
criterio.

📌 **Decisión: no se unifican.** Tocar el libro mayor sin ganar correctitud es
riesgo puro. La entrada sigue en la allowlist de `unaFuncionUnaFirma.test.ts`
con el motivo corregido, para que la duplicación siga a la vista.

⚠️ Lo que **no** se pudo cerrar en vivo: una prueba de punta a punta del
asiento del POS. El posteo pasa por un outbox asíncrono que no se completa
dentro de la transacción de prueba, así que la conclusión se apoya en el código
y en que `audit_resultado_divergente` está en 0 con 0 ventas sin cobrar.

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

Hipótesis preferida a validar: cuando el merchant usa Nerqia Pay, la plataforma
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

### Sesión 2026-09-02 — Cableado uso real (ATM)

Olas ejecutadas: Commerce honesto (tarifario/pesos/legales/checkout), ofertas
propias + Anthropic (`offerRules` + `ai-offer-recommender` sin Lovable),
`seed_default_automation_flows`, banner SMTP sin dominio, FocoDelDia
primera-venta/toma-física, `create-checkout` → 410. Fuera: segundo OAuth, Ship
API, AFIP prod, Orbit O1+, n8n.

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

- Categoría Commerce OS y un solo Business Graph ([ADR 002](docs/ADR_002_COMMERCE_OPERATING_SYSTEM.md)).
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
- No declarar un módulo “completo” sin el contrato de ADR 002 §4.

## 13. Congelado deliberadamente

Hasta abrir sus gates:

- Finance Automation antes del Finance MVP;
- multi-market, A/B testing o personalización sin tráfico;
- Store Builder libre antes de temas/versiones/rollback;
- agentes autónomos sobre pagos, inventario o precios;
- Pay regulado, Capital o custodia;
- KYC/AML, selfie, score de fraude o motor de riesgo F7 sin partner ni volumen;
- controladora fiscal (Hasar, Epson, Moretti u otra): Nerqia emite por WSFE/CAE, no por controlador; sin hardware homologado no se finge;
- marketplace de apps/themes;
- microservicios por moda;
- multi-región, data residency o tenancy dedicado;
- country packs fuera de Argentina;
- features de ERP periféricas sin merchant ni métrica.

## 14. Fuentes, evidencia y revisión

- AGENTS.md: invariantes operativas, seguridad, migraciones y verificación.
- **docs/auditorias/2026-08-24_auditoria_integral.md** y su backlog ejecutable:
  auditoría externa sobre el commit `96b0bb4`. Sus afirmaciones concretas se
  verificaron contra el repo el 2026-08-24 y **las cinco dieron ciertas**: 65
  funciones (README decía 29 — corregido), tres lockfiles conviviendo
  (eliminados `bun.lock`/`bun.lockb`), `xlsx` 0.18.5 con auditoría conocida,
  onboarding con `useState('perfumes')` como default, y la API pública con la
  key **en texto plano y sin scopes**. Sus fases coinciden con las de este
  documento; su backlog mapea a los 25 slices salvo tres brechas que los slices
  no cubren. **Las tres se cerraron el 2026-08-25:**
  - ~~**endurecer la API pública**~~ hecho (ver abajo).
  - ~~**reemplazar o aislar `xlsx`**~~ hecho (ver abajo).
  - ~~**quitar el default `perfumes`**~~ hecho (ver abajo), y el 2026-08-25 se
    cerró también el hermano que la auditoría no vio: el `DEFAULT 'perfume_arabe'`
    de `products.category`.

### El rubro deja de venir puesto — 2026-08-25

La auditoría lo vio en `OnboardingPage.tsx:36`, y era la mitad del problema: el
`useState('perfumes')` y una **reselección** después de cargar los presets
(`rows.find(code === 'perfumes')`) que reponía el default aunque el estado
arrancara vacío. La otra mitad estaba en la base: `settings.industry_code` se
creó con `DEFAULT 'perfumes'` en 20260428021128, cuando esto era la app de un
solo negocio.

No es una etiqueta: el rubro siembra tipos de producto y atributos en el
catálogo. Adivinar mal se descubre cuando el comercio ya cargó productos.

Medido (2026-08-25): 2 organizaciones con fila en `settings`, **las dos** en
`perfumes`, 0 en NULL, y sólo **1** pasó de verdad por el perfilador — una
eligió y la otra lo heredó sin enterarse. Hay 7 rubros disponibles.

Ahora no hay preselección, el paso no avanza sin elegir (`disabled={!rubroCode}`)
y la columna no tiene default: NULL significa "todavía no eligió", un estado
real y distinto de cualquier rubro, con el mismo criterio que `products.tax_rate`.
**No se backfilleó nada**: una de las dos filas es la perfumería de verdad, y
reescribir datos reales para que un reporte dé limpio está prohibido acá.

### La categoría del producto tampoco viene puesta — 2026-08-25

La misma deuda, un nivel más abajo. `products.category` era
`NOT NULL DEFAULT 'perfume_arabe'`: un comercio de cualquier rubro que cargara
un producto sin elegir categoría quedaba con perfumería escrita en su base, sin
enterarse —la pantalla muestra el nombre lindo y el slug recién aparece cuando
exporta, publica en la tienda o arma un precio por categoría—.

Medido antes de tocar (2026-08-25, contra producción): 60 productos en 3 slugs
(`perfume_arabe` 54, `vaper` 5, `perfume_diseñador` 1), **todos de una sola
organización de 4**; `ecommerce_categories` poblada y coincidiendo exacto con
esos 3 slugs; las otras 3 organizaciones con 0 productos, 0 categorías y **0
tiendas**. Es decir: las tres que verían el vocabulario ajeno.

Al medir aparecieron dos bloqueantes que no estaban en el pedido:

1. **"Crear una categoría…" fallaba siempre.** `CategorySelect` insertaba en
   `ecommerce_categories` sin `store_id`, que era `NOT NULL` sin default ni
   trigger. Verificado en vivo: `null value in column "store_id" ... violates
   not-null constraint`. Y aunque lo pasara, 3 de 4 organizaciones no tienen
   tienda de la que sacarlo.
2. **`useOrgCategories` sembraba los cuatro nombres heredados** cuando la
   organización no tenía categorías propias — justo el caso del comercio nuevo.
   El "respaldo" hacía lo contrario de lo que buscaba.

`20260825000002_categoria_sin_rubro` le saca a `products.category` el default
**y** el `NOT NULL` (sin el segundo, quitar el default rompe al re-correrse los
~15 bloques de verificación de migraciones que insertan sin `category`), y hace
`store_id` opcional: la categoría es del Business Core y la tienda es un canal
que la muestra — `get_store_categories` ya unía por `org_id` desde
20260805000002 y el índice único ya era `(org_id, slug)`. **No se backfilleó
nada**: las 60 filas son de la perfumería de verdad.

Del lado del código quedaron sin vocabulario hardcodeado la base de
conocimiento de marcas, la Toma Física, la sugerencia de la IA —que ahora
propone sobre las categorías reales del comercio en vez de una lista fija de
doce, y sólo devuelve algo si existe: sugerir un slug que no está deja el
selector en blanco—, el placeholder del banner, la ficha de producto y la
oferta masiva. Los importadores conservan sus heurísticas, pero el fallback
dejó de ser un rubro: el de Tiendanube usa la categoría del propio archivo y el
de facturas cae en `otro`.

⚠️ **Lo que NO se tocó, medido y listado en la allowlist de
`categoriaSinRubroPorDefault.test.ts`:** `types.ts` (`ProductCategory` es una
unión cerrada de los 4 slugs), `POSPage`, `SalesPage` y `SettingsPage` (listas
escritas a mano; la de Settings gobierna el markup por categoría),
`PublicCatalogPage` (hero y agrupación con copy de perfumería),
`supabaseStore.getCategoryLabel`, `BulkPriceAdjust` dentro de `ProductsPage`,
`CatalogPage`, `weightEstimate` y las plantillas de marketing. El test falla si
aparece un archivo nuevo con un slug de rubro, y también si la allowlist
conserva una entrada que ya se limpió.

Verificado contra producción como el rol real: una organización **sin tienda**
crea una categoría y la ve por RLS (0 restos); y después de la migración la
tienda pública sigue respondiendo como `anon` con las 3 categorías y sus
conteos exactos (54/1/5), 60 productos en el catálogo y `stock_negativo` en 0.

### Ninguna pantalla enumera categorías a mano — 2026-08-26

La segunda mitad. El slice anterior sacó el rubro de la base y de los
componentes que **eligen** una categoría; éste sacó las listas que la
**enumeraban**: seis pantallas con la misma lista de cuatro slugs escrita a
mano, cada una con su propia copia.

Lo caro no era el rótulo feo. Era **Ajustes → Precios por categoría**: el markup
es el número con el que se calcula el precio de venta, y sólo se podía
configurar para `perfume_arabe`, `perfume_diseñador`, `vaper` y `electronico`.
Un comercio de otro rubro no tenía forma de tocar el suyo. Medido antes de
tocar: `category_pricing` está en `{"perfume_arabe": {}}` —una entrada vacía— y
`{}`, así que **nadie llegó a configurar ninguno**; el riesgo del cambio era
cero y la funcionalidad estaba muerta desde que hay más de un comercio.

Qué quedó, como criterio reusable:

- **Un filtro** (POS, Ventas) arma su lista con **los productos que la pantalla
  ya tiene cargados** y rotula con `useOrgCategoryNames`. En un mostrador, una
  pastilla que devuelve cero resultados es peor que no estar — y así no cuesta
  una consulta extra.
- **Una configuración** (el markup) lista las categorías de la organización
  **más las que ya tengan valor guardado**. Eso último no es cosmético:
  `getCategoryMarkup` sigue aplicando una entrada de una categoría borrada, así
  que no mostrarla la deja cobrando sin que nadie pueda verla ni sacarla.
- `getCategoryLabel` perdió su mapa —copia letra por letra de
  `NOMBRES_HEREDADOS`— y delega en `nombreDeCategoria`. Sigue siendo el fallback
  **sin organización**: helpers de módulo, PDFs y el catálogo de
  `/catalogo/:userId`, que es anónimo y no puede leer `ecommerce_categories`.
- El badge usa `colorDeCategoria(slug)`, un hash estable sobre una paleta de
  ocho. Antes sólo cuatro slugs tenían color y cualquier otra categoría salía
  sin badge.
- `BulkPriceAdjust` recibe las categorías por prop en vez de listarlas: la
  página ya las tiene y pedirlas de nuevo sería la misma consulta dos veces.

⚠️ **`ProductCategory` no era la raíz.** Figuraba primero en el plan como "el
tipo cerrado que impide abrir el resto". Medido: `src/lib/types.ts` lo importa
**un solo archivo**, `seedData.ts`, y sus interfaces `Product`, `Purchase`,
`Sale`, `Debt` y `Settings` no las consume nadie —las pantallas usan los tipos
generados de Supabase o interfaces locales—. Se abrió igual, porque cuesta una
línea, pero no destrabó nada: la raíz real eran las seis listas.

⚠️ **Lo que queda en la allowlist ya no son listas: son features atadas a un
rubro.** Ficha de perfume (`product_perfume_details`), subtipos de vaper,
campos de electrónica, venta por decant, `weightEstimate` y las plantillas de
marketing. Eso se saca con el catálogo polimórfico (P0.1, `product_types` y sus
atributos), no reemplazando un slug por otro, y es una decisión de producto —
no una limpieza.

Verificado en navegador contra el catálogo público real: los chips muestran
"Perfume Árabe 36", "Perfume Diseñador 1" y "Vaper 5", ningún slug crudo llega
al comprador y no hay errores de consola. Las pantallas del panel siguen sin
inspección en navegador: piden sesión y no hay credenciales de prueba.

### `xlsx` sale de la versión abandonada — 2026-08-25

El paquete `xlsx` del registro de npm está **congelado en 0.18.5 a propósito**:
SheetJS movió la distribución a su propio CDN y los arreglos siguieron ahí. Esa
0.18.5 arrastra dos avisos altos —contaminación de prototipo y ReDoS— y los dos
están en el **parser**, que es exactamente lo que corre sobre un archivo que
sube el comercio.

Medida la exposición real: seis usos, pero sólo dos **parsean** —
`ProductsExcelImport` y `TiendanubeExcelImport`, ambos sobre un archivo subido.
Los otros cuatro escriben, y escribir no es la superficie vulnerable.

Se pasó a `0.20.3` desde `cdn.sheetjs.com`, que es la vía que publica el propio
autor: misma API, cero cambios de código. El lock fija el tarball **con hash de
integridad**, así que si el CDN sirviera otros bytes `npm ci` falla en vez de
instalar otra cosa. Verificado con round trip real de escritura y lectura, y
comprobando que una hoja con cabecera `__proto__` **no** contamina
`Object.prototype` — la prueba del aviso, no la ausencia de una línea en
`npm audit`, donde `xlsx` ya no aparece.

⚠️ **Riesgo asumido, dicho de frente:** la dependencia deja de venir del
registro. Si `cdn.sheetjs.com` no responde durante un build, el deploy falla.
Es el precio de usar la única distribución con los arreglos; la alternativa era
quedarse en 0.18.5 parseando archivos ajenos.

**Lo que sigue siendo cierto:** parsear un archivo que sube un tercero en el
mismo realm que la sesión de Supabase es una superficie que un CVE futuro vuelve
a abrir. Moverlo a un Web Worker es defensa en profundidad todavía pendiente.

### API pública endurecida — 2026-08-25

Había **tres sistemas de API keys desconectados**, y el único que autenticaba
era el peor: `settings.api_key`, **en texto plano**, en una tabla que todo
miembro de la organización lee por RLS. Cualquier empleado la copiaba y con ella
creaba ventas, ajustaba stock y rotaba la key. Los otros dos no autenticaban
nada: `org_api_keys` (hash correcto, sin backend) y `api_keys` con
`key_hash = btoa(key)` — **base64, reversible con `atob()`**. Y la key se
generaba **en el navegador**.

Se midió antes de tocar: **0 keys activas y 0 filas en las dos tablas**, así que
no había nada que migrar ni integración que romper.

Qué quedó (`20260824000001_api_keys_endurecidas.sql`, 5 aserciones en la
migración + 16 contra la función deployada):

- la key nace en el servidor (`api_key_emitir`, owner/admin), se muestra **una
  vez** y en la base sólo queda su SHA-256;
- **scopes por endpoint** — siete reales, no los catorce fantasma que la UI
  ofrecía y ningún endpoint chequeaba: el usuario creía acotar una key y no
  acotaba nada;
- `cost_usd` sólo sale con `costs:read`: el costo es el dato con el que se
  deduce el margen;
- `POST /sales` acepta `Idempotency-Key` (primitiva H1);
- sin CORS `*`: es server-to-server, como Stripe. Allow-Origin abierto invita a
  poner la key en el frontend de un tercero;
- los errores de Postgres no se filtran, y un fallo de DB en el lookup de auth
  responde error interno, **no "key inválida"** — son problemas opuestos.

⚠️ **Lo que encontró la verificación en vivo, y no lo habría encontrado leer el
código:** la búsqueda del producto corría **después** de reservar la clave de
idempotencia, así que un `product_id` inexistente devolvía 404 y dejaba la clave
`en_curso`; el reintento —aun corregido— chocaba 24 h contra un 409 por una
request que nunca escribió nada. Stripe lo dice explícito: un fallo de
validación no guarda resultado idempotente. Se movió la validación antes de la
reserva y hay un test de orden que lo fija.

Verificado contra producción con dos keys `ZZ` de sólo lectura, borradas al
terminar (restos 0, y `settings.api_key` en 0 filas): el costo no viaja sin su
scope y sí con él, un scope faltante da 403 sin escribir, key inexistente 401,
key revocada 401, `/v2/` da 404 en vez de mapear a v1, `OPTIONS` no devuelve
Allow-Origin, el contador de uso se mueve, y el hash guardado no es la key ni su
base64.

El cierre contractual del **2026-08-29** corrigió lo que aquella primera capa
todavía no resolvía: cupo durable por key en lugar de memoria por IP, separación
real `products:read`/`stock:read`/`costs:read`, venta e idempotencia en una única
transacción con lock de concurrencia, límites antes de Postgres, path `/v1`
obligatorio, montos ARS/USD y stock definidos, `X-Request-Id` correlacionable y
política estándar de `Deprecation`/`Sunset`. El contrato máquina vive en
`/developer/api/openapi.json`; la guía humana en `docs/API_PUBLICA.md`. La
fixture destructiva-cero probó el RPC real y producción sirve `public-api` v42.

- docs/ESTRATEGIA.md: tesis de margen y comparativas con fuente/fecha.
- docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md: investigación funcional/visual,
  arquetipos de pantalla, overlays, segmentación, estados, cobertura por
  producto y puerta de adopción tecnológica.
- docs/LEGAL.md: requisitos argentinos y estado fiscal/legal.
- Nerqia v2, análisis recibido el 2026-08-21: referencia estratégica para
  portfolio, arquitectura, Finance, Commerce, Platform y monetización.
- Build y suites locales del 2026-08-30: **2.102 tests en 213 archivos**,
  typecheck, lint sin errores (139 warnings de deuda conocida), build/PWA y 74
  funciones verificadas. Última evidencia: 46 E2E críticos —32 públicos, 13 de
  panel y 1 setup autenticado—; Gastos, importación y turno son de sólo lectura.
- docs/FINANCE_DOCUMENT_EXTRACTION.md: custodia, esquema estructurado,
  confianza, revisión append-only, gate de privacidad y operación.
- docs/FINANCE_DOCUMENT_MATCHING.md: orden determinístico, aliases confirmados,
  ambigüedad, RPC/ACL y verificación real.
- docs/FINANCE_DOCUMENT_DRAFTS.md: tres borradores, segregación, aprobación,
  idempotencia y límite físico hasta la recepción.
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
- trimestralmente para competencia, experiencia, tecnología y monetización.

La visión puede ampliarse. El orden sólo cambia con evidencia de operación,
cliente, riesgo, tracción o economics.
