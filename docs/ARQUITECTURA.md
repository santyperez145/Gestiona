# Arquitectura de Nerqia

**Estado:** vigente. **Corte:** 2026-09-04.

Este documento fija límites técnicos. El alcance de producto vive en
[ROADMAP.md](../ROADMAP.md) y las decisiones estructurales en los ADR.

## 1. Forma del sistema

Nerqia es un monolito modular con frontend React/Vite, API de Supabase,
PostgreSQL, Edge Functions y endpoints Vercel. Esta forma se conserva mientras
un límite de seguridad, escala, SLO o equipo no justifique separar un servicio.

```text
Browser / PWA
  ├─ Landing y tiendas públicas
  ├─ Organización / Business
  ├─ Finance
  └─ Platform
       ↓
Supabase Auth + PostgREST + RPC + Realtime + Storage
       ↓
PostgreSQL: Business Graph, RLS, triggers, auditoría
       ↓
Edge Functions / Vercel Functions
       ↓
Pagos, correo, IA, logística, ARCA y canales externos
```

Las cuatro superficies comparten deploy, primitives y observabilidad. No
comparten automáticamente permisos ni navegación.

## 2. Superficies y confianza

| Superficie | Entrada | Autorización |
|---|---|---|
| Tienda pública | `/tienda/:slug`, subdominio o dominio propio | Contratos públicos mínimos; nunca tablas crudas. |
| Organización | `/` | Sesión + `memberships` + permisos + RLS. |
| Finance | `/finance` | Sesión + membership + entitlement + `finance.view`. |
| Platform | `/platform` | `platform_admins`, rol específico y MFA. |

Ser staff de Platform no crea una membresía de organización. El soporte entra
por un flujo consentido, temporal y auditado.

## 3. Business Graph

Autoridades compartidas:

- identidad: `auth.users`, `profiles`, `organizations`, `memberships`;
- catálogo: productos, variantes, tipos, atributos y categorías;
- comercio: stores, customers, orders, payments, shipments y returns;
- operación: ubicaciones, inventario, movimientos, compras y proveedores;
- finanzas: gastos, obligaciones, documentos, ledger y hechos de margen;
- automatización: señal, recomendación, aprobación, ejecución y resultado.

Un módulo nuevo referencia esas entidades. No crea copias como
`finance_suppliers`, `commerce_products` o `pay_customers`.

### Tiendas múltiples

Una organización puede tener varias tiendas y exactamente una principal. La
tienda es dueña de dominio, diseño, navegación, páginas, surtido visible,
promociones de vitrina, pedidos, recuperación y analítica. Producto, stock,
cliente, costo y categoría siguen perteneciendo al Core.

`store_product_publications` es un overlay escaso: si no hay fila, el producto
activo se publica con los datos del Core; si la hay, sólo puede cambiar
visibilidad, precio visible/comparativo, categoría de navegación, destacado y
orden para esa tienda. No contiene stock, costo, descripción ni imágenes. El
catálogo público, variantes, carrito, checkout, feed, sitemap y metadata
resuelven el mismo `store_id` server-side para evitar vitrinas divergentes.

## 4. Autoridades transaccionales

### Stock

`record_stock_movement` y los triggers de venta/compra son el único camino
para modificar `products.stock`, variantes y stock por ubicación. El cliente
nunca escribe esas columnas. Insert, update, cancelación y devolución deben
producir movimientos compensatorios auditables.

No se recortan negativos con `GREATEST` o `Math.max`: un negativo revela una
inconsistencia. La vista `stock_negativo` debe quedar vacía.

### Dinero

El checkout envía identificadores y cantidades. La base vuelve a resolver
precio, promoción, cupón, envío, impuesto, comisión, stock y total. Todo cobro,
reintegro, settlement y asiento necesita idempotencia y trazabilidad.

Funciones puras como `businessCalc.ts`, `shippingCalc.ts`,
`paymentFees.ts` y `storeReadiness.ts` cubren cálculos de interfaz. Cuando
existe el mismo cálculo SQL, ambos lados documentan el espejo y el servidor es
autoridad.

### Sistemas externos

Una respuesta del navegador o un cron despachado no acredita un hecho externo.
Pagos, emails, etiquetas y comprobantes se confirman con webhook o consulta,
guardan identificador externo y permiten conciliación/reintento idempotente.

## 5. Lecturas y compatibilidad

- Las superficies públicas usan RPC/vistas con contratos mínimos.
- Una vista nueva convive con la anterior hasta retirar consumidores.
- El fallback a un contrato anterior sólo se permite ante
  `42P01`, `42883`, `PGRST205` o `PGRST202`.
- Permisos, red o errores de datos nunca se transforman en `[]` o `null`.
- Las respuestas asíncronas viejas se descartan al cambiar organización,
  tienda, ubicación o filtro.
- `columnasQueExisten.test.ts` impide pedir columnas ausentes en PostgREST.

## 6. Rutas y estado

`src/app/routeManifest.ts` es la fuente de verdad de rutas privadas, módulo,
roles, página y aliases. Router, sidebar, buscador y permisos se derivan de ese
manifiesto. Sólo rutas parametrizadas y montajes de superficie se declaran a
mano.

