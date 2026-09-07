# P1 Gate Validation Plan — Validación de Gates Externos

**Fecha:** 2026-09-07  
**Objetivo:** Validar que todos los gates externos están listos para segundo comercio  
**Duración:** 1 semana (5 días laborales)  
**Owner:** DevOps + Operación

---

## Estado Actual de Gates Externos

### ARCA (Facturación AFIP)

**Estado Técnico:** ✅ COMPLETAMENTE IMPLEMENTADO

**Evidencia:**
- ✅ `afip-authorize` Edge Function con flow completo
- ✅ WSAA para ticket de acceso
- ✅ Credenciales en tabla segura con RLS (`afip_credentials`)
- ✅ Soporta homologación y producción
- ✅ Flow: credenciales → WSAA → FECompUltimoAutorizado → FECAESolicitar → CAE
- ✅ Certificado en plataforma, delegado por comercio
- ✅ Prevención de duplicados con reserva server-side

**Estado Productivo:** ⚠️ PARCIAL

**Falta:**
- Validar con CUIT real de comercio
- Emitir primera factura real con CAE
- Validar autorización, rechazo, timeout
- Validar webhook de respuesta ARCA

**Tiempo estimado:** 2 días

---

### Pagos (Mercado Pago)

**Estado Técnico:** ✅ COMPLETAMENTE IMPLEMENTADO

**Evidencia:**
- ✅ `store-pay` Edge Function con payment orchestration
- ✅ `paymentOrchestrator` para manejar intents
- ✅ `paymentSettlement` para conciliación
- ✅ Mercado Pago OAuth implementado (`mp-connect`)
- ✅ `mercadopago-webhook` para notificaciones
- ✅ `mercadopago-pos-qr` para QR de mostrador
- ✅ `refund-store-payment` y `refund-pos-payment` para reintegros
- ✅ Soporte para múltiples métodos de pago
- ✅ Idempotencia implementada

**Estado Productivo:** ⚠️ PARCIAL

**Falta:**
- Validar aprobación con cuenta real de Mercado Pago
- Validar rechazo de pago
- Validar timeout y retry
- Validar refund completo
- Validar conciliación automática
- Validar webhook de Mercado Pago

**Tiempo estimado:** 2 días

---

### Email (SMTP + Resend)

**Estado Técnico:** ✅ COMPLETAMENTE IMPLEMENTADO

**Evidencia:**
- ✅ `smtpSender` unificado con fallback a Resend
- ✅ Soporta SMTP propio + Resend
- ✅ `emailErrors` para tracking de errores
- ✅ `resend-webhook` para notificaciones de entrega
- ✅ Muchas funciones de email implementadas:
  - `send-invoice-email`
  - `store-order-email`
  - `store-order-status-email`
  - `send-email-campaign`
  - `send-scheduled-campaigns`
  - `recover-abandoned-carts`
  - `notify-back-in-stock`
  - `send-team-invite`
  - `send-supplier-po`

**Estado Productivo:** ⚠️ PARCIAL

**Falta:**
- Activar Auth SMTP real
- Validar envío desde @nerqia.app
- Validar recepción de emails
- Validar reset de contraseña
- Validar magic link
- Validar invitación
- Validar rebote, queja, supresión
- Validar webhook de Resend

**Tiempo estimado:** 1 día

---

### Logística

**Estado Técnico:** ❌ NO IMPLEMENTADO

**Evidencia:**
- ❌ No hay Edge Function para logística
- ❌ No hay integración con transportista
- ❌ No hay generación de etiquetas
- ❌ No hay tracking de envíos

**Estado Productivo:** ❌ NO CERRADO

**Falta:**
- Contactar transportista para contrato real
- Configurar tarifas reales
- Implementar generación de etiquetas
- Implementar tracking
- Test con envío real

**Tiempo estimado:** 2 días

---

## Plan de Validación — Día por Día

