# GESTIONA — Auditoría integral de plataforma y roadmap competitivo

**Repositorio:** `santyperez145/exentryimports`  
**Rama analizada:** `main`  
**Corte:** 24 de agosto de 2026  
**Último commit observado:** `96b0bb40615cb89d19f5f8b49cfee93a585c1af7`  
**Objetivo:** transformar Gestiona en una plataforma capaz de competir con Tiendanube, Empretienda, TiendaNegocio, Shopify, Mendel, ERPs locales y plataformas de pagos, sin destruir la base ya construida.

---

## 1. Dictamen ejecutivo

Gestiona ya no es una tienda online con funciones administrativas. El repositorio contiene una plataforma de alcance amplio:

- ERP y gestión operativa.
- POS.
- Inventario auditable.
- Compras y proveedores.
- Ventas, clientes y CRM.
- Finanzas y facturación.
- Commerce propio.
- Checkout y orquestación de pagos.
- Mercado Libre, Tiendanube y WhatsApp.
- Control Plane de plataforma.
- Gestiona Finance con procesamiento documental.
- Automatizaciones e inteligencia artificial.
- Fundamentos de idempotencia, eventos, outbox, RLS y ledgers.

La principal conclusión es contraintuitiva:

> **Gestiona no tiene un problema de escasez de funciones. Tiene un problema de evidencia, foco, activación y madurez de plataforma.**

La ingeniería está muy por delante de la tracción comercial. Según la medición mantenida dentro del propio proyecto, la base llegó a cientos de tablas, funciones, políticas y migraciones, 65 Edge Functions y 1.498 tests; sin embargo, la evidencia comercial sigue concentrada en un comercio real, pocos pedidos, pagos de prueba mínimos, cero facturas de producción y adopción externa todavía insuficiente.

Esto crea dos riesgos:

1. Continuar agregando módulos y aumentar el costo de mantenimiento sin probar valor.
2. Presentar capacidades técnicamente construidas como productos comercialmente maduros.

La estrategia recomendada no es achicar la visión. Es imponer gates:

```text
CONSTRUIDO
→ PROBADO
→ OPERADO
→ USADO POR UN TERCERO
→ RETENIDO
→ MONETIZADO
→ ESCALADO
```

### Tesis recomendada

> **Gestiona es la infraestructura para crear, operar, vender, cobrar, controlar y hacer crecer un negocio desde una única fuente de verdad.**

La ventaja no debe formularse como “tenemos más módulos”, sino como:

```text
Business Core
+ Commerce nativo
+ Finance nativo
+ pagos y logística
+ margen real
+ acciones automatizadas
```

---

## 2. Estado real de la plataforma

### 2.1 Evaluación de madurez

Las siguientes calificaciones son estimaciones consultivas, no métricas oficiales.

| Dimensión | Madurez estimada | Diagnóstico |
|---|---:|---|
| Fundamentos arquitectónicos | 8/10 | Muy buenos para la escala actual |
| Multi-tenancy y RLS | 8/10 | Avanzado; debe reforzarse autorización por acción |
| ERP operativo | 7/10 | Amplio; validación externa insuficiente |
| POS e inventario | 7/10 | Buen diseño; falta evidencia física y multiempresa |
| Commerce | 5/10 | Funcional; faltan piezas de plataforma |
| Finance técnico | 5/10 | Pipeline sólido; faltan documentos y operación reales |
| Finance adoptado | 1/10 | Sin evidencia comercial suficiente |
| Pagos | 4/10 | Buena mecánica interna; poca certificación externa |
| ARCA/fiscal | 4/10 | Homologación y guardas; falta primer CAE productivo |
| Control Plane | 6/10 | Base profesional en evolución |
| Inteligencia diferencial | 3/10 | Falta impacto verificado |
| Developer Platform | 1/10 | API prototipo, no ecosistema |
| Observabilidad/SRE | 3/10 | Insuficiente para prometer alta disponibilidad |
| Tracción comercial | 1/10 | Principal riesgo empresarial |

### 2.2 Lo que ya está construido y conviene preservar

#### Plataforma y seguridad

- Multiempresa mediante `org_id`.
- RLS para aislamiento.
- Autenticación Supabase.
- Roles y permisos.
- Auditoría.
- Rate limiting.
- PWA.
- Sentry.
- CI con lint, typecheck, build, unit tests, Edge Functions y E2E.
- Exportación de datos.
- Control Plane privado.

#### Operación

- Productos, variantes y categorías.
- Product types y atributos.
- Inventario mediante movimientos/Kardex.
- Multiubicación.
- Compras y recepciones.
- Órdenes de compra.
- Proveedores.
- POS y caja.
- Ventas.
- Presupuestos.
- Clientes.
- CRM.
- Cuentas corrientes.
- Gastos, deudas y reportes.
- Facturación y ARCA en homologación.

#### Commerce

- Storefront.
- Catálogo.
- Variantes.
- Promociones.
- Wishlist.
- Reseñas y preguntas.
- Carrito/checkout.
- Recuperación de carritos.
- Pagos Mercado Pago.
- Stripe.
- Envíos cotizados.
- RMA/reintegros.
- CMS y configuración visual inicial.
- Mercado Libre.
- Tiendanube.

#### Fundamentos transaccionales

- Servidor como autoridad de precio, stock, promociones, envío y comisión.
- Idempotencia.
- Transactional outbox.
- Eventos de dominio.
- Ledger financiero de doble partida.
- Inventario por ledger.
- Correlation IDs.
- Reconciliación de pagos.
- Guardas para webhooks duplicados y timeouts ambiguos.

#### Finance

