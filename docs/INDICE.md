# Índice de documentación

**Estado:** canónico. **Revisión:** 2026-10-01. **Owner:** Producto / CTO.

Este índice enumera los documentos vigentes. ROADMAP describe presente y futuro;
Git conserva auditorías, evidencia e incidentes cerrados. No se versionan dumps
SQL one-off bajo `docs/` (van a `supabase/verificaciones` o se descartan).

## Empezar

- [README](../README.md): instalación, comandos y deploy.
- [Guía de contribución](../CONTRIBUTING.md): reglas obligatorias de trabajo.
- [Roadmap](../ROADMAP.md): estado y orden de ejecución.
- [Roadmap de diseño](../DESIGNROADMAP.md): dirección visual.
- [Guía del proyecto](GUIA.md): mapa para incorporarse.

## Producto y estrategia

- [Estrategia](ESTRATEGIA.md): categoría, benchmarks y secuencia.
- [Arquitectura](ARQUITECTURA.md): autoridades, límites y seguridad.
- [Capacidad Finance](FINANCE.md): contrato de producto y paridad Mendel-class.
- [Profit](PROFIT.md): contribución, confianza, atribución y fases; superficie dedicada pendiente.
- [Growth](GROWTH.md): CRM/marketing fuera de Finance, identidad compartida y fases.
- [Influencers](INFLUENCERS.md): alcance real, referencia GoMarz y pendientes.
- [Economics](ECONOMICS.md): monetización y métricas.
- [Inversores](INVERSORES.md): tesis y narrativa.
- [Activación y cohortes](ACTIVACION_COHORTES.md): adopción y medición.
- [Business Profiler](BUSINESS_PROFILER.md): personalización por comercio.
- [Margen](MARGIN_FACTS.md): hechos, confianza y acciones.
- [Nerqia Intelligence](NERQIA_INTELLIGENCE.md): control plane, autonomía
  gobernada y enriquecimiento de catálogo.
- [Auditoría funcional](AUDITORIA_FUNCIONAL.md): matriz vigente por ruta,
  hallazgos productivos y límites de certificación.

## Decisiones

- [ADR 001 — Finance](ADR_001_FINANCE_PRODUCT_SURFACE.md)
- [ADR 002 — Commerce OS](ADR_002_COMMERCE_OPERATING_SYSTEM.md)
- [ADR 003 — Identidad y dominio](ADR_003_NERQIA_IDENTIDAD_Y_DOMINIO.md)
- [ADR 004 — Growth / Profit](ADR_004_GROWTH_PROFIT_SHARED_GRAPH.md): portfolio y Graph compartido; reemplazo parcial de ADR 002.

Los ADR aceptados no se reescriben para ocultar el contexto: una decisión nueva
los reemplaza con otro ADR.

## Experiencia

- [Estándar competitivo](ESTANDAR_EXPERIENCIA_COMPETITIVA.md): definición de
  pantalla completa y evaluación tecnológica.
- [Interfaz](INTERFAZ.md): tokens, layouts, primitives y responsive.
- [SEO e indexación](SEO_INDEXACION.md): descubrimiento de tiendas.
- [Importación de productos](IMPORTACION_PRODUCTOS.md): contrato del importador.

## Operación e integraciones

- [Configuración](CONFIGURACION.md): variables y servicios.
- [Alta de comercios](ALTA_COMERCIOS.md): provisioning operativo.
- [API pública](API_PUBLICA.md): autenticación, scopes y consumo.
- [Webhooks](WEBHOOKS.md): entrega, firma e idempotencia.
- [Cron](CRON.md): jobs y health.
- [Email marketing](EMAIL_MARKETING.md): audiencia, consentimiento, baja y operación.
- [Pagos](PAGOS.md): checkout, webhook, conciliación y refunds.
- [Facturación](FACTURACION.md): renglones, IVA, NC, impresión y autoridad ARCA.
- [Mercado Pago diferencial](MP_DIFERENCIAL.md): estrategia de fees, split y conciliación.
- [Mercado Libre](MERCADOLIBRE.md): canal y sincronización.
- [Google OAuth](GOOGLE_OAUTH_SETUP.md): configuración de acceso.
- [Estados de checkout](C20_ESTADOS_CHECKOUT.md): matriz de estados y recuperación.
- [Certificación de migración](C222_CERTIFICAR_MIGRACION.md): protocolo de corte.
- [Primer documento Finance](F5_1_PRIMER_DOCUMENTO_FINANCE_REAL.md): protocolo de certificación, no evidencia de adopción.
- [Margen explicado](P3_MARGEN_EXPLICADO.md): desglose canónico por canal.
- [Contratos de acción](A1_CONTRATOS_ACCION.md): transiciones server-side.
- [Contratos de acción por estado](A1_CONTRATOS_ACCION_ESTADO.md): máquinas de estado.

## Calidad, soporte y recuperación

- [E2E](E2E.md): ejecución de Playwright.
- [Permisos](permisos.md): roles, tenants y superficies.
- [Seguridad](SEGURIDAD.md): amenazas, RLS, RPC, fraude e incidentes.
- [Legal](LEGAL.md): normativa argentina y datos pendientes del comercio.
- [Soporte diagnóstico](SOPORTE_DIAGNOSTICO.md): triage y operación.
- [Restore](RESTORE.md): recuperación y drills.

## Política documental

La fecha es la última revisión del contrato, no una recertificación de todos
sus benchmarks. Fuente fechada e implementación comprobada son evidencias distintas.

| Autoridad | Estado | Owner | Revisión / reemplazo |
|---|---|---|---|
| ROADMAP | Canónico: prioridades/gates | Producto / CTO | 2026-10-01; historia en Git. |
| CONTRIBUTING | Canónico: ejecución | Ingeniería | 2026-10-01. |
| Arquitectura / Estrategia | Canónico: límites / portfolio | CTO / Producto | 2026-10-01; fuentes conservan su fecha. |
| Finance | Canónico: control de gasto | Producto Finance | 2026-10-01; certificación real abierta. |
| Profit / Growth | Canónico: contratos; superficies pendientes | Producto / Datos / Growth | 2026-10-01. |
| Intelligence | Canónico: runtime y autonomía | CTO | 2026-10-01; no segundo motor. |
| ADR 001 / 003 | Aceptado | CTO | Fecha de cada ADR; no sustituidos. |
| ADR 002 | Aceptado parcialmente sustituido | CTO | ADR 004 reemplaza límites indicados; contexto histórico intacto. |
| ADR 004 | Aceptado incremental | CTO / Producto | 2026-10-01. |
| F5.1 / C22.2 | Referencia: protocolos operativos | Producto / Operación | No sustituyen contrato Finance / importación. |
| Auditorías y cierres anteriores | Histórico | Owner del cambio | Git; no autoridad paralela ni promesa vigente. |

Un documento activo:

1. tiene un propósito que no se superpone;
2. declara estado o fecha cuando puede envejecer;
3. enlaza su autoridad y fuentes;
4. se actualiza en el mismo slice que cambia el comportamiento;
5. evita diarios de sesión, capturas repetidas y listas ya cerradas.
6. no declara como terminada una UI con datos simulados o sin autoridad
   server-side desplegable.
7. separa planeado, implementado, verificado internamente, certificado y adoptado.

Las verificaciones SQL puntuales pueden vivir junto a su migración en
supabase/verificaciones. Los informes cerrados se consultan con git log y git
show; no vuelven a la rama principal como una segunda cola de producto.
