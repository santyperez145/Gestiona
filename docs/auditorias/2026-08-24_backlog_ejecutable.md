# Gestiona — Backlog ejecutable para Product & Engineering

**Corte:** 24 de agosto de 2026  
**Regla operativa:** máximo tres epics activos simultáneamente: una foundation, un producto y una prueba externa.

---

## Convenciones

- **P0:** bloquea operar o vender.
- **P1:** bloquea competir.
- **P2:** crea diferenciación.
- **P3:** escala ecosistema/empresa.
- **Owner recomendado:** accountable técnico/producto, no necesariamente una sola persona.
- Ningún epic se cierra sólo porque compila.

### Definition of Done transversal

Toda entrega debe contemplar, cuando corresponda:

- tenant isolation;
- autorización server-side;
- validación;
- idempotencia;
- auditoría;
- observabilidad;
- error/loading/empty states;
- tests unitarios;
- tests de integración;
- E2E;
- migración backward-compatible;
- rollback/kill switch;
- documentación;
- evento de uso;
- métrica de resultado.

---

# P0 — Verdad operacional

## P0-01 — Fuente de verdad documental — 🟢 completo (2026-08-26)

> **Hecho:** conteos unificados y con fecha con guarda `check:conteos` en CI,
> procedimiento único de migraciones al tope de la sección, npm declarado con
> `packageManager` y `engines`. No había `bun.lock` ni `bun.lockb` que borrar.
>
> ~~README con las cuatro superficies~~ **hecho el 2026-08-26.** README y
> CLAUDE.md decían "tres superficies" y omitían **Finance**, que tiene shell
> propio (`FinanceLayout`), gate propio (`FinanceProductGate`) y exige
> entitlement de organización más permiso `finance.view`. Omitirla de la tabla
> de permisos era el peor lugar para omitirla.
>
> ~~Validación de links en CI~~ **hecho el 2026-08-26** con
> `npm run check:enlaces`. Valida rutas y anclas de los `.md`: **54 enlaces
> internos en 37 documentos**, 0 rotos. Los 147 externos **no** se verifican, a
> propósito: un sitio caído no es un error de este repo y un CI que falla por
> algo ajeno enseña a ignorar el CI.
>
> Probado en rojo antes de confiar en él: detectó archivo inexistente, ancla
> inexistente en otro archivo y ancla local rota, y dejó pasar la válida.
>
> ~~Capacidades marcadas como `built/verified/operated/adopted`~~ **hecho el
> 2026-08-26** en `docs/CAPACIDADES.md`, con la evidencia medida al lado de cada
> fila y no con una opinión.
>
> ⚠️ Medir para escribirlo destapó dos cosas: **0 facturas y 0 comprobantes ARCA
> en la base**, así que el CAE que la documentación declara emitido no se puede
> volver a mirar; y **0 ventas con `source = pos`**, que resultó ser adopción y
> no un bug de instrumentación — el POS sí escribe el valor.

**Owner:** Tech Lead  
**Objetivo:** eliminar contradicciones entre README, Roadmap, Arquitectura y estado real.

**Trabajo**

- Actualizar cantidad de funciones/tests/superficies.
- Definir un único procedimiento de migraciones.
- Marcar capacidades como `built`, `verified`, `operated`, `adopted`.
- Agregar check CI para comandos y conteos.
- Elegir npm; eliminar `bun.lock` y `bun.lockb` si no se usan.

**Aceptación**

- Un developer nuevo levanta local sin instrucción oral.
- No existe recomendación simultánea de usar y no usar `supabase db push`.
- ✅ README refleja Business, Finance, Platform y Storefront (2026-08-26).
- ✅ CI valida links (2026-08-26) y comandos principales.

---

## P0-02 — ARCA producción — 🟡 el código listo, falta el trámite (2026-08-25)

> **Hecho hoy:** nota de crédito con la clase correcta (A→3, B→8, C→13),
> prorrateo de IVA, tope por saldo acumulado, motivo obligatorio, y la factura
> autorizada pasó a ser **inmutable** —  no tenía un solo trigger, se
> le podía cambiar el total con CAE puesto.
>
> **Falta y depende del dueño:** certificado X.509 de producción, alta del
> punto de venta como *Web Services* y validación con contador. Pedir el CAE de
> una nota de crédito exige lo mismo que una factura.

**Owner:** Backend/Fiscal  
**Objetivo:** emitir el primer comprobante real autorizado.

**Trabajo**

- Certificado X.509 productivo.
- Asociación `wsfev1`.
- Punto de venta.
- Cache seguro de TA.
- Idempotencia por comprobante.
- Último autorizado.
- CAE, vencimiento, QR.
- Nota de crédito.
- Error taxonomy.
- Runbook de contingencia.

**Aceptación**

- Factura real A/B/C según situación.
- No duplica número ante retry.
- La factura autorizada es inmutable.
- Corrección mediante documento fiscal.
- Traza completa.
- Validación con contador.

---

## P0-03 — Inventario físico reconciliado — 🟡 el código listo, falta contar (2026-08-25)

> **Hecho:** el circuito ya estaba completo (`abrir_conteo`,
> `registrar_conteo`, `cerrar_conteo`, `conteo_varianzas`, pestaña en
> Inventario). Se agregó `kardex_contra_stock`, que dice **qué contar
> primero**: 15 productos desalineados, **$2.855.019** de impacto, 9 con Kardex
> negativo.
>
> **Falta y depende del dueño:** el conteo físico. `stock_counts` tiene 0 filas.
> Nada de esto se corrige por código: reconstruirlo exigiría saber qué ventas
> pasaron por el camino duplicado.

