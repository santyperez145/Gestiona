# ADR 002 — Nerqia como Commerce Operating System

- **Estado:** aceptado
- **Fecha:** 2026-09-01
- **Supersede parcial:** el lineamiento 2026-08-14 de “no creador de tiendas”
  queda acotado. La tienda es la **puerta de adquisición**. El producto sigue
  siendo un solo Business Graph, no un clon de Tiendanube.
- **No reemplaza:** [ADR 001](ADR_001_FINANCE_PRODUCT_SURFACE.md). Finance
  permanece superficie propia en `/finance`.

## Contexto

El posicionamiento “sistema de gestión que además tiene tienda” orientaba el
backlog hacia amplitud ERP y colocaba a Nerqia en la categoría donde pierde
(temas, apps, marca Tiendanube). El diferencial medible —costo landed,
comisión, envío e IVA sobre la misma venta— no se ve si la primera pantalla
es un dashboard de operación interna.

Hacía falta una categoría, un portfolio y una definición de “completo” que no
autorice a construir diez productos a medias.

## Decisión

### 1. Categoría

Nerqia es un **Commerce Operating System** para negocios latinoamericanos.

Definición corta:

> Permite crear una tienda, vender en todos los canales, gestionar la empresa,
> cobrar, automatizar decisiones y —más adelante, con partner— acceder a
> capital desde un único sistema.

Mensaje merchant: *Creá tu tienda, vendé en cualquier canal y gestioná todo tu
negocio sin cambiar de plataforma.*

Mensaje inversor: *Nerqia is building the Commerce Operating System and
Merchant Financial Network for Latin America.*

No se presenta como ERP, alternativa económica a Tiendanube, tienda+CRM,
plataforma “todo en uno” ni chatbot con IA.

### 2. Jerarquía de producto

~~~text
COMMERCE   adquirir y convertir ventas
  → BUSINESS   operar el negocio
    → PAY      controlar cobros
      → FINANCE  caja, gastos y obligaciones
        → CAPITAL  financiar crecimiento (partner)
          → AUTOMATE  optimizar y ejecutar con política
~~~

Commerce es el producto insignia. Business, Pay, Finance y Capital no
desaparecen: son capas que hacen al comercio más difícil de reemplazar.

### 3. Un Business Graph

Entidades canónicas compartidas: Organization, Store, Product, Variant,
Customer, Supplier, Inventory, Order, Payment, Shipment, Invoice, Expense,
Ledger, Action, Outcome.

Queda prohibido crear `commerce_products`, `business_products`,
`finance_suppliers`, `pay_customers` o `capital_merchants` si el concepto ya
tiene autoridad.

Identidad y organización: un `auth.users`, `profiles`, `organizations` y
`memberships`. Staff de Platform no hereda permisos de tenant.

### 4. “Módulo completo”

No significa lanzar treinta capacidades a la vez. Significa no declarar lista
una capacidad hasta que resuelva de punta a punta el trabajo para el que
existe:

Onboarding, permisos server-side, flujo principal, cancelaciones y reversas,
auditoría, idempotencia cuando corresponde, estados de error/vacío/carga/
desconexión, uso móvil, métricas, integraciones, soporte desde Platform,
documentación, tests (unidad, integración, E2E cuando el flujo vende o cobra),
estrategia de desactivación o rollback, modelo económico.

Ejemplo: Nerqia Pay no está completo porque crea un cobro. Está completo
cuando onboard, cobra, confirma, concilia, reembolsa, trata disputa, liquida,
explica comisión, recupera webhook fallido y audita cada transición.

### 5. Portfolio (nombres de producto)

~~~text
Nerqia Cloud
├── Nerqia Commerce     insignia (storefront, checkout, OMS, canales)
├── Nerqia Business     operación, POS, CRM, compras, inventario
├── Nerqia Pay          orquestación de cobros (no PSP de entrada)
├── Nerqia Finance      gastos, documentos, AP — superficie /finance
├── Nerqia Capital      crédito con socio prestamista (congelado)
├── Nerqia Automate     Orbit/playbooks: señal → política → acción
├── Nerqia Ship         logística (congelado hasta contrato/volumen)
├── Nerqia Growth       marketing y consultoría productizada
├── Nerqia Developers   API, webhooks, partners
└── Nerqia Platform     control plane interno
~~~

