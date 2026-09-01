# Arquitectura — principios, límites y hacia dónde va

Este documento fija **cómo se construye**, no qué se construye. El qué está en
`ROADMAP.md`; el porqué del negocio, en `docs/ESTRATEGIA.md`.

Existe porque la ambición del producto creció —Commerce de primera línea, medio
de pago propio, plataforma abierta— y esa ambición **no se alcanza escribiendo
más features**: se alcanza no cerrándose puertas ahora. Casi todo lo que hay acá
es barato hoy y carísimo dentro de dos años.

Última revisión: 2026-08-22 (H1–H3 y límite inicial de Finance cerrados).

⚠️ **Este documento no autoriza una reescritura.** El sistema funciona, cobra de
verdad y tiene 1.446 tests (`npm test`, 2026-08-22). Todo se aplica de forma incremental, y cada slice deja
el sistema usable.

---

## 0. Dónde estamos parados, medido

✅ **Medido contra la base (2026-08-16):**

| | |
|---|---|
| Tablas en `public` | **323** (2026-08-19) |
| Con `org_id` | **284** |
| Ledger de inventario (`stock_movements`) | ✅ existe |
| Tablas de auditoría | 4 |
| Tablas de webhooks | 3 |
| **Tabla de idempotencia** | ✅ **existe** (H1, sesión 113) |
| **Outbox / eventos de dominio** | ✅ **existe** (H2, sesión 112) |
| **Ledger financiero** | ✅ **existe** (H3, sesión 112) |

Eso es lo importante: el multi-tenant y el ledger de stock **ya están y son
sólidos**. **Los tres huecos están cerrados**: idempotencia en H1, eventos con
outbox en H2 y el ledger financiero en H3. Lo que sigue ya no son fundaciones
sino producto — y la tabla de la sección 5 dice qué espera evidencia.

---

## 1. Los quince principios

No son aspiracionales. Cada uno se puede violar en un pull request, y por eso
están escritos.

1. **Cada dominio es dueño de sus datos.** Otro dominio lee por API, evento o
   proyección; no hace joins arbitrarios contra tablas ajenas.
2. **La integridad la garantiza la base.** Constraints, transacciones y triggers
   antes que disciplina del cliente.
3. **Toda mutación crítica es idempotente.** El mismo pedido dos veces produce
   el mismo resultado, no dos cobros.
4. **Los eventos son durables.** Si se commiteó el cambio, el evento no se
   pierde.
5. **El dinero es un ledger.** Nunca un saldo mutable.
6. **El inventario es un ledger.** Ya lo es: `record_stock_movement`.
7. **Los sistemas externos fallan.** Timeouts, reintentos, circuit breakers.
8. **La IA nunca es dependencia crítica.** Si se cae, se vende igual.
9. **Las APIs públicas son contratos versionados.** Nadie de afuera lee tablas.
10. **La analítica nunca bloquea una transacción.**
11. **Todo lo importante es observable.**
12. **Los tenants están aislados por diseño**, no por cuidado del programador.
13. **Las fallas degradan.** Que se caiga el buscador no puede apagar la tienda.
14. **Los servicios se extraen sólo cuando se justifica.** Monolito modular
    hasta que duela.
15. **Todo deploy es reversible.**

---

## 2. Lo que ya cumple, y no hay que rehacer

✅ **Medido.** Esto es lo que un análisis externo recomendó construir y **ya
está**. Anotarlo importa: en la sesión 110 casi se reconstruye A10 —historial de
precios— que estaba entero.

- **Principio 6 — ledger de inventario.** `record_stock_movement` es el único
  lugar que toca `products.stock`, `product_variants.stock` y `location_stock`.
  `trg_sale_stock_movement` y `trg_purchase_stock_movement` cubren INSERT,
  UPDATE y DELETE. Se llegó ahí rompiéndolo dos veces.
- **Principio 12 — aislamiento.** RLS por `org_id` en 269 tablas, verificada con
  roles reales, con `publicSurface.test.ts` y la vista `rls_audit_open_policies`
  como guardas.