- Superficie separada.
- Sesión y organizaciones compartidas.
- Entitlements y permisos.
- Document Inbox.
- Bucket privado.
- Versiones, hash, MIME y tamaño.
- Inspección estructural.
- Scanner externo fail-closed.
- Extracción estructurada con confianza por campo.
- Detección de duplicados.
- Matching de proveedores y productos.
- Memoria de alias.
- Borradores de compra y obligación.
- Aprobación antes de impactar Core.
- Auditoría.

#### Platform

- Overview.
- Merchant 360.
- Registro de integraciones.
- Evidencia de conexión/runtime.
- Cola de operaciones.
- Feature flag para checkout.
- Acciones administrativas auditadas.
- Separación entre configuración y evidencia operativa.

### 2.3 Construido no significa validado

| Capacidad | Construida | Validada externamente | Riesgo |
|---|---|---|---|
| ARCA | Sí, homologación | No producción | Alto |
| Payment orchestration | Sí | Volumen mínimo | Alto |
| Refund/RMA | Sí | Matriz real incompleta | Alto |
| Ledger financiero | Sí | Sin volumen operativo | Alto |
| Finance Document AI | Sí | Sin corpus real aprobado | Alto |
| Business Profiler | Parcial | No universal | Alto |
| Storefront | Sí | No comparable aún con líderes | Alto |
| Merchant 360 | Sí | Poco uso de soporte real | Medio |
| Integration Registry | Sí | Health activo incompleto | Medio |
| POS offline | Sí | Sin varias empresas | Medio |
| IA comercial | Sí | Impacto no medido | Medio |
| API pública | Prototipo | No developer ecosystem | Alto |

---

## 3. Hallazgos críticos del repositorio

### 3.1 Sobreconstrucción frente a tracción

La plataforma tiene una base técnica muy grande para una operación comercial todavía mínima. Esto es valioso como activo, pero peligroso como dinámica:

- Más código.
- Más migraciones.
- Más estados.
- Más soporte.
- Más superficies.
- Más probabilidad de inconsistencia.
- Poco feedback de usuarios externos.

**Orden:** no abrir un nuevo macrodominio sin cerrar una evidencia de uso real.

### 3.2 Documentación desactualizada

El README describe una topología anterior y una cantidad vieja de Edge Functions. También mantiene instrucciones de migración contradictorias.

**Riesgo:** un developer nuevo, auditor o inversor recibe una imagen incorrecta.

**Orden:**

- Definir `README.md` como entrada.
- `ROADMAP.md` como estado.
- `docs/ARQUITECTURA.md` como invariantes.
- `docs/COMPARACION.md` como evidencia.
- Un solo procedimiento de migración.
- CI que detecte divergencia de conteos y comandos.

### 3.3 Onboarding todavía no universal

Aunque existe infraestructura de perfiles, el onboarding sigue partiendo de `perfumes` y perfiles de producto limitados.

No cubre correctamente:

- Servicios.
- Turnos.
- Proyectos.
- Fabricación.
- Alquileres.
- Suscripciones.
- Gastronomía.
- Operaciones híbridas.

**Orden:** reemplazar rubros hardcodeados por arquetipos operativos y capabilities.

### 3.4 No existe todavía un kernel de capabilities completo

Actualmente existe:

- Mapeo estático de rutas.
- Permisos por módulo.
- Product entitlement de Finance.
- Flags puntuales.

Falta:

- `capability_catalog`.
- Dependencias.
- Activación por organización.
- Blueprint.
- Provisionamiento.
- Milestones.
- Desactivación segura.
- Resolución común entre UI, backend y jobs.

### 3.5 Autorización de UI no equivale a autorización de negocio

`ModuleGuard` es explícitamente una barrera visual. RLS evita cruces entre tenants, pero no necesariamente impide que un usuario interno ejecute una acción para la cual no tiene autorización funcional.

**Orden:** las acciones sensibles deben pasar por comandos/RPC/Edge Functions que validen:

- tenant;
- usuario;
- rol;
- permiso;
- capability;
- estado;
- política;
- segregación de funciones.

### 3.6 Una sola SPA concentra demasiado

Business, Finance, Platform y Storefront viven en un gran router y deployment.

Problemas:

- Bundle alto.
- Radio de fallo amplio.
- SLOs mezclados.
- Checkout y admin comparten ciclo de release.
- Complica edge rendering y caching.
- Dificulta ownership futuro.

**Orden de separación física:**

1. Storefront.
2. Platform.
3. Finance.
4. Workers críticos cuando exista presión.

No reescribir el Core.

### 3.7 Public API es un prototipo, no una Developer Platform

La función existente demuestra intención, pero tiene límites:

- Una API key cruda por organización.
- Comparación directa en base.
- Sin hash.
- Sin scopes.
- Sin app identity.
- Sin OAuth.
- Sin instalaciones.
- Sin idempotencia completa.
- CORS abierto.
- Sin OpenAPI.
- Sin SDK.
- Sin portal.
- Sin webhooks salientes contractuales.

**Orden:** no promocionarla como plataforma abierta hasta endurecerla.

### 3.8 El modelo de pagos todavía no tiene economics aprobados

La comisión histórica de prueba y la propuesta actual no constituyen pricing validado.

Faltan:

- Contrato upstream.
- Costo real.
- Tasa de aprobación.
- Reintentos.
- Fraude.
- Reembolsos.
- IVA/impuestos.
- Soporte.
- Conciliación.
- Margen bruto.

**Orden:** una comisión se activa sólo si Finance aprueba un modelo económico versionado.

### 3.9 Finance está bien diseñado, pero bloqueado externamente

El código es prudente:

- falla cerrado si no hay scanner;
- falla cerrado si no hay aprobación de proveedor/modelo;
- revalida hash;
- usa salida estructurada;
- mantiene revisión humana.

Faltan:

- Scanner privado real.
- DPA/privacidad.
- Política de retención.
- Modelo aprobado.
- Corpus de facturas reales.
- Evaluaciones por tipo de documento.
- Medición de precisión.
- Email/WhatsApp productivos.