**Owner:** Operations/Inventory  
**Objetivo:** demostrar que el Kardex representa el stock real.

**Trabajo**

- Conteo físico.
- Ubicaciones.
- Ajuste con motivo.
- Reporte de diferencias.
- Unidades fraccionables.
- Balance de variantes.
- Reservas y liberaciones.

**Aceptación**

- Conteo y sistema conciliados.
- Toda diferencia tiene movimiento.
- No existe edición directa.
- Reporte antes/después.
- Segundo conteo de control.

---

## P0-04 — Matriz externa de pagos — 🟢 16 escenarios (2026-08-26)

> **Hecho:** `npm run drill:payments` cubre aprobado, rechazado, timeout, retry,
> webhook duplicado, webhook fuera de orden, refund, refund timeout, refund
> sobre orden ya reintegrada, reversión contable, habilitado-sin-token y
> conciliación end-to-end. Todos en verde, RESTOS 0 por rollback.
>
> ~~*webhook firmado* y *refresh token*~~ **cerrados el 2026-08-26** con
> `webhookMercadoPagoFirmado.test.ts`: 13 aserciones, el HMAC se calcula de
> verdad con `node:crypto` y la guarda se probó **en rojo** reintroduciendo el
> bug del punto y coma.
>
> ⚠️ **Hallazgo:** con `MP_WEBHOOK_SECRET` sin configurar, la verificación de
> firma **se saltea entera**. El test lo deja escrito; cambiarlo a rechazar
> siempre exige confirmar antes que el secreto esté cargado en produccion.
>
> ~~*reintegro por monto mayor al cobrado*~~ **cerrado el 2026-08-26** con una
> segunda orden en la matriz. Y construirlo destapó un agujero de plata que
> ninguna lectura del código había encontrado:
>
> ⚠️ **Un NULL saltaba el guard que autoriza sacar plata.** El chequeo era
> `resolution <> 'refund' OR refund_method <> 'original_payment'`. Con NULL,
> `x <> 'literal'` da **NULL**, y `FALSE OR NULL` es NULL: el `IF` no ejecuta.
> Una devolución resuelta como *cambio de producto* o sin medio definido
> preparaba igual un reintegro real a la tarjeta. Ninguna de las dos columnas
> tiene DEFAULT ni CHECK, y `return_requests` se escribe directo desde el
> cliente. Corregido con `IS DISTINCT FROM` en `20260826000130`.
>
> El tope por monto **sí** funcionaba, así que el daño máximo era reintegrar
> hasta el total de la orden. 0 filas en `return_requests` al encontrarlo.
>
> ⚠️ **Y tres escenarios pasaban por la razón equivocada.** El de "monto
> excesivo" rechazaba por el estado de la orden; después del fix pasó a
> rechazar por el NULL. Ahora cada escenario **exige su propio motivo** en el
> mensaje de error, no sólo que rechace: un guard que rechaza todo también
> aprueba un test que sólo prueba rechazos. Y se agregó el caso contrario —
> el reintegro del total exacto tiene que seguir aceptándose.

**Owner:** Payments  
**Objetivo:** certificar Mercado Pago fuera de la matriz interna.

**Escenarios**

- aprobado;
- rechazado;
- pending;
- timeout;
- webhook firmado;
- webhook duplicado;
- webhook fuera de orden;
- retry explícito;
- refund;
- refund sin saldo (monto mayor al cobrado, sobre una orden intacta);
- refund sin medio de reintegro definido;
- refund del total exacto (el caso que sí debe pasar);
- desconexión OAuth;
- refresh token;
- reversión;
- conciliación.

**Aceptación**

- Cada escenario produce estado esperado.
- No existen dobles cargos.
- No existen órdenes pagadas sin settlement.
- Refund ambiguo se reconcilia.
- Evidence pack con IDs saneados.

---

## P0-05 — Staging reproducible — 🔴 bloqueado por infraestructura del dueño

> **Por qué no avanzó:** crear el proyecto Supabase de staging, el proyecto de
> Vercel y las cuentas de prueba de Mercado Pago exige credenciales y decisiones
> de costo que no están de este lado. No es trabajo de código pendiente.
>
> **Lo que sí está listo para cuando exista:** las migraciones aplican desde
> cero (libro reconciliado, `db push --dry-run` en `upToDate`), el drill de
> restore reconstruye datos en un esquema aislado, y la matriz de pagos corre
> entera sin dejar restos.
>
> ⚠️ **Bloquea a P0-08**: los flujos E2E que faltan —signup, refund, ARCA,
> Finance— escriben datos. Hoy los E2E son de **sólo lectura contra
> producción** a propósito; agregarlos sin staging significaría crear órdenes y
> facturas reales en cada corrida de CI.

**Owner:** DevOps/SRE  
**Objetivo:** dejar de probar cambios peligrosos contra producción.

**Trabajo**

- Proyecto Supabase staging.
- Vercel staging.
- Secretos separados.
- Datos sintéticos.
- OAuth callbacks.
- ARCA homologación.
- Mercado Pago test accounts.
- Deployment workflow.

**Aceptación**

- Infraestructura recreable desde cero.
- No usa datos reales.
- E2E corre allí.
- Migraciones aplican desde cero.

---

## P0-06 — Restore drill — 🟡 RTO y RPO medidos y exigidos (2026-08-25)