- **Principio 2 — integridad en la base.** Precios, stock, cupones, envío y
  comisiones se recalculan del lado del servidor. El checkout manda ids y
  cantidades.
- **Principio 8 — IA no crítica.** La IA vive en Edge Functions aparte; si falta
  `ANTHROPIC_API_KEY`, el resto funciona.
- **Principio 11 — parcial.** Sentry y `cron.job_run_details`; faltan trazas.

---

## 3. Los tres huecos, en orden de urgencia

📌 **Criterio.** Los tres son baratos ahora y caros después. Ninguno requiere
reescribir nada.

### H1 — Idempotencia (✅ hecho, sesión 113)

**Qué resolvía:** un checkout puede llegar dos veces por reintento, timeout,
doble clic o proxy, y nada garantizaba que no se cobrara dos veces.

Ya pasó algo de esta familia acá: el descuento de stock duplicado, que vivió
meses. La forma del bug es la misma — una operación que se ejecuta dos veces y
nadie lo nota.

**Cómo quedó.** `idempotency_keys` + `idempotencia_reservar/completar/fallar`,
y `create_store_order_idem` que **envuelve** create_store_order sin tocarla.

La decisión que no es obvia: **la misma clave con distinto contenido es un
error, no un acierto**. Devolver la respuesta vieja ante otro carrito sería
cobrarle lo que no pidió.

✅ **El cobro inicial de la tienda ya usa el contrato común** (P0.3.1):
`store-pay` prepara la intención y el intento, conserva la clave canónica del
proveedor y el webhook reconcilia el resultado eventual. ✅ **El reintegro de un
RMA online ya usa el contrato común** (P0.3.2/P0.3.3): `payment_refunds` conserva
la clave estable, el RPC valida el tenant, la Edge Function exige owner/admin y
el monto se valida en SQL. `refund-store-payment` puede ejecutar o reconciliar,
el webhook reconcilia timeouts y `receive_store_return_request` conecta la
recepción física con `returns` y el Kardex sin tocar stock directamente. La
matriz transaccional del 2026-08-21 ensayó siete caminos internos y encontró dos
fallas reales: el ledger no reconocía `source=ecommerce` y el wrapper del refund
tenía una sobrecarga ambigua. Ambas quedaron corregidas en las migraciones 55 y
56, con rollback de toda la organización ZZ y cero restos.
La autorización ARCA también tiene una reserva server-side por organización,
punto de venta y tipo de comprobante: `afip_autorizacion_reservar` serializa el
lease y `afip_autorizacion_resultado` es la única transición de la factura.
Una respuesta incierta conserva `processing` y la reserva. La factura ya usa
esta primitiva y la recepción parcial de compra usa
`receive_purchase_order_idem`: ambas transiciones están protegidas. Queda por
diseñar captura diferida únicamente si un proveedor incorpora autorización y
captura separadas; no se implementa una abstracción sin un contrato real. La
certificación con red y dinero reales sigue pendiente; la matriz aprobada prueba
la autoridad interna, no la disponibilidad de MercadoPago.

### H2 — Eventos durables y outbox (✅ hecho, sesión 112)

**Qué resolvía:** quien confirmaba una orden tenía que acordarse de avisarle a
stock, al CRM, a marketing y a los emails. Cada consumidor nuevo era una edición
en el centro.

**Cómo quedó.** Tres tablas y una regla:

    domain_events        qué pasó. Append-only, es la verdad.
    event_subscriptions  quién escucha qué. Un consumidor nuevo es una FILA.
    outbox_events        qué falta entregar. Es una cola, se vacía.

`emitir_evento` escribe el evento y encola sus entregas **en la misma
transacción que el cambio**. Si el cambio se guardó, el evento está; si la
transacción se cayó, no está ninguno de los dos. El worker (`outbox_despachar` +
`outbox_confirmar`, por `pg_cron` cada minuto) las entrega con backoff
exponencial con techo, y lo que agota los intentos queda en `descartado` **con
el error**, no borrado.

