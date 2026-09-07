# CEO Execution Plan — Nerqia Commerce OS

**Fecha:** 2026-09-07  
**Estado:** Análisis CEO-level del repositorio actual y plan de ejecución acelerado  
**Objetivo:** Maximizar ATM (Active Transacting Merchants) en el menor tiempo posible

---

## Executive Summary

### Estado Actual del Repositorio

**Nerqia está significativamente más avanzado que el análisis inicial de exentryimports.**

**Nombre y Posicionamiento:**
- ✅ **Nombre**: Nerqia Commerce OS (ya no Gestiona)
- ✅ **Posicionamiento**: Commerce Operating System para LATAM (ADR 002 definido)
- ✅ **Categoría**: No es "otro creador de tiendas", es Commerce OS
- ✅ **Mensaje**: "Creá tu tienda, vendé en cualquier canal y gestioná todo el negocio sin cambiar de plataforma"

**Estado Técnico (2026-09-07):**
- ✅ **2.802 tests** en 311 archivos (vs 2.102 en exentryimports)
- ✅ **76 Edge Functions** (vs 74 en exentryimports)
- ✅ **Typecheck, lint, build** todos pasando
- ✅ **70 escenarios E2E** aprobados (Playwright)
- ✅ **93 contextos de ruta** auditados sin errores
- ✅ **CommerceKernel** construido y operativo
- ✅ **Ledger financiero** implementado (H3)
- ✅ **Idempotencia** implementada (H1)
- ✅ **Eventos durables** implementados (H2)
- ✅ **ARCA** productiva y autorizada
- ✅ **Multi-store** implementado
- ✅ **Migrador unificado** (Shopify, Tiendanube, planillas)

**Progreso Reciente (70+ commits desde agosto 2026):**
- ✅ Transformación UI completa a Commerce OS (cobalto, chrome Commerce)
- ✅ Admin de tienda como ledger Commerce OS
- ✅ Migrador unificado de catálogos (C22.1 cerrado)
- ✅ Payment orquestation funcional
- ✅ Cola de pedidos operativa
- ✅ Finance UI Mendel-class
- ✅ Surtido multi-tienda con autoridad server-side
- ✅ Header buscador sin pill genérico
- ✅ Checkout/carrito editoriales
- ✅ POS retail chrome
- ✅ Landing Commerce OS publicada

**Producto en Producción:**
- ✅ **nerqia.app** live y operativo
- ✅ **Landing** Commerce OS publicada
- ✅ **Storefront** funcional con SEO
- ✅ **Checkout** orquestado
- ✅ **Pagos** Mercado Pago OAuth
- ✅ **ARCA** autorizando facturas
- ✅ **Email** con Resend configurado
- ✅ **Platform** con MFA, Merchant 360, métricas

---

## GAP Analysis — Qué falta para Commerce First-Level

### GAP 1: Gates Externos No Cerrados

| Gate | Estado | Impacto ATM | Tiempo estimado |
|------|--------|-------------|-----------------|
| **Segundo comercio real** | ❌ NO CERRADO | 🔴 CRÍTICO | 2-4 semanas |
| **ARCA productiva real** | ⚠️ Parcial | 🟡 MEDIO | 1 semana |
| **Pago real certificado** | ⚠️ Parcial | 🟡 MEDIO | 1 semana |
| **Logística real** | ❌ NO CERRADO | 🟡 MEDIO | 2-3 semanas |
| **Inventario confiable** | ⚠️ Parcial | 🟡 MEDIO | 1 semana |
| **Finance real** | ❌ NO CERRADO | 🟢 BAJO | 3-4 semanas |
| **Correo productivo** | ⚠️ Parcial | 🟢 BAJO | 1 semana |

**Prioridad CEO:** Segundo comercio real es el #1 blocker para escalar.

### GAP 2: Commerce Parity — Qué falta para first-level