### DÍA 1: ARCA Certificación Live

**Objetivo:** Validar ARCA con CUIT real y emitir primera factura real

**Tareas:**

#### Mañana (4 horas)

1. **Obtener CUIT Real de Prueba** (1 hora)
   - Usar CUIT de comercio existente o CUIT de prueba
   - Validar que el CUIT esté habilitado para facturación
   - **Owner:** Responsable fiscal
   - **Outcome:** CUIT real validado

2. **Validar Certificado de Plataforma** (1 hora)
   - Verificar que el certificado de plataforma esté activo
   - Validar que tenga los permisos necesarios
   - **Owner:** DevOps
   - **Outcome:** Certificado validado

3. **Emitir Primera Factura Real** (2 horas)
   - Crear factura de prueba con CUIT real
   - Validar que se obtenga CAE real
   - Validar que la factura sea válida en AFIP
   - **Owner:** Responsable fiscal + Dev
   - **Outcome:** Primera factura real emitida

#### Tarde (4 horas)

4. **Validar Estados de Factura** (2 horas)
   - Test autorización exitosa
   - Test rechazo (datos inválidos)
   - Test timeout (simular)
   - **Owner:** Dev
   - **Outcome:** Estados validados

5. **Validar Webhook ARCA** (2 horas)
   - Configurar webhook de respuesta ARCA
   - Test notificación de respuesta
   - Validar que se procese correctamente
   - **Owner:** DevOps
   - **Outcome:** Webhook validado

**Gate de Éxito DÍA 1:**
- [ ] CUIT real validado
- [ ] Certificado validado
- [ ] Primera factura real emitida
- [ ] Estados validados
- [ ] Webhook validado

---

### DÍA 2: Pagos Certificación Live

**Objetivo:** Validar pagos con cuenta real de Mercado Pago

**Tareas:**

#### Mañana (4 horas)

1. **Obtener Cuenta Real de Mercado Pago** (1 hora)
   - Usar cuenta de comercio existente
   - Validar que tenga saldo para pruebas
   - **Owner:** DevOps
   - **Outcome:** Cuenta real validada

2. **Validar Aprobación de Pago** (2 horas)
   - Crear orden de prueba
   - Procesar pago con tarjeta real
   - Validar que se apruebe correctamente
   - **Owner:** Dev
   - **Outcome:** Aprobación validada

3. **Validar Conciliación Automática** (1 hora)
   - Verificar que el pago se concilie automáticamente
   - Validar que el webhook de Mercado Pago funcione
   - **Owner:** Dev
   - **Outcome:** Conciliación validada

#### Tarde (4 horas)

4. **Validar Rechazo de Pago** (2 horas)
   - Test tarjeta rechazada
   - Validar que se maneje correctamente
   - Validar que el usuario reciba feedback claro
   - **Owner:** Dev
   - **Outcome:** Rechazo validado

5. **Validar Timeout y Retry** (1 hora)
   - Simular timeout de Mercado Pago
   - Validar que el sistema reintente correctamente
   - Validar idempotencia
   - **Owner:** Dev
   - **Outcome:** Timeout validado

6. **Validar Refund Completo** (1 hora)
   - Test refund de pago aprobado
   - Validar que se procese correctamente
   - Validar conciliación del refund
   - **Owner:** Dev
   - **Outcome:** Refund validado

**Gate de Éxito DÍA 2:**
- [ ] Cuenta real validada
- [ ] Aprobación validada
- [ ] Conciliación validada
- [ ] Rechazo validado
- [ ] Timeout validado
- [ ] Refund validado

---

### DÍA 3: Email Productivo

**Objetivo:** Validar email con SMTP real y Resend

**Tareas:**

#### Mañana (4 horas)

1. **Activar Auth SMTP Real** (2 horas)
   - Configurar Auth SMTP en Supabase
   - Validar que las credenciales sean correctas
   - **Owner:** DevOps
   - **Outcome:** Auth SMTP activado

