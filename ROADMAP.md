# Gestiona Cloud — Visión y roadmap ejecutivo

**Corte:** 2026-08-22
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
comparativas fechadas y con fuente oficial viven en `docs/ESTRATEGIA.md`; los
patrones de producto/UX y la matriz de ejecución viven en
`docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md`.

| Campo competitivo | Paridad mínima | Diferencial Gestiona que debe probarse |
|---|---|---|
| ERP / operación | Contabilium, Xubio y Colppy ya combinan facturación argentina, compras, stock, caja/bancos, contabilidad e integraciones locales. | Menor tiempo de implementación y una verdad conectada a Commerce y Finance; la amplitud de módulos no es ventaja por sí sola. |
| Commerce | Tiendanube y Empretienda fijan la paridad local: checkout, catálogo/importación, promociones, pagos, envíos, dominio, operación mobile y stock entre ventas online/presenciales; Tiendanube suma PDV, filtros/bulk y ecosistema. | Costo y margen del mismo Core que ejecuta la venta, con migración reconciliada y una operación más simple para el segundo comercio. |
| Margen y rentabilidad | Shopify ya reporta profit por producto/orden/mercado y Odoo margen por línea/pedido; tener un reporte es paridad, no ventaja. | Cuatro fuentes persistidas —costo histórico, cobro, envío real e IVA— por venta/canal/operación, con mix, promoción y devoluciones. El POS ahora convierte cada parte del cobro en evidencia conciliable y bloquea el ticket mientras falte el arancel; la autoridad existe, pero su impacto todavía debe probarse con una decisión real. |
| Marketplace | Sincronización de catálogo, stock, órdenes y postventa. | Sistema neutral que decide canal por margen, capital y disponibilidad. |
| Spend / Finance | Odoo/QuickBooks fijan OCR, revisión y matching. Mendel, Clara, Rindegastos y Concur agregan control preventivo, presupuestos/políticas, roles, reembolsos, captura mobile/offline e integración ERP. | Finance comparte proveedor, producto, compra, stock y ledger nativos. F3 demuestra documento → matching → borradores aprobados; F5 agrega política, centro de costo, presupuesto y operación por excepción. Tarjetas/custodia/viajes quedan fuera sin demanda, partner regulado y economics. |
| IA | Asistencia dentro del flujo real. | Recomendación → aprobación → acción → resultado verificado. |
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
producto y experiencia para Gestiona Finance**. La meta es alcanzar una
experiencia comparable de control de gasto de punta a punta, no copiar su marca,
assets o pantallas. Su propuesta oficial vigente combina control preventivo,
presupuestos, reglas, aprobaciones multinivel, medios de pago, auditoría e
integración contable/ERP ([plataforma](https://mendel.com/ar/producto/),
[tarjetas](https://mendel.com/ar/producto/tarjetas-mendel/) e
[integraciones](https://mendel.com/ar/producto/integraciones/), verificadas el
2026-08-22).

**Contrato de paridad Mendel-class:**

| Capacidad objetivo | Comportamiento obligatorio en Gestiona Finance | Evidencia antes de declararla comparable |
|---|---|---|
| Control financiero | Inicio en tiempo real con gasto, disponible/comprometido/consumido, aprobaciones, comprobantes faltantes, anomalías y fuera de política. | Un responsable detecta y resuelve la excepción desde la misma superficie, sin planilla ni SQL. |
| Presupuestos y políticas | Presupuestos únicos o recurrentes por persona/equipo/centro/proyecto/categoría; reglas versionadas por monto, categoría, comercio, ubicación, horario y frecuencia. | El servidor explica qué regla y versión permitió, escaló o bloqueó cada solicitud/transacción. |
| Solicitudes y aprobaciones | Flujos de uno o más niveles, comentarios, rechazo, delegación, sustitución, SLA y segregación solicitante/aprobador/contabilidad/pago. | Casos felices, fuera de política, ausencia del aprobador y retry quedan auditados y tenant-safe. |
| Gasto unificado | Tarjeta propia o externa, transferencia, efectivo, reembolso, anticipo/fondo y factura convergen en un registro con evidencia y estado común. | Ningún medio crea un ledger, proveedor, centro de costo o circuito de aprobación paralelo. |
| Evidencia y conciliación | Ticket/factura, datos fiscales, categoría, centro de costo y cuenta contable se vinculan a una sola transacción; conciliación y exportación ERP son idempotentes. | No hay doble carga ni doble asiento; diferencia, retry y estado de sincronización son visibles. |
| Mobile e inteligencia | Captura, solicitud, aprobación y alertas funcionan mobile; el Copilot clasifica, explica y propone acciones sólo con permisos y auditoría. | La IA nunca salta una política ni una aprobación humana y su acción/resultados se miden. |
| Seguridad y operación | Roles mínimos, MFA para acciones sensibles, trazabilidad append-only, configuración por organización y observabilidad de integraciones. | Un usuario restringido no puede leer ni operar otra organización, credencial o etapa del flujo. |

**Diferencial propio:** Mendel-class define la paridad de Spend Management;
Gestiona debe superarla conectando ese gasto con el mismo proveedor, compra,
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

Corte medido el **2026-08-22**. Todo número debe volver a medirse antes de
usarse en una presentación, valuación o decisión de inversión.

| Señal | Evidencia actual |
|---|---|
| Calidad técnica | 1.982 tests en 192 archivos pasan al 2026-08-29; typecheck, lint sin errores (140 warnings conocidos), build/PWA y 71 Edge Functions verdes. Hay 43 E2E críticos: 32 públicos, 10 de panel y 1 setup autenticado; el recorrido de Gastos conserva 0 escrituras. |
| Tracción | 4 organizaciones, 1 comercio real, 34 registros POS y 6 online. Es una muestra, no product-market fit. |
| Pagos | 2 pagos reales de prueba por ARS 1; matriz interna de 8 escenarios aprobada el 2026-08-21 y 0 suscripciones efectivamente cobradas. La comisión histórica fue 5% en esas pruebas; la propuesta actual de 0,5% quedó en borrador y cobra $0 hasta aprobación. Falta certificación live para probar proveedor/economics. |
| Fiscal | 1 CAE de homologación; 0 CAE de producción. Configurar identidad exige `invoices.edit`, se audita sin secretos y sólo `service_role` puede confirmar una delegación tras hablar con ARCA. |
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
| Finance documental | Custodia, extracción, revisión, matching, borradores y aprobación conectada al Core. | Primera factura autorizada procesada y recibida sin SQL; proveedor privado y métricas reales siguen pendientes. |
| Finance product surface | Ruta, chrome, sesión compartida, entitlement, permiso y snapshot del Core. | Primer comercio habilitado y primer documento procesado; 0 adopción real al corte. |
| Sistema visual v3 Figma | El workspace claro adopta obligatoriamente la dirección de los kits CRM/marketplace compartidos: canvas casi blanco, superficies blancas, primary violeta `252 83% 62%`, secundarios turquesa/coral, rail persistente, topbar y profundidad baja; se aplica a Business, Finance y Platform sin alterar el Business Core. El 2026-08-22 se eliminó la mutación global que convertía el color secundario de un comercio en fondo/rail del panel: Gestión mantiene tokens oficiales y las paletas quedan limitadas a tienda pública y catálogo PDF; Finance ya no fuerza un rail negro en modo claro. El 2026-08-23 se incorporó el símbolo oficial RGBA como identidad única de Gestiona: reemplaza letras e íconos improvisados en Business, Finance, Platform, landing, acceso y rutas institucionales, además de favicon/Apple/PWA; el logo del merchant queda aislado a Storefront y documentos comerciales. Las tres superficies ahora envuelven todas sus rutas en `workspace-route-surface`, por lo que más de cien páginas heredan el contrato aunque todavía no declaren la clase; Button, Card, Input, Select, Textarea, Tabs, Table, Badge, Dialog, Popover, Tooltip, EmptyState y skeletons fueron alineados a radios, foco, profundidad, estados y contraste del Figma. Ajustes, Perfil, resumen/Document Inbox de Finance y Anuncios de Platform adoptaron `PageHeader`; POS queda documentado como workspace de caja a viewport completo. `DESIGNROADMAP.md` separa desde ahora fases, cobertura, métricas y 26 slices visuales del plan de producto. D2.2–D2.3 retiraron 30 selects nativos: 20 de páginas y 10 de componentes; el SaaS queda en cero, mientras Storefront conserva sólo 3 excepciones mobile/autofill fijadas por test. D2.4 reemplaza los cinco paginadores manuales de Admin, Productos, Compras, Reportes y Ventas por `DataPagination`, con rango real, límites, respuesta mobile y anuncio accesible; sus 82 campos temporales de 46 archivos conservan semántica nativa bajo `Input`, con cero variantes manuales y tema claro/oscuro protegido. Los 16 transportes de archivo quedaron clasificados en importación, documento/cámara e imagen/branding; las cinco importaciones estructuradas ya comparten `FilePicker` con dropzone o botón, validación por extensión/MIME, busy y error accesible sin mover la autoridad de preview/aplicación fuera de cada flujo. D2.5 crea `WorkspaceState` con los 12 estados del estándar, skeleton estable, `alert/status` accesibles y recuperación; Finance/Compras ya distinguen carga/refresh, primer uso/filtro, error, offline, stale, parcial y éxito sin convertir fallas en `[]`. D2.6 migra 16 overlays manuales de 11 archivos a Dialog/Sheet/Popover y fija en CI las únicas cuatro excepciones técnicas: rail mobile y tres scanners fullscreen. Dashboard conserva seis vistas persistidas y los hashes `#dashboard-*`; Platform organiza su rail por trabajo/rol. El estándar competitivo agrega anatomía, 11 arquetipos, árbol de overlays, segmentación, cobertura por producto y adopción tecnológica con umbral verificable. | Extender D2.5 al resto de rutas, converger documentos/cámara e imagen/branding y auditar combobox/menús de D2.4, auditar Storefront en D5 y validar los overlays migrados en desktop/mobile; captura autenticada, revisión end-to-end y medición de tiempo a tarea antes de declarar la renovación visual validada. |
| Rediseño público v3 | Landing pública y Auth fueron reconstruidos el 2026-08-22 con propuesta omnicanal, preview del producto, registro directo desde CTA, responsive desktop/mobile y metadatos SEO alineados. | Validar conversión del CTA y continuar la auditoría visual de Storefront y rutas públicas de compra. |
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

### F5 — Gestiona Finance Mendel-class

**Objetivo:** pasar de capturar documentos a una plataforma comparable con
Mendel para controlar gasto por excepción, conectada nativamente al Business
Graph de Gestiona.

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
| P0-08 | F0 · slice 7 | **Parcial por P0-05** | Los 43 E2E definidos bloquean; los flujos con escritura esperan staging. |
| P0-09 | F0 · slice 8 | **Técnico; decisión externa** | Costos reales, contrato y pricing aprobados; comisión sigue inactiva por defecto. |
| P0-10 | F1 · slices 9–10 | **Técnico + externo** | Segundo comercio completa primera venta/pago/factura/cierre sin SQL. |
| P1-01 | F1 · slice 10 / bitácora 39 | **Técnico** | Adopción real del Capability Catalog fuera de fixtures. |
| P1-02 | F1 · slice 10 | **Parcial** | Perfil versionado y tres negocios externos distintos; no crear presets para entidades inexistentes. |
| P1-03 | F1 · slice 10 / bitácora 40 | **Técnico** | Primer provisioning real y costo de intervención medido. |
| P1-04 | F0–F1 · bitácora 41–42/49 | **Técnico; prueba externa** | Refund ya expresa `payments.edit`; falta prueba cross-branch con dos sucursales aptas. |
| P1-05 | F1 + F4 · slices 10/22 | **Parcial** | CSV/Excel está cerrado; faltan conectores priorizados, redirects y reconciliación de migración. |
| P1-06 | F4 · slice 19 | **Pendiente** | Build/deploy/SLO del Storefront físicamente independientes. |
| P1-07 | F4 · slice 21 | **Pendiente** | Dos stores de una organización sobre el mismo Core. |
| P1-08 | F4 · slice 20 | **Pendiente** | Carrito server-side, multidevice e idempotente. |
| P1-09 | F4 · slice 20 | **Pendiente** | State machines separadas y concurrencia/partial flows probados. |
| P1-10 | F4 · slice 22 | **Pendiente** | Dominio, SSL, canonical, redirects, health y takeover prevention. |
| P1-11 | F4 · slice 22 + Design | **Parcial** | Themes existen; faltan draft/preview/publish/version/rollback y page contract. |
| P1-12 | F4 · slice 22 | **Parcial** | JSON-LD/sitemap existen; faltan redirects, hreflang y reporte de migración SEO. |
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
| 7 | E2E bloqueante | F0 | **Cerrado para los 43 recorridos definidos al 2026-08-29:** tienda desktop/móvil y panel autenticado bloquean CI. Ampliar signup/refund/ARCA/Finance con escritura depende de P0-05. | GitHub Actions exige las 5 variables, no permite skips de auth y conserva specs de sólo lectura. |
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
| 20 | Cart y order canónicos | F4 | Pendiente | Carrito server-side y estados independientes. |
| 21 | Store first-class | F4 | Pendiente | Una organización opera dos stores sin duplicar Core. |
| 22 | Domains + migración inicial | F4 | Pendiente | Tienda externa migra, conecta SSL y vende. |
| 23 | Finance Mendel-class piloto | F5 | Congelado hasta adopción F3 | Un piloto completa solicitud → presupuesto/política → aprobación → gasto/evidencia → conciliación/exportación; tarjetas externas primero y emisión sólo con gate regulado. |
| 24 | Commerce diferencial | F6 | Congelado hasta F4 y demanda | Una capacidad diferencial adoptada por merchants. |
| 25 | Pay/Ship + Developer gates | F7–F8 | Congelado por volumen/regulación | Margen transaccional y app externa reales. |

### Próximo trabajo autorizado por el roadmap

Mientras los slices 1–3 esperan al dueño, el orden técnico es:

1. ~~restore drill de datos~~ — cerrado el 2026-08-21;
2. ~~payment test matrix interna~~ — cerrada; certificación live espera una operación controlada;
3. ~~correlation IDs y trazas de pagos~~ — cerrado el 2026-08-21;
4. ~~E2E bloqueante~~ — cerrado para los 43 recorridos definidos al 2026-08-29 y credenciales técnicas rotadas;
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
17. ~~ADR, shell y acceso por producto de Gestiona Finance~~ — cerrado
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
    componentes del SaaS quedan en cero; Storefront conserva sólo 3 excepciones
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
    hipótesis; define anatomía, 11 arquetipos, overlays, filtros/vistas/
    segmentos/cohortes/colas, tablas/bulk, 12 estados, responsive, WCAG,
    performance, cobertura mínima por producto y una puerta 80/100 antes de
    adoptar tecnología. Una guarda en CI exige que ROADMAP, DESIGNROADMAP,
    INTERFAZ y AGENTS sigan apuntando al estándar. D2.5 ya tiene contrato y una
    primera adopción en Finance/Compras; sigue su expansión por riesgo. D2.6 ya
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
    offline, stale, parcial y éxito. Compras conserva órdenes si sólo fallan
    proveedores/productos y lo declara parcial; Finance conserva documentos si
    falla un refresh. Escrituras de documento/OC/recepción quedan deshabilitadas
    offline. Se agregaron 6 pruebas; el slice sigue **parcial** hasta migrar las
    demás rutas y validar responsive/claro/oscuro con sesión autenticada.
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
38. ~~Identidad oficial de Gestiona~~ — cerrada técnicamente el 2026-08-23:
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
    antes de emitir la key. El texto ahora envuelve completo y una guarda evita
    devolverle `truncate`. Esto cierra la matriz de API Keys, no la de todas las
    Integraciones ni la validación con otro comercio. Evidencia reproducible en
    `docs/evidencias/2026-08-29_api_keys_visual.md`. Puerta final: 1.983/1.983
    tests en 192 archivos, typecheck, lint 0/140, build/PWA, 71 Edge tipadas,
    audit 0, 489 migraciones y 70 enlaces internos en 43 documentos
    (2026-08-29).

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
- Gestiona v2, análisis recibido el 2026-08-21: referencia estratégica para
  portfolio, arquitectura, Finance, Commerce, Platform y monetización.
- Build y suites locales del 2026-08-29: **1.982 tests en 192 archivos**,
  typecheck, lint sin errores (140 warnings de deuda conocida), build/PWA y 71
  funciones verificadas. Última evidencia: 43 E2E críticos —32 públicos, 10 de
  panel y 1 setup autenticado—; el de Gastos es de sólo lectura.
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