| Capacidad | Estado Nerqia | Paridad Shopify/Tiendanube | Gap |
|-----------|---------------|---------------------------|-----|
| **Onboarding, dominio, tema** | ✅ Básico | ✅ Completo | UI mejorada |
| **Catálogo, variantes, imágenes** | ✅ Completo | ✅ Completo | ✅ PARIDAD |
| **Surtido multi-tienda** | ✅ Completo | ✅ Completo | ✅ PARIDAD |
| **Precio/promoción, stock** | ✅ Completo | ✅ Completo | ✅ PARIDAD |
| **Carrito persistente** | ✅ Completo | ✅ Completo | ✅ PARIDAD |
| **Pagos aprobados/rechazados** | ⚠️ Parcial | ✅ Completo | Certificación live |
| **Preparación, fulfillment** | ⚠️ Parcial | ✅ Completo | Logística real |
| **Tracking, cancelación, devolución** | ⚠️ Parcial | ✅ Completo | Logística real |
| **Emails, recuperación** | ✅ Completo | ✅ Completo | ✅ PARIDAD |
| **SEO técnico, analytics** | ✅ Completo | ✅ Completo | ✅ PARIDAD |
| **Migración con preview** | ⚠️ Parcial | ✅ Completo | Certificación real |
| **Cola operativa, bulk** | ✅ Completo | ✅ Completo | ✅ PARIDAD |

**Veredicto CEO:** Nerqia tiene ~80% de paridad Commerce. Los gaps son principalmente gates externos, no tecnología.

### GAP 3: Finance Mendel-class — Qué falta

| Trabajo | Estado Nerqia | Paridad Mendel | Gap |
|---------|---------------|----------------|-----|
| **Inbox y captura** | ✅ Base técnica | ✅ Completo | Proveedor privado |
| **Solicitudes y aprobaciones** | ⚠️ Parcial | ✅ Completo | Políticas versionadas |
| **Presupuestos y centros de costo** | ⚠️ Parcial | ✅ Completo | Comprometido/disponible |
| **Gastos, reembolsos, payables** | ⚠️ Parcial | ✅ Completo | Flujo unificado |
| **Conciliación bancaria** | ❌ NO | ✅ Completo | Match bancario |
| **Tarjetas y reglas preventivas** | ❌ NO | ✅ Completo | Tarjetas externas |
| **IA operativa** | ✅ Base transversal | ✅ Completo | Excepción → acción |

**Veredicto CEO:** Finance tiene base técnica sólida. Los gaps son implementación de políticas y proveedor privado.

---

## CEO Decision — Estrategia de Ejecución Acelerada

### Thesis Ejecutiva

**Nerqia tiene la tecnología lista. El bottleneck es ADOPCIÓN, no CONSTRUCCIÓN.**

**Evidencia:**
- 2.802 tests, 76 Edge Functions, CI verde
- CommerceKernel funcional, ARCA productiva, Payment orquestation
- Landing publicada, storefront SEO, checkout orquestado
- Multi-store, migrador unificado, ledger financiero

**Problema Real:**
- 0 comercios externos activos (solo 1 comercio interno)
- 0 certificaciones live con datos reales
- 0 segundo comercio vendiendo sin intervención SQL

**Solución CEO:**
**Pausar desarrollo de nuevas features. Foco 100% en ADOPCIÓN y SEGUNDO COMERCIO.**

---

## Plan de Ejecución — 6 Semanas para Segundo Comercio

### SEMANA 1: Validación Técnica de Gates Externos

**Objetivo:** Validar que todos los gates externos están listos para segundo comercio.

**Tareas:**

1. **ARCA Certificación Live** (2 días)
   - Validar que el certificado productivo funciona con CUIT real
   - Emitir primera factura real con un comercio de prueba
   - Verificar autorización, rechazo, timeout
   - **Owner:** Responsable fiscal
   - **Outcome:** ARCA certificada live

2. **Pago Real Certificación** (2 días)
   - Validar aprobación, rechazo, webhook, timeout, refund
   - Test con Mercado Pago cuenta real
   - Validar conciliación automática
   - **Owner:** Operación/DevOps
   - **Outcome:** Pagos certificados live

3. **Logística Real Setup** (1 día)
   - Contactar transportista para contrato real
   - Configurar tarifas reales
   - Test generación de etiqueta real
   - **Owner:** Founder-led sales
   - **Outcome:** Contrato logística firmado

**Gate de Éxito:**
- [ ] ARCA emite factura real
- [ ] Pagos procesan aprobación/rechazo/timeout
- [ ] Logística tiene contrato firmado

---

