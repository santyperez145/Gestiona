# F5.1 — Certificación del primer documento Finance

**Estado:** referencia operativa; certificación real pendiente.
**Revisión:** 2026-10-01. **Owner:** Producto / Operación Finance.
Autoridad del dominio: [Finance](FINANCE.md); prioridad: [roadmap](../ROADMAP.md).

## Alcance de la evidencia existente

La verificación `supabase/verificaciones/20260925_finance_document_extraction_e2e.sql`
crea una fixture y metadata de Storage; inicia/completa la extracción con un
payload preparado, dentro de `BEGIN/ROLLBACK`. Comprueba autoridad, transiciones,
matching y entrega idempotente. No llama al proveedor HTTP, no sube por sí sola
un PDF físico ni prueba OCR/antimalware externo. No demuestra adopción comercial.

La consulta `supabase/verificaciones/20261001_finance_product_evidence.sql`
registró 0 documentos, 0 políticas y 0 lotes contables el 2026-10-01.
Sólo usa agregados; no revela nombres, documentos ni beneficiarios.
Es evidencia persistida ausente, no prueba de proveedor deshabilitado.

## Protocolo real autorizado

1. Elegir tenant, usuario/rol y documento del negocio autorizados; no crear datos
   comerciales ni enviar PII al proveedor sin aprobación y política de datos.
2. Confirmar disponibilidad del extractor/inspector mediante su contrato de
   servicio, bucket privado, permisos y configuración; no leer secretos en UI.
3. Cargar bytes reales mediante `uploadFinanceDocument`: intención/path
   server-side, MIME/tamaño/hash, versión, inspección y original privado.
4. Invocar el extractor real, conservar request/correlación y resultado sanitizado.
   Confianza calibrada por campo, sin umbral mágico ni importe/categoría por defecto.
5. Revisar originales, impuestos, moneda y líneas; corregir con traza y confirmar
   matching contra proveedor/orden del mismo tenant.
6. Preparar y aprobar borradores bajo política/presupuesto y segregación; verificar
   efecto en Core y vínculo al original. Aprobar no implica pago externo.
7. Probar reintento: sin segunda compra/deuda/asiento. Verificar estados de fallo,
   permiso, duplicado, cuarentena y recuperación con fixtures reversibles.
8. Conciliar/exportar cuando corresponda; el responsable financiero valida cifras.
   Conservar evidencia de operación, sin adjuntar PII al repo.

## Cierre

Certificado sólo con original físico, proveedor real, revisión, aprobación,
efecto canónico, idempotencia y evidencia autorizada. Adoptado requiere además
uso por merchant sin intervención SQL. Una fixture verde no cierra ninguno.

Registrar fecha, entorno, tenant anonimizado, roles, versiones/IDs de correlación,
resultado y limitaciones en el contrato vigente; no crear otra bitácora.
No declarar pago, recepción bancaria o integración ERP a partir de una referencia
manual. El rollback de las pruebas no reemplaza conciliación de una operación real.
