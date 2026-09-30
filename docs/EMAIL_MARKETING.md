# Email marketing: autoridad y operación

## Incidente del envío de las 08:00

El cron `execute-automations-daily` ejecutaba una regla creada automáticamente
por `seed_default_automation_flows`: asunto **Te extrañamos**, cuerpo dirigido al
administrador y nombres de clientes de su organización. No era una campaña
personalizada a cada cliente. El 2026-09-30 se detectaron cuatro reglas activas
con ese asunto; se pausaron en producción y la migración
`20260930000300_marketing_email_safety.sql` conserva la corrección. El motor
rechaza la regla retirada aunque alguien vuelva a activarla.

No volver a sembrar campañas o mensajes comerciales activos al crear una
organización. Las automatizaciones de email son **resúmenes internos** para
owner/admin, con cantidades y sin nombres ni destinatarios externos. Para
contactar compradores se usan Campañas o Secuencias, no Automatizaciones.

## Contrato de envío

1. La audiencia se define en la campaña guardada: segmento o selección de IDs
   de clientes del CRM. El cliente no envía emails, asunto, HTML ni segmento en
   la llamada de despacho. Un test A/B separa los IDs en dos grupos disjuntos.
2. El servidor exige consentimiento registrado y vigente. Cruza ambas listas de
   baja (`email_unsubscribes`, `email_suppressions`) y deduplica por email. Las
   secuencias consultan `marketing_email_eligible` antes de cada paso. Un
   opt-out o supresión siempre prevalece sobre el consentimiento del CRM.
3. El envío reclama la campaña con `claim_email_campaign`; solo un proceso
   cambia un borrador a `sending`. Los reintentos no generan otro token de baja
   para el mismo par campaña/email. El token debe guardarse antes del envío;
   ante error se corta, no sale correo sin baja.
4. Cada mensaje comercial muestra una baja visible y lleva los encabezados
   `List-Unsubscribe` y `List-Unsubscribe-Post`. GET abre confirmación sin
   efectos; POST registra la baja. Las plantillas sustituyen datos propios del
   destinatario, nunca una lista de otras personas.
5. SMTP privado y Resend son rutas explícitas. No hay fallback silencioso entre
   proveedores. Los eventos de proveedor firman el webhook y registran
   entrega, rebote, queja y supresión.

## Operación y verificación pendiente

- Revisar semanalmente `automation_runs`, `email_campaigns.failed_count`,
  `email_events` y las listas de supresión; investigar cualquier salto de
  rebotes o quejas antes de subir volumen.
- Certificar con un grupo de prueba consentido: prueba de campaña, A/B, envío
  programado, secuencia, Gmail y otro proveedor, baja por botón y one-click,
  rebote/queja desde webhook, reintento y ausencia de nombres ajenos. No usar
  datos de clientes reales para pruebas de contenido.
- Confirmar en el proveedor remitente verificado, SPF/DKIM/DMARC, webhook
  firmado, límites y reputación. El código y el DNS no prueban entrega real.
- Registrar evidencia del consentimiento y revisar textos legales con asesoría
  local antes de campañas masivas. No convertir una compra previa en opt-in.

Referencias: [guía oficial de Gmail para remitentes](https://support.google.com/mail/answer/81126),
[encabezados personalizados de Resend](https://resend.com/changelog/custom-email-headers).