> **Hecho:** `npm run drill:restore` mide RTO (815 ms) y ahora tambien RPO, y
> **falla** si el snapshot supera 36 h. El RPO real era de hasta 7 dias y nadie
> lo habia medido; backups pasados a diarios y ventana de salteo de 6 dias a
> 20 h — cambiar solo el cron no bajaba el RPO.
>
> **Falta:** verificar Storage y Auth (hoy solo tablas), drill periodico
> automatico y que un fallo genere incidente.

**Owner:** SRE  
**Objetivo:** probar recuperación, no sólo backup.

**Trabajo**

- Snapshot.
- Restore aislado.
- Verificación de tablas, storage y auth.
- Medir RPO/RTO.
- Runbook.
- Drill periódico.

**Aceptación**

- Restore completo exitoso.
- RTO/RPO registrados.
- Evidencia automática.
- Fallos generan incidente.

---

## P0-07 — OpenTelemetry y correlación — 🟡 P95 y error rate visibles; falta exporter externo (2026-08-26)

> **Hecho:** payment_operation_trace pasa de 5 a 8 etapas: intent, attempt,
> order, settlement, inventory, invoice, event, ledger. La matriz de pagos lo
> exige con el escenario traza_hasta_la_factura.
>
> **Falta:** exporter OTel real y dashboards externos.
>
> ~~Una venta de mostrador no aparece en la traza~~ **cerrado el 2026-08-26**:
> `sale_transactions.correlation_id` le da correlacion propia al ticket, y la
> traza cubre sale, inventory, invoice y ledger para el mostrador.
>
> ~~P95 y error rate~~ **cerrados el 2026-08-26**, y lo que se encontro al
> medir vale mas que la metrica: **el exito de un cron no probaba nada**.
> `invoke_edge_function` termina en `net.http_post`, que es asincrono, asi que
> el job terminaba en 0,2 s sin esperar respuesta. Los 20 jobs figuraban en
> verde con 0 fallas en 7 dias mientras, en la ventana de retencion de pg_net,
> **4 respuestas daban error y 1 timeout sobre 42** — ~10% fallando, 0%
> visible.
>
> Ahora `edge_invocation_log` guarda el id de pg_net junto al nombre de la
> funcion —el puente que faltaba, porque `net._http_response` no guarda el
> nombre y la cola se vacia al procesar—, `reconciliar_invocaciones()` copia el
> resultado cada 5 minutos antes de que pg_net lo pode a las ~6 h, y
> `platform_edge_invocation_health` expone error rate, timeouts, sin-despachar
> y P95 por funcion en `/platform/metricas`. `platform_cron_health` gano el
> estado `sin_respuesta`: despacho salio, funcion no contesto.
>
> Tres correcciones que salieron de la misma medicion:
> - El despacho usaba el default de pg_net, **5 s**, y cortaba antes de que la
>   funcion pudiera contestar: `recover-abandoned-carts` cortaba con 0
>   carritos para procesar**. Ahora declara 30 s. pg_net no cancela la funcion,
>   asi que el timeout no rompia el trabajo — rompia poder saber si se hizo.
> - Un vault sin secretos hacia `RAISE WARNING` + `RETURN NULL` y el cron
>   terminaba `succeeded` sin despachar. Ahora lanza excepcion.
> - `String(err)` sobre un `PostgrestError` —un objeto plano— daba
>   `"[object Object]"`, y una de las respuestas 500 reales tenia exactamente
>   ese cuerpo. `_shared/errorMessage.ts` desarma el error de verdad.
>
> ⚠️ El P95 mide encolado -> respuesta registrada por pg_net. Incluye la cola y
> **no** es tiempo de ejecucion de la funcion; ese dato no existe de este lado.

**Owner:** Platform/SRE  
**Objetivo:** reconstruir una operación end-to-end.

**Trabajo**

- Instrumentar Edge Functions críticas.
- Propagar `trace_id`, `correlation_id`, `tenant_id`.
- Métricas de checkout, payments, ARCA, Finance y webhooks.
- Exporter.
- Dashboards y alertas.
- Redacción PII.

**Aceptación**

- Una venta puede seguirse checkout→payment→order→inventory→invoice→ledger.
- P95 y error rate visibles.
- No se loguean secretos o PII innecesaria.

---

## P0-08 — E2E bloqueante — 🟡 ya bloquea, faltan flujos (2026-08-25)

> **Hecho, y ya estaba:** el job `e2e` de `ci.yml` corre tienda y panel en
> chromium + mobile, **falla el PR** si algo se rompe, y valida las variables de
> entorno antes de arrancar el browser — así una variable ausente no se
> convierte en tests salteados con el workflow en verde.
>
> **Falta:** signup/onboarding, refund, ARCA, Finance upload/review/apply y
> Platform operations. **Todos escriben datos** y los E2E actuales son de sólo
> lectura contra producción. ⚠️ Depende de P0-05: sin staging, agregarlos
> significa crear órdenes y facturas reales en cada corrida de CI.

**Owner:** QA  
**Objetivo:** impedir regresiones de flujos críticos.

**Flujos**

- signup/onboarding;
- POS;
- store checkout;
- payment reconciliation;
- refund;
- ARCA;
- Finance upload/review/apply;
- Platform operations.

**Aceptación**

- PR no integra con E2E crítico rojo.
- Fixtures aisladas.
- Reintentos no esconden fallos.
- Reporte y artifacts.

---

## P0-09 — Economics gate — 🟢 completo (verificado 2026-08-26)

