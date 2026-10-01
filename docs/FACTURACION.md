# Facturación y autoridad fiscal

**Estado:** vigente, 2026-10-01. **Responsable:** Business Core / integración ARCA.
Este contrato describe cálculo, persistencia y representación. Configuración
general vive en [CONFIGURACION.md](CONFIGURACION.md); normativa en [LEGAL.md](LEGAL.md).

- POS factura el total persistido de sus ventas, no vuelve a añadir IVA según
  la configuración de precios de lista. Número, cabecera, renglones, vínculo
  con ventas y evento se crean en una transacción bloqueada por ticket.
- Las nuevas ventas capturan la tasa server-side. Las históricas conservan
  `fiscal_tax_rate = NULL`: no se les inventa un snapshot; al facturarlas se usa
  la configuración vigente, que requiere revisión si cambió desde la venta.
- Nuevos renglones POS almacenan neto, tasa e IVA. WSFE agrupa cada tasa con su
  Id oficial y verifica neto + IVA = total. `tax_pct = 0` en una cabecera mixta
  no significa IVA cero: la autoridad es el desglose de renglones.
- Las NC reservan saldo e IVA por alícuota, incluyendo borradores previos. Una
  NC completa cierra exactamente los importes restantes. No mueve inventario
  ni acredita dinero: esos hechos tienen autoridad en Devoluciones y Pay.
- ARCA toma una nueva lectura después de reservar. Cabecera y renglones se
  congelan durante `processing`; con CAE no se editan ni eliminan. Rechazos
  permiten corregir; una respuesta incierta mantiene la reserva para conciliar.
- A4 y 80 mm muestran neto/IVA para A y NC A, precios finales para B/C y sus NC,
  transparencia, identidad congelada, CAE/QR y referencia de la NC. Homologación
  se identifica explícitamente y no es un comprobante productivo.

## Verificación y pendientes

`supabase/verificaciones/20261001_invoice_line_iva_authority.sql` prueba POS con
21%/10,5%, snapshot frente a cambios de catálogo, idempotencia, comprobante C,
NC parcial/final y de un centavo, inmutabilidad y permisos owner/viewer/otro
tenant. Los tests de impresión verifican el PDF real A/B con precios mixtos.
El CAE de la fixture es
**simulado sólo dentro del rollback**; no certifica emisión ni recepción real.

Siguen pendientes el snapshot fiscal completo de Commerce y sus renglones,
alícuotas por renglón en la factura manual, otros tributos reales, certificación
ARCA A/B/C y NC con identidad delegada, impresión física y entrega por correo.
El cero supuesto de otros impuestos en las representaciones actuales no es una
certificación de transparencia fiscal completa.

Referencia oficial revisada el 2026-10-01: [manual WSFEv1 de ARCA](https://arca.gob.ar/ws/WSFEV1/documentos/manual-desarrollador-COMPG-v3-4-2.pdf).