### 3.10 Deuda de toolchain

- Múltiples lock files.
- Dependencia `xlsx` con auditoría conocida.
- Gran cantidad de warnings históricos.
- Frontend y Edge Functions con versiones de Supabase no completamente uniformes.

**Orden:**

- Elegir npm inicialmente.
- Eliminar lockfiles alternativos.
- Planificar reemplazo de `xlsx`.
- Reducir warnings por presupuesto.
- Centralizar versiones serverless.

---

## 4. Comparación competitiva

## 4.1 Matriz ejecutiva

Leyenda:

- **Fuerte:** capacidad madura o diferenciada.
- **Parcial:** existe, pero falta profundidad o validación.
- **Falta:** no disponible o insuficiente.
- **No es core:** la empresa compite desde otro modelo.

| Dimensión | Gestiona | Tiendanube | Empretienda | TiendaNegocio | Shopify | Mendel |
|---|---|---|---|---|---|---|
| ERP operativo | Fuerte técnico | Integraciones | Básico | Gestión comercial | Parcial/partners | No es core |
| Tienda online | Parcial | Fuerte | Fuerte simple | Fuerte simple | Excelente | No |
| Personalización | Parcial | Fuerte | Media | Media | Excelente | No |
| Dominio/SSL | Falta | Fuerte | Sí | Sí | Sí | No aplica |
| Checkout | Parcial | Fuerte | Funcional | Funcional | Excelente | No aplica |
| Pagos propios | Orquestación | Pago Nube | Terceros | Terceros | Shopify Payments | Tarjetas/pagos |
| Logística propia | Inicial | Envío Nube | Terceros | Terceros | Fuerte | No aplica |
| POS | Fuerte técnico | Sí | No core | No core | Fuerte | No |
| Inventario/ledger | Fuerte | Stock commerce | Básico | Básico | Fuerte commerce | No |
| Compras/proveedores | Fuerte | ERP externo | Bajo | Bajo | Apps/ERP | Gastos/proveedores |
| Facturación argentina | Parcial | Externa | Externa | Externa | Apps | Integración ERP |
| CRM | Fuerte técnico | Apps/marketing | Básico | Básico | Fuerte ecosistema | No |
| B2B | Parcial | Limitado | Mayorista simple | Mayorista | Fuerte | Enterprise finance |
| Finance documental | Parcial avanzado | No core | No | No | Apps | Excelente |
| Aprobaciones/policies | Parcial | No core | No | No | Apps/enterprise | Fuerte |
| IA operacional | Parcial | Chat/marketing | Baja | Baja | Muy fuerte | Muy fuerte |
| API/ecosistema | Prototipo | 350+ apps | Cerrado/simple | App store | Excelente | Integraciones enterprise |
| Multi-market | Falta | Parcial | Bajo | Bajo | Excelente | Regional enterprise |
| Margen real cross-channel | Potencial fuerte | Limitado | Bajo | Bajo | Apps | Gasto, no commerce |
| Onboarding simple | Parcial | Fuerte | Muy fuerte | Fuerte | Fuerte | Consultivo |
| Tracción | Muy baja | Muy alta | Alta creación | Media | Global | Enterprise |
| Modelo gratuito | Diseñado | Plan inicial | No | No | No | Enterprise |
| Potencial de unificación | Muy alto | Commerce-first | Commerce simple | Commerce simple | Commerce-first | Finance-first |

---

## 4.2 Gestiona frente a Tiendanube

### Donde Gestiona puede ganar

- ERP nativo.
- Compra, costo, stock, venta y cobro en un mismo Core.
- ARCA nativo.
- Margen de contribución por canal.
- POS e inventario auditables.
- Finance documental.
- Neutralidad frente a Mercado Libre y otros canales.
- Automatizaciones operativas, no sólo comerciales.
- Software base gratuito.

### Donde Tiendanube gana hoy

- Onboarding probado.
- Dominio propio.
- Storefront maduro.
- Más de 60 diseños.
- Editor modular.
- Checkout acelerado.
- Identidad de comprador Nube.
- Pago Nube.
- Envío Nube.
- Marketing Nube.
- Chat Nube.
- Más de 350 apps.
- Ecosistema de partners.
- Merchant adoption.
- Migración asistida enterprise.
- Marca y confianza.

### Gap para competir

```text
Store entity
+ domains
+ storefront separado
+ theme/page builder
+ checkout medido
+ migrador
+ payments economics
+ shipping
+ onboarding repetible
+ merchants activos
```

### Diferencial que Tiendanube no resuelve nativamente

> “Vendiste más en Mercado Libre, pero ganaste menos después de comisión, envío, financiación e impuestos.”

Ese insight debe convertirse en acción dentro de Gestiona.

---

## 4.3 Gestiona frente a Empretienda

Empretienda compite por:

- Sencillez.
- Precio único.
- Sin comisión.
- Dominio.
- Stock.
- Diseño.
- Promociones.
- Atención humana.
- Administración móvil.

### Gestiona gana en

- Profundidad operativa.
- ERP.
- POS.
- Compras.
- Finanzas.
- CRM.
- ARCA.
- Multiubicación.
- Integraciones.
- IA.
- Finance.

### Empretienda gana en

- Activación.
- Mensaje simple.
- Menor curva.
- Oferta comercial clara.
- Producto enfocado.

### Riesgo

Gestiona puede tener diez veces más capacidad y convertir peor por complejidad.

**Respuesta:** progressive disclosure y blueprint automático.

---

## 4.4 Gestiona frente a TiendaNegocio

TiendaNegocio ofrece:

- Retail.
- Mayorista.
- Servicios.
- Digitales.
- WhatsApp.
- Dominio/SSL.
- Migración.
- App store.
- Sin comisión.
- Precio claro.