> Comisión **inactiva por defecto**, regla versionada con
> proponente/aprobador/términos/tratamiento fiscal, simulador en Plataforma →
> Comisiones, `docs/ECONOMICS.md` separando medido, modelado y aprobado, y desde
> el 2026-08-26 **gross profit por pago** en `platform_gross_profit_por_pago`,
> visible en Comisiones → Revenue mensual.
>
> El número es comisión cobrada menos el IVA de esa comisión, con la regla
> vigente **al momento del cobro**. ⚠️ No resta la comisión de MercadoPago: ésa
> la paga el comercio, no la plataforma. 📌 Tampoco resta infraestructura por
> transacción, que **no está medida** — la vista dice "contribución antes de
> infraestructura" en vez de aparentar ser gross profit completo.
>
> Verificado 9/9 con el JWT de un admin real: 2 pagos, $0,10 de comisión, take
> rate 5% (la regla de la sesión 90, no la de hoy). `solo_montos_chicos` marca
> que con cobros de $1 el porcentaje no significa nada.

**Owner:** Finance/Product  
**Objetivo:** impedir pricing sin economía verificada.

**Trabajo**

- Costos upstream.
- IVA/impuestos.
- Refunds.
- Fraude.
- Soporte.
- Infraestructura.
- Take rate.
- Gross margin.
- Approval workflow.

**Aceptación**

- Comisión inactiva por defecto.
- Regla versionada y aprobada.
- Simulación con escenarios.
- ✅ Gross profit por pago visible (2026-08-26).

---

## P0-10 — Segundo comercio externo — 🔴 depende del dueño

### El camino ya está auditado y es repetible (2026-08-27)

`supabase/verificaciones/20260827_comercio_nuevo_puede_vender.sql` recorre el
camino entero sobre una organización recién creada: nace con settings y
permisos, **sin rubro adivinado**, carga un producto, vende en el POS, siembra
precios y envíos, crea su tienda, y el comprador **anónimo** la ve, ve el
producto y compra. Doce pasos, por los caminos reales y como los roles reales.

Al 2026-08-27 los doce dan `ok`. Pero encontró dos bugs que llevaban días
escondidos porque Exentry ya tenía todo configurado:

- el rubro salía `perfumes` en un comercio que nunca eligió (`20260827000110`);
- **la primera venta no llegaba al libro** (`20260827000120`): los tres
  triggers de asiento cortaban con «sin plan de cuentas no hay libro donde
  asentar» y nada más sembraba el plan. Un círculo cerrado y silencioso —el
  trigger atrapa la excepción para no voltear la venta— así que el comercio
  vendía bien y su P&L quedaba vacío para siempre.

📌 **Lo que queda de P0-10 es conseguir el comercio, no arreglar el camino.**
Eso depende del dueño; el software ya lo recorre entero sin ayuda técnica.

> Es la condición de salida de la fase y el único dato que le importa a un
> inversor: que Gestiona funcione con alguien que no lo escribió. No hay trabajo
> de código que lo destrabe.
>
> Medido 2026-08-25: 4 organizaciones, **1 vende de verdad**.

**Owner:** Founder/Product  
**Objetivo:** probar que Gestiona no depende de su creador.

**Aceptación**

- Onboarding.
- Import.
- Primera venta.
- Primer pago.
- Primera factura.
- Primer cierre.
- Sin SQL ni edición manual de base.
- Incidentes documentados.

---

# P1 — Activación universal

## P1-01 — Capability Catalog — 🟢 kernel piloto completo (2026-08-28)

**Owner:** Architecture  
**Objetivo:** reemplazar módulos estáticos por capacidades versionadas.

**Entidades**

- capability_catalog;
- capability_dependencies;
- capability_conflicts;
- organization_capabilities;
- capability_settings.

**Aceptación**

- [x] `catalog.products`, `inventory.core`, `commerce.store`, `finance.documents` resueltos por un evaluador único.
- [x] UI, backend y jobs usan la misma decisión.
- [x] Desactivar no borra datos.

### Entregado (`20260828000130`)

- El manifest versiona problema, arquetipos, países, producto, permiso, rollout,
  eventos, workflows, KPI, milestone y política de desactivación. No es otro
  mapa de navegación.
- `capability_evaluate` es la única composición de activación por organización,
  entitlement comercial, dependencias recursivas, conflictos, feature flag,
  membresía y permiso. Un wrapper autenticado fija la identidad; otro, revocado
  salvo `service_role`, sirve a workers.
- `product_surface_access` y `finance_document_can` conservan sus contratos pero
  delegan a `finance.documents`. Los workers de inspección y extracción vuelven
  a consultar el mismo evaluador antes de tomar un lease o descargar el original.
- El grafo rechaza ciclos al escribir. Crear una tienda activa
  `commerce.store`; Finance sigue bloqueado hasta que Platform habilita el
  producto, sin duplicar ese estado dentro de la capability.
- Las cinco tablas tienen RLS, cero acceso crudo desde `authenticated` y no
  conceden `DELETE` a `service_role`. La mutación de Platform actualiza sólo la
  fila de control y audita `data_policy = preserve`.

### Evidencia real

Fixture transaccional con owner y outsider: catálogo permitido, Finance
bloqueado antes del entitlement y permitido después, dependencia de inventario
bloqueada al apagar catálogo, ciclo inverso rechazado, wrapper de worker en la
misma decisión, producto preservado y **0 restos**. Línea de base productiva del
2026-08-28: **4 capabilities v1.0.0**, 2 organizaciones con catálogo/inventario,
1 con tienda activa y 1 sin tienda. Esto cierra el kernel piloto; Blueprint y
provisioning idempotente siguen en P1-03.

---

## P1-02 — Business Profiler universal — 🟡 el Core ya acepta lo que no se stockea (2026-08-27)

### Lo medido: el sesgo no eran los presets