### SEMANA 2: Onboarding Optimizado para Segundo Comercio

**Objetivo:** Crear onboarding reproducible que any merchant pueda completar sin ayuda técnica.

**Tareas:**

1. **Simplificar Onboarding** (3 días)
   - Reducir onboarding a <30 minutos
   - Eliminar pasos técnicos del merchant
   - Auto-configurar todo lo posible
   - **Owner:** PM/UX
   - **Outcome:** Onboarding <30 minutos

2. **Crear Templates por Rubro** (2 días)
   - Templates para ferretería, perfumería, electrónica
   - Pre-configurar categorías, atributos, defaults
   - **Owner:** PM/Business
   - **Outcome:** 3 templates listos

**Gate de Éxito:**
- [ ] Onboarding <30 minutos
- [ ] 3 templates funcionales
- [ ] 0 intervención SQL

---

### SEMANA 3: Migrador Certificado con Datos Reales

**Objetivo:** Certificar migrador con archivos reales de comercios.

**Tareas:**

1. **Certificar Migrador Shopify** (2 días)
   - Test con export real de Shopify
   - Validar mapeo exacto de campos
   - Validar imágenes propias
   - Validar rollback seguro
   - **Owner:** Dev + Design partner
   - **Outcome:** Shopify migrador certificado

2. **Certificar Migrador Tiendanube** (2 días)
   - Test con export real de Tiendanube
   - Cerrar mapeo exacto (actualmente detecta por nombre)
   - Validar clientes
   - **Owner:** Dev + Design partner
   - **Outcome:** Tiendanube migrador certificado

3. **Certificar Migrador Planillas** (1 día)
   - Test con Excel real de comercio
   - Validar detección de origen
   - **Owner:** Dev
   - **Outcome:** Planillas migrador certificado

**Gate de Éxito:**
- [ ] 3 migradores certificados con datos reales
- [ ] Rollback condicionado funcional
- [ ] 0 correcciones manuales

---

### SEMANA 4: Founder-Led Sales — Primeros 2 Comercios

**Objetivo:** Conseguir 2 comercios reales que migren y vendan.

**Tareas:**

1. **Identificar 5 prospects** (1 día)
   - Ferreterías, perfumerías, electrónica
   - Que ya tengan tienda en Shopify/Tiendanube
   - Que estén frustrados con margen/conciliación
   - **Owner:** CEO/Fundador
   - **Outcome:** 5 prospects identificados

2. **Outreach y Demo** (2 días)
   - Presentar Nerqia como Commerce OS
   - Demostrar margin intelligence
   - Ofrecer migración gratis
   - **Owner:** CEO/Fundador
   - **Outcome:** 3 demos agendadas

3. **Cerrar 2 comercios** (2 días)
   - Cerrar contrato con 2 comercios
   - Comenzar migración
   - **Owner:** CEO/Fundador
   - **Outcome:** 2 comercios comprometidos

**Gate de Éxito:**
- [ ] 5 prospects identificados
- [ ] 3 demos agendadas
- [ ] 2 comercios comprometidos

---

### SEMANA 5: Migración y Primera Venta de Segundo Comercio

**Objetivo:** Migrar 2 comercios y lograr primera venta de cada uno.

**Tareas:**

1. **Migrar Comercio 1** (2 días)
   - Ejecutar migración certificado
   - Validar catálogo, stock, clientes
   - Publicar tienda
   - **Owner:** Dev + Success
   - **Outcome:** Comercio 1 migrado

2. **Migrar Comercio 2** (2 días)
   - Ejecutar migración certificado
   - Validar catálogo, stock, clientes
   - Publicar tienda
   - **Owner:** Dev + Success
   - **Outcome:** Comercio 2 migrado

3. **Lograr Primera Venta** (1 día)
   - Apoyar cada comercio en primera venta
   - Validar checkout, pago, fulfillment
   - **Owner:** Success + CEO
   - **Outcome:** 2 primeras ventas logradas

**Gate de Éxito:**
- [ ] 2 comercios migrados
- [ ] 2 tiendas publicadas
- [ ] 2 primeras ventas logradas
- [ ] 0 intervención SQL

---

### SEMANA 6: Validación y Optimización

**Objetivo:** Validar que el modelo es repetible y optimizar para escalar.