⚠️ **Mandar no es entregar.** `pg_net` es asincrónico: devuelve un `request_id`
y sigue. Marcar la entrega al mandarla haría pasar un 500 por éxito. Por eso son
dos pasadas, y por eso **no pueden estar en la misma transacción** — pg_net
recién despacha después del commit. Se descubrió verificando: un script que
mandaba y confirmaba junto no veía nunca la respuesta.

Garantía: **al menos una vez**, con orden por agregado. Exactamente una vez no
existe sobre HTTP; por eso cada entrega lleva `event_id` para que quien recibe
descarte repetidos, igual que Stripe y MercadoPago.

**Webhooks públicos (2026-08-29).** `sale.created` también recorre esta tubería:
la configuración visible sincroniza una suscripción server-managed y
`dispatch-outbound-webhook` relee la venta después del commit. El POS no hace un
último request best-effort. La Edge intenta una vez y devuelve el resultado; la
outbox es la única autoridad de backoff, descarte y replay. `event_id` permanece
estable y `delivery_id` identifica cada ciclo de entrega/log; cambia al
reencolar o hacer replay, aunque retries de red inmediatos puedan compartirlo.

El contrato ya no depende de leer ese código: OpenAPI 3.1 se sirve en
`/developer/webhooks/openapi.json`, la guía humana vive en
[`docs/WEBHOOKS.md`](WEBHOOKS.md) y ambos productores de
`automation.triggered` comparten una sola forma sin datos de contacto. La misma
función pura construye el request productivo y el vector de certificación. El
2026-08-29 `npm run certify:webhooks` lo envió a un receptor HTTPS efímero
externo, recalculó el HMAC sobre el cuerpo capturado y borró el destino; ver
[`evidencia`](evidencias/2026-08-29_webhook_externo.md).

**Correlación crítica (2026-08-21).** En pagos, el `correlation_id` nace en
`payment_intents` y no en el navegador. `emitir_evento` lo hereda para el
agregado pago; el trigger de la orden y el de la liquidación lo derivan por
`order_id`; el ledger lo conserva en la partida de cobro. MercadoPago recibe el
mismo UUID en `metadata`, nunca PII. `payment_operation_trace` reúne esas etapas
con `security_invoker`, de modo que observabilidad no crea un atajo alrededor
de la separación entre plataforma y organización.

Hoy emiten `ecommerce_orders` (creada, pagada, reembolsada, fallida, despachada,
entregada) y `stock_movements`. Desde triggers y no desde las funciones de
negocio a propósito: un trigger no se puede olvidar, y las órdenes entran por
cuatro caminos distintos.

### H3 — Ledger financiero (✅ hecho, sesión 112)

**Qué resolvía:** el dinero vivía en columnas de importe repartidas en quince
tablas y ninguna era un libro. Un saldo en una columna es un número que alguien
tiene que acordarse de actualizar, y cuando se desincroniza no hay forma de
saber cuál de las mil operaciones lo rompió.

**Cómo quedó.** Partida doble: `ledger_accounts` (plan de cuentas),
`ledger_entries` (asientos) y `ledger_lines` (partidas). Tres reglas que
verifica la base, no el programador:

1. **Todo asiento cuadra.** La suma de los debe iguala la de los haber, o no
   entra. Se valida dos veces: inmediata en `ledger_asentar` —para que el error
   sea atrapable y llegue con contexto— y diferida al commit como red para quien
   inserte partidas sin pasar por la función.
2. **El libro es inmutable.** No hay UPDATE ni DELETE. Corregir es
   `ledger_contraasentar()`, que agrega el asiento inverso y deja los dos.
3. **El saldo se deriva.** No hay columna de saldo en ningún lado, y el signo
   sale del tipo de cuenta: activo y gasto crecen por el debe; pasivo,
   patrimonio e ingreso por el haber.

**Y acá se ve para qué servía H2.** La venta cobrada se asienta por el outbox:
el checkout emite `orden.pagada` y no sabe que existe la contabilidad. El
consumidor es idempotente contra el libro —H2 garantiza *al menos una vez*, así
que reprocesar el evento no puede asentar la venta dos veces—. Verificado: dos
reprocesos, un solo asiento.

---

## 4. Los límites de dominio