Los siete perfiles viven en `industry_presets`, una **tabla**: agregar
servicios, gastronomía o turnos es un INSERT, no código. Ése no era el problema.

El problema es una línea del esquema:

```
products.stock  integer  NOT NULL  DEFAULT 0
```

y ninguna noción de «esto no se stockea». Una peluquería que carga «Corte de
pelo» y lo vende diez veces lo ve en **−10**: `trg_sale_stock_movement` dispara
en cada venta y `record_stock_movement` descuenta. `stock_negativo` —que según
CLAUDE.md tiene que estar vacía— se llenaría de servicios, y el panel diría
«agotado» sobre algo que no se agota.

📌 **El arreglo no era agregar rubros: era que el Business Core acepte algo que
se vende y no se stockea.** Los rubros vienen después, y son datos.

### Hecho (`20260827000090`)

- `products.maneja_stock`, default `true`: los 60 productos existentes no
  cambian en nada.
- La guarda vive **dentro de `record_stock_movement`**, la única autoridad
  sobre el stock: cubre de una vez venta, compra, ajuste manual, cierre de
  conteo y transferencia. Devuelve NULL y **no escribe Kardex**.
- `stock_a_reponer` los excluye: `run_abc_analysis` clasifica por ventas, así
  que un servicio aparecía como «quebrado» pidiendo comprar unidades de algo
  que no se compra.
- Los KPI de Productos («sin stock», «poco stock») los excluyen.
- Verificado en los dos sentidos con datos ZZ: el servicio no se movió (stock
  10, 0 filas de Kardex) **y el producto normal sí** (10 → 7, 1 fila). Sin esa
  segunda mitad, una guarda que frenara TODO habría pasado igual y roto el
  stock del sistema entero en silencio.

### Segunda pasada (`20260827000100`)

El interruptor por producto no alcanzaba: una peluquería con veinte
prestaciones las marca veinte veces, y la primera que se le pasa vuelve a bajar
a −1 con cada venta. **Lo que sabe si algo se descuenta no es el producto: es
el tipo.** `product_types.maneja_stock` sube la declaración al tipo, el preset
la trae puesta y la ficha la usa como valor inicial — sólo al crear, porque en
un producto que ya existe cambiar el tipo no puede reescribir una decisión
tomada.

Dos rubros nuevos: **Servicios** y **Gastronomía**.

⚠️ Gastronomía trae DOS tipos a propósito: `Plato` sin stock y `Insumo` con
stock. **Un restaurante no es un negocio sin stock** — el plato se prepara,
pero la harina, la bebida y el descartable se compran y se consumen. Marcar
todo como «sin stock» le rompe el inventario al día siguiente, y es el error
fácil al agregar el rubro. Hay un test que lo vigila.

### Falta

- Los otros arquetipos de la auditoría. **No se agregaron a propósito:**
  mayorista, ecommerce y retail ya funcionan con los rubros de catálogo —no son
  un rubro distinto, son la misma mercadería por otro canal— y turnos,
  proyectos, alquileres y suscripciones necesitan entidades que hoy no existen
  (una agenda, un contrato, un plazo). Un preset suyo sería una promesa vacía.
- Perfil versionado y «tres negocios muy distintos generan perfiles correctos»,
  que es el criterio de cierre original.

---

## P1-02 — Business Profiler universal (criterio original)

**Owner:** Product/Frontend  
**Objetivo:** eliminar sesgo a productos/perfumes.

**Arquetipos**

- retail;
- wholesale;
- ecommerce;
- services;
- appointments;
- projects;
- manufacturing;
- rentals;
- subscriptions;
- gastronomy;
- hybrid.

**Aceptación**

- `perfumes` no es default.
- Tres negocios muy distintos generan perfiles correctos.
- IA interpreta, reglas determinísticas deciden.
- Perfil versionado.

---

## P1-03 — Blueprint y Provisioning — 🟢 cerrado técnicamente (2026-08-28)

**Owner:** Backend  
**Objetivo:** configurar automáticamente una organización.

**Trabajo**

- organization_blueprints;
- provisioning_runs;
- steps;
- retries;
- idempotency;
- progress;
- compensation.

**Aceptación**

- Repetir provisioning no duplica.
- Roles, settings, pipelines, ubicaciones y checklist se crean.
- Fallo parcial es recuperable.

### Entregado

`organization_blueprints` conserva el estado deseado versionado y su SHA-256;
`provisioning_runs` hace única la idempotency key por organización y
`provisioning_steps` es el checklist observable. Antes de confirmar,
`business_blueprint_preview` devuelve estado actual, diff y hash sin escribir.

La ejecución serializa por organización y delega en las autoridades existentes:
`configure_business_profile`, `seed_default_permissions`, Capability Catalog,
`locations` y `seed_crm_pipeline`. El navegador perdió permiso para llamar al
configurador interno y sólo entra por Blueprint u onboarding. No aparece otro
stock, settings, pipeline ni sistema de roles.

El bloque de pasos corre en una subtransacción real. Ante error, PostgreSQL
revierte todas las mutaciones del intento y luego persiste run/checklist como
`failed`, con pasos previos `compensated`, paso actual `failed` y siguientes
`skipped`. La misma key puede reintentar; después de éxito devuelve replay sin
ejecutar ni duplicar.

### Evidencia real

Fixture productivo `ZZ`, transaccional: preview con **5 cambios**, falla
inyectada al crear ubicación, **0** perfiles/tipos/permisos/capabilities/
ubicaciones/pipelines parciales, retry exitoso en el intento **2**, replay sobre
**1 run**, **5/5 pasos**, matriz de **60+ permisos**, **1 ubicación principal**,
pipeline de **6 etapas**, **2 capabilities base**, outsider bloqueado y **0
restos**. La línea de base productiva sigue en 0 blueprints/runs/steps reales:
se cerró confiabilidad técnica, no adopción del segundo comercio.