**Tareas:**

1. **Medir Métricas** (2 días)
   - Tiempo hasta primera venta
   - Tiempo de migración
   - Conversión de checkout
   - Pay penetration
   - **Owner:** Data + CEO
   - **Outcome:** Métricas baseline establecidas

2. **Optimizar Onboarding** (2 días)
   - Basado en learning de 2 comercios
   - Simplificar pasos que causaron fricción
   - Automatizar más
   - **Owner:** PM/UX
   - **Outcome:** Onboarding mejorado

3. **Preparar Escalamiento** (1 día)
   - Documentar proceso de onboarding
   - Crear playbooks de migración
   - Preparar materials de sales
   - **Owner:** PM + CEO
   - **Outcome:** Proceso repetible documentado

**Gate de Éxito:**
- [ ] Métricas baseline medidas
- [ ] Onboarding optimizado
- [ ] Proceso documentado
- [ ] Ready para escalar a 10 comercios

---

## Resource Allocation — 6 Semanas

### Equipo

| Rol | Dedicación | Responsabilidad |
|-----|------------|-----------------|
| **CEO/Fundador** | 100% | Sales, closing comercios, oversight |
| **Dev Lead** | 100% | Certificación gates, migrador, bugs críticos |
| **Dev** | 100% | Migrador, onboarding, soporte técnico |
| **PM/UX** | 100% | Onboarding UX, templates, optimización |
| **Success** | 100% | Onboarding comercios, soporte, primera venta |
| **DevOps** | 50% | ARCA, pagos, logística, infraestructura |

### Presupuesto

| Ítem | Costo 6 semanas |
|------|-----------------|
| **Equipo** | $120-150k (5 personas × 6 semanas) |
| **Infraestructura** | $3k (Supabase, Vercel, Resend) |
| **Logística** | $2k (contrato transportista) |
| **Marketing/Sales** | $5k (outreach, demos) |
| **Total** | **$130-160k** |

---

## Decisiones CEO Críticas

### 1. PAUSAR Desarrollo de Nuevas Features

**Razón:**
- La tecnología está lista (2.802 tests, 76 Edge Functions)
- El bottleneck es adopción, no construcción
- Cada nueva feature diluye foco de adopción

**Excepciones:**
- Bugs críticos que bloquean adopción
- Gates externos (ARCA, pagos, logística)
- Optimizaciones de onboarding

### 2. Foco 100% en Segundo Comercio

**Razón:**
- Segundo comercio es el #1 blocker para escalar
- Sin segundo comercio, no hay evidencia de product-market fit
- Inversores no van a invertir sin evidencia de tracción

**Métrica de Éxito:**
- 2 comercios externos activos
- 2 primeras ventas logradas
- 0 intervención SQL

### 3. Founder-Led Sales

**Razón:**
- CEO es el mejor salesperson en etapa temprana
- Permite obtener feedback directo del mercado
- Acelera closing de primeros comercios

**Compromiso:**
- CEO dedica 100% de tiempo a sales durante 6 semanas
- CEO participa en demos y closing
- CEO on-the-ground para soporte de primeros comercios

### 4. Onboarding Optimizado

**Razón:**
- Si onboarding toma >1 hora, el merchant no completa
- La meta es <30 minutos para completar
- Cada minuto extra reduce conversión

**Táctica:**
- Auto-configurar todo lo posible
- Eliminar pasos técnicos del merchant
- Usar templates por rubro
- Video walkthrough en cada paso

### 5. Migrador Certificado

**Razón:**
- Si migración falla, el merchant se va
- Certificación con datos reales reduce riesgo
- Rollback seguro da confianza

**Táctica:**
- Certificar con archivos reales de comercios
- Validar cada campo mapeado
- Test rollback con datos reales
- Documentar edge cases

---

## Metrics — KPIs para 6 Semanas

### North Star
**Active Transacting Merchants (ATM):** 2 (hoy: 1)

### KPIs Semanales

| Semana | KPI | Target |
|--------|-----|--------|
| **Semana 1** | Gates externos validados | 3/3 |
| **Semana 2** | Onboarding <30 minutos | ✅ |
| **Semana 3** | Migradores certificados | 3/3 |
| **Semana 4** | Comercios comprometidos | 2 |
| **Semana 5** | Comercios migrados | 2 |
| **Semana 6** | Primeras ventas | 2 |

