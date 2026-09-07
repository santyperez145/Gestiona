# ATM Priority Slices — Máximo Impacto para Active Transacting Merchants

**Fecha:** 2026-09-07  
**Objetivo:** Priorizar slices que más acercan a ATM (Active Transacting Merchants)  
**Principio:** Cada slice debe tener impacto medible en segundos/ventas/comercios

---

## Priority Matrix — Impacto ATM vs Esfuerzo

```
ALTO IMPACTO ATM
│
│  [P0] Segundo comercio real ████████████████████
│  [P1] Gates externos validados ██████████████
│  [P2] Onboarding <30 minutos ████████████
│  [P3] Migrador certificado ███████████
│  [P4] Primeras ventas logradas █████████
│
│──────────────────────────────────────────
│ BAJO IMPACTO ATM
│  [P5] B2B commerce ███
│  [P6] Themes avanzados ██
│  [P7] Page builder █
│  [P8] IA agents █
│  [P9] Capital █
│
└──────────────────────────────────────────
    BAJO ESFUERZO        ALTO ESFUERZO
```

---

## SLICE P0: Segundo Comercio Real (CRÍTICO)

**Impacto ATM:** 🔴 CRÍTICO  
**Esfuerzo:** 🟡 Medio  
**Tiempo:** 2-4 semanas  
**Owner:** CEO/Fundador  
**Outcome:** 2 comercios externos activos

### Sub-slices

#### P0.1: Identificar 5 Prospects (1 día)
- Ferreterías, perfumerías, electrónica
- Que ya tengan tienda en Shopify/Tiendanube
- Que estén frustrados con margen/conciliación
- **Outcome:** 5 prospects calificados

#### P0.2: Outreach y Demo (2 días)
- Presentar Nerqia como Commerce OS
- Demostrar margin intelligence
- Ofrecer migración gratis
- **Outcome:** 3 demos agendadas

#### P0.3: Cerrar 2 Comercios (2 días)
- Cerrar contrato con 2 comercios
- Comenzar migración
- **Outcome:** 2 comercios comprometidos

#### P0.4: Migrar 2 Comercios (4 días)
- Ejecutar migración certificado
- Validar catálogo, stock, clientes
- Publicar tienda
- **Outcome:** 2 comercios migrados

#### P0.5: Lograr 2 Primeras Ventas (3 días)
- Apoyar cada comercio en primera venta
- Validar checkout, pago, fulfillment
- **Outcome:** 2 primeras ventas logradas

### KPIs
- **North Star:** ATM = 2 (hoy: 1)
- **Tiempo hasta primera venta:** <7 días
- **Tiempo de migración:** <4 horas
- **Conversión prospecto → comercio:** >40%

### Gates de Éxito
- [ ] 2 comercios externos activos
- [ ] 2 primeras ventas logradas
- [ ] 0 intervención SQL
- [ ] Onboarding <30 minutos

---

## SLICE P1: Gates Externos Validados

**Impacto ATM:** 🟡 Medio  
**Esfuerzo:** 🟢 Bajo  
**Tiempo:** 1 semana  
**Owner:** DevOps/Operación  
**Outcome:** Todos los gates externos funcionales

### Sub-slices

#### P1.1: ARCA Certificación Live (2 días)
- Validar certificado productivo con CUIT real
- Emitir primera factura real
- Verificar autorización, rechazo, timeout
- **Outcome:** ARCA certificada live

#### P1.2: Pago Real Certificación (2 días)
- Validar aprobación, rechazo, webhook, timeout, refund
- Test con Mercado Pago cuenta real
- Validar conciliación automática
- **Outcome:** Pagos certificados live

#### P1.3: Logística Real Setup (1 día)
- Contactar transportista para contrato real
- Configurar tarifas reales
- Test generación de etiqueta real
- **Outcome:** Contrato logística firmado

#### P1.4: Correo Productivo (2 días)
- Activar Resend, Auth SMTP
- Validar envío real desde @nerqia.app
- Validar recepción, reset, magic link
- **Outcome:** Correo productivo validado

### KPIs
- **ARCA approval rate:** >95%
- **Pago approval rate:** >90%
- **Logística lead time:** <48 horas
- **Email delivery rate:** >98%

### Gates de Éxito
- [ ] ARCA emite factura real
- [ ] Pagos procesan aprobación/rechazo/timeout
- [ ] Logística tiene contrato firmado
- [ ] Correo envía y recibe correctamente

---

## SLICE P2: Onboarding Optimizado

**Impacto ATM:** 🟡 Medio  
**Esfuerzo:** 🟡 Medio  
**Tiempo:** 1 semana  
**Owner:** PM/UX  
**Outcome:** Onboarding <30 minutos

### Sub-slices

#### P2.1: Simplificar Onboarding (3 días)
- Reducir onboarding a <30 minutos
- Eliminar pasos técnicos del merchant
- Auto-configurar todo lo posible
- **Outcome:** Onboarding <30 minutos

#### P2.2: Templates por Rubro (2 días)
- Templates para ferretería, perfumería, electrónica
- Pre-configurar categorías, atributos, defaults
- **Outcome:** 3 templates funcionales

