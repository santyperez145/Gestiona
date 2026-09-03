# Nerqia Orbit — módulo de playbooks operativos

**Corte de discovery:** 2026-08-29
**Estado:** propuesta de innovación transversal; no implementado ni autorizado
para crear tablas o rutas.
**Producto:** Nerqia Business Graph + Commerce + Finance + Platform +
Intelligence.

## 1. La idea

Nerqia ya puede describir una venta, una compra, un documento, un pago, un
cliente, un stock y un margen. Orbit agrega una capacidad diferente: convertir
señales de varios dominios en un **playbook operativo** que una persona pueda
simular, aprobar, ejecutar y medir.

```text
señal del Business Graph
  → contexto y evidencia
  → impacto simulado
  → política y nivel de riesgo
  → aprobación humana si corresponde
  → acciones idempotentes
  → resultado, costo y aprendizaje
```

No es Mendel, no es otro dashboard y no es un clon de Zapier. Mendel es el
benchmark de Spend Management; Orbit resuelve la coordinación de decisiones de
todo el negocio: stock, compras, ventas, Commerce, clientes, pagos, Finance,
integraciones, soporte y Platform.

La innovación no está en dibujar un flujo. Está en que el sistema conozca las
relaciones del negocio, calcule el impacto antes de actuar, se abstenga cuando
la evidencia no alcanza y pueda demostrar el resultado posterior.

## 2. Qué aprendemos de otras referencias

Estas referencias no son modelos para copiar la UI. Aportan comportamientos
puntuales que Orbit debe superar con autoridad, trazabilidad y contexto de
comercio:

