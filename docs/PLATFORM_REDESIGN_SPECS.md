# Platform Redesign Specs — Commerce OS Vision

**Fecha:** 2026-09-07  
**Objetivo:** Rediseñar todas las plataformas según la visión Commerce OS  
**Principio:** Cada superficie debe expresar claramente su rol en el Commerce OS

---

## Superficies del Commerce OS

| Superficie | Ruta | Rol | Audiencia | Chrome | Norte |
|---|---|---|---|---|---|
| **Commerce** | `/tienda-online`, `/pedidos-online`, `/tienda/:slug` | Puerta de adquisición, conversión, canales | Merchant + End-customer | Cobalto | ATM |
| **Business** | `/` | Operación central, POS, inventario, CRM | Merchant (admin/vendedor) | Cobalto | Stock único |
| **Finance** | `/finance` | Documentos, gastos, aprobaciones, obligaciones | Merchant (admin/finance) | Teal | Conciliación |
| **Platform** | `/platform` | Control plane de plataforma, ATM, gobierno | Staff (superadmin/support/finance) | Slate | Sistémico |
| **Storefront** | `/tienda/:slug`, `<slug>.nerqia.app` | Vitrina pública, checkout, conversión | End-customer | Custom | Conversión |

---

## 1. Commerce Platform Redesign

### Estado Actual
- ✅ Chrome cobalto implementado
- ✅ Navegación por grupos implementada
- ✅ Admin de tienda como ledger implementado
- ⚠️ Foco aún muy operacional, no conversión

### Visión Commerce OS

**Principio:** Commerce es la PUERTA DE ADQUISICIÓN. El merchant debe pensar en VENDER, no en OPERAR.

**Key Changes:**

#### 1.1 Header Focused en Conversión

```
┌─────────────────────────────────────────────────────────────┐
│ 🛒 Mi Tienda              [🔍 Buscar]  [⚙️ Ajustes] [💬]  │
│ ─────────────────────────────────────────────────────────── │
│ [📊 Dashboard] [📦 Pedidos] [🛍️ Catálogo] [📈 Analytics]  │
└─────────────────────────────────────────────────────────────┘
```

**Antes:**
- Header genérico de Business
- Navegación mezclada con POS, inventario, etc.

**Después:**
- Header específico de Commerce
- CTAs de conversión visibles
- Foco en pedidos, catálogo, analytics

#### 1.2 Dashboard de Conversión

**KPIs Principales:**
- Pedidos hoy
- Conversion rate
- Carritos abandonados
- Time to first order
- Revenue 7 días

**Widgets:**
- Pedidos en cola (actionable)
- Stock crítico que afecta ventas
- Alertas de checkout
- Recomendaciones de IA para conversión

#### 1.3 Cola de Pedidos como Ledger

**Estado Actual:** ✅ Implementado

**Mejoras:**
- Filtros por estado (pago, fulfillment, entrega)
- CTAs rápidos (aprobar pago, despachar, contactar)
- Timeline de cada pedido
- Metrics por pedido (margen, tiempo, canal)

#### 1.4 Catálogo Focused en Publicación

**Estado Actual:** ✅ Implementado

**Mejoras:**
- Calidad de publicación (completo)
- Surtido por tienda (ya implementado)
- Imágenes masivas (GTIN/MPN)
- Estado de publicación (publicado, oculto, borrador)

#### 1.5 Analytics de Conversión

**KPIs:**
- Funnel de conversión
- Abandono de carrito
- Time to checkout
- Sources de tráfico
- Revenue por canal

**Visualizaciones:**
- Funnel chart
- Cohortes de conversión
- Heatmap de abandono
- Attribution por source

---

## 2. Business Platform Redesign

### Estado Actual
- ✅ Chrome cobalto implementado
- ✅ Navegación por grupos implementada
- ✅ POS retail chrome implementado
- ⚠️ Mezcla de Commerce y Business en navegación

### Visión Commerce OS

**Principio:** Business es la OPERACIÓN CENTRAL. El merchant debe pensar en OPERAR el negocio, no en configurar.

**Key Changes:**

#### 2.1 Separación de Commerce vs Business

**Commerce Section:**
- Pedidos online
- Catálogo
- Tienda online
- Marketing
- Analytics

**Business Section:**
- POS
- Productos
- Inventario
- Clientes
- Compras
- Proveedores

**Finance Section:**
- (Link a `/finance`)

#### 2.2 Dashboard Operativo

**KPIs Principales:**
- Ventas hoy
- Stock total
- Stock crítico
- Clientes nuevos
- Margen bruto

**Widgets:**
- Ventas por canal
- Stock por ubicación
- Alertas de stock
- Reposiciones recomendadas
- IA insights (opcional)

#### 2.3 POS Retail Chrome

**Estado Actual:** ✅ Implementado