#### P2.3: Video Walkthrough (2 días)
- Video corto para cada paso del onboarding
- Integrado en el flujo
- **Outcome:** 5 videos creados

### KPIs
- **Onboarding completion rate:** >80%
- **Onboarding time:** <30 minutos
- **Support tickets durante onboarding:** <1 por merchant
- **Drop-off rate:** <20%

### Gates de Éxito
- [ ] Onboarding <30 minutos
- [ ] 3 templates funcionales
- [ ] 0 intervención SQL
- [ ] 80% completion rate

---

## SLICE P3: Migrador Certificado

**Impacto ATM:** 🟡 Medio  
**Esfuerzo:** 🟡 Medio  
**Tiempo:** 1 semana  
**Owner:** Dev  
**Outcome:** Migrador certificado con datos reales

### Sub-slices

#### P3.1: Certificar Migrador Shopify (2 días)
- Test con export real de Shopify
- Validar mapeo exacto de campos
- Validar imágenes propias
- Validar rollback seguro
- **Outcome:** Shopify migrador certificado

#### P3.2: Certificar Migrador Tiendanube (2 días)
- Test con export real de Tiendanube
- Cerrar mapeo exacto (actualmente detecta por nombre)
- Validar clientes
- **Outcome:** Tiendanube migrador certificado

#### P3.3: Certificar Migrador Planillas (1 día)
- Test con Excel real de comercio
- Validar detección de origen
- **Outcome:** Planillas migrador certificado

#### P3.4: Documentar Edge Cases (2 días)
- Documentar cada edge case encontrado
- Crear playbooks de resolución
- **Outcome:** Edge cases documentados

### KPIs
- **Migración success rate:** >95%
- **Migración time:** <4 horas
- **Rollback success rate:** 100%
- **Data loss rate:** 0%

### Gates de Éxito
- [ ] 3 migradores certificados con datos reales
- [ ] Rollback condicionado funcional
- [ ] 0 correcciones manuales
- [ ] 95% success rate

---

## SLICE P4: Primeras Ventas Logradas

**Impacto ATM:** 🟡 Medio  
**Esfuerzo:** 🟢 Bajo  
**Tiempo:** 1 semana  
**Owner:** Success  
**Outcome:** Primeras ventas de comercios externos

### Sub-slices

#### P4.1: Apoyar Primera Venta (3 días)
- Success dedicado a ayudar
- On-call para resolver issues
- Validar checkout, pago, fulfillment
- **Outcome:** 2 primeras ventas logradas

#### P4.2: Medir Conversión (2 días)
- Medir conversión de checkout
- Identificar drop-offs
- Optimizar funnel
- **Outcome:** Conversión >3%

#### P4.3: Crear Incentivos (2 días)
- Incentivos para primera venta
- Publicar en redes sociales
- **Outcome:** Incentivos activos

### KPIs
- **Primeras ventas:** 2
- **Conversión checkout:** >3%
- **Tiempo hasta primera venta:** <7 días
- **Support response time:** <2 horas

### Gates de Éxito
- [ ] 2 primeras ventas logradas
- [ ] Conversión >3%
- [ ] <7 días para primera venta
- [ ] Soporte response <2 horas

---

## SLICE P5: Métricas y Analytics

**Impacto ATM:** 🟢 Bajo  
**Esfuerzo:** 🟢 Bajo  
**Tiempo:** 3 días  
**Owner:** Data  
**Outcome:** Métricas baseline establecidas

### Sub-slices

#### P5.1: Implementar Tracking (1 día)
- Eventos de onboarding
- Eventos de migración
- Eventos de primera venta
- **Outcome:** Tracking implementado

#### P5.2: Dashboard de Métricas (1 día)
- Dashboard de ATM
- Dashboard de conversión
- Dashboard de tiempo a primera venta
- **Outcome:** Dashboard funcional

#### P5.3: Baseline Medido (1 día)
- Medir métricas baseline
- Documentar current state
- **Outcome:** Baseline establecido

### KPIs
- **Tracking coverage:** 100%
- **Dashboard accuracy:** 100%
- **Baseline measured:** ✅

### Gates de Éxito
- [ ] Tracking implementado
- [ ] Dashboard funcional
- [ ] Baseline medido
- [ ] Métricas accuradas

---

## Orden de Ejecución — Sprints de 2 Semanas

### SPRINT 1 (Semana 1-2): Gates + Onboarding

**Sprint Goal:** Validar que la infraestructura está lista para segundo comercio

**Slices:**
- P1: Gates externos validados (Semana 1)
- P2: Onboarding optimizado (Semana 2)

**Sprint Review:**
- [ ] Gates externos funcionales
- [ ] Onboarding <30 minutos
- [ ] Ready para merchant real

### SPRINT 2 (Semana 3-4): Migrador + Sales

**Sprint Goal:** Certificar migrador y cerrar primeros 2 comercios

**Slices:**
- P3: Migrador certificado (Semana 3)
- P0.1-P0.3: Sales (Semana 4)

**Sprint Review:**
- [ ] Migrador certificado
- [ ] 2 comercios comprometidos
- [ ] Ready para migración