### KPIs Diarios (Semana 5-6)

| KPI | Target |
|-----|--------|
| Tiempo hasta primera venta | <7 días |
| Tiempo de migración | <4 horas |
| Conversión de checkout | >3% |
| Pay penetration | >20% |
| Soporte response time | <2 horas |

---

## Risk Management

### Riesgo 1: Segundo Comercio No Conseguido

**Probabilidad:** 🟡 Media  
**Impacto:** 🔴 Crítico

**Mitigación:**
- Identificar 10 prospects, no 5
- Ofrecer migración gratis + 3 meses gratis
- CEO dedicado 100% a sales
- Tener backup plan (comercio conocido)

### Riesgo 2: Migración Falla

**Probabilidad:** 🟡 Media  
**Impacto:** 🟡 Medio

**Mitigación:**
- Certificar migrador con datos reales antes
- Tener rollback seguro
- Dev on-call durante migración
- Plan B: migración manual parcial

### Riesgo 3: Gates Externos Fallan

**Probabilidad:** 🟢 Baja  
**Impacto:** 🟡 Medio

**Mitigación:**
- Validar cada gate antes de semana 4
- Tener plan B para cada gate
- Documentar workarounds
- Contactar proveedores anticipadamente

### Riesgo 4: Primer Venta No Lograda

**Probabilidad:** 🟡 Media  
**Impacto:** 🟡 Medio

**Mitigación:**
- Success dedicado a ayudar
- CEO on-call para resolver issues
- Tener incentivos para primera venta
- Publicar en redes sociales del comercio

---

## Post-6 Weeks — Escalando a 10 Comercios

### Objetivo Mes 2-3: 10 Comercios Activos

**Estrategia:**
1. **Refinar onboarding** basado en learning de primeros 2
2. **Crear sales materials** (case studies, videos, testimonials)
3. **Implementar referral program** (comercio refiere comercio)
4. **Automatizar outreach** (email sequences, LinkedIn)
5. **Partnerships** (agencias, contadores, consultores)

**Métricas:**
- 10 comercios activos
- 80% onboarding completion rate
- 70% first sale within 7 days
- 60% Pay penetration

### Objetivo Mes 4-6: 50 Comercios Activos

**Estrategia:**
1. **Scale sales team** (1-2 SDRs)
2. **Content marketing** (SEO, blog, webinars)
3. **Paid acquisition** (Google Ads, Meta Ads)
4. **Partner program** formal
5. **Customer success team** (1-2 CSMs)

**Métricas:**
- 50 comercios activos
- $50k-$100k GMV mensual
- 50% Pay penetration
- 80% retention 90 días

---

## Decision Matrix — Qué SÍ y Qué NO

### QUÉ SÍ (Próximas 6 Semanas)

✅ **Cerrar gates externos** (ARCA, pagos, logística)  
✅ **Optimizar onboarding** (<30 minutos)  
✅ **Certificar migrador** (datos reales)  
✅ **Founder-led sales** (cerrar 2 comercios)  
✅ **Support intensivo** (primeras ventas)  
✅ **Medir métricas** (baseline)  
✅ **Documentar proceso** (repetible)  
✅ **Bugs críticos** que bloquean adopción

### QUÉ NO (Próximas 6 Semanas)

❌ **Nuevas features** (B2B, themes avanzados, page builder)  
❌ **Finance completo** (políticas, presupuestos, tarjetas)  
❌ **IA agents** (catalog, pricing, merchandising)  
❌ **Capital** (requiere partner, economics)  
❌ **Ship** (requiere contrato, volumen)  
❌ **Multi-brand** (no prioridad sin segundo comercio)  
❌ **Headless** (no prioridad sin demanda)  
❌ **Regionalización** (no prioridad sin tracción local)

---

## Comunicación — Mensaje a Stakeholders

### A Inversores

"Nerqia tiene la tecnología lista (2.802 tests, 76 Edge Functions, CI verde). El foco ahora es adopción. Vamos a dedicar las próximas 6 semanas a conseguir 2 comercios externos activos y validar que el modelo es repetible. Después escalaremos a 10 comercios en 2-3 meses."