Gestiona puede superarla en profundidad, pero debe igualar:

- migración;
- dominio;
- publicación;
- simplicidad;
- diseño;
- estabilidad.

No conviene subestimar competidores simples: para una PyME, menor esfuerzo suele valer más que arquitectura profunda.

---

## 4.5 Gestiona frente a Shopify

Shopify es la referencia de plataforma.

### Shopify domina

- Checkout.
- Themes.
- Storefront APIs.
- Headless.
- B2B.
- Markets.
- POS.
- Payments.
- Shipping.
- Functions.
- Checkout Extensions.
- App Store.
- Developer Platform.
- OAuth.
- Sandboxes.
- Observabilidad de apps.
- Ecosistema global.
- Sidekick.
- Agentic Commerce.
- Universal Commerce Protocol.

### Gestiona no debe perseguir paridad general inmediata

La estrategia debe ser:

```text
Argentina/LatAm wedge
+ ERP profundo
+ Finance nativo
+ ARCA
+ margen por canal
+ WhatsApp
+ menor TCO
```

### Orden de inversión para acercarse

1. Storefront/API boundaries.
2. Domains.
3. B2B.
4. Theme/Page Builder.
5. Public API.
6. Webhooks.
7. OAuth apps.
8. Functions/Rules runtime.
9. Developer Portal.
10. Marketplace.

---

## 4.6 Gestiona frente a Mendel

### Mendel domina

- Spend management.
- Tarjetas.
- Presupuestos.
- Policies.
- Aprobaciones.
- Expense reports.
- Comprobantes por WhatsApp/email/app.
- Recupero de factura.
- Auditoría.
- Conciliación.
- ERP/HCM/card feed integrations.
- Venta enterprise.

### Gestiona ya tiene una base útil

- Document Inbox.
- Custodia privada.
- Inspección.
- Extracción.
- Confidence.
- Matching.
- Alias.
- Duplicados.
- Compra/deuda bajo aprobación.
- Core compartido.

### Ventaja potencial de Gestiona

Mendel debe enviar el resultado a un ERP.

Gestiona puede ejecutar:

```text
documento
→ compra
→ recepción
→ producto
→ costo
→ deuda
→ cash flow
→ margen
```

sin sincronización entre proveedores.

### Para competir realmente faltan

- Inbound email.
- WhatsApp productivo.
- Expense transactions.
- Budgets.
- Policies.
- Multi-step approval.
- Corporate card feeds.
- Bank feeds.
- Reconciliation.
- Three-way matching.
- Audit Agent.
- Supplier Portal.
- Finance standalone connectors.
- SLAs, seguridad y venta enterprise.

---

## 4.7 Gestiona frente a Mercado Libre

Mercado Libre no es un SaaS de tienda: es demanda, reputación, pagos, ads, logística y fulfillment.

No intentar reemplazarlo.

Gestiona debe ser:

```text
sistema neutral de operación multicanal
```

Funciones prioritarias:

- Publicaciones.
- Preguntas.
- Pedidos.
- Stock.
- Precios.
- Fees.
- Envíos.
- Reputación.
- Ads.
- Rentabilidad.
- Recomendación de canal.

---

## 4.8 Gestiona frente a Contabilium y Xubio

Estos competidores prueban que:

- Facturación.
- Stock.
- Compras.
- Tesorería.
- Contabilidad.
- POS.
- Mercado Libre.
- Tiendanube.

ya son paridad del ERP argentino.

Gestiona no gana por tenerlas.

Gana si demuestra:

- Commerce nativo de mejor calidad.
- Menor integración.
- Activación más simple.
- Margen explicable.
- Finance documental.
- Action Loop.
- Modelo gratuito sostenible.

---

## 5. Posicionamiento recomendado

### Categoría

**Adaptive Business & Commerce OS para PyMEs latinoamericanas.**

### Propuesta

> Gestiona unifica operación, commerce, finanzas y pagos, entiende cómo funciona cada negocio y convierte datos en acciones con impacto medible.

### Wedge inicial recomendado

Arquitectura universal, go-to-market específico:

> **Comercios argentinos con inventario, venta física + online, uno o más canales y baja visibilidad del margen.**

Ejemplos:

- Ferreterías.
- Repuestos.
- Distribución.
- Indumentaria.
- Perfumerías.
- Pinturerías.
- Electricidad.
- Hogar.
- Comercios industriales.

Luego:

- Servicios.
- Fabricación liviana.
- B2B.
- Finance-only enterprise.

---

## 6. Arquitectura objetivo

### 6.1 Principio

> Diseñar límites de escala hoy; mantener ejecución simple hasta que la evidencia justifique extraer servicios.

### 6.2 Mantener

- PostgreSQL.
- Supabase Auth.
- Supabase Storage.
- RLS.
- Edge Functions.
- Monolito modular.
- Outbox.
- Eventos.
- Ledgers.
- Vite/React donde sea adecuado.

### 6.3 Estructura objetivo

```text
apps/
├── business/
├── storefront/
├── finance/
├── platform/
└── auth/                  # opcional cuando se separen subdominios

packages/
├── core-contracts/
├── domain-events/
├── capabilities/
├── auth/
├── permissions/
├── ui/
├── integrations/
├── observability/
├── ai-gateway/
├── database-types/
└── testing/

supabase/
├── functions/
├── migrations/
├── verifications/
└── seeds/
```

### 6.4 Orden de separación

#### Primero: Storefront

- Deployment independiente.
- CDN/edge.
- Bundle menor.
- SLO propio.
- Cache agresiva.
- Checkout aislado del admin.

#### Segundo: Platform

- Mayor aislamiento.
- Permisos superadmin.
- Ciclo de release interno.
- Herramientas de incidentes.

#### Tercero: Finance

- Necesidad de seguridad.
- Procesamiento documental.
- Jobs y costos de IA.
- Venta standalone.

