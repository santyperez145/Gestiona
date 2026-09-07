# Plan de Continuación — Post-Rediseño

**Fecha:** 2026-09-07
**Estado:** Rediseño completado y pusheado
**Próximo paso:** Validación de gates externos (P1)

---

## 🎯 Contexto

El rediseño de plataformas está completo (100%). Las superficies TIENDAS ONLINE y FINANCE están rediseñadas con IA útil específica para conversión y optimización financiera.

**Ahora es momento de validar que la infraestructura real funcione.**

---

## 📋 Prioridades CEO/CTO/CFO/UI/UX/PO/PM

### CEO / Inversor
**Pregunta:** ¿Acerca Active Transacting Merchants (ATM) o un segundo comercio a su primera venta?

**Siguiente paso:** Validar gates externos para asegurar que la infraestructura soporte un segundo comercio real.

### CTO
**Pregunta:** ¿Es la tecnología que usa la competencia seria (Meta Cloud, OAuth, webhooks firmados, autoridad en servidor)?

**Siguiente paso:** Validar ARCA, Pagos (Mercado Pago), Email y Logística con integraciones reales.

### CFO
**Pregunta:** ¿Protege margen, cobro, comisión, costo e IVA?

**Siguiente paso:** Validar que los pagos y facturación funcionen correctamente para no perder margen.

### PM / PO
**Pregunta:** ¿Hay estados completos, honestidad de canal, deep-link accionable y evidencia medible?

**Siguiente paso:** Validar cada gate con evidencia real (no simulación).

---

## 🚀 Plan de Continuación — FASE 2: Validación de Gates Externos

### Día 1-2: ARCA Validation

**Objetivo:** Validar que ARCA funcione con un CUIT real.

**Requisitos:**
- CUIT real de organización
- Certificado y clave privada (en `afip_credentials` via Edge Function)
- Environment: homologación primero, luego producción

**Validación:**
1. ✅ Obtener WSAA Ticket de Acceso
2. ✅ Solicitar CAE vía `FECAESolicitar`
3. ✅ Emitir primera factura real
4. ✅ Persistir CAE y número de factura
5. ✅ Verificar que la factura sea válida

**Evidencia requerida:**
- Número de CAE
- Fecha de vencimiento de CAE
- PDF de factura emitida
- Confirmación de ARCA

**Riesgo:** Sin CUIT real, no se puede validar.

---

### Día 3-4: Mercado Pago Validation

**Objetivo:** Validar que los pagos funcionen con una cuenta real.

**Requisitos:**
- Cuenta de Mercado Pago OAuth
- Access token
- Preference ID configurado
- Webhook configurado

**Validación:**
1. ✅ OAuth flow funciona
2. ✅ Crear preferencia de pago
3. ✅ Checkout de Mercado Pago redirige correctamente
4. ✅ Webhook recibe notificación de pago
5. ✅ Webhook firma es válida
6. ✅ Pago se procesa y se crea orden real
7. ✅ Idempotencia funciona (reintentos no duplican pagos)

**Evidencia requerida:**
- ID de preferencia
- ID de pago
- Estado de pago (approved)
- Webhook payload (redactado)
- Orden creada en base de datos

**Riesgo:** Sin cuenta real, no se puede validar.

---

### Día 5: Email Validation

**Objetivo:** Validar que los emails se envíen correctamente.

**Requisitos:**
- SMTP configurado o Resend API key
- Template de email de orden
- Email de prueba real

**Validación:**
1. ✅ SMTP connection funciona
2. ✅ Email de orden se envía
3. ✅ Email llega a inbox (no spam)
4. ✅ Links en email funcionan
5. ✅ Abandono de carrito email se envía
6. ✅ Recovery de carrito funciona

**Evidencia requerida:**
- Email recibido
- Headers de email
- Tracking de open/click
- Confirmación de entrega

**Riesgo:** Sin SMTP configurado, no se puede validar.

---

### Día 6: Logística Validation

**Objetivo:** Validar que la logística se pueda cotizar y programar.

**Requisitos:**
- Integración con Andreani o similar
- Datos de envío reales
- Código postal real

**Validación:**
1. ✅ Cotización de envío funciona
2. ✅ Costo de envío es correcto
3. ✅ Programación de retiro funciona
4. ✅ Tracking de envío funciona
5. ✅ Notificación de entrega funciona

**Evidencia requerida:**
- ID de envío
- Costo de envío
- Estado de envío
- Tracking ID

**Riesgo:** Sin integración real, no se puede validar.

---

## 📊 Métricas de Éxito P1

### ARCA
- ✅ Primera factura emitida con CAE válido
- ✅ Tiempo de emisión < 5 segundos
- ✅ No errores de WSAA
- ✅ No errores de FECAESolicitar

### Mercado Pago
- ✅ Checkout funciona sin errores
- ✅ Webhook recibe notificación
- ✅ Pago se procesa correctamente
- ✅ Idempotencia funciona
- ✅ No pagos duplicados

### Email
- ✅ Emails se envían correctamente
- ✅ Entrega > 95%
- ✅ No spam folder
- ✅ Links funcionan

### Logística
- ✅ Cotización funciona
- ✅ Costo correcto
- ✅ Programación funciona
- ✅ Tracking funciona

---

## 🎯 KPIs de Éxito Global

- ✅ Todos los gates validados con evidencia real
- ✅ Tiempo de validación < 7 días
- ✅ No bloqueos por infraestructura
- ✅ Ready para segundo comercio real

---

## 📝 Requisitos de Usuario

Para continuar con P1, necesito:

1. **CUIT real** para ARCA
2. **Cuenta de Mercado Pago** para pagos
3. **SMTP configurado** o Resend API key para email
4. **Integración logística** (Andreani o similar) para envíos

---

## 🚀 Opción B: Si no hay acceso a gates externos

Si no hay acceso a gates externos ahora, puedo continuar con:

1. **Integrar componentes en rutas** — Conectar los nuevos componentes a las rutas reales
2. **Typecheck y build** — Verificar que no haya errores
3. **Tests** — Asegurar que los componentes funcionen
4. **Documentación** — Documentar los componentes para el equipo

**Recomendación:** Si gates externos no están disponibles, continuar con integración de componentes para que el rediseño sea funcional en la aplicación.

---

## 🎯 Próxima Acción

**Pregunta para el usuario:**

¿Tienes acceso a gates externos (CUIT, Mercado Pago, SMTP, logística) para validar P1?

**Opción A:** Sí, tengo acceso. Continuar con validación de gates externos.
**Opción B:** No, no tengo acceso ahora. Continuar con integración de componentes en rutas.

---

## 📌 Nota

**Prioridad CEO:** Validar gates externos es crítico para asegurar que la infraestructura soporte un segundo comercio real. Sin esto, el rediseño es visual pero no funcional.

**Prioridad CTO:** Validar que las integraciones reales funcionen antes de escalar.

**Prioridad CFO:** Validar que los pagos y facturación funcionen para no perder margen.

**Prioridad PM/PO:** Validar con evidencia real, no simulación.