📌 **Criterio.** No hay que mover archivos mañana. Hay que **dejar de cruzar
estos límites** en el código nuevo:

```
BUSINESS CORE                    COMMERCE
  Organizations                    Catalog
  Identity / Party                 Pricing
  Customers                        Promotions
  Inventory                        Cart
  Purchasing                       Checkout
  Finance                          Orders
  CRM                              Fulfillment
        +--------------+----------------+
                       |
                 EVENTOS (H2)
                       |
      +----------------+----------------+
   PAYMENTS       AUTOMATION          DATA
```

Reglas concretas y verificables:

- **Catalog no escribe Inventory.** Se pide disponibilidad, no se toca stock.
- **Inventory no escribe Orders.**
- **Payments no escribe Sales.**
- **Commerce Core no conoce el rubro.** Nada de ramas por categoría en el
  núcleo. Los verticales aportan atributos y defaults, no `if`.
- **La UI no hace joins entre dominios.** Si hace falta, es una vista o un RPC.

### 4 bis. Finance como producto, no como Core paralelo

✅ **Límite inicial cerrado el 2026-08-22.** `/finance` tiene chrome propio pero
comparte `auth.users`, organización, membresía y MFA. El acceso exige dos
condiciones server-side independientes: la organización tiene el entitlement
`finance` y la persona tiene `finance.view`. Un feature flag sigue siendo sólo
un control de rollout y no reemplaza ninguna de las dos.

El snapshot de Finance lee proveedores, órdenes de compra, obligaciones y
asientos existentes mediante un RPC agregado. No existen `finance_suppliers`,
`finance_products`, `finance_purchases` ni otro ledger. El OCR viejo se muestra
como precursor y no como producto terminado. Decisión completa y amenazas en
[ADR 001](ADR_001_FINANCE_PRODUCT_SURFACE.md).

El Document Inbox también separa captura de confianza. El usuario abre un lease
bajo entitlement + `finance.edit`; una Edge Function descarga el original
privado, recalcula hash/tamaño/MIME y consulta un scanner privado. Sólo un RPC
ejecutable por `service_role` deriva `ready_for_extraction`, duplicado,
diferido o cuarentena, y el token evita que un timeout viejo pise un retry. Sin
scanner configurado la salida es siempre diferida. Contrato operativo en
[FINANCE_DOCUMENT_INSPECTION.md](FINANCE_DOCUMENT_INSPECTION.md).

La extracción repite esa frontera: el navegador envía sólo ids, la Edge descarga
el original privado y vuelve a comprobar el SHA-256 antes de llamar a un modelo
fijado. La salida llega como tool call bajo JSON Schema, se normaliza sin
defaults inventados y Postgres vuelve a validar estructura y matemática. Una
confianza declarada por el proveedor no puede tapar errores: con cualquier
inconsistencia queda limitada a 0,69 y exige revisión.

Modelo y correcciones viven en revisiones append-only. Confirmar una revisión
no crea compras, obligaciones, stock ni asientos; matching y borradores son
slices posteriores. La función está activa con JWT, pero el flag y el modelo
permanecen ausentes hasta aprobar privacidad y benchmark. Contrato en
[FINANCE_DOCUMENT_EXTRACTION.md](FINANCE_DOCUMENT_EXTRACTION.md).

El fixture real descubrió además que la inmutabilidad de versiones bloqueaba el
borrado en cascada de una organización. La app sigue sin poder borrar
originales: sólo roles privilegiados pueden hacerlo al activar explícitamente
`app.finance_document_retention_cleanup`, dejando la retención como operación
separada y auditable.

### 4 ter. Capability Catalog: composición, no cuarta clase de permiso

✅ **Kernel piloto cerrado el 2026-08-28.** `capability_catalog` versiona el
contrato funcional; `organization_capabilities` dice qué activó el negocio;
dependencias, conflictos y settings completan el grafo. Las primeras claves son
`catalog.products`, `inventory.core`, `commerce.store` y `finance.documents`.

La resolución conserva las fronteras:

- `organization_product_access` sigue respondiendo qué producto comercial tiene
  la organización;
