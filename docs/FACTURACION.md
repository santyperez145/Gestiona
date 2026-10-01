# Facturación y autoridad fiscal

**Estado:** vigente, 2026-10-01. **Responsable:** Business Core / integración ARCA.
Este contrato describe cálculo, persistencia y representación. Configuración
general vive en [CONFIGURACION.md](CONFIGURACION.md); normativa en [LEGAL.md](LEGAL.md).

- POS factura el total persistido de sus ventas, no vuelve a añadir IVA según
  la configuración de precios de lista. Número, cabecera, renglones, vínculo
  con ventas y evento se crean en una transacción bloqueada por ticket.
- Las nuevas ventas POS capturan la tasa server-side. Las históricas conservan
  `fiscal_tax_rate = NULL`: no se les inventa un snapshot; al facturarlas se usa
  la configuración vigente, que requiere revisión si cambió desde la venta.
- Commerce captura `ecommerce_orders.fiscal_snapshot` al crear el pedido. El
  servidor distribuye el descuento entre productos y registra envío, neto,
  tasa e IVA por línea. El total persistido es el importe final cobrado: no
  vuelve a añadir IVA por un cambio en la configuración de precios de lista.
  El envío usa la tasa declarada de la organización, que debe revisar su
  responsable fiscal; este cálculo no certifica su tratamiento tributario.
- El pago confirmado genera cabecera y renglones desde ese snapshot, enlaza
  las ventas y emite un único evento. Reintentar devuelve la misma factura;
  un cambio posterior del catálogo no modifica las tasas del pedido.
- Los pedidos históricos no reciben IVA supuesto desde el catálogo actual.
  Un snapshot ausente/inválido o un cambio de clase fiscal del emisor bloquea
  la facturación con un motivo visible en pendientes. Los nuevos importes,
  renglones y datos fiscales del comprador no se reescriben; pago, entrega y
  seguimiento conservan sus autoridades. La corrección fiscal requiere un
  flujo revisado, no un UPDATE directo ni una reconstrucción silenciosa.
- El prorrateo compartido SQL/TypeScript reparte unidades de moneda por restos
  mayores, con desempate desde la última línea. No produce una línea negativa
  para compensar redondeos ni carga el resto a un producto de importe cero.
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
`supabase/verificaciones/20261001_store_invoice_snapshot.sql` cubre checkout
anónimo e idempotente, descuento/envío, tasas originales, facturas A/B/C,
históricos, cambio de emisor, importes inválidos e inmutabilidad con roles
reales. Las fixtures se revierten; no llaman proveedores ni envían correos.
Los tests de ticket incluyen un pedido con descuento, envío e IVA mixto.
El CAE de la fixture POS es
**simulado sólo dentro del rollback**; no certifica emisión ni recepción real.

Siguen pendientes la revisión explícita de pedidos históricos/correcciones,
alícuotas por renglón en la factura manual, otros tributos reales, certificación
ARCA A/B/C y NC con identidad delegada, impresión física y entrega por correo.
El cero supuesto de otros impuestos en las representaciones actuales no es una
certificación de transparencia fiscal completa.

Referencia oficial revisada el 2026-10-01: [manual WSFEv1 de ARCA](https://arca.gob.ar/ws/WSFEV1/documentos/manual-desarrollador-COMPG-v3-4-2.pdf).