#### Después: servicios específicos

Sólo cuando existan carga o SLO:

- Webhook ingress.
- Payments.
- Document processing.
- Search indexing.
- Notifications.
- AI Gateway.

### 6.5 Lo que no debe hacerse

- Microservicios por moda.
- Kubernetes.
- Kafka.
- Event sourcing total.
- Sharding temprano.
- Multi-region activo-activo.
- Reescritura del Core.
- Otra base de usuarios para Finance.

---

## 7. Capability & Provisioning Engine

### 7.1 Entidades

```text
business_archetypes
business_profiles
business_profile_answers

capability_catalog
capability_dependencies
capability_conflicts

organization_blueprints
organization_capabilities
organization_capability_settings
provisioning_runs
provisioning_steps

product_access
role_assignments
permission_grants
feature_flags
```

### 7.2 Arquetipos

- Retail.
- Wholesale/distribution.
- E-commerce.
- Services.
- Appointments.
- Projects/professional.
- Manufacturing.
- Rentals.
- Subscriptions.
- Gastronomy.
- Hybrid.

### 7.3 Manifest

```ts
interface CapabilityManifest {
  key: string;
  version: string;
  problemSolved: string;
  supportedArchetypes: string[];
  supportedCountries: string[];
  requires: string[];
  recommends: string[];
  conflictsWith: string[];
  permissions: string[];
  emitsEvents: string[];
  consumesEvents: string[];
  defaultWorkflows: string[];
  kpis: string[];
  activationMilestone: string;
  deactivationPolicy: "read_only" | "safe_disable" | "requires_cleanup";
}
```

### 7.4 Resolución

```text
capability existe
AND país soportado
AND organización la activó
AND dependencias listas
AND rollout habilitado
AND usuario autorizado
```

### 7.5 Onboarding universal

```text
Descripción libre
→ interpretación IA
→ perfil estructurado
→ preguntas faltantes
→ reglas determinísticas
→ blueprint
→ revisión humana
→ provisioning idempotente
→ primer milestone
```

La IA interpreta. El Rules Engine decide.

---

## 8. Commerce roadmap técnico

### 8.1 Store first-class

```text
organizations
brands
stores
markets
catalogs
price_lists
channels
domains
```

### 8.2 Server-side Cart

```text
carts
cart_items
cart_adjustments
cart_buyer
cart_delivery_groups
cart_sessions
cart_reservations
```

### 8.3 State machines

Separar:

- Order.
- Payment.
- Fulfillment.
- Return.
- Refund.

### 8.4 Domain Service

- Verificación DNS.
- SSL.
- Canonical.
- Redirects.
- Health.
- Takeover prevention.
- Provider abstraction.

### 8.5 Theme Engine

```text
manifest
layouts
templates
sections
blocks
settings
assets
translations
versions
```

### 8.6 Page Builder

- Draft.
- Preview.
- Publish.
- Schedule.
- Rollback.
- Mobile/desktop.
- Tokens.
- Sin JS arbitrario en checkout.

### 8.7 Search

Crear `SearchProvider`.

Evaluar:

- PostgreSQL FTS al inicio.
- Typesense.
- Meilisearch.
- OpenSearch.

No elegir sin benchmark de:

- tamaño;
- facetas;
- latencia;
- typo tolerance;
- idiomas;
- costo;
- operación.

### 8.8 B2B

- Company accounts.
- Buyers.
- Catálogos.
- Price lists.
- Volume rules.
- Payment terms.
- Credit.
- Purchase orders.
- Approvals.
- Portal.

### 8.9 Migration Platform

- Tiendanube.
- Empretienda.
- TiendaNegocio.
- Shopify.
- WooCommerce.
- CSV.
- AnswerSoft.
- ERP legado.

Mantener staging, preview y reconciliación.

---

## 9. Finance roadmap técnico

### 9.1 Corpus y evaluación

Antes de abrir IA:

- Conjunto representativo.
- Facturas A/B/C.
- PDFs digitales.
- Escaneos.
- Fotos.
- Tickets.
- Notas de crédito.
- Multipágina.
- Diversas tasas de IVA.
- Ítems largos.
- Diferentes proveedores.

Métricas:

- Exactitud por campo.
- Exactitud de ítems.
- Exactitud matemática.
- Match de proveedor.
- Match de producto.
- Falso duplicado.
- Tiempo.
- Costo.
- Human correction rate.

### 9.2 Provider abstraction

```ts
interface DocumentExtractionProvider {
  extract(input: DocumentInput): Promise<StructuredDocument>;
}
```

Probar:

- Anthropic actual.
- OpenAI.
- OCR/document intelligence especializado si hace falta.

### 9.3 Pipeline

```text
Upload
→ quarantine
→ scan
→ hash
→ classify
→ extract
→ validate
→ match
→ review
→ approve
→ command
→ outcome
```

### 9.4 Próximas capacidades

- Email inbound.
- WhatsApp inbound.
- AP Calendar.
- Three-way matching.
- Expense policies.
- Approval Engine.
- Reconciliation.
- Audit Agent.
- Supplier Portal.
- Card feed.
- Bank feed.
- Finance Connect.

---

## 10. Estrategia de IA

### 10.1 Prioridades

#### 1. Document-to-ERP

La primera apuesta correcta.

#### 2. Margin Intelligence

```text
producto
+ costo
+ canal
+ comisión
+ pago
+ envío
+ promoción
+ impuesto
= contribución
```

#### 3. Simulation Engine

- Cambiar precio.
- Dar descuento.
- Ofrecer cuotas.
- Comprar stock.
- Subir envío gratis.
- Cambiar canal.

#### 4. Purchasing Agent

- Demanda.
- Stock.
- Lead time.
- MOQ.
- Caja.
- Margen.
- Riesgo.

#### 5. Commerce CRO Agent

