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

## P0-01 — Fuente de verdad documental — 🟡 parcial (2026-08-25)

> **Hecho:** conteos unificados y con fecha, guarda `npm run check:conteos` en CI,
> procedimiento único de migraciones al tope de la sección, npm declarado con
> `packageManager` y `engines`. No había `bun.lock` ni `bun.lockb` que borrar.
>
> **Falta:** marcar capacidades como `built/verified/operated/adopted`, README
> con las cuatro superficies, y validación de links en CI.

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
- README refleja Business, Finance, Platform y Storefront.
- CI valida links y comandos principales.

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

## P0-04 — Matriz externa de pagos — 🟡 12/14 escenarios (2026-08-25)

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
> **Falta:** *reintegro por monto mayor al cobrado*, que exige una segunda
> orden en la matriz.

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
- refund sin saldo;
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

## P0-07 — OpenTelemetry y correlación — 🟡 la traza cierra la cadena (2026-08-25)

> **Hecho:** payment_operation_trace pasa de 5 a 8 etapas: intent, attempt,
> order, settlement, inventory, invoice, event, ledger. La matriz de pagos lo
> exige con el escenario traza_hasta_la_factura.
>
> **Falta:** exporter OTel real, dashboards, P95 y error rate.
>
> ~~Una venta de mostrador no aparece en la traza~~ **cerrado el 2026-08-26**:
> `sale_transactions.correlation_id` le da correlacion propia al ticket, y la
> traza cubre sale, inventory, invoice y ledger para el mostrador.

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

## P1-01 — Capability Catalog

**Owner:** Architecture  
**Objetivo:** reemplazar módulos estáticos por capacidades versionadas.

**Entidades**

- capability_catalog;
- capability_dependencies;
- capability_conflicts;
- organization_capabilities;
- capability_settings.

**Aceptación**

- `catalog.products`, `inventory.core`, `commerce.store`, `finance.documents` resueltos por un evaluador único.
- UI, backend y jobs usan la misma decisión.
- Desactivar no borra datos.

---

## P1-02 — Business Profiler universal

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

## P1-03 — Blueprint y Provisioning

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

---

## P1-04 — Autorización server-side

**Owner:** Security/Backend  
**Objetivo:** separar RLS de autorización funcional.

**Aceptación**

- Stock adjust, refund, payment, payable, price override y fiscal requieren permiso en servidor.
- Tests cross-role/cross-branch.
- Deny by default.
- Auditoría.

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