| Referencia oficial | Patrón observado | Traducción propia |
|---|---|---|
| [Shopify Flow](https://help.shopify.com/en/manual/shopify-flow/getting-started) | Flujos con trigger, condición y acción sobre eventos del store y apps. | Triggers del Business Graph, condiciones con fuentes y acciones autorizadas por dominio. |
| [Shopify Flow: condiciones](https://help.shopify.com/en/manual/shopify-flow/reference/conditions) | AND/OR, operadores, valores dinámicos, ramas y preview de datos. | Editor de condiciones que muestra campos, periodo, moneda, población y cobertura; no evalúa una lista vacía como permiso. |
| [Shopify Flow: acciones](https://help.shopify.com/en/manual/shopify-flow/reference/actions) | Acciones internas, notificaciones, HTTP y conectores; la acción falla si falta el dato requerido. | Catálogo de acciones tipadas, con scopes, precondiciones, dry-run y bloqueo si la autoridad del Core no está disponible. |
| [Shopify Flow: schedules y loops](https://help.shopify.com/en/manual/shopify-flow/getting-started/concepts/advanced-workflows) | Triggers programados, consulta de datos y procesamiento de listas. | Jobs con ventana temporal, población congelada, límite, paginación, costo estimado y deduplicación. |
| [HubSpot: detalle e historial](https://knowledge.hubspot.com/workflows/understand-your-workflow-details-page) | Historial de acciones, enrollments, versiones, problemas y performance. | Cada corrida muestra snapshot de versión, ruta tomada, evidencia, error, retry y resultado; nunca sólo “success”. |
| [HubSpot: trazado de un registro](https://knowledge.hubspot.com/workflows/review-a-records-workflow-paths-and-actions) | El operador puede ver el camino de un registro en el diagrama y el detalle de cada paso. | Inspector Business Graph con entidades enlazadas y causa de cada decisión. |
| [n8n: ejecuciones](https://docs.n8n.io/workflows/executions/all-executions/) | Filtrado de ejecuciones, reintento con la versión actual u original y datos guardados. | Replay explícito, versión inmutable, idempotency key, límite de reintentos y comparación de resultado. |
| [Temporal](https://docs.temporal.io/) | Ejecución durable que retoma procesos después de fallas de red o infraestructura. | Evaluar durable execution sólo para workflows largos/externalizados; no agregar infraestructura antes de volumen y benchmark. |

La conclusión es propia: los productos de automatización ofrecen pasos, pero no
conocen el costo aterrizado, el margen por canal, el estado de stock, la
recepción, el riesgo de caja y la autoridad de cada entidad de Nerqia al
mismo tiempo.

## 3. Diferencial de Orbit

### 3.1 Correlación de grafo, no trigger aislado

Un playbook puede combinar hechos de diferentes dominios sin hacer joins en el
navegador:

- ventas de un SKU bajan durante 14 días;
- stock disponible cubre menos que el lead time del proveedor;
- el margen del canal online supera el piso;
- existe una orden de compra abierta o un proveedor alternativo;
- no hay un documento pendiente que invalide el costo.

El resultado puede ser una propuesta de compra priorizada, no una alerta
genérica de stock bajo. La consulta agregada y sus fuentes deben vivir en SQL o
RPC, respetando los dueños del Core.

### 3.2 Impact Preview antes de actuar

Antes de publicar un playbook el dueño ve:

- población histórica o actual que habría entrado;
- entidades que leería y acciones que intentaría;
- monto, stock, clientes o comunicaciones potencialmente afectados;
- casos sin datos y casos bloqueados por permiso/política;
- costo de ejecución y dependencia externa;
- resultado esperado y riesgo máximo;
- ejemplo sintético cuando no hay datos autorizados.

El preview nunca escribe producción. Una acción con efecto sólo se activa
después de un cambio de versión, una confirmación y el gate correspondiente.

### 3.3 Atención limitada, no ruido infinito

Orbit ordena señales por impacto económico, urgencia, confianza y costo de
resolución. Agrupa duplicados y suprime repeticiones durante una ventana
explícita. La meta es reducir minutos hasta una decisión, no llenar el panel de
notificaciones.

### 3.4 Acción con clase de riesgo

| Clase | Ejemplos | Control mínimo |
|---|---|---|
| `observe` | Crear señal, medir, agregar contexto. | Lectura y auditoría. |
| `notify` | Avisar a owner/equipo por inbox o canal consentido. | Consentimiento, rate limit y retry. |
| `prepare` | Crear borrador de compra, campaña, reembolso o respuesta. | Draft sin efecto + permisos del dominio. |
| `request_approval` | Enviar una propuesta a la cola correcta. | Aprobador, SLA, segregación y policy snapshot. |
| `reversible` | Pausar una publicación, cambiar una etiqueta, reprogramar una tarea. | Pre/after, undo con ventana y control de concurrencia. |
| `external` | Llamar una API, emitir, enviar, reservar o pagar. | Connector health, idempotencia, límites, auditoría y partner. |
| `irreversible` | Cobrar, pagar, mover stock, emitir factura o borrar. | Fuera de Orbit inicial; sólo workflow de dominio con gate específico. |

Orbit no obtiene permisos nuevos por existir. Cada acción delega en la
autoridad del dominio y conserva actor, organización, versión de policy,
idempotency key y resultado.

### 3.5 Aprendizaje con abstención

El sistema puede sugerir que un merchant convierta una solución manual
repetida en playbook. No puede autoeditar una policy ni aprender una acción
irreversible sin confirmación. Debe mostrar:

- evidencia usada;
- confianza y cobertura;
- casos falsos/omitidos si se dispone de ground truth;
- por qué se abstuvo;
- qué resultado se esperaba y qué ocurrió.

## 4. Playbooks que cruzan todo Nerqia

Cada ejemplo tiene un dueño operativo y no crea una autoridad nueva.

| Playbook | Señales correlacionadas | Acción inicial segura | Resultado a medir |
|---|---|---|---|
| Reposición rentable | Stock/lead time + ventas + margen por canal + compra abierta. | Preparar OC sugerida y pedir aprobación. | Quiebres evitados, capital comprometido, margen protegido. |
| Rescate de orden | Orden pagada + fulfillment detenido + stock disponible + salud de envío. | Crear tarea, reintentar connector o pedir revisión. | Tiempo a despacho, fallas repetidas, cancelaciones. |
| Margen en riesgo | Aumento de costo + arancel/envío/IVA + precio vigente + piso por canal. | Simular nuevo precio/promoción y abrir Price Action Loop. | Contribución protegida, conversión, reversión. |
| Cliente que se enfría | Cohorte + frecuencia + ticket + consentimiento + stock de favoritos. | Preparar audiencia y oferta con margen validado. | Reactivación incremental, bajas, margen neto. |
| Documento bloqueado | Inbox + proveedor + matching ambiguo + vencimiento de deuda. | Asignar excepción y solicitar dato faltante. | Tiempo de resolución, matching confirmado, aging. |
| Integración degradada | Error/cursor/latencia + entidad afectada + criticidad de canal. | Pausar retry agresivo, abrir incidente y ofrecer replay. | MTTR, eventos recuperados, duplicados evitados. |
| Merchant en riesgo | Onboarding incompleto + errores repetidos + primera venta ausente. | Crear checklist y tarea de soporte consentido. | Tiempo a primera venta, abandono, intervención humana. |
| Cierre operativo | Ventana de caja + pagos + órdenes + banco + documentos. | Preparar conciliación y lista de diferencias. | Diferencias resueltas, tiempo de cierre, cobertura. |

Los primeros dos playbooks no se publican como automatizaciones universales. Se
usan como fixtures de lectura y simulación para probar el contrato sin tocar
ventas, stock, dinero ni clientes reales.

## 5. Módulo y navegación propuesta

Orbit es un módulo de organización con capability propia futura, no una ruta
oculta dentro de Finance ni una pantalla más de Platform:

```text
/orbit
  hoy                  señales priorizadas y decisiones pendientes
  playbooks             biblioteca, owner, versión y estado
  playbooks/:id         definición, impacto, permisos y publicación
  ejecuciones           runs, pasos, errores, retries y replay
  excepciones           items que requieren una persona
  resultados            outcome, costo, impacto y comparación
  catalogo              triggers, datos, acciones y conectores disponibles
  configuracion         límites, notificaciones, horarios y retención
```

### 5.1 Hoy

- resumen de cinco señales accionables como máximo por contexto;
- filtros por dominio, severidad, monto, antigüedad, owner y confianza;
- origen y población de cada señal;
- una acción primaria y alternativas explícitas;
- enlace directo a la ficha 360 o cola dueña;
- “sin evidencia suficiente” y “sin permiso” como estados diferentes.

### 5.2 Biblioteca de playbooks

- estados `draft`, `in_review`, `approved`, `published`, `paused`, `failed`,
  `archived`;
- owner, equipo, scope de organizaciones/sucursales, última versión y KPI;
- plantilla sintética con explicación, nunca activada por defecto;
- impacto simulado antes de publicar;
- historial de versiones y motivo de cada cambio;
- permisos de ver, editar, aprobar, publicar, pausar y replay separados.

### 5.3 Builder

La UI puede usar un canvas visual tipo Figma/CRM, pero la autoridad es un
grafo/versionado validado por servidor:

```text
trigger → contexto → condición/branch → guard → acción → espera → outcome
```

El editor muestra cada nodo con fuente, tipo, dato requerido, alcance, costo,
riesgo y salida. Una alternativa de tabla/JSON legible permite accesibilidad,
mobile y revisión técnica. No se agrega `@xyflow/react` ni otro canvas hasta
pasar la puerta tecnológica del estándar y demostrar que el canvas mejora el
tiempo de tarea.

### 5.4 Ejecuciones

- lista por estado `queued`, `running`, `waiting_approval`, `waiting_external`,
  `succeeded`, `partial`, `failed`, `cancelled`, `expired`;
- detalle por step con input sanitizado, output, duración, retry y error;
- snapshot de la versión del playbook y de la policy;
- entidades enlazadas en el Business Graph;
- reintentar sólo lo seguro, desde el paso permitido y con nueva clave;
- cancelar sin afirmar rollback cuando hubo efecto externo;
- exportar auditoría sin documentos privados ni secretos.

## 6. Contrato técnico propuesto

### 6.1 Fuentes y eventos

Orbit consume contratos/eventos existentes de H2 y lecturas agregadas. No lee
tablas de otros dominios para decidir desde el frontend. Cada trigger declara:

- versión de evento o consulta;
- entidad raíz y relaciones permitidas;
- tenant/org/location scope;
- frescura y cobertura;
- si permite evento, schedule o acción manual;
- deduplication key y ventana de reingreso.

### 6.2 Definición de un playbook

La estructura conceptual, pendiente de ADR y migración, contiene:

```text
playbook
  id, org_id, name, owner, status, timezone, retention_policy
playbook_version
  version, definition, input_schema, published_by, published_at, hash
playbook_run
  run_id, version, trigger_event, scope, status, idempotency_key, timestamps
playbook_step_run
  step, action, status, attempts, input_hash, output_ref, error_code
playbook_approval
  approver, policy_version, decision, reason, decided_at
playbook_outcome
  baseline_ref, result_ref, confidence, observed_at, causal_label
```

Son nombres de contrato, no autorización para crearlas. Antes de una tabla se
debe comprobar si `domain_events`, outbox, idempotencia, tareas, auditoría o
Action Loop ya resuelven el caso.

### 6.3 Ejecución y resiliencia

- evaluación y validación de parámetros antes de reservar una idempotency key;
- advisory lock por organización y entidad cuando haya riesgo de concurrencia;
- `at-least-once` de eventos con acciones idempotentes y deduplicación explícita;
- reintentos sólo para errores transitorios, con backoff, límite y DLQ;
- outbox para emitir señales después de confirmar la transacción del dominio;
- pasos externos con timeout, correlation id, estado incierto y reconciliación;
- payloads minimizados, sin documentos ni credenciales en logs;
- compensación sólo cuando la autoridad del dominio la soporte;
- pausa global por playbook, organización y connector;
- retención configurable y borrado separado de la historia de auditoría.

El primer worker puede vivir en PostgreSQL + Edge Functions, porque el volumen
actual no justifica otro runtime. Temporal u otra durable execution se evalúa
cuando haya workflows que duren más que el límite de una Edge, espera humana o
dependencias externas; la decisión exige benchmark, costo, observabilidad,
rollback y salida.

## 7. Permisos y seguridad

Capability futura propuesta: `operations.playbooks`. No se habilita hasta que
el Capability Catalog tenga dependencia, conflicto, rollout y política de
desactivación.

Permisos conceptuales mínimos:

| Permiso | Puede hacer |
|---|---|
| `playbooks.view` | Ver playbooks, señales y ejecuciones permitidas. |
| `playbooks.edit` | Crear borrador y editar versión no publicada. |
| `playbooks.approve` | Revisar definición, impacto y acciones. |
| `playbooks.publish` | Publicar/pausar según scope y policy. |
| `playbooks.execute` | Ejecutar manualmente un playbook permitido. |
| `playbooks.replay` | Reintentar un run seguro y revisar su resultado. |
| `playbooks.audit` | Ver evidencias y versiones dentro del alcance. |

El dominio sigue siendo autoridad para la acción final:

- `inventory` rechaza una escritura client-side aunque Orbit la solicite;
- `payments` conserva intención, intento, refund y reconciliación;
- `finance` conserva aprobación, documento, gasto y obligación;
- `commerce` conserva orden, fulfillment y publicación;
- `marketing` conserva consentimiento y baja;
- `platform` conserva flags, soporte, health e incidentes.

Platform puede ver salud agregada y controlar rollout. No puede leer el gasto o
los clientes de un tenant por el solo hecho de operar Orbit.

## 8. Fases y gates

### O0 — Discovery

**Estado:** cerrado en este documento. Se definieron problema, alcance, fuentes,
no objetivos, pantallas, contrato conceptual y límites.

### O1 — Señales read-only

Crear un catálogo pequeño de señales derivadas de eventos existentes, con
explicación, frescura, severidad, supresión y drill-down. Sin mutaciones y sin
capability comercial todavía.

**Salida:** tres señales útiles en dos dominios, cero joins de UI, tests de
tenant, una prueba de tiempo a resolución y cero falsos vacíos por error.

### O2 — Impact Preview

Permitir definir un borrador, probarlo contra una población sintética o
histórica autorizada y mostrar acciones potenciales, riesgo y costo. Sin
publicar ni ejecutar efectos.

**Salida:** un owner entiende qué habría pasado y puede corregir la definición
sin SQL.

### O3 — Acciones seguras

Activar `notify`, `prepare` y `request_approval` con permisos por dominio,
idempotencia, auditoría, retry y excepciones. Integrar el Price Action Loop y
el approval engine de Finance cuando estén disponibles.

**Salida:** un playbook real prepara y envía una decisión, pero no mueve stock,
dinero ni precio sin el workflow dueño.

### O4 — Reversibles e integraciones

Acciones reversibles y connectors con health, DLQ, replay y estado incierto.
Primero canales internos, después APIs externas con sandbox y contrato.

**Salida:** MTTR y esfuerzo de operación menores que el proceso manual, con
rollback probado.

### O5 — IA asistida y escala

Sugerir playbooks, condiciones y acciones a partir de lenguaje natural o
patrones observados. Toda propuesta es borrador, toda mutación requiere
confirmación y toda acción conserva AI Action Rate.

**Salida:** precisión de sugerencia, aceptación humana, costo, tiempo ahorrado y
resultado observados; durable execution sólo si el benchmark lo justifica.

## 9. Definition of Done

Un playbook sólo está listo cuando:

- tiene usuario, problema, owner, dominio, evento, métrica y kill switch;
- la definición está versionada y su hash aparece en cada run;
- el preview muestra población, impacto, datos faltantes, permisos y costo;
- cada acción declara clase de riesgo y autoridad del dominio;
- `anon`, outsider, miembro sin permiso y staff Platform quedan aislados;
- las mutaciones validan antes de reservar idempotencia;
- retries, timeouts, respuestas inciertas y duplicados tienen comportamiento
  explícito;
- el run permite ver el camino, error, siguiente acción y resultado;
- no se escribe stock, precio, dinero, cliente o documento desde Orbit;
- la UI cumple los 12 estados, tabs/inspector, responsive, foco y teclado;
- typecheck, lint, tests, build, E2E y verificación real pasan;
- la corrida usa datos sintéticos o autorizados y termina con restos en `0`;
- el owner puede pausar el playbook y conservar historia.

## 10. Criterio de adopción

Orbit entra al roadmap de implementación sólo si se cumplen simultáneamente:

1. F0/F1 no tienen bloqueos de seguridad, identidad o recuperación;
2. el segundo comercio ya opera sin cambios especiales de base;
3. F2 prueba al menos una decisión de margen con resultado medido;
4. F3 Finance tiene una factura real y autorizada procesada de punta a punta;
5. tres casos manuales repetidos muestran costo operativo suficiente;
6. el piloto read-only reduce tiempo a resolver sin aumentar alert fatigue;
7. la arquitectura actual puede sostenerlo sin crear un segundo ledger o una
   cola opaca.

Sin estas señales, Orbit permanece como diseño estratégico y no como una nueva
sección del sidebar. La plataforma gana por resolver mejor una operación real,
no por tener un módulo más.

## 11. Fuentes externas consultadas

- [Shopify Flow](https://help.shopify.com/en/manual/shopify-flow)
- [Triggers de Shopify Flow](https://help.shopify.com/en/manual/shopify-flow/reference/triggers)
- [Conditions de Shopify Flow](https://help.shopify.com/en/manual/shopify-flow/reference/conditions)
- [Actions de Shopify Flow](https://help.shopify.com/en/manual/shopify-flow/reference/actions)
- [Workflow editor de Shopify Flow](https://help.shopify.com/en/manual/shopify-flow/create/workflow-editor)
- [Schedules, get data y loops](https://help.shopify.com/en/manual/shopify-flow/getting-started/concepts/advanced-workflows)
- [HubSpot workflow details](https://knowledge.hubspot.com/workflows/understand-your-workflow-details-page)
- [HubSpot workflow paths](https://knowledge.hubspot.com/workflows/review-a-records-workflow-paths-and-actions)
- [n8n execution history y retry](https://docs.n8n.io/workflows/executions/all-executions/)
- [Temporal durable execution](https://docs.temporal.io/)
