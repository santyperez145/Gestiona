# Índice de documentación

**Estado:** canónico. **Corte:** 2026-09-04.

Este índice enumera todos los documentos vigentes. ROADMAP describe presente y
futuro; Git conserva auditorías, evidencia e incidentes cerrados.

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
- [Economics](ECONOMICS.md): monetización y métricas.
- [Inversores](INVERSORES.md): tesis y narrativa.
- [Activación y cohortes](ACTIVACION_COHORTES.md): adopción y medición.
- [Business Profiler](BUSINESS_PROFILER.md): personalización por comercio.
- [Margen](MARGIN_FACTS.md): hechos, confianza y acciones.

## Decisiones

- [ADR 001 — Finance](ADR_001_FINANCE_PRODUCT_SURFACE.md)
- [ADR 002 — Commerce OS](ADR_002_COMMERCE_OPERATING_SYSTEM.md)
- [ADR 003 — Identidad y dominio](ADR_003_NERQIA_IDENTIDAD_Y_DOMINIO.md)

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
- [Pagos](PAGOS.md): checkout, webhook, conciliación y refunds.
- [Mercado Libre](MERCADOLIBRE.md): canal y sincronización.
- [Google OAuth](GOOGLE_OAUTH_SETUP.md): configuración de acceso.

## Calidad, soporte y recuperación

- [E2E](E2E.md): ejecución de Playwright.
- [Permisos](permisos.md): roles, tenants y superficies.
- [Seguridad](SEGURIDAD.md): amenazas, RLS, RPC, fraude e incidentes.
- [Legal](LEGAL.md): normativa argentina y datos pendientes del comercio.
- [Soporte diagnóstico](SOPORTE_DIAGNOSTICO.md): triage y operación.
- [Restore](RESTORE.md): recuperación y drills.

## Política documental

Un documento activo:

1. tiene un propósito que no se superpone;
2. declara estado o fecha cuando puede envejecer;
3. enlaza su autoridad y fuentes;
4. se actualiza en el mismo slice que cambia el comportamiento;
5. evita diarios de sesión, capturas repetidas y listas ya cerradas.

Las verificaciones SQL puntuales pueden vivir junto a su migración en
supabase/verificaciones. Los informes cerrados se consultan con git log y git
show; no vuelven a la rama principal como una segunda cola de producto.