**Mejoras:**
- Modo mostrador vs back office
- Carrito persistente
- Filtros rápidos por categoría
- Búsqueda tolerante
- CTAs de acción (cobrar, generar QR)

#### 2.4 Inventario como Ledger

**KPIs:**
- Stock por ubicación
- Stock en tránsito
- Stock reservado
- Stock negativo (error)
- Rotación

**Visualizaciones:**
- Heatmap de stock
- Forecast de stock
- Reposiciones
- Conteo físico

#### 2.5 CRM Operativo

**KPIs:**
- Clientes activos
- LTV por cliente
- Segmentos
- Comunicaciones

**Widgets:**
- Pipeline de ventas
- Seguimientos
- Comunicaciones
- Lead scoring

---

## 3. Finance Platform Redesign

### Estado Actual
- ✅ Layout separado implementado
- ✅ Chrome teal implementado
- ✅ UI Mendel-class implementada
- ⚠️ Faltan políticas, presupuestos, conciliación

### Visión Mendel-class

**Principio:** Finance es una SUPERFICIE SEPARADA. El merchant debe pensar en CONTROLAR GASTOS, no en facturar.

**Key Changes:**

#### 3.1 Inbox de Documentos

**Estado Actual:** ✅ Implementado

**Mejoras:**
- Filtros por tipo, estado, proveedor
- CTAs rápidos (aprobar, rechazar, pedir info)
- Matching automático
- Aliases por tenant

#### 3.2 Solicitud → Aprobación → Gasto

**Workflow:**
1. Solicitud de gasto
2. Política de aprobación
3. Presupuesto comprometido
4. Aprobación
5. Gasto efectivo
6. Obligación creada

**UI:**
- Pipeline de solicitudes
- Aprobaciones pendientes
- Presupuestos disponibles
- Alertas de sobre-presupuesto

#### 3.3 Presupuestos y Centros de Costo

**KPIs:**
- Presupuesto total
- Comprometido
- Disponible
- Alertas de sobre-presupuesto

**Visualizaciones:**
- Burn down chart
- Spending por centro de costo
- Forecast de gasto

#### 3.4 Conciliación Bancaria

**Estado Actual:** ❌ NO IMPLEMENTADO

**Features:**
- Importación de extractos bancarios
- Matching automático
- Reconciliación manual
- Exportación contable

#### 3.5 Tarjetas Externas

**Estado Actual:** ❌ NO IMPLEMENTADO

**Features:**
- Tarjetas externas conectadas
- Movimientos importados
- Categorización automática
- Controles preventivos

---

## 4. Platform Redesign

### Estado Actual
- ✅ Chrome slate implementado
- ✅ Navegación por grupos implementada
- ✅ Separación de tenant vs platform
- ⚠️ Foco aún muy técnico, no business

### Visión Control Plane

**Principio:** Platform es el CONTROL PLANE. El staff debe pensar en OPERAR LA PLATAFORMA, no en configurar individualmente cada comercio.

**Key Changes:**

#### 4.1 Dashboard de ATM

**KPIs Principales:**
- Active Transacting Merchants (ATM)
- GMV total
- GMV por merchant
- Pay penetration
- Churn rate

**Widgets:**
- ATM trends
- Top merchants
- Risk alerts
- System health

#### 4.2 Merchant 360

**Estado Actual:** ✅ Implementado

**Mejoras:**
- Timeline de activación
- Health score
- Risk indicators
- Integration status
- Support tickets

#### 4.3 Operaciones Platform

**KPIs:**
- System health
- Error rates
- Uptime
- Performance metrics

**Widgets:**
- Health dashboard
- Error logs
- Performance charts
- Alert configs

#### 4.4 Monetización

**KPIs:**
- MRR
- ARR
- Payment revenue
- Commission revenue
- Churn

**Visualizaciones:**
- Revenue trends
- Revenue breakdown
- Unit economics
- LTV/CAC

#### 4.5 Gobierno

**KPIs:**
- Risk score
- Compliance status
- Audit logs
- Fraud rate

**Widgets:**
- Risk dashboard
- Compliance checklist
- Audit trail
- Fraud alerts

---

## 5. Storefront Redesign

### Estado Actual
- ✅ Header y buscador sin pill genérico
- ✅ Vitrina sin orbes ni trust genérico
- ✅ Navegación accesible
- ⚠️ Foco aún muy genérico, no brand

### Visión World-Class

**Principio:** Storefront es la VITRINA PÚBLICA. El end-customer debe pensar en COMPRAR, no en navegar.

**Key Changes:**

#### 5.1 Header Minimalista

```
┌─────────────────────────────────────────────────────────────┐
│ [LOGO]            [🔍 Buscar]               [🛒 0] [👤]    │
└─────────────────────────────────────────────────────────────┘
```

**Antes:**
- Header con navigation completa
- Pills genéricos

**Después:**
- Header minimalista
- Foco en búsqueda y carrito
- Navigation secundaria