- `role_permissions` sigue respondiendo qué puede hacer la persona;
- `feature_flag_overrides` sigue respondiendo qué implementación técnica está en
  rollout;
- `capability_evaluate` es el único lugar que compone esos controles con la
  activación, dependencias y conflictos.

La UI nunca lee las tablas crudas. Su wrapper siempre evalúa `auth.uid()`; los
workers tienen otro wrapper exclusivo de `service_role`, sin posibilidad de
elegir «no validar usuario» desde el navegador. `product_surface_access`,
`finance_document_can`, inspección y extracción ya delegan al mismo evaluador.

Desactivar una capability **no desprovisiona datos**. Sólo cambia su fila de
control y la política (`read_only`, `safe_disable` o `requires_cleanup`) declara
cómo debe comportarse la superficie. Borrar o transformar historia requiere un
workflow separado y explícito; nunca es un efecto lateral del toggle.

### 4 quater. Blueprint: orquestación, no otra autoridad

✅ **P1-03 cerrado técnicamente el 2026-08-28.** El Business Profiler produce
un estado deseado versionado en `organization_blueprints`. El preview devuelve
ese JSON, su hash y el diff sin escribir; una confirmación crea una
`provisioning_run` con cinco `provisioning_steps`.

Blueprint no implementa perfiles, permisos, capabilities, sucursales ni CRM.
Coordina, en ese orden, `configure_business_profile`,
`seed_default_permissions`, Capability Catalog, `locations` y
`seed_crm_pipeline`. El configurador de perfil dejó de ser ejecutable por
`authenticated`, por lo que onboarding y reconfiguración pasan por la misma
orquestación.

La ejecución toma un advisory lock por organización y el trabajo de dominio
vive en una subtransacción. Ante una falla, PostgreSQL revierte todos los pasos;
afuera se conserva la corrida como evidencia con compensación
`transaction_rollback`. La misma idempotency key reintenta el run fallido y un
run exitoso sólo devuelve replay. Es recuperación transaccional, no una cola
distribuida ni una promesa de compensar efectos externos futuros.

### 4 quinquies. API pública: adapter versionado, nunca segunda autoridad

La API REST es otro canal alrededor del Business Core. No recibe `org_id`,
owner, costo, nombre de producto ni margen como autoridad: la key hasheada fija
tenant/scopes y PostgreSQL relee el resto. `PATCH /stock` delega en
`adjust_stock`; `POST /sales` delega en `api_v1_crear_venta`, que une advisory
lock, reserva idempotente, insert y triggers de stock/outbox en una sola
transacción. Un replay vuelve a pasar por allowlist de scopes antes de salir.

El contrato operativo vive en tres capas que se controlan entre sí:

- `/developer/api/openapi.json`: siete métodos reales, schemas, errores y
  headers;
- `_shared/publicApiContract.ts`: versión, precisión, límites y lifecycle que
  ejecuta la Edge;
- `20260829000020_api_publica_tiene_contrato.sql`: cuota durable y mutación
  transaccional, sólo para `service_role`.

`/v1` es obligatorio. Breaking changes requieren otro path; un sucesor tendrá
al menos 12 meses de solapamiento y la versión saliente anunciará
`Deprecation`, `Sunset` y `Link`. ARS admite 2 decimales, USD 4 y el inventario
actual son unidades enteras. No hay CORS browser: una key live pertenece a un
backend, no al JavaScript público de un integrador.

### 4 sexies. Orbit: orquestación transversal propuesta, no otra autoridad

📌 **Discovery 2026-08-29:** [Gestiona Orbit](INNOVATION_ORBIT_PLAYBOOKS.md)
sería un módulo opcional de playbooks para convertir señales del Business Graph
en decisiones repetibles. Consumiría `domain_events`, outbox y vistas/RPC
agregados; no leería tablas ajenas desde la UI ni inventaría un ledger, stock,
cliente, precio, documento o pago.

