# Nerqia Finance — estudio Mendel-class y blueprint de producto

**Corte del relevamiento:** 2026-08-29  
**Fuente primaria:** sitio oficial de [Mendel](https://mendel.com/) y sus
páginas de producto enlazadas desde allí.  
**Estado:** discovery cerrado como insumo de F5; no implica que las capacidades
estén construidas ni que Nerqia pueda ofrecer productos financieros regulados.

Este documento convierte a Mendel en un benchmark operativo concreto. No es una
orden de copiar marca, textos, assets o pantallas. Es un inventario de trabajos,
estados, controles, permisos y resultados que Finance debe cubrir para ser una
alternativa seria. La ventaja de Nerqia aparece cuando ese gasto se conecta
con el proveedor, la compra, la recepción, el costo importado, el stock, el
impuesto, la venta y el margen del mismo Business Graph.

## 1. Cómo leer la evidencia

- **✅ Observado en fuente oficial:** la capacidad o el posicionamiento está
  publicado por Mendel en la fecha de corte. Es evidencia de oferta, no prueba
  de cada implementación interna ni de disponibilidad en Argentina.
- **📌 Decisión Nerqia:** traducción elegida para nuestro producto y su
  arquitectura actual.
- **🟡 F5:** capacidad objetivo posterior a la adopción de Finance documental.
- **🔒 Gate:** no se construye ni se anuncia sin la condición indicada.
- **❓ Pendiente:** requiere entrevista, contrato, prueba técnica o validación
  regulatoria; no se completa con una suposición.

Las páginas de Mendel contienen afirmaciones comerciales y casos expresados en
contexto mexicano o regional. Los porcentajes de ahorro, deducibilidad,
recupero, horas y cantidad de flotillas se conservan como claims de su fuente,
no como métricas de Nerqia. Antes de usar una afirmación en ventas se debe
verificar país, vigencia, contrato y población medida.

## 2. Inventario exhaustivo de la superficie Mendel

| Superficie oficial | ✅ Trabajo que declara resolver | 📌 Traducción en Nerqia | Estado |
|---|---|---|---|
| [Plataforma de gestión de gastos](https://mendel.com/producto/) | Centralizar gastos, aprobar, monitorear en tiempo real, aplicar reglas, operar distintos medios de pago, recuperar comprobantes, reportar e integrar con ERP. | Inicio de Finance con pendientes, gasto comprometido/consumido/disponible, excepciones, cola y drill-down a evidencia. | 🟡 F5 |
| [Tarjetas Mendel](https://mendel.com/ar/producto/tarjetas-mendel/) | Tarjetas físicas y virtuales, límites por monto/categoría/ubicación/frecuencia, notificaciones, aceptación internacional y control preventivo. | Primero feed de tarjetas externas y transacciones bloqueadas; emisión sólo detrás de partner, legal, riesgo y economics. | 🔒 Gate regulado |
| [Tarjetas corporativas](https://mendel.com/producto/corporate/) | Integrar tarjetas que la empresa ya usa, centralizar gastos, auditar fuera de política y exportar a contabilidad. | Conector de movimientos externos con identidad, fecha, comercio y monto inmutables; enriquecimiento y evidencia sin reescribir el hecho bancario. | 🟡 F5 |
| [Reembolsos](https://mendel.com/producto/reembolsos/) | Solicitud con comprobante, cuenta del colaborador, política, aprobación y transferencia posterior. | Reembolso como estado del mismo gasto; transferencia sólo con proveedor y control legal habilitados. Mientras tanto, exportación/conciliación marcada como pendiente. | 🟡 F5 / 🔒 fondos |
| [Recuperación de facturas](https://mendel.com/producto/recupero/) | Foto de ticket, contacto con el comercio, recuperación por portales/email/otros canales, visibilidad del estado y validación fiscal. | Ticket → comprobante argentino cuando exista conector autorizado; mantener original, consentimiento, intentos, estado y revisión humana. No llamar “validado por ARCA” sin respuesta del organismo. | 🟡 F5 / 🔒 proveedor |
| [Integraciones](https://mendel.com/producto/integraciones/) | HCM, ERP, expense management y card feed mediante API, web services o archivos SFTP; altas/bajas de personas; exportación sin duplicados. | Registro de conectores con scopes, mapping, cursor, idempotencia, retries, DLQ, health y reconciliación. El Business Core continúa siendo autoridad. | 🟡 F5 |
| [Gastos por categoría](https://mendel.com/producto/gastos-por-categoria/) | Clasificar transacciones con detalle personalizado y control por categoría. | Categorías y dimensiones del tenant, centros de costo/proyectos y mapping a cuentas; nunca listas de rubros hardcodeadas. | 🟡 F5 |
| [Mendel Viajes](https://mendel.com/mendel-viajes/) | Buscar vuelos/hoteles/transporte, solicitar, revisar, aprobar, reservar, cambiar/cancelar, aplicar políticas e informar en tiempo real. | Módulo de viajes separado pero conectado al mismo presupuesto, aprobación, gasto y evidencia. No entra hasta tener proveedor de contenido y modelo operativo. | 🔒 Gate externo |
| [Tarjeta Mendel Flotilla](https://mendel.com/producto/tarjeta-mendel-flotilla/) | Gasto por unidad/conductor/ruta, combustible, peajes, comida, hospedaje, reparaciones, límites de litros, activación por viaje y anomalías. | Vertical de operación sólo si un comercio lo pide: vehículo, viaje activo, odómetro, unidad y política como dimensiones del Core, no como otra billetera. | 🔒 Demanda + partner |
| [Beneficios](https://mendel.com/beneficios-colaboradores/) | Beneficios, caja chica, fondo fijo, viáticos, viajes, presupuestos por rol, confidencialidad para RRHH y notificaciones. | Posible caso de uso de asignaciones y fondos; separar visibilidad RRHH/Finanzas y datos sensibles desde el diseño. | ❓ Discovery |
| [Mendel AI](https://mendel.com/ai/) | Agentes de comprobación, auditoría, soporte y reservas; clasificación, matching, impuestos, anomalías, respuestas y apoyo de viajes. | Business Copilot con evidencia y acción autorizada; `AI Action Rate`, explicación, política aplicada, aprobación humana y resultado medido. | 🟡 F5+ |
| [Mendel MCP](https://mendel.com/ar/mendel-mcp/) | Conectar Claude, ChatGPT o Copilot; buscar, auditar, aprobar/rechazar hasta 100, consultar presupuestos y solicitudes, respetando permisos y dejando trazabilidad. | Conector MCP server-side con OAuth, scopes por herramienta, límites, confirmación para mutaciones, logs sanitizados y misma RLS que la UI. | 🟡 F6+ |

### 2.1 Lo que no se debe perder del menú por pensar sólo en tarjetas

El sitio también presenta soluciones por industria y rol: automotriz, retail,
logística, salud/farmacia, CFO, controller, contabilidad, operaciones y
flotillas. Eso enseña que el producto se compra por un trabajo y una jerarquía,
no por una tabla de transacciones. Nerqia debe resolver primero los objetos
comunes y después aplicar presets declarativos por perfil, sin crear una base de
datos distinta por vertical.

La cobertura mínima por rol será:

| Rol | Necesita responder | Alcance de datos |
|---|---|---|
| Colaborador | ¿Qué gasté, qué falta justificar, qué puedo solicitar y cuándo se paga? | Propios, estado y comentarios relevantes. |
| Aprobador | ¿Qué estoy decidiendo, contra qué política y cuánto presupuesto queda? | Equipo/centro autorizado, con evidencia suficiente. |
| Finanzas/controller | ¿Qué está fuera de política, vencido, duplicado o sin comprobante? | Toda la organización según permiso, con colas y aging. |
| Contabilidad | ¿Qué documento, impuesto, cuenta y exportación respaldan el asiento? | Documentos, mapping, conciliación y auditoría; no secretos. |
| Operaciones | ¿Qué gasto habilita la operación y cuál es la excepción? | Unidades, proyectos, viajes o sucursales asignados. |
| Owner/admin | ¿Quién puede gastar y qué producto/configuración está habilitado? | Configuración tenant y delegaciones autorizadas. |
| Platform | ¿Qué organización tiene el producto y qué integración está fallando? | Snapshots agregados, health y soporte consentido; nunca credenciales o datos crudos por defecto. |

## 3. Contrato de paridad funcional

“Igual a Mendel” se traduce en cubrir el trabajo completo. Una capacidad sólo
se declara comparable cuando el servidor conserva autoridad, el usuario puede
resolver la excepción y existe una prueba con datos autorizados.

| Área | Cobertura obligatoria en Nerqia Finance | Estado actual / puerta de salida |
|---|---|---|
| Bandeja de gasto | Lista unificada de gastos, solicitudes y documentos con origen, responsable, edad, estado, monto, moneda y próxima acción. | F3 tiene Document Inbox; F5 agrega gastos y solicitudes. Salida: una cola real sin planilla. |
| Captura | App/web, cámara, email/WhatsApp cuando haya consentimiento, carga manual y captura offline con reconciliación. | F3 soporta original privado web; F5 requiere canales adicionales y deduplicación. |
| Evidencia | Ticket/factura original, versiones, hash, OCR por campo, confianza, corrección humana, duplicados y trazabilidad. | F3 técnico entregado; scanner/proveedor y primera factura real siguen bloqueados. |
| Matching | Asociar gasto ↔ comprobante ↔ proveedor ↔ orden/recepción/producto cuando corresponda. | Matching y drafts F3 entregados; F5 suma transacción externa y three-way match. |
| Políticas | Versiones por monto, categoría, comercio, ubicación, horario, frecuencia, persona, equipo, centro, proyecto y periodo; explicar permitir/escalar/bloquear. | F5. Salida: replay determinístico de la política y evidencia de versión aplicada. |
| Presupuestos | Únicos y recurrentes; total, comprometido, consumido, disponible, expirado y forecast; límites por dimensiones. | F5. Salida: una solicitud reserva sin doble conteo y libera al cancelar/rechazar. |
| Solicitudes | Solicitud de gasto, anticipo, reembolso, viaje o fondos con propósito, fecha, dimensión y evidencia requerida. | F5. Salida: cada tipo comparte approval engine y no abre un ledger paralelo. |
| Aprobaciones | Uno o más niveles, monto/tipo/centro, comentarios, rechazo con motivo, delegación, sustitución, SLA, ausencia y segregación. | F5. Salida: solicitante no se autoaprueba; retry no duplica ni salta niveles. |
| Excepciones | Fuera de política, comprobante faltante, duplicado, anomalía, mismatch, integración fallida y vencimiento en una cola priorizada. | F5. Salida: cada excepción tiene causa, dueño, vencimiento, evidencia y resolución. |
| Medios de pago | Tarjetas externas, tarjeta del producto si existiera, transferencia, efectivo, cuenta bancaria y reembolso, con origen común. | F5 software-first; emisión/custodia/movimiento de fondos son gates separados. |
| Reembolsos | Datos del beneficiario, cuenta verificada por proveedor, política, aprobación, estado de pago, reversión y comprobante de transferencia. | F5 parcial hasta partner de pagos. Nunca simular “pagado” desde UI. |
| Documentos fiscales | Identificar jurisdicción, tipo, CUIT, número, impuestos y estado fiscal; registrar respuesta de ARCA o proveedor. | F3 conserva evidencia y validación estructural; ARCA productivo/proveedor autorizado pendiente. |
| AP y obligaciones | AP calendar, vencimiento, aging, proveedor, deuda, orden, recepción, nota de crédito y pago conciliado. | Core existente + drafts F3; F5 agrega vista Finance y excepciones. |
| Conciliación | Transacción, documento, obligación, banco/card feed y asiento; diferencias explícitas y exportación idempotente. | F5. La conciliación de cobros Commerce no se duplica: se enlaza. |
| Centros y dimensiones | Centro de costo, proyecto, sucursal, canal, persona, vehículo y categoría, con vigencia y mapping. | F5. La dimensión debe ser tenant-safe y visible en permisos/reportes. |
| Integraciones | HCM, ERP, bancos, emisores, email/WhatsApp, proveedor OCR/fiscal; sync manual/periódica/near-real-time. | F5. Registro único, status, cursor, error recuperable y reconciliación. |
| Viajes | Búsqueda, política, solicitud, aprobación, reserva, cambio, cancelación y gasto enlazado. | F6 o después; requiere proveedor y operación, no sólo una pantalla. |
| Flotillas | Unidad/conductor/ruta/odómetro, combustible, peajes, límites y evento de viaje. | Gate por demanda de comercio de logística. |
| IA | Clasificación, extracción, matching, anomalía, soporte, recomendación y preparación de conciliación. | F3 extraction técnica; F5/F6 agregan acciones bajo permisos. |
| MCP | Herramientas de lectura y acciones con OAuth, scopes, confirmación, rate limit y auditoría. | F6+; no exponer una service key ni convertir chat en bypass. |
| Seguridad | RLS por organización, MFA en acciones sensibles, segregación, minimización, cifrado, retención, auditoría append-only y soporte consentido. | Invariante transversal; la tabla de credenciales nunca se expone al navegador. |

## 4. Qué se mueve y qué permanece en el sistema actual

No se moverán páginas sólo para que el menú se parezca a Mendel. La decisión se
toma por autoridad de datos y por el trabajo de la persona.

### 4.1 Destino Finance objetivo

Cuando exista el modelo F5 y su gate, el shell de `/finance` debe crecer así:

```text
/finance
  resumen                 decisión diaria y pendientes
  documentos              Document Inbox y evidencia
  gastos                  gastos propios/externos y estados
  solicitudes             gasto, anticipo, reembolso y viaje
  aprobaciones            cola del aprobador con SLA
  presupuestos            disponible/comprometido/consumido
  reembolsos              revisión y estado de pago
  medios-de-pago          feeds externos y estado del emisor
  obligaciones            AP calendar, aging y vencimientos
  conciliacion            documentos, feeds, banco y ledger
  integraciones           ERP/HCM/card/OCR, mapping y health
  reportes                gasto por categoría, centro, proyecto y periodo
  configuracion           políticas, flujos, dimensiones y retención
  viajes                  sólo con proveedor y operación habilitados
  flotillas               sólo con demanda y modelo de operación probado
```

Las rutas son una arquitectura objetivo, no autorización para agregarlas ahora.
Cada una requerirá entrada en `src/app/routeManifest.ts`, permiso/entitlement,
estado completo, contrato de datos, E2E y migración idempotente si corresponde.

### 4.2 Páginas que siguen en Business/Core

| Ruta actual | Decisión | Motivo |
|---|---|---|
| `/compras`, `/proveedores`, `/ordenes-compra` | Permanece en Business; Finance enlaza y muestra contexto. | La compra y la recepción son autoridad operativa de inventario; moverlas duplicaría stock/costo. |
| `/productos`, `/kardex`, `/valuacion-inventario`, `/sucursales` | Permanece en Business/Core. | Producto, movimiento y costo histórico pertenecen al grafo operacional. |
| `/facturas`, `/afip` | Permanece como emisión fiscal/AR, con enlaces desde Finance. | Una factura emitida al cliente no es una factura de proveedor ni un expense; ambas pueden compartir evidencia fiscal. |
| `/deudas`, `/cuotas`, `/presupuestos` | Permanece como cobranzas/comercial. | Son cuentas por cobrar y cotizaciones de venta; no deben confundirse con AP budgets o spend requests. |
| `/billetera`, `/links-de-pago`, `/banco` de cobros | Se mantiene ligado a Payments/Commerce; Finance consume la conciliación. | El dinero cobrado por ventas y el gasto corporativo tienen orígenes y controles distintos. |
| `/mi-plan`, `/suscripciones` | Permanece en billing de Nerqia/Platform. | Es el cobro del SaaS, no un gasto del comercio. |

### 4.3 Candidatos a converger bajo Finance

`/gastos`, `/cash-flow`, `/pl-dashboard`, `/movimientos`, `/cheques`,
`/impuestos` y el reporte de `/multi-divisa` pueden convertirse en vistas o
enlaces de Finance cuando tengan filtros, permisos y autoridad compartidos.
No se hace un corte de rutas todavía: primero se define el modelo común y luego
se deja el alias legado con redirección preservando deep links. Las vistas de
resultado deben distinguir caja, AP, cobros, impuestos, moneda y margen; un
dashboard que sume magnitudes incompatibles no es paridad.

## 5. Blueprint de experiencia alineado a Figma

La referencia visual obligatoria para la futura superficie Finance es la
combinación de los kits CRM/marketplace entregados por el dueño y el estándar de
experiencia del repo:

- rail persistente, canvas claro, superficies blancas y profundidad baja;
- violeta para la acción primaria, turquesa/coral/ámbar para estados y riesgo,
  sin teñir todo el panel con el color del comercio;
- tabs internas y vistas guardadas para evitar páginas interminables;
- lista densa → preview/inspector → ficha completa con URL y auditoría;
- tablas comparables en desktop y filas rotuladas en mobile;
- una CTA primaria por contexto, alcance visible y efecto explicado antes de
  confirmar;
- no usar gráficos decorativos si la señal no abre su población fuente.

### 5.1 Pantallas mínimas

**Resumen Finance**

- contexto de organización, periodo, moneda y estado de integraciones;
- 3–6 señales: pendientes, fuera de política, comprobantes faltantes,
  disponible/comprometido, vencimientos y tiempo de aprobación;
- cada señal abre la cola exacta que la compone;
- bloque de “requiere atención” antes de visualizaciones secundarias;
- estado parcial, stale, offline y cobertura de datos visible.

**Inbox de gastos/documentos**

- tabs `Todos`, `Míos`, `Para aprobar`, `Fuera de política`, `Sin comprobante`,
  `Con excepción` y vistas guardadas por rol;
- búsqueda por persona, comercio, proveedor, importe, fecha, categoría,
  centro, origen y estado;
- lista con monto/moneda, antigüedad, dueño, SLA, evidencia y próxima acción;
- inspector lado a lado con documento, extracción, matching, política y
  timeline;
- acciones agrupadas: solicitar información, corregir, enviar, aprobar,
  rechazar, devolver y reintentar integración; cada una explica quién puede
  hacerla y qué produce.

**Solicitud/reembolso**

- formulario corto por decisión, no por columnas SQL;
- presupuesto y política evaluados antes de enviar;
- requerimientos de evidencia y estado de cuenta claros;
- borrador, enviado, en revisión, aprobado, rechazado, pagado, fallido,
  cancelado y revertido como estados textuales, no sólo colores.

**Cola de aprobación**

- orden por impacto y vencimiento;
- selección masiva sólo con alcance explícito y reglas compatibles;
- aprobación individual y en lote con resumen de política y cambios;
- delegación/sustitución visible, sin autoaprobación ni salto de nivel;
- comentario obligatorio en rechazo o excepción según policy.

**Presupuestos y políticas**

- vista de jerarquía y tabla alternativa;
- periodo, recurrencia, dimensión, owner, disponible y forecast;
- simulador “qué pasaría si” antes de publicar una versión;
- historial inmutable y explicación de qué versión evaluó una transacción;
- publicación separada de edición y con efecto futuro visible.

**Integraciones y conciliación**

- catálogo de conectores desde registro, no nombres hardcodeados;
- conexión/configuración/mapping/sync/errores/reconciliación en tabs;
- salud con último intento, próximo retry, cursor, registros, duplicados y
  diferencia;
- secretos sólo mediante Edge Function/OAuth; el navegador recibe status.

## 6. Modelo de datos y límites no negociables

Finance trabaja sobre el Core existente:

```text
persona / proveedor / producto / orden / recepción / documento / gasto
       └── política + presupuesto + centro/proyecto + aprobación + evidencia
       └── obligación / pago / conciliación / asiento / margen
```

- no crear `finance_products`, `finance_suppliers`, otro stock, otro cliente ni
  otro ledger;
- el gasto de inventario debe poder enlazar a compra, recepción y landed cost;
  el gasto administrativo puede ser `non_inventory` sin inventar una compra;
- documento, gasto, solicitud, aprobación, integración y pago tienen estados
  explícitos e idempotencia server-side;
- una reserva presupuestaria no es un asiento y un `approved` no es `paid`;
- una transacción externa conserva sus campos inmutables y toda normalización
  posterior tiene fuente, actor y timestamp;
- impuestos, moneda, tipo de cambio, redondeos y jurisdicción viven en funciones
  puras espejadas en SQL cuando la base es autoridad;
- toda mutación sensible genera evento append-only con actor, organización,
  request/idempotency key, motivo y resultado;
- RLS se evalúa con el rol real; `?? []` no reemplaza un error de permiso o
  esquema;
- el browser nunca escribe stock, ledger, deuda, precios ni estado de pago.

## 7. Plan de ejecución F5, en orden

### F5-A — Evidencia de F3 y adopción

**Entrada:** scanner/proveedor privado aprobado, una factura autorizada y un
comercio que acepte el flujo.  
**Trabajo:** documento → extracción → revisión → matching → drafts → aprobación
→ recepción → deuda/ledger.  
**Salida:** primer caso real sin SQL, tiempos y accuracy por campo; error,
duplicado, retry y rollback documentados.

### F5-B — Spend software-first

Construir en este orden:

1. modelo de gasto/solicitud enlazado al usuario, proveedor, categoría y
   dimensión;
2. approval engine reusable con delegación, SLA y segregación;
3. políticas versionadas y presupuestos con reserva/liberación;
4. captura mobile/offline y comprobante faltante;
5. reembolso como workflow y exportación pendiente de pago;
6. cola de excepciones, aging y notificaciones;
7. feed de tarjetas externas y conciliación idempotente;
8. AP Calendar, reportes y Finance Connect.

Cada paso debe mantener una sola cola y una sola autoridad. No se construye la
tarjeta antes de probar la operación sin tarjeta.

### F5-C — Inteligencia operativa

Añadir clasificación, extracción, anomalías y copiloto sobre acciones existentes.
La IA puede recomendar, preparar o explicar; la aprobación sensible conserva
persona, permiso, policy y auditoría. Métrica obligatoria: `AI Action Rate`,
corrección humana, precision/recall de excepción, costo por caso y resultado.

### F5-D — Gates externos

Viajes, reembolsos automáticos, emisión de tarjetas, custodia, dispersión de
fondos, flotillas y validación fiscal automática sólo avanzan con:

- demanda de comercios y caso de uso pagable;
- partner con contrato, SLA, soporte y sandbox;
- revisión legal argentina, privacidad, datos sensibles y transferencias;
- economics unitarios positivos incluyendo soporte, fraude y chargebacks;
- threat model, límites de exposición y plan de apagado;
- prueba controlada con dinero/documentos autorizados.

## 8. Definition of Done de Finance

Una pantalla o función no se considera terminada por compilar. Debe cumplir:

- contrato en `routeManifest` y permiso/entitlement correctos;
- tenant, organización, roles y segregación probados con `anon`, `authenticated`,
  outsider y staff de Platform cuando aplique;
- loading, primer uso, filtro vacío, error, offline, stale, parcial, permiso,
  confirmación y resultado persistido;
- migración idempotente y `db push --linked --dry-run` saludable;
- mutaciones server-side, idempotencia, auditoría y retry sin duplicados;
- typecheck, lint sin errores, tests puros y E2E del camino crítico;
- captura desktop/mobile de la vista real con sesión y medición de tiempo a
  tarea;
- un indicador de negocio que pruebe adopción, no sólo cantidad de filas;
- `ROADMAP.md`, `CLAUDE.md` y este documento actualizados en el mismo slice.

## 9. Métricas de decisión

| Métrica | Definición | Señal de producto |
|---|---|---|
| Submission completion | Gastos/solicitudes enviados con campos y evidencia requeridos / iniciados. | Captura comprensible. |
| Straight-through rate | Casos que llegan a estado final permitido sin intervención manual / casos procesables. | Automatización real, no ausencia de datos. |
| Exception rate | Casos enviados a excepción por política, matching, duplicado o integración / procesables. | Control y calidad; no se busca minimizarlo ciegamente. |
| Approval latency | Mediana y P95 desde envío hasta decisión por rol y monto. | Flujo operativo. |
| Policy explainability | Casos con regla, versión, decisión y evidencia recuperables / evaluados. | Confianza y auditoría. |
| Reconciliation rate | Movimientos conciliados sin doble conteo / movimientos recibidos. | Conectividad con el Core. |
| Missing evidence aging | Antigüedad por persona, origen y monto de gastos sin comprobante. | Riesgo accionable. |
| Reimbursement cycle | Envío → aprobación → comprobante de pago, separado de un “paid” simulado. | Valor para colaboradores. |
| Document field accuracy | Accuracy por campo y caso real autorizado, con correcciones humanas. | Calidad del OCR/IA. |
| AI Action Rate | Recomendaciones que terminan en acción autorizada y resultado observado / recomendaciones mostradas. | Copiloto útil, no chatbot. |
| Finance activation | Organización habilitada que procesa al menos un caso real en ventana madura. | Adopción, no entitlement. |

## 10. Revisión competitiva continua

Cada trimestre o ante una nueva integración se repite este estudio con la
fuente oficial vigente y se registra:

1. fecha, país, URL y capacidad observada;
2. si es marketing, documentación de uso o evidencia contractual;
3. impacto en los arquetipos de pantalla y el Business Graph;
4. costo/regulación/partner necesarios;
5. decisión `adoptar`, `adaptar`, `esperar` o `rechazar`;
6. métrica y condición de salida.

El benchmark no habilita una feature por reflejo. Si una capacidad no mejora
activación, control del gasto, continuidad con el Core, margen, riesgo o una
métrica de adopción, queda fuera aunque esté publicada por un competidor.

## 11. Registro oficial consultado

- [Mendel — plataforma de gestión de gastos](https://mendel.com/producto/)
- [Mendel — tarjetas corporativas](https://mendel.com/ar/producto/tarjetas-mendel/)
- [Mendel — tarjetas corporativas integradas](https://mendel.com/producto/corporate/)
- [Mendel — viajes corporativos](https://mendel.com/mendel-viajes/)
- [Mendel — tarjeta para flotillas](https://mendel.com/producto/tarjeta-mendel-flotilla/)
- [Mendel AI](https://mendel.com/ai/)
- [Mendel MCP](https://mendel.com/ar/mendel-mcp/)
- [Mendel — reembolsos](https://mendel.com/producto/reembolsos/)
- [Mendel — recuperación de facturas](https://mendel.com/producto/recupero/)
- [Mendel — integraciones](https://mendel.com/producto/integraciones/)
- [Mendel — gastos por categoría](https://mendel.com/producto/gastos-por-categoria/)
- [Mendel — beneficios para colaboradores](https://mendel.com/beneficios-colaboradores/)