2. **Validar Envío desde @nerqia.app** (2 horas)
   - Enviar email de prueba desde @nerqia.app
   - Validar que llegue correctamente
   - Validar SPF/DKIM/DMARC
   - **Owner:** DevOps
   - **Outcome:** Envío validado

#### Tarde (4 horas)

3. **Validar Recepción de Emails** (2 horas)
   - Test recepción de respuestas
   - Validar que se procesen correctamente
   - **Owner:** Dev
   - **Outcome:** Recepción validada

4. **Validar Reset de Contraseña** (1 hora)
   - Test flujo completo de reset
   - Validar magic link
   - **Owner:** Dev
   - **Outcome:** Reset validado

5. **Validar Invitación** (1 hora)
   - Test invitación de equipo
   - Validar que el link funcione
   - **Owner:** Dev
   - **Outcome:** Invitación validada

**Gate de Éxito DÍA 3:**
- [ ] Auth SMTP activado
- [ ] Envío desde @nerqia.app validado
- [ ] Recepción validada
- [ ] Reset validado
- [ ] Invitación validada

---

### DÍA 4: Logística Real Setup

**Objetivo:** Contratar logística y configurar tarifas reales

**Tareas:**

#### Mañana (4 horas)

1. **Contactar Transportistas** (2 horas)
   - Contactar 3 transportistas (Andreani, OCA, Correo Argentino)
   - Solicitar cotización
   - **Owner:** CEO/Fundador
   - **Outcome:** Cotizaciones obtenidas

2. **Seleccionar Transportista** (2 horas)
   - Evaluar cotizaciones
   - Seleccionar mejor opción
   - Negociar contrato
   - **Owner:** CEO/Fundador
   - **Outcome:** Transportista seleccionado

#### Tarde (4 horas)

3. **Firmar Contrato** (2 horas)
   - Revisar contrato legal
   - Firmar contrato
   - Configurar cuenta
   - **Owner:** CEO/Fundador
   - **Outcome:** Contrato firmado

4. **Configurar Tarifas Reales** (2 horas)
   - Cargar tarifas reales en sistema
   - Configurar zonas de envío
   - Test cálculo de envío
   - **Owner:** Dev
   - **Outcome:** Tarifas configuradas

**Gate de Éxito DÍA 4:**
- [ ] 3 cotizaciones obtenidas
- [ ] Transportista seleccionado
- [ ] Contrato firmado
- [ ] Tarifas configuradas

---

### DÍA 5: Integración Logística

**Objetivo:** Implementar integración básica con transportista

**Tareas:**

#### Mañana (4 horas)

1. **Implementar Generación de Etiquetas** (3 horas)
   - Crear Edge Function para generar etiquetas
   - Integrar con API de transportista
   - Test generación de etiqueta
   - **Owner:** Dev
   - **Outcome:** Generación de etiquetas implementada

2. **Test Etiqueta Real** (1 hora)
   - Generar etiqueta para envío real
   - Validar que sea válida
   - **Owner:** Dev
   - **Outcome:** Etiqueta real validada

#### Tarde (4 horas)

3. **Implementar Tracking Básico** (3 horas)
   - Crear Edge Function para tracking
   - Integrar con API de transportista
   - Test tracking
   - **Owner:** Dev
   - **Outcome:** Tracking implementado

4. **Test Envío Real** (1 hora)
   - Test envío real con tracking
   - Validar que se actualice correctamente
   - **Owner:** Dev
   - **Outcome:** Envío real validado

**Gate de Éxito DÍA 5:**
- [ ] Generación de etiquetas implementada
- [ ] Etiqueta real validada
- [ ] Tracking implementado
- [ ] Envío real validado

---

## KPIs de Validación

### ARCA
- **Autorización rate:** >95%
- **CAE obtenido:** 100%
- **Timeout rate:** <5%
- **Webhook delivery rate:** >98%