#### 5.2 PDP Conversión-Focused

**Features:**
- Imágenes grandes
- Reviews visibles
- Preguntas destacadas
- CTA prominente
- Trust signals reales (no genéricos)

#### 5.3 Checkout Optimizado

**Features:**
- Guest checkout
- One-page checkout
- Múltiples métodos de pago
- Cálculo de envío en tiempo real
- Trust signals visibles

#### 5.4 Mobile-First

**Features:**
- Touch-friendly
- Swipe gestures
- Bottom navigation
- Fast loading
- Offline fallback

---

## Implementation Order

### FASE 1: Commerce Platform (Week 1-2)

1. **Header Commerce** (2 días)
   - Header específico de Commerce
   - CTAs de conversión
   - Foco en pedidos, catálogo, analytics

2. **Dashboard Conversión** (3 días)
   - KPIs de conversión
   - Widgets de acción
   - Cola de pedidos mejorada

3. **Analytics Conversión** (3 días)
   - Funnel de conversión
   - Cohortes
   - Attribution

### FASE 2: Business Platform (Week 3-4)

1. **Separación Commerce vs Business** (2 días)
   - Navegación separada
   - Secciones claras

2. **Dashboard Operativo** (3 días)
   - KPIs operativos
   - Widgets de acción
   - IA insights

3. **Inventario Ledger** (3 días)
   - Heatmap de stock
   - Forecast
   - Reposiciones

### FASE 3: Finance Platform (Week 5-6)

1. **Workflow Solicitud → Aprobación** (3 días)
   - Pipeline de solicitudes
   - Políticas versionadas
   - Presupuestos

2. **Conciliación Bancaria** (4 días)
   - Importación de extractos
   - Matching automático
   - Exportación contable

3. **Tarjetas Externas** (3 días)
   - Conexión de tarjetas
   - Movimientos importados
   - Categorización

### FASE 4: Platform Redesign (Week 7-8)

1. **Dashboard ATM** (3 días)
   - KPIs de ATM
   - Trends
   - Risk alerts

2. **Merchant 360 Mejorado** (3 días)
   - Timeline
   - Health score
   - Risk indicators

3. **Operaciones Platform** (2 días)
   - Health dashboard
   - Error logs
   - Performance

### FASE 5: Storefront Redesign (Week 9-10)

1. **Header Minimalista** (2 días)
   - Header minimalista
   - Foco en búsqueda

2. **PDP Conversión-Focused** (3 días)
   - Imágenes grandes
   - Reviews
   - CTA prominente

3. **Checkout Optimizado** (3 días)
   - Guest checkout
   - One-page checkout
   - Trust signals

---

## Design System Updates

### Colores

**Commerce:** Cobalto (hsl(217, 91%, 60%))  
**Business:** Cobalto (hsl(217, 91%, 60%))  
**Finance:** Teal (hsl(174, 71%, 39%))  
**Platform:** Slate (hsl(215, 25%, 27%))  
**Storefront:** Custom por tienda

### Tipografía

**Headers:** Display font (bold, tight tracking)  
**Body:** Sans-serif (readable, optimized for UI)  
**CTAs:** Strong, high contrast

### Componentes

**Buttons:** Primary (cobalto), Secondary (gray), Ghost (transparent)  
**Cards:** Subtle borders, slight elevation  
**Tables:** Clean, sortable, filterable  
**Charts:** Consistent colors, clear labels

---

## Success Metrics

### Commerce Platform
- **Conversión de checkout:** >3%
- **Time to first order:** <7 días
- **Carritos abandonados recuperados:** >20%

### Business Platform
- **Stock accuracy:** >95%
- **Time to sell:** <2 días
- **POS adoption:** >80%

### Finance Platform
- **Document processing rate:** >95%
- **Approval time:** <24 horas
- **Reconciliation rate:** >90%

### Platform
- **ATM growth:** >10% mensual
- **System uptime:** >99.9%
- **Support response time:** <2 horas

### Storefront
- **Conversion rate:** >3%
- **Mobile traffic:** >60%
- **Page load time:** <2s

---

## Conclusion

**El rediseño de plataformas es un proyecto de 10 semanas que transformará cada superficie para expresar claramente su rol en el Commerce OS.**

**Estrategia:**
- Fase 1-2: Commerce (prioridad #1 para ATM)
- Fase 3-4: Business (operación central)
- Fase 5-6: Finance (Mendel-class)
- Fase 7-8: Platform (control plane)
- Fase 9-10: Storefront (conversión)

**Inversión:** $200-300k (10 semanas de UI/UX + Dev)  
**Outcome:** Cada superficie expresa su rol claramente = mejor UX = mayor adopción = más ATM

**Veredicto:** **EJECUTAR EN PARALELO CON P1.** Rediseño es visual, P1 es técnico. Se pueden hacer en paralelo.