Orbit sólo coordina. La acción final sigue perteneciendo a su dominio: compras
prepara la orden, Inventory mueve stock, Payments reconcilia el cobro, Finance
aprueba el gasto/documento y Commerce actualiza la orden/fulfillment. Cada run
conserva versión, policy snapshot, scope, actor, idempotency key, pasos, retry,
error y outcome. El preview es read-only; las acciones irreversibles quedan
fuera del primer alcance.

El primer runtime debe reutilizar PostgreSQL, Edge Functions, advisory locks,
idempotencia y outbox. Temporal u otro runtime de durable execution sólo se
evalúa si un benchmark real demuestra que los workflows largos o externos lo
necesitan; no se agrega infraestructura por anticipación. Una capability
`operations.playbooks` y sus permisos requieren un ADR, dependencia/conflicto
en Capability Catalog, rollout, política de apagado y fixture con restos 0.

---

## 5. Lo que se adopta ahora y lo que espera

📌 **Criterio, y es la parte que evita construir un castillo.**

### Se adopta ya — barato, previene deuda

| Qué | Por qué ahora |
|---|---|
| Los quince principios como criterio de revisión | Cuesta cero |
| **H1 idempotencia** | Cada semana sin esto es riesgo de doble cobro |
| **H2 eventos + outbox** | Cada consumidor nuevo agrega acoplamiento |
| Abstracción de proveedor de pago | Ya hay dos; un tercero sin abstracción duele |
| No cruzar límites de dominio en código nuevo | Cuesta cero |

### Commerce Kernel — auditado 2026-08-20

✅ **Está:** variantes, listas de precio, promociones declarativas, motor de
reservas, devoluciones, CMS, temas, API keys, webhooks, los dos ledgers,
idempotencia y eventos.

✅ **K1 cerrado el 2026-08-21:** `product_types` + `attribute_definitions` y
valores tipados con validación de organización. Sigue faltando el carrito del
lado del servidor (K2)
· `domains` (K3) · `markets` (K4) · máquinas de estado explícitas (K5) ·
feature flags (K6) · `SearchProvider` como interfaz (K7).

📌 **El núcleo no conoce el rubro.** Nada de `if (categoria === 'perfume')`. Los
verticales aportan atributos, defaults y presets — nunca ramas en el motor.

### Espera evidencia

| Qué | Qué lo destraba |
|---|---|
| Multi-store, multi-market, multi-brand | Un comercio que tenga dos tiendas |
| Dominios propios por tienda | Un comercio que tenga dominio propio |
| Theme engine, page builder, headless | Un comercio que quiera otro diseño |
| **Gestiona Pay** más allá de orquestación | Volumen que justifique la estructura regulatoria |
| Marketplace de apps, developer platform | Desarrolladores que quieran construir |
| Search dedicado, recomendaciones, experimentos | Tráfico que haga que muevan la aguja |
| Multi-región, sharding, CQRS | Carga que lo pida |

⚠️ **La regla que ordena esta tabla:** hoy hay **un** comercio usando el sistema.
Construir multi-store para un comercio no es arquitectura, es adivinar. Lo que
sí corresponde ahora es **no cerrarse la puerta**: por eso los límites de dominio
y los tres huecos van primero, y el resto espera evidencia.

---

## 6. Sobre Gestiona Pay

📌 **Criterio.** La escalera tiene cuatro peldaños y **hoy estamos en el primero
y medio** ([ADR 002](ADR_002_COMMERCE_OPERATING_SYSTEM.md) §6). Stripe no es el
rail de lanzamiento argentino; el adapter sí se contempla para expansión.

1. **Orquestación** — el checkout es nuestro, el dinero lo mueve otro. ✅ Es lo
   que hay: OAuth de MercadoPago y `marketplace_fee` cobrando de verdad,
   verificado con dos compras acreditadas.
2. **Pagos embebidos con partner** — 🟡 arrancó: el Brick de MercadoPago dentro
   de la tienda.
3. **Routing y riesgo entre varios adquirentes** — necesita volumen.
4. **PSP regulado con cuentas de pago** — necesita inscripción en el registro de
   proveedores de servicios de pago del BCRA, capital, compliance y auditoría.
   **Es otra empresa adentro de la empresa**, no una feature.