- Funnel.
- Checkout.
- Envío.
- Search.
- PDP.
- Mobile.
- Experimentos.

#### 6. Store Architect

Generar configuración real:

- Theme.
- Sections.
- Menus.
- Collections.
- Content.
- SEO.

#### 7. Platform Ops Copilot

- Incidentes.
- Correlación.
- Root cause.
- Runbooks.
- Replays seguros.

### 10.2 Arquitectura

```text
AI Gateway
├── Provider routing
├── Model registry
├── Prompt versions
├── Structured outputs
├── Tool permissions
├── Cost controls
├── Timeouts
├── Fallbacks
├── Redaction
├── Evaluations
└── Telemetry
```

### 10.3 Regla de seguridad

Nunca:

```text
LLM → SQL libre
LLM → stock
LLM → pago
LLM → factura
LLM → precio
```

Siempre:

```text
LLM
→ propuesta estructurada
→ validación determinística
→ política
→ aprobación
→ comando idempotente
→ auditoría
```

### 10.4 Action Loop

```text
Finding
→ Recommendation
→ Draft Action
→ Approval
→ Execution
→ Outcome
→ Verified Impact
```

Ésta debe ser la diferenciación.

---

## 11. Tecnología en la que invertir

## 11.1 Inversión inmediata

### Observabilidad

- OpenTelemetry server-side.
- Correlation IDs.
- Traces.
- Metrics.
- Error budgets.
- SLOs.
- Sentry como error tracking.

Priorizar:

- checkout;
- payments;
- webhooks;
- ARCA;
- Finance extraction;
- queues;
- Mercado Libre.

### Queues

Usar Supabase Queues/PGMQ para:

- webhooks;
- documents;
- AI;
- notifications;
- search;
- analytics;
- reconciliation.

Con:

- retry;
- backoff;
- visibility timeout;
- DLQ;
- replay;
- metrics.

### Staging y DR

- Proyecto staging.
- Datos sintéticos.
- Migrations from zero.
- Restore drill.
- RPO/RTO.
- Runbooks.

### Toolchain

- npm como única autoridad inicial.
- Workspaces.
- Turborepo cuando las apps se separen.
- Eliminar lockfiles alternativos.
- Reemplazar `xlsx` o aislarlo en worker.
- Versiones coherentes de Supabase.

### Storefront

- Deployment separado.
- CDN/edge.
- Image pipeline.
- AVIF/WebP.
- Caching.
- Core Web Vitals.

### Security

- Secret Manager/Vault.
- API keys hasheadas.
- Key prefixes.
- Rotation.
- Scopes.
- Audit.
- MFA superadmin.
- Support sessions.

### AI

- AI Gateway.
- Eval harness.
- Dataset versionado.
- pgvector.
- Alias cache.
- Cost attribution.

## 11.2 Inversión posterior

- Search provider dedicado.
- Data warehouse/ClickHouse/BigQuery sólo cuando OLTP sufra.
- OAuth app platform.
- Developer Portal.
- Segundo provider de pago.
- Carrier abstraction.
- Feature flags porcentuales/canary.

## 11.3 No invertir todavía

- Kubernetes.
- Kafka.
- Sharding.
- Multi-region activo-activo.
- Modelo de IA propio.
- Emisión propia de tarjeta.
- PSP propio.
- App Marketplace.
- 100 themes.
- Expansión regional operativa.
- SOC 2 antes del segmento enterprise, aunque sí preparar controles.

---

## 12. Escalabilidad por etapa

### 1–20 merchants activos

- Shared Postgres.
- RLS.
- Modular monolith.
- Storefront separado.
- PGMQ.
- OpenTelemetry.
- Staging.
- Restore.
- Un único auth.

### 20–500

- Workers independientes.
- Search dedicado.
- Warehouse analítico.
- API Gateway.
- Contratos.
- Rate limits por tenant.
- Better support tooling.

### 500–5.000

Extraer sólo si hay evidencia:

- Payments.
- Webhook ingress.
- Document processing.
- Search indexing.
- Notifications.

Agregar:

- read replicas;
- partitioning;
- Redis donde exista medición.

### 5.000+

- Tenant routing.
- Sharding por organización si es necesario.
- Dedicated tenancy enterprise.
- Regional deployments.
- Data residency.
- Multi-region según mercado/SLO.

---

## 13. Roadmap por fases

## Fase 0 — Verdad operacional

**Horizonte:** 0–45 días.

### Objetivo

Demostrar el circuito crítico real.

### Epics

- Primer CAE de producción.
- Legales publicados.
- Stock físico conciliado.
- Matriz real de pagos.
- Refund real.
- Webhook firmado.
- Timeout/reconsulta.
- Staging.
- Restore drill.
- OpenTelemetry base.
- E2E bloqueante.
- README/migraciones.
- Economics.
- Segundo comercio.

### Exit gate

```text
venta
→ pago
→ stock
→ factura
→ ledger
→ margen
→ devolución
```

funciona y es recuperable.

---

## Fase 1 — Activación universal

**Horizonte:** 30–90 días.

### Epics

- Capability catalog.
- Arquetipos.
- Business Profiler.
- Blueprint.
- Provisioning.
- Remover default perfumes.
- Import CSV/Excel.
- Import AnswerSoft.
- Product access.
- Server authorization.
- Merchant setup checklist.
- Support session.
- 3–5 merchants externos.

### Exit gate

Un comercio no técnico configura, importa y vende sin SQL ni intervención del fundador sobre base.

---

## Fase 2 — Commerce migrable

**Horizonte:** 60–150 días.

### Epics

- Storefront split.
- Store entity.
- Server-side Cart.
- State machines.
- Domains/SSL.
- SEO.
- Theme minimum.
- Page sections.
- Funnel.
- Migrator.
- Performance budget.

### Exit gate