---

## P1-04 — Autorización server-side — 🟡 stock y billetera cerrados (2026-08-27)

**Owner:** Security/Backend  
**Objetivo:** separar RLS de autorización funcional.

**Aceptación**

- Stock adjust, refund, payment, payable, price override y fiscal requieren permiso en servidor.
- Tests cross-role/cross-branch.
- Deny by default.
- Auditoría.

### Lo medido (2026-08-27)

La primitiva ya existía y estaba bien hecha: `has_permission(org, módulo,
acción)` lee la matriz de Admin → Permisos, es deny by default para quien no es
miembro y tiene defaults por rol. **El problema era quiénes no la llamaban.**

Probado contra producción como `authenticated` real, con una membresía
`vendedor` real, dentro de una transacción revertida:

```
matriz: puede editar inventario  →  false
abrir_conteo(...)                →  PASÓ
```

Cerrar ese conteo llama a `record_stock_movement`, la única autoridad sobre el
stock. El comercio desmarcaba «Inventario» para un empleado y el empleado lo
reescribía igual por la RPC.

⚠️ **Un escaneo de texto no encuentra esto y además miente en las dos
direcciones.** Marcaba `record_stock_movement`, `ledger_contraasentar` y
`pago_reintegro_preparar` como desprotegidas —no son alcanzables, `authenticated`
no tiene `EXECUTE`— y `save_afip_config`, que sí exige owner/admin. Hay que
mirar privilegios y leer el cuerpo.

⚠️ **Y la primera versión de la prueba dio un falso negativo.** Asignaba el
retorno a un `uuid` y el error de tipo caía en el mismo `EXCEPTION WHEN OTHERS`,
así que el resultado era «no pasó» y se habría cerrado como correcto. El
mensaje del error es parte de la prueba, no un adorno: `payments.edit` se frena
hoy, pero por «Primero conectá tu cuenta de MercadoPago» —una precondición de
negocio—, no por un permiso.

### Hecho

- `exigir_permiso(org, módulo, acción, qué)` — una sola puerta, con `RAISE`
  `insufficient_privilege`. Deja pasar a `service_role`: la matriz responde
  «¿esta persona puede?» y en una Edge Function no hay persona. Sin esa rama,
  agregar la guarda rompía el ajuste de stock de la API pública.
- Nueve funciones la llaman, después de la membresía y antes de escribir:
  `abrir_conteo`, `registrar_conteo`, `cerrar_conteo`, `cancelar_conteo`,
  `transfer_stock_between_locations`, `asignar_a_ubicacion`, `adjust_stock`,
  `record_member_stock_movement`, `wallet_solicitar_retiro`. Los cuerpos se
  regeneraron desde `pg_get_functiondef` con un script.
- `ledger_asentar_venta` / `ledger_asentar_gasto` pierden el `EXECUTE` de
  `authenticated`: las llaman los triggers y nadie desde el cliente. Con el
  grant puesto, un miembro podía forzar un asiento en **otro** comercio.
- **Auditoría:** vista `audit_rpc_sin_permiso`, tiene que estar vacía (0).
- **Test cross-role:** la migración verifica en los dos sentidos — un vendedor
  queda frenado **y** un admin sigue pudiendo. La segunda mitad no es
  decorativa: una guarda que frena a todos deja la vista igual de vacía.
- `permisoEnElServidor.test.ts` (11 tests, probado en rojo en tres dimensiones:
  guarda ausente, módulo equivocado y guarda puesta antes de la membresía).

### Segunda pasada (`20260827000040`)

Al volver a medir quedaban seis funciones sin puerta y **dos merecían una**:

- `medio_de_pago_habilitar` → `payments.edit`. Se frenaba, pero por «Primero
  conectá tu cuenta de MercadoPago»: una precondición de negocio. El día que la
  cuenta está conectada —que es siempre, en un comercio que vende— dejaba de
  frenar.
- **`promotions`**, que no es una RPC: se escribe derecho contra la tabla y la
  puerta es la policy. Era `ALL` con sólo membresía, así que cualquier vendedor
  podía crear una promoción — y una promoción **es un precio**. Lo raro no era
  que faltara: `quantity_discounts` hace lo mismo y exige rol desde el día uno,
  y `/promociones` ya era `SOLO_ADMIN`.

⚠️ **La lectura de `promotions` NO se tocó, y ahí estaba la trampa.** El POS la
lee para cobrar. Apretar la policy `ALL` entera le sacaba la lectura al vendedor
—justo quien atiende el mostrador— y el POS habría cobrado **sin la promoción**,
en silencio y a favor del comercio. Va partida en dos, como `quantity_discounts`.

Price override queda cubierto: `products`, `price_lists`, `price_list_items`,
`product_variants`, `purchases` y `expenses` ya exigían rol `owner`/`admin`.

### Tercera pasada fiscal (`20260828000150`)

La frase «fiscal ya exige owner/admin» escondía dos problemas diferentes:

- `save_afip_config` aislaba tenant y exigía un rol estricto, pero no respetaba
  la matriz. Ahora separa membresía de `invoices.edit`, conserva deny by default
  y audita valores fiscales anteriores/nuevos sin TA, certificado ni clave.