Orbit no es un octavo Core: es la implementación de Automate sobre el grafo.
Intelligence del ROADMAP anterior vive aquí.

### 6. Pay — propio sin ser adquirente

Nerqia Pay es propio si controla checkout, onboarding UX, pricing de
plataforma, PaymentIntent, routing, conciliación, reintegros, riesgo de
producto, reporting, soporte, ledger y comisiones. El procesador puede ser
tercero.

Escalera (igual que [ARQUITECTURA.md](ARQUITECTURA.md) §6):

1. Orquestación — checkout Nerqia, dinero en Mercado Pago. **Hoy.**
2. Embedded payments con pricing/onboarding acordado.
3. Multi-adquirencia y smart routing. Exige volumen.
4. Cuenta de pago / wallet / PSPCP. Otra unidad jurídica, no un sprint.

**Argentina, 2026-09-01:** no lanzar Pay sobre Stripe como rail doméstico.
Diseñar el adapter. v1 = Mercado Pago OAuth + fee de marketplace + refunds +
webhooks. Payway como segundo rail **después** de contrato. dLocal en
expansión regional.

Stripe útil fuera de Argentina o para billing de la propia suscripción de
Nerqia: Connect, Embedded Onboarding/Components, Payment Element, Express
Checkout, Billing, Radar, webhooks de plataforma vs connected accounts.
No usar para tesis argentina: Capital, Treasury/Financial Accounts, Issuing,
Tax como reemplazo de ARCA, Terminal como POS local.

Detalle inversor y rails: [INVERSORES.md](INVERSORES.md) y
[ESTRATEGIA.md](ESTRATEGIA.md) §11.

### 7. Capital

No préstamos generales. Productos atados a lo que Nerqia mide: Capital
Stock, Flex (adelanto sobre ventas), Facturas (factoring con socio), Growth
(gasto restringido pagado al proveedor).

Fase inicial: Nerqia origina, da UX y servicing tecnológico; el socio es
titular del crédito. La IA explica y prepara; **no** aprueba tasa, límite,
mora ni bloqueo.

No financiar la cartera con equity de venture. Registro PNFC / vehículo
propio es fase posterior.

### 8. Automate

Contrato: Domain Event → señal → cálculo determinístico → explicación IA →
simulación → política → borrador → aprobación → executor idempotente →
outcome. Niveles 0–4. Nunca `Usuario → chat → LLM → UPDATE`.

### 9. Congelado hasta evidencia (no se abre en este ADR)

Multi-store / multi-brand / mercados, dominios propios, theme engine y page
builder, storefront Next.js separado, B2B company profiles, headless
agentic gateway, Pay etapas 3–4, Capital, Ship API de correo, marketplace de
apps, country packs.

La regla de [ARQUITECTURA.md](ARQUITECTURA.md) §5 se mantiene: no construir
eso para un solo comercio; no cerrar la puerta en el modelo de datos.

### 10. Superficies y rutas

No se crean `/commerce`, `/pay` ni `/capital` en este slice. Commerce se
opera desde `/tienda-online` y la tienda pública `/tienda/:slug`. Business
sigue en `/`. Pay se nombra en copy y se implementará sobre conexiones
existentes. Finance no se mezcla.

## Consecuencias

- Onboarding y navegación diaria privilegian publicar y vender online; el POS
  permanece en el bloque diario como canal.
- La documentación de agentes (CLAUDE.md / AGENTS.md) deja de orientar como
  ERP-first.
- El North Star sigue siendo Active Transacting Merchants, no cantidad de
  módulos.

## Alternativas rechazadas

- Reescribir el monoreto a Next.js ahora: costo alto, cero merchants extra.
- Construir Pay+Capital+Finance+Automate en paralelo: viola §4.
- Stripe como procesador de lanzamiento en Argentina: sin cuenta estándar
  confirmada como rail doméstico a esta fecha.
- Presentar “todo en uno” al merchant: el wedge es tienda + margen real +
  migración.