### Pagos
- **Aprobación rate:** >90%
- **Conciliación rate:** >95%
- **Refund success rate:** >95%
- **Webhook delivery rate:** >98%

### Email
- **Delivery rate:** >98%
- **Open rate:** >40%
- **Click rate:** >5%
- **Bounce rate:** <2%

### Logística
- **Label generation rate:** 100%
- **Tracking accuracy:** >95%
- **Lead time:** <48 horas
- **Cost accuracy:** 100%

---

## Risk Mitigation

### Riesgo 1: ARCA Rechaza CUIT

**Probabilidad:** 🟡 Media  
**Impacto:** 🟡 Medio

**Mitigación:**
- Validar CUIT antes de empezar
- Tener CUIT de backup
- Contactar soporte ARCA si hay problemas

### Riesgo 2: Mercado Pago Rechaza Pago

**Probabilidad:** 🟢 Baja  
**Impacto:** 🟡 Medio

**Mitigación:**
- Usar tarjeta con saldo
- Validar límites de cuenta
- Tener método de pago backup

### Riesgo 3: SMTP No Funciona

**Probabilidad:** 🟢 Baja  
**Impacto:** 🟢 Bajo

**Mitigación:**
- Tener Resend como fallback
- Validar configuración DNS
- Tener proveedor backup

### Riesgo 4: Transportista No Acepta Contrato

**Probabilidad:** 🟡 Media  
**Impacto:** 🟡 Medio

**Mitigación:**
- Contactar 3 transportistas
- Tener backup logístico
- Considerar logística propia inicial

---

## Gates de Éxito — Semana 1

### Must-Have

- [ ] **ARCA emite factura real** con CUIT real
- [ ] **Pagos procesan aprobación/rechazo/timeout** con cuenta real
- [ ] **Email envía y recibe correctamente** desde @nerqia.app
- [ ] **Logística tiene contrato firmado** con tarifas reales

### Nice-to-Have

- [ ] ARCA timeout <5 segundos
- [ ] Pagos conciliación <1 minuto
- [ ] Email delivery >99%
- [ ] Logística lead time <24 horas

### Stretch Goals

- [ ] ARCA autorización rate >98%
- [ ] Pagos aprobación rate >95%
- [ ] Email open rate >50%
- [ ] Logística integración completa

---

## Dependencies

```
DÍA 1 (ARCA) ──────┐
                    │
DÍA 2 (Pagos) ───────┤
                    ├──► P0 (Segundo Comercio)
                    │
DÍA 3 (Email) ────────┤
                    │
DÍA 4 (Logística) ────┘
                    │
DÍA 5 (Integración) ──┘
```

**Critical Path:** DÍA 1 → DÍA 2 → DÍA 3 → DÍA 4 → DÍA 5

---

## Post-Validación — Ready for Sales

### Checklist de Ready for Sales

- [ ] ARCA certificada live
- [ ] Pagos certificados live
- [ ] Email productivo validado
- [ ] Logística contratada
- [ ] Todos los gates funcionales
- [ ] Documentación de gates
- [ ] Playbooks de resolución
- [ ] Soporte preparado

### Handoff a Sales

- Presentar resultados de validación
- Documentar capacidades
- Crear materials de demo
- Preparar respuestas a objections
- Configurar CRM para tracking

---

## Conclusion

**Los gates externos están 80% implementados técnicamente.** Falta validación productiva real.

**Estrategia:**
- Dedicar 1 semana a validación intensiva
- Validar cada gate con datos reales
- Documentar resultados
- Preparar playbooks de resolución
- Handoff a sales para P0

**Inversión:** $20-30k (1 semana de DevOps + Operación)  
**Outcome:** Gates externos validados = Ready para segundo comercio = Escalado posible

**Veredicto:** **EJECUTAR P1 AHORA.** Gates externos son prerequisite para segundo comercio.