Una tienda externa migra y procesa órdenes reales conservando catálogo, clientes, SEO y operación crítica.

---

## Fase 3 — Margin Intelligence & Action Loop

**Horizonte:** 90–180 días.

### Epics

- Cost facts.
- Contribution margin.
- Channel margin.
- Pricing proposals.
- Business findings.
- Recommendations.
- Approval.
- Outcome.
- Simulator.
- Verified Impact.

### Exit gate

Al menos un merchant cambia una decisión y Gestiona mide el efecto.

---

## Fase 4 — Finance real

**Horizonte:** 90–210 días, paralelo limitado.

### Epics

- Scanner.
- DPA/privacidad.
- Modelo.
- Benchmark.
- Email.
- WhatsApp.
- AP.
- Three-way match.
- Policies.
- Approvals.
- Reconciliation.
- Audit Agent.
- Supplier Portal.
- Finance Connect.

### Exit gate

La mayoría de documentos del piloto se procesa sin corrección o sólo mediante cola de excepciones.

---

## Fase 5 — Commerce diferencial

**Horizonte:** 6–12 meses.

### Epics

- Multi-store.
- Multi-brand.
- Markets.
- B2B.
- Subscriptions.
- Search.
- Recommendations.
- Personalization.
- Experiments.
- Store Builder AI.
- Channel Intelligence.

### Exit gate

Existen razones objetivas para elegir Gestiona aunque costara igual que el líder.

---

## Fase 6 — Pay & Ship

**Horizonte:** 9–18 meses.

### Epics

- Segundo provider.
- Reconciliation.
- Provider health.
- Routing.
- Risk.
- Settlement.
- Partner embedded payments.
- Shipping quotes.
- Labels.
- Tracking.
- Negotiated rates.
- Compliance program.

### Exit gate

Margen bruto positivo y conciliado por transacción/envío.

---

## Fase 7 — Developer ecosystem

**Horizonte:** 12–24 meses.

### Epics

- API v1.
- OAuth apps.
- Scopes.
- Signed webhooks.
- Replay.
- SDK.
- Sandbox.
- Portal.
- Theme tools.
- App marketplace sólo con demanda.

### Exit gate

Una app de tercero se instala en varias organizaciones sin acceso directo a base.

---

## Fase 8 — Enterprise y región

- Country packs.
- SSO/SAML.
- SCIM.
- Data residency.
- SOC 2.
- Dedicated tenancy.
- Multi-region.
- Capital.
- Infraestructura financiera más profunda.

---

## 14. Órdenes prioritarias para developers

Máximo tres epics activos simultáneamente.

| # | Orden | Criterio de aceptación |
|---:|---|---|
| 1 | Unificar documentación | README, roadmap y arquitectura sin contradicciones |
| 2 | ARCA productivo | Primer CAE real, QR y rollback documentado |
| 3 | Conteo físico | Kardex conciliado y diferencia explicada |
| 4 | Payments live matrix | Aprobado, rechazado, timeout, webhook, refund |
| 5 | Crear staging | Deploy reproducible con datos sintéticos |
| 6 | Restore drill | RTO/RPO medidos |
| 7 | OpenTelemetry base | Trace único checkout→payment→order→ledger |
| 8 | E2E como gate | CI bloquea regresiones críticas |
| 9 | Economics gate | Ninguna comisión activa sin aprobación |
| 10 | Segundo merchant | Primera venta sin SQL |
| 11 | Capability catalog | Tres capabilities piloto resueltas |
| 12 | Universal profiler | Sin default perfumes, arquetipos estructurados |
| 13 | Provisioning | Idempotente, auditado, reintentable |
| 14 | Server authorization | Acciones críticas verifican permisos |
| 15 | Storefront split | Build/deploy independiente |
| 16 | Store entity | Organización soporta varias stores |
| 17 | Server Cart | Carrito persistido y recalculado |
| 18 | State machines | Order/payment/fulfillment separados |
| 19 | Domains | DNS, SSL, canonical, health |
| 20 | Migration engine | Preview, apply y report |
| 21 | API v1 hardening | Keys hasheadas, scopes, idempotency, OpenAPI |
| 22 | Outgoing webhooks | Firma, retry, DLQ, replay |
| 23 | Margin Action Loop | Finding→action→outcome |
| 24 | AI Gateway | Proveedor/modelo/prompts/costos centralizados |
| 25 | Finance scanner | Documento limpio requerido |
| 26 | Finance benchmark | Accuracy/cost/latency medidos |
| 27 | Email/WhatsApp inbound | Documento entra sin upload manual |
| 28 | Three-way matching | PO/receipt/invoice con discrepancias |
| 29 | Reconciliation | Pagos y documentos conciliables |
| 30 | Provider health | Health activo, SLO, incidente |
| 31 | SearchProvider | Contrato + benchmark |
| 32 | B2B foundation | Companies/catalogs/terms |
| 33 | Developer OAuth | App install con scopes |
| 34 | Visual validation | Tareas reales en cuatro viewports |
| 35 | Replace XLSX risk | Auditoría sin dependencia vulnerable |

---

## 15. Métricas

### North Star

**Active Transacting Merchants**

Merchant que en una ventana definida realiza operación real, no sólo login.

### Activation

- Signup.
- Profiler.
- Import.
- POS/store ready.
- First order.
- First payment.
- First invoice.
- Time to first value.
- Founder interventions.

### Commerce

- Sessions.
- Search success.
- PDP→cart.
- Cart→checkout.
- Checkout completion.
- Payment approval.
- Stockouts.
- Refund rate.
- Contribution margin.

### Finance

- Documents.
- Field accuracy.
- Match rate.
- Straight-through processing.
- Exception rate.
- Duplicate rate.
- Time to posting.
- Approval time.
- AP aging.

### AI