- **`afip_marcar_delegacion` sí era un agujero:** decía «sólo backend», pero
  `anon` conservaba `EXECUTE` y su guarda empezaba con
  `auth.uid() IS NOT NULL`. Para anon era NULL, la condición no entraba y podía
  marcar cualquier org conocida como verificada. Quedó exclusiva de
  `service_role`, con una segunda guarda interna que también rechaza anon.

Se retiró además `anon` de `get_afip_stats`: ya dependía de RLS invoker, pero no
existe una superficie fiscal pública que justifique ese contrato.

**Evidencia real:** organización `ZZ` transaccional; vendedor sin permiso
bloqueado, el mismo vendedor con `invoices.edit` habilitado pudo guardar,
cross-tenant bloqueado, anon bloqueado aun invocando la función directamente,
`service_role` habilitado, una auditoría saneada y **0 restos**. ACL medida:
delegación `anon=false`, `authenticated=false`, `service_role=true`.

### Cuarta pasada: una revocación incompleta (`20260828000160`)

La vista real dejó a la vista otra diferencia entre intención y ACL:
`REVOKE ... FROM PUBLIC` no retiró grants directos que producción conservaba
para `anon` y `authenticated`. Seis funciones que sólo consumen cron o Edge
seguían invocables desde el navegador:

- `cambios_de_precio_a_aplicar` y `registrar_cambio_de_precio`;
- `ia_registrar_consumo`;
- `registrar_invocacion`, `reconciliar_invocaciones` y `podar_invocaciones`.

El impacto cubría confidencialidad e integridad: ids de suscripción/preapproval,
precio acordado, cupo/costo de IA y la telemetría con la que Plataforma decide
si una función está sana. Las seis quedaron con ACL exclusiva de `service_role`
y una guarda interna independiente; pg_cron/verificaciones sólo pasan sin JWT
cuando `session_user` es realmente el dueño de la base. Además anon perdió los
helpers heredados `platform_role`, `has_role` y `get_user_role`.

**Evidencia real:** seis ataques anon rechazados aun invocando directo, acceso
authenticated ausente, service role operativo para consumo de IA,
`audit_costo_expuesto = 0` y **0 restos**.

### Falta

- Refund: la Edge exige `owner`/`admin` antes de llegar a RPCs que son sólo
  `service_role`. Es más estricto que la matriz y no es un agujero, pero todavía
  no expresa `payments.edit` como política funcional configurable.
- `expire_batches`, `expire_stock_reservations`, `run_abc_analysis` y los dos
  contadores de plantillas siguen sin permiso. Ninguno fija precio, mueve stock
  ni saca plata.
- Cross-branch: no hay sucursales suficientes para probarlo de verdad.

---

## P1-05 — Import Platform

**Owner:** Integrations/Data  
**Objetivo:** reducir switching cost.

**Conectores iniciales**

- CSV/Excel;
- AnswerSoft;
- Tiendanube;
- Empretienda/TiendaNegocio CSV;
- Shopify.

**Aceptación**

- Staging.
- Mapping.
- Preview.
- Error report.
- Apply idempotente.
- Reconciliation.
- SEO redirects cuando aplique.

---

# P1 — Commerce foundation

## P1-06 — Storefront split

**Owner:** Frontend/Platform  
**Objetivo:** aislar tienda pública.

**Aceptación**

- Build/deploy independiente.
- SLO separado.
- Admin down no tumba storefront.
- Menor bundle.
- CDN/cache.
- Preview environments.

---

## P1-07 — Store first-class

**Owner:** Commerce Backend  
**Objetivo:** permitir multi-store sin duplicar Core.

**Entidades**

- brands;
- stores;
- store_channels;
- store_catalogs;
- store_price_lists;
- markets.

**Aceptación**

- Una org crea dos stores.
- Cada store tiene catálogo/precio/theme/config.
- Mismo producto Core.

---

## P1-08 — Server-side Cart

**Owner:** Commerce Backend  
**Objetivo:** carrito persistente y consistente.

**Aceptación**

- Anonymous/auth.
- Multidevice.
- Recalculate.
- Expiration.
- Assisted cart.
- Quote-to-cart.
- Idempotent mutation.
- No precio confiado al cliente.

---

## P1-09 — Lifecycle state machines

**Owner:** Commerce Architecture  
**Objetivo:** eliminar estados ambiguos.

**Aceptación**

- Order, Payment, Fulfillment, Return separados.
- Transiciones explícitas.
- Concurrency tests.
- Partial payment/fulfillment/refund.

---

## P1-10 — Domains Service

**Owner:** Platform/Commerce  
**Objetivo:** dominio propio y SSL.

**Aceptación**

- DNS verification.
- SSL provision/renewal.
- Primary/secondary.
- Canonical.
- 301.
- Health.
- Takeover prevention.
- Provider abstraction.

---

## P1-11 — Theme/Page minimum

**Owner:** Storefront  
**Objetivo:** paridad visual mínima.

**Aceptación**

- Manifest.
- Sections/blocks.
- Design tokens.
- Draft/preview/publish.
- Version/rollback.
- Homepage/product/category/content.
- No unsafe checkout JS.

---

## P1-12 — SEO & migration

**Owner:** Storefront/Growth  
**Aceptación**

- Canonical.
- Sitemap.
- robots.
- JSON-LD.
- hreflang-ready.
- Redirects.
- SEO migration report.

---

# P1 — Developer Platform hardening

## P1-13 — API v1

**Owner:** Platform API  
**Objetivo:** convertir prototipo en contrato.

**Aceptación**

- Keys hashed.
- Prefix/id/last_used.
- Scopes.
- Rate limits.
- Idempotency.
- OpenAPI.
- Versioning.
- Deprecation.
- CORS allowlist.
- Decimal stock.