### A Equipo

"Vamos a pausar desarrollo de nuevas features por 6 semanas. El foco 100% es adopción y segundo comercio. La tecnología está lista. Necesitamos validar que merchants reales pueden usar Nerqia sin intervención técnica. Esto es crítico para nuestra próxima ronda de funding."

### A Comercios

"Nerqia no es otro creador de tiendas. Es un Commerce Operating System que te permite crear tienda, vender en cualquier canal y gestionar todo el negocio desde una sola plataforma. Nosotros nos encargamos de la migración gratis. Tu primera venta está en nuestras manos."

---

## Timeline Visual

```
SEMANA 1: Validación Gates Externos
├── ARCA certificación live (2 días)
├── Pago real certificación (2 días)
└── Logística real setup (1 día)

SEMANA 2: Onboarding Optimizado
├── Simplificar onboarding (3 días)
└── Templates por rubro (2 días)

SEMANA 3: Migrador Certificado
├── Shopify certificado (2 días)
├── Tiendanube certificado (2 días)
└── Planillas certificado (1 día)

SEMANA 4: Founder-Led Sales
├── Identificar 5 prospects (1 día)
├── Outreach y demo (2 días)
└── Cerrar 2 comercios (2 días)

SEMANA 5: Migración y Primera Venta
├── Migrar comercio 1 (2 días)
├── Migrar comercio 2 (2 días)
└── Lograr primera venta (1 día)

SEMANA 6: Validación y Optimización
├── Medir métricas (2 días)
├── Optimizar onboarding (2 días)
└── Preparar escalamiento (1 día)
```

---

## Success Criteria — 6 Semanas

### Must-Have (Gates de Éxito)

- [ ] **2 comercios externos activos**
- [ ] **2 primeras ventas logradas**
- [ ] **0 intervención SQL**
- [ ] **Onboarding <30 minutos**
- [ ] **Migradores certificados**
- [ ] **Gates externos validados**

### Nice-to-Have

- [ ] 3 comercios comprometidos
- [ ] 1 case study inicial
- [ ] 1 testimonial video
- [ ] 1 referral generado
- [ ] Pay penetration >20%

### Stretch Goals

- [ ] 5 comercios activos
- [ ] $10k GMV mensual
- [ ] 1 partnership cerrado
- [ ] 1 content piece viral
- [ ] 1 press coverage

---

## Post-6 Weeks — Next Steps

### Si Éxito (2 Comercios Activos)

1. **Series A Preparation** (Mes 2-3)
   - Preparar deck con evidencia
   - Identificar inversores
   - Comenzar conversations
   - Target: $2-5M Series A

2. **Scale to 10 Comercios** (Mes 2-3)
   - Refinar onboarding
   - Implementar referral program
   - Content marketing
   - Partnerships

3. **Scale to 50 Comercios** (Mes 4-6)
   - Hire sales team
   - Paid acquisition
   - Customer success team
   - Partner program formal

### Si Fracaso (0-1 Comercio Activo)

1. **Pivot Strategy** (Semana 7)
   - Revisar onboarding
   - Revisar value proposition
   - Revisar target market
   - Considerar pivot de producto

2. **Cut Burn** (Semana 7-8)
   - Reducir equipo
   - Extender runway
   - Revisar unit economics
   - Considerar bootstrapping

3. **Alternative Models** (Semana 9-10)
   - Consultoría productizada
   - Servicios de migración
   - Whitelabel para agencias
   - Marketplace de apps

---

## Conclusion

**Nerqia está técnicamente listo para escalar. El bottleneck es adopción, no construcción.**

**Estrategia CEO:**
1. Pausar desarrollo de nuevas features por 6 semanas
2. Foco 100% en adopción y segundo comercio
3. Founder-led sales para cerrar primeros 2 comercios
4. Validar que el modelo es repetible
5. Escalar a 10 comercios en 2-3 meses
6. Series A con evidencia de tracción

**Inversión:** $130-160k por 6 semanas  
**Riesgo:** Medio (depende de sales, no tecnología)  
**Retorno:** Alto (2 comercios activos = evidencia de product-market fit = Series A)

**Veredicto CEO:** **EJECUTAR AHORA.** La tecnología está lista. El momento es ahora.