### SPRINT 3 (Semana 5-6): Migración + Primeras Ventas

**Sprint Goal:** Migrar 2 comercios y lograr primeras ventas

**Slices:**
- P0.4-P0.5: Migración + primeras ventas (Semana 5)
- P4: Primeras ventas logradas (Semana 6)
- P5: Métricas baseline (Semana 6)

**Sprint Review:**
- [ ] 2 comercios migrados
- [ ] 2 primeras ventas logradas
- [ ] Métricas baseline establecidas
- [ ] Ready para escalar

---

## Dependencies Graph

```
P1 (Gates Externos) ──────┐
                          │
                          ├──► P0 (Segundo Comercio)
                          │
P2 (Onboarding) ──────────┘
                          │
                          ├──► P3 (Migrador)
                          │
                          ├──► P4 (Primeras Ventas)
                          │
                          └──► P5 (Métricas)
```

**Critical Path:** P1 → P2 → P0 → P3 → P4 → P5

---

## Risk Mitigation por Slice

### P0: Segundo Comercio

**Riesgo:** No conseguir 2 comercios  
**Mitigación:**
- Identificar 10 prospects, no 5
- Ofrecer migración gratis + 3 meses gratis
- CEO dedicado 100% a sales
- Backup plan: comercio conocido

### P1: Gates Externos

**Riesgo:** Gates fallan  
**Mitigación:**
- Validar cada gate antes de sales
- Plan B para cada gate
- Contactar proveedores anticipadamente
- Documentar workarounds

### P2: Onboarding

**Riesgo:** Onboarding >30 minutos  
**Mitigación:**
- Medir tiempo real con usuarios
- Eliminar pasos no críticos
- Auto-configurar máximo posible
- Video walkthrough para cada paso

### P3: Migrador

**Riesgo:** Migración falla  
**Mitigación:**
- Certificar con datos reales antes
- Rollback seguro implementado
- Dev on-call durante migración
- Plan B: migración manual parcial

### P4: Primeras Ventas

**Riesgo:** Primera venta no lograda  
**Mitigación:**
- Success dedicado a ayudar
- CEO on-call para resolver issues
- Incentivos para primera venta
- Publicar en redes sociales

---

## Success Criteria — 6 Semanas

### Must-Have

- [ ] **2 comercios externos activos** (P0)
- [ ] **2 primeras ventas logradas** (P0, P4)
- [ ] **0 intervención SQL** (P0, P3)
- [ ] **Onboarding <30 minutos** (P2)
- [ ] **Migradores certificados** (P3)
- [ ] **Gates externos validados** (P1)

### Nice-to-Have

- [ ] 3 comercios comprometidos (P0)
- [ ] 1 case study inicial (P4)
- [ ] 1 testimonial video (P4)
- [ ] Pay penetration >20% (P4)
- [ ] Métricas baseline completas (P5)

### Stretch Goals

- [ ] 5 comercios activos (P0)
- [ ] $10k GMV mensual (P4)
- [ ] 1 partnership cerrado (P0)
- [ ] 1 content piece viral (P4)
- [ ] 1 press coverage (P4)

---

## Post-6 Weeks — Escalando a 10 Comercios

### SPRINT 4 (Semana 7-8): Refinar y Documentar

**Slices:**
- Refinar onboarding basado en learning
- Documentar proceso de sales
- Crear playbooks de migración
- Preparar materials de marketing

**Sprint Review:**
- [ ] Proceso documentado
- [ ] Playbooks creados
- [ ] Materials ready
- [ ] Ready para escalar

### SPRINT 5 (Semana 9-10): Escalar a 5 Comercios

**Slices:**
- Ejecutar proceso de sales documentado
- Migrar 3 comercios adicionales
- Lograr 5 primeras ventas
- Medir y optimizar

**Sprint Review:**
- [ ] 5 comercios activos
- [ ] 5 primeras ventas
- [ ] Proceso validado
- [ ] Ready para escalar a 10

### SPRINT 6 (Semana 11-12): Escalar a 10 Comercios

**Slices:**
- Implementar referral program
- Content marketing
- Partnerships iniciales
- Migrar 5 comercios adicionales

**Sprint Review:**
- [ ] 10 comercios activos
- [ ] 10 primeras ventas
- [ ] Referral program activo
- [ ] Ready para Series A

---

## Conclusion

**Los slices de máximo impacto ATM son:**

1. **P0: Segundo Comercio Real** (CRÍTICO)
2. **P1: Gates Externos Validados** (MEDIO)
3. **P2: Onboarding Optimizado** (MEDIO)
4. **P3: Migrador Certificado** (MEDIO)
5. **P4: Primeras Ventas Logradas** (MEDIO)

**Estrategia de ejecución:**
- 3 sprints de 2 semanas
- Foco 100% en adopción
- Pausar desarrollo de nuevas features
- Founder-led sales
- Success intensivo

**Inversión:** $130-160k por 6 semanas  
**Outcome:** 2 comercios externos activos = evidencia de product-market fit = Series A

**Veredicto:** **EJECUTAR P0 AHORA.** Segundo comercio es el blocker crítico para escalar.
