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

## P0-02 — ARCA producción

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

## P0-03 — Inventario físico reconciliado

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
> **Falta y por qué:** *webhook firmado* y *refresh token* viven en la Edge
> Function y una matriz SQL no los puede ejercitar — necesitan test en TS.
> *Reintegro por monto mayor al cobrado* exige una segunda orden en la matriz.

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

## P0-05 — Staging reproducible

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

## P0-06 — Restore drill

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

## P0-07 — OpenTelemetry y correlación

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

## P0-08 — E2E bloqueante

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

## P0-09 — Economics gate

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
- Gross profit por pago visible.

---

## P0-10 — Segundo comercio externo

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