⚠️ **Nunca asumir que se puede custodiar dinero de terceros sin estructura
regulatoria.** El peldaño 4 no se empieza en el código.

---

## 6 bis. Lo que costó cerrar los tres huecos

✅ **Medido, sesión 113.** Tapar H1, H2 y H3 abrió un agujero nuevo, y vale
dejarlo escrito porque se va a repetir con el próximo motor que se construya.

⚠️ **Postgres otorga `EXECUTE` a PUBLIC por default.** Toda función nace
llamable por `anon` — el rol de la clave anónima, que viaja en el bundle del
navegador y cualquiera puede leer. Las diecinueve funciones internas de los
motores quedaron abiertas apenas se escribieron.

Se comprobó asumiendo el rol `anon`, **seis de seis**:

| Ataque | Resultado |
|---|---|
| escribir en el libro contable ajeno | asiento creado |
| acreditarse plata en la billetera | plata acreditada |
| marcar una suscripción como pagada | aceptado |
| inyectar eventos en la historia ajena | evento creado |
| vaciar la cola de entregas | tomó la cola |
| leer el saldo de un comercio ajeno | disponible = 19.999.998 |

Ese último número es el ataque mirándose el resultado: se acreditó veinte
millones y la billetera se los mostró como disponibles. Desde ahí
`wallet_solicitar_retiro` —que **sí** valida membresía— los dejaba retirar. La
cadena de robo estaba completa, y **cada eslabón por separado parecía
correcto**. Es la misma forma que el agujero de las políticas `USING (true)`
que este repo ya cerró una vez.

**El principio que queda, y es nuevo:** una función `SECURITY DEFINER` que
recibe `org_id` y no verifica quién la llama es un agujero. Se cierra de las dos
maneras a la vez —`REVOKE` de PUBLIC **y** verificación adentro— porque el
REVOKE protege de la llamada directa y la verificación protege de que mañana
alguien vuelva a otorgar el permiso sin darse cuenta.

Dos detalles que costaron una corrida cada uno:

- **`REVOKE FROM anon` no saca nada** si el permiso lo tiene vía PUBLIC, del que
  todo rol es miembro. Va `FROM PUBLIC`. La primera versión revocaba sólo de
  `anon` y la verificación mostró que las ocho funciones seguían llamables.
- **Los compradores de la tienda son usuarios `authenticated`.** Revocar sólo de
  `anon` deja abierto a cualquiera que se haya registrado para comprar un
  perfume. `create_sales_transaction` y `record_manual_stock_movement` estaban
  así.

Guardas que quedaron, y se complementan a propósito:

- **`audit_funciones_expuestas`** (vista) mira los permisos **reales** de la
  base. Ve un `GRANT` hecho a mano.
- **`src/test/funcionesExpuestas.test.ts`** hace análisis estático de las
  migraciones. Ve una función nueva antes de que se aplique.

Ninguna sobra: la vista no ve una migración sin aplicar y el test no ve un
permiso otorgado fuera de una migración.

---

## 7. Definición de terminado

Una feature no está lista porque compila:

reglas de dominio · autorización · aislamiento por tenant · validación ·
idempotencia si aplica · auditoría si aplica · observabilidad · tests · estados
de error y de carga · documentación · estrategia de migración · forma de
apagarla · una métrica de uso.

Para cualquier cosa que toque dinero o stock, **test de integración contra la
base real, con limpieza, y restos en 0**.

---

## 8. Antes de construir cualquier cosa

Diez preguntas. Si alguna no tiene respuesta, no se implementa:

1. Qué problema resuelve. 2. Qué usuario lo necesita. 3. Qué dominio es dueño.
4. Qué datos necesita. 5. Qué evento consume o emite. 6. Qué acción habilita.
7. Cómo se mide. 8. Qué pasa si falla. 9. Cómo se apaga. 10. **Si una primitiva
que ya existe lo resuelve.**

La décima es la que más trabajo ahorra: en la sesión 110, A10 figuraba como
faltante y estaba entero —656 filas, trigger y gráfico en pantalla—. Empezar por
el código lo habría construido dos veces.