El contexto navegable va en URL cuando debe sobrevivir enlaces y volver/avanzar.
Preferencias de interfaz pueden persistir localmente con clave versionada. Datos
del negocio permanecen en servidor y TanStack Query gestiona su caché.

La PWA no recarga automáticamente al detectar un deploy. Informa la nueva
versión y el usuario decide cuándo activarla, preservando trabajo no guardado.

## 7. Seguridad

El modelo sigue mínimo privilegio, denegación por defecto y defensa en
profundidad:

- RLS por tenant en toda tabla expuesta;
- funciones `SECURITY DEFINER` con `search_path` fijo, grants mínimos y
  validación explícita de organización/rol;
- tablas de credenciales con RLS y cero policies para el navegador;
- OAuth cuando existe; secretos alternativos entran por Edge Function y no se
  devuelven;
- API keys emitidas server-side, visibles una vez, almacenadas como hash,
  revocables y con scopes;
- MFA obligatorio en Platform;
- buckets privados, paths asignados por servidor, MIME/tamaño real, hash,
  cuarentena y URLs firmadas breves;
- idempotencia reservada sólo después de validar el request;
- rate limit, validación de origen y límites de payload en entradas sensibles;
- auditoría append-only para accesos, cambios financieros y acciones de staff;
- CSP, headers defensivos y dependencias auditadas en cada slice;
- logs sin tokens, documentos, datos de tarjeta ni PII innecesaria.

Guardas principales: `publicSurface.test.ts`, `edgeFunctionAuth.test.ts`,
`apiPublicaEndurecida.test.ts`, `noPastedCredentials.test.ts`,
`moduleMap.test.ts` y la vista `rls_audit_open_policies`.

Prevención de fraude:

- no confiar montos, precios, estados ni identidad declarados por el cliente;
- correlacionar pago, orden, actor, IP/metadata permitida e idempotency key;
- detectar replay, webhook inválido, velocidad anómala y cambios de beneficiario;
- separar creator, approver y payer en Finance;
- mantener reglas determinísticas y revisión humana para acciones de alto riesgo;
- no mover fondos, emitir crédito o tarjetas sin partner, controles legales y
  monitoreo operativo.

Los detalles de acceso están en [permisos.md](permisos.md), los webhooks en
[WEBHOOKS.md](WEBHOOKS.md) y el relevamiento regulatorio en [LEGAL.md](LEGAL.md).

## 8. Finance

Finance es una superficie propia sobre el mismo Graph. Sus documentos,
versiones, políticas, aprobaciones y eventos son entidades específicas; sus
proveedores, compras, gastos, obligaciones, centros de costo y ledger no se
duplican.

Un documento sigue:

```text
intención de carga → original privado → inspección → extracción
→ revisión humana → matching → borrador → aprobación → efecto en Core
```

Ningún OCR o modelo crea stock, deuda o asiento antes de la aprobación. El
contrato completo está en [FINANCE.md](FINANCE.md).

## 9. Pay y conectores

Nerqia Pay orquesta intención, checkout, comisión, webhook, conciliación,
reintegro y soporte; el procesador mueve el dinero. El adapter actual prioriza
Mercado Pago OAuth. Otros rails requieren contrato, volumen y certificación.

Cada conector implementa:

1. conexión/revocación seguras;
2. estado sanitizado para UI;
3. request idempotente;
4. webhook autenticado y replay-safe;
5. reconciliación;
6. errores accionables y health operativo.

## 10. Rendimiento

- rutas y vendors pesados se cargan bajo demanda;
- landing/storefront no descargan el panel;
- imágenes pasan por `ImageUpload`, compresión y tamaños responsivos;
- queries tienen claves estables, paginación y cancelación/descartado;
- no se crean refetch loops para “mantener fresco” un dashboard;
- LCP, INP, CLS, errores y peso de assets se miden, no se presumen;
- storefront puede separarse de deploy sólo si tráfico/SLO justifican la
  complejidad.

## 11. Evolución tecnológica

El stack cambia por un gap medido, no por reputación. Una dependencia nueva
debe superar la puerta de
[ESTANDAR_EXPERIENCIA_COMPETITIVA.md](ESTANDAR_EXPERIENCIA_COMPETITIVA.md):
beneficio, accesibilidad, seguridad, rendimiento, operación y costo de salida.

Se evalúa extraer un servicio cuando hay aislamiento regulatorio, escalado
independiente, ownership claro o un SLO que el monolito no puede cumplir.

## 12. Verificación

Cada slice combina:

- Vitest para contratos y cálculos;
- SQL reversible como roles reales para RLS/triggers;
- Playwright para flujos y responsive;
- navegador local y producción;
- `typecheck`, lint, tests, build, enlaces y diff;
- revisión de logs, errores, secretos y cambios de dependencias.

Los datos productivos no se alteran para demostrar un resultado. Las fixtures
`ZZ` se crean y eliminan en la misma transacción, cuya última consulta prueba
cero restos.