- Findings.
- Recommendations.
- Views.
- Approvals.
- Executions.
- Reverts.
- Cost/action.
- Verified Impact.

### Platform

- Webhook success.
- Queue age.
- DLQ.
- Provider availability.
- Checkout error.
- Reconciliation lag.
- MTTR.

### Economics

- GMV.
- TPV.
- Payment penetration.
- Shipping penetration.
- Net take rate.
- Gross profit/merchant.
- Gross profit/order.
- Cost to serve.
- AI cost.
- Support cost.

---

## 16. Equipo e inversión

### Hasta cinco merchants reales

- 40% verdad operacional y activación.
- 25% Commerce foundation.
- 15% Finance real.
- 10% Platform/SRE.
- 10% payments/legal/economics.

### Equipo mínimo recomendado

- Founder/Product.
- Principal/lead backend.
- 2 frontend/product engineers.
- 2 backend/Postgres/integrations.
- 1 QA/SRE.
- 1 data/AI.
- Asesoría legal, fiscal y compliance.

### Con Codex y equipo reducido

Mantener simultáneamente:

1. Una foundation.
2. Un producto.
3. Una prueba externa.

Nunca cinco macroepics.

---

## 17. Gates internos de inversión

No son reglas universales de VC. Son objetivos operativos recomendados.

### Pre-seed readiness

- 10–20 active transacting merchants.
- Onboarding repetible.
- Cohorte de 90 días.
- Un servicio transaccional con economics positivos.
- 3–5 Finance pilots.
- ARCA productivo.
- Restore probado.
- Data room.
- IP ordenada.

### Seed readiness

- 100+ merchants activos.
- Retención por cohorte.
- Activación sin fundador.
- Canal de adquisición.
- Soporte repetible.
- Margen bruto.
- Payment/Finance/Ship contribution.
- Segundo vertical adyacente.

---

## 18. No-go list

- No reescribir.
- No microservicios prematuros.
- No más módulos genéricos sin evidencia.
- No marketplace sin usuarios.
- No IA sin acciones/resultados.
- No SQL libre para agentes.
- No writes de dinero/stock por LLM.
- No API keys del merchant cuando exista OAuth.
- No PSP propio antes de partner y compliance.
- No expansión regional antes de validar Argentina.
- No “universal” en marketing sin activación universal.
- No declarar validado lo que sólo tiene tests.
- No usar métricas técnicas como tracción.
- No habilitar comisión sin unit economics.
- No construir para millones antes de cerrar el segundo merchant.

---

## 19. Plan de 90 días

### Días 1–30

- ARCA.
- Legal.
- Stock.
- Payments live.
- README.
- Staging.
- Restore.
- OpenTelemetry.
- Segundo merchant recruitment.

### Días 31–60

- Universal Profiler.
- Capability kernel.
- Provisioning.
- Server authorization.
- Storefront split.
- Store entity.
- Finance scanner/model benchmark.

### Días 61–90

- Server Cart.
- Domains MVP.
- Migrator MVP.
- Margin Action Loop.
- Primer Finance pilot.
- Third merchant.
- Economics review.

### Resultado esperado

Gestiona deja de demostrar “mucho código” y empieza a demostrar:

- operación real;
- activación;
- migración;
- margen;
- automatización;
- retención;
- economics.

---

## 20. Conclusión

Gestiona tiene una base técnica inusualmente avanzada para su etapa. El activo más valioso no es la cantidad de módulos, sino la combinación de:

- Business Core.
- Commerce.
- Finance.
- Payments.
- Margin Intelligence.
- Action Loop.
- Localización argentina.

La amenaza principal no es que Tiendanube, Shopify o Mendel tengan más funciones. Es que tienen:

- mayor confianza;
- mejor onboarding;
- más usuarios;
- operación probada;
- ecosistema;
- economics conocidos.

La respuesta correcta es mantener la visión de infraestructura, pero ejecutar mediante gates verificables.

> **La próxima ventaja de Gestiona no saldrá de agregar una pantalla. Saldrá de demostrar que un negocio externo puede migrar, vender, facturar, cobrar, controlar documentos y mejorar margen sin intervención manual.**

---

## 21. Fuentes principales

### Repositorio

- `README.md`
- `ROADMAP.md`
- `DESIGNROADMAP.md`
- `docs/ARQUITECTURA.md`
- `docs/COMPARACION.md`
- `docs/ESTRATEGIA.md`
- `docs/ECONOMICS.md`
- `docs/BUSINESS_PROFILER.md`
- `docs/ADR_001_FINANCE_PRODUCT_SURFACE.md`
- `docs/PAGOS.md`
- `src/App.tsx`
- `src/pages/OnboardingPage.tsx`
- `src/components/auth/ModuleGuard.tsx`
- `src/lib/moduleMap.ts`
- `src/pages/PlatformIntegrationsPage.tsx`
- `supabase/functions/public-api/index.ts`
- `supabase/functions/extract-finance-document/index.ts`
- `supabase/functions/inspect-finance-document/index.ts`
- `.github/workflows/ci.yml`

### Competidores y tecnología

- https://www.tiendanube.com/funcionalidades
- https://www.tiendanube.com/planes-y-precios
- https://ayuda.tiendanube.com/
- https://www.empretienda.com/
- https://tiendanegocio.com/
- https://www.shopify.com/pricing
- https://www.shopify.com/news/spring-26-edition-dev
- https://www.shopify.com/news/b2b-for-all
- https://mendel.com/ar/ai/
- https://mendel.com/ar/producto/
- https://mendel.com/ar/producto/integraciones/
- https://contabilium.com/ar/
- https://xubio.com/ar/integraciones
- https://www.mercadopago.com.ar/developers/
- https://arca.gob.ar/ws/
- https://www.bcra.gob.ar/
- https://supabase.com/docs/guides/queues
- https://opentelemetry.io/docs/languages/js/