---

## P1-14 — Outgoing webhooks

**Owner:** Platform API  
**Aceptación**

- Subscriptions.
- HMAC signatures.
- Retry/backoff.
- DLQ.
- Replay.
- Filtering.
- Event versions.
- Delivery logs.

---

# P2 — Diferenciación

## P2-01 — Margin Engine

**Owner:** Data/Finance  
**Objetivo:** contribución real por transacción.

**Aceptación**

- COGS.
- Payment fee.
- Shipping.
- Marketplace fee.
- Promotion.
- Tax assumption.
- Refund.
- Explanation.
- Data quality score.

---

## P2-02 — Action Loop

**Owner:** Intelligence  
**Entidades**

- findings;
- recommendations;
- approvals;
- executions;
- outcomes;
- impact_events.

**Aceptación**

- Finding persistido.
- Acción aprobable.
- Ejecución idempotente.
- Resultado medido.
- Reversión.

---

## P2-03 — Simulation Engine

**Owner:** Data/Intelligence  
**Aceptación**

- Price.
- Promotion.
- Installments.
- Purchase.
- Shipping threshold.
- Channel mix.
- Assumptions visible.
- No writes.

---

## P2-04 — AI Gateway

**Owner:** AI Platform  
**Aceptación**

- Provider abstraction.
- Model registry.
- Prompt version.
- Structured output.
- Cost/latency.
- Quotas.
- Fallback.
- Redaction.
- Eval hooks.

---

## P2-05 — Finance production readiness

**Owner:** Finance  
**Aceptación**

- Scanner configured.
- DPA/privacy.
- Retention.
- Approved model.
- Benchmark dataset.
- Accuracy thresholds.
- Fail-closed.
- User consent.

---

## P2-06 — Finance inbound

**Owner:** Integrations/Finance  
**Aceptación**

- Email attachment.
- WhatsApp media.
- Dedup.
- Tenant routing.
- Original preserved.
- Audit.

---

## P2-07 — Three-way matching

**Owner:** Finance/Purchasing  
**Aceptación**

- PO vs receipt vs invoice.
- Price/quantity tolerances.
- Discrepancy queue.
- Approval.
- Audit.

---

## P2-08 — Reconciliation

**Owner:** Finance/Payments  
**Aceptación**

- Provider transaction.
- Order.
- Payment intent.
- Settlement.
- Refund.
- Invoice/payable.
- Match/suggest/ambiguous/unmatched.

---

## P2-09 — SearchProvider

**Owner:** Commerce Search  
**Aceptación**

- Interface.
- Postgres implementation.
- Typesense/Meili/OpenSearch benchmark.
- Facets.
- Typo.
- Synonyms.
- Index lag metrics.
- Fallback.

---

## P2-10 — B2B foundation

**Owner:** Commerce/Product  
**Aceptación**

- Companies.
- Buyers.
- Catalogs.
- Price lists.
- Volume rules.
- Terms.
- Credit.
- PO.
- Approval.

---

# P3 — Rails y ecosystem

## P3-01 — Segundo proveedor de pagos

**Gate:** TPV real suficiente.  
**Aceptación:** provider-neutral PaymentIntent, reconciliation and failover evidence.

## P3-02 — Gestiona Ship

**Gate:** volumen de envíos.  
**Aceptación:** quote/label/cancel/track contracts and positive unit economics.

## P3-03 — OAuth Apps

**Gate:** API estable.  
**Aceptación:** app identity, scopes, install, revoke, audit.

## P3-04 — Developer Portal/Sandbox

**Gate:** al menos tres integraciones externas activas.

## P3-05 — Marketplace

**Gate:** 50+ active merchants y demanda repetida.

## P3-06 — Enterprise

**Gate:** pipeline empresarial real.  
**Alcance:** SSO, SCIM, SLA, dedicated tenancy, compliance.

## P3-07 — Gestiona Pay regulado

**Gate:** volumen, partner, legal entity, BCRA/compliance program, risk and capital.

---

# KPIs de ejecución

## P0

- First production CAE.
- Payment scenarios passed.
- Restore RTO/RPO.
- Second merchant first transaction.
- Critical trace coverage.

## P1

- Time to first value.
- Founder interventions.
- Migration success.
- Store performance.
- Domain activation time.
- API error rate.

## P2

- Margin coverage.
- Recommendation action rate.
- Verified impact.
- Finance extraction accuracy.
- Straight-through processing.
- Match rate.
- AI cost/action.

## P3

- TPV.
- Payment penetration.
- Shipping penetration.
- App installs.
- Gross profit.
- NRR.

---

# Secuencia inmediata recomendada

## Sprint 1

- P0-01 Documentation.
- P0-02 ARCA.
- P0-10 second merchant preparation.

## Sprint 2

- P0-03 stock.
- P0-04 payments live.
- P0-05 staging.

## Sprint 3

- P0-06 restore.
- P0-07 observability.
- P0-08 E2E.

## Sprint 4

- P1-01 capability catalog.
- P1-02 profiler.
- P1-06 storefront split discovery.

## Sprint 5

- P1-03 provisioning.
- P1-04 server authorization.
- P2-05 Finance provider benchmark.

## Sprint 6

- P1-07 Store.
- P1-08 Cart.
- P2-01 Margin Engine.

---

# Regla final

No abrir P3 mientras:

- no haya segundo merchant;
- ARCA no sea productivo;
- restore no esté probado;
- checkout/pagos no tengan evidencia real;
- Finance no procese documentos reales;
- la comisión no tenga economics aprobados.
