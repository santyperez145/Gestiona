# Facturación y autoridad fiscal

**Estado:** vigente, 2026-10-03. **Responsable:** Business Core / integración ARCA.
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
- Las facturas manuales A/B permiten una alicuota admitida por renglon. La UI
  anticipa neto, IVA agrupado y total, pero `crear_factura_manual` recalcula y
  persiste cada importe en la base. La clase C fuerza IVA cero y un borrador no
  fiscal no recibe datos fiscales inventados.
- Las NC reservan saldo e IVA por alícuota, incluyendo borradores previos. Una
  NC completa cierra exactamente los importes restantes. No mueve inventario
  ni acredita dinero: esos hechos tienen autoridad en Devoluciones y Pay.
- ARCA toma una nueva lectura después de reservar. Cabecera y renglones se
  congelan durante `processing`; con CAE no se editan ni eliminan. Rechazos
  permiten corregir; una respuesta incierta mantiene la reserva para conciliar.
- La prueba de representación guarda la versión exacta de CUIT, punto de venta,
  ambiente, clase y certificado que ARCA validó. Un cambio concurrente invalida
  el resultado; sólo el backend puede confirmarlo. Certificado propio y
  representación delegada conservan diagnósticos separados.
- La credencial de plataforma acepta el CRT emitido y la KEY usada para su CSR;
  el CSR nunca se carga en Nerqia. Antes de persistir, la Edge parsea X.509,
  comprueba vigencia, par RSA y CUIT del subject. Certificado y clave se cifran
  con el envelope server-side; la UI sólo puede leer fechas y huella SHA-256.
  `.crt` no demuestra ambiente: producción y homologación se seleccionan y
  prueban por separado.
- `FECompUltimoAutorizado` sólo devuelve cero cuando ARCA envía explícitamente
  `CbteNro=0`. Faults, bloques `Errors/Err`, número ausente o inválido fallan;
  un HTTP 200 de SOAP no se interpreta por sí solo como conexión válida.
- La conexión delegada tiene dos autoridades visibles: el comercio designa a
  Nerqia y solicita activación; Platform acepta la designación, asocia el
  computador fiscal y ejecuta `FECompUltimoAutorizado`. La solicitud no puede
  marcarse verificada desde el navegador. Pendiente, corrección y verificada
  quedan separados y auditados; cambiar CUIT/ambiente/punto invalida el ciclo.
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
`supabase/verificaciones/20261002_manual_invoice_line_tax.sql` cubre alicuotas
mixtas, redondeo, clase C, tasa invalida y permisos owner/viewer en rollback.
`supabase/verificaciones/20261002_arca_connection_context.sql` prueba versionado,
invalidación, ambiente y confirmación exclusiva del backend sin llamar a ARCA.
`20261003_arca_delegation_activation_queue.sql` suma nueve escenarios reversibles:
solicitud, idempotencia, handoff visible, cola de staff, revisión, corrección,
reintento, invalidación y navegador sin autoridad de confirmación.
Las pruebas puras `wsfeRespuesta` y `afipCertificate` cubren rechazo embebido,
respuesta incompleta, cero legítimo, CRT/KEY distinto, vigencia y CUIT. La
migraciones `20261003000100`/`00110`/`00120` están aplicadas en la base vinculada y las funciones
`afip-platform-cert` v21 y `afip-authorize` v66 quedaron desplegadas. Esto prueba
el control interno. `00110` recifra la credencial legada y agrega un trigger
que impide futuras escrituras en claro; no reemplaza una llamada con certificado
productivo real ni valida retroactivamente la vigencia del PEM ya almacenado.
`00120` agrega la solicitud idempotente, cola de Platform y confirmación sólo
backend; la cola productiva tenía cero solicitudes al verificarla, por lo que
todavía no prueba una aceptación real de un comercio.
El CAE de la fixture POS es
**simulado sólo dentro del rollback**; no certifica emisión ni recepción real.

Siguen pendientes la revisión explícita de pedidos históricos/correcciones,
otros tributos reales, certificación
ARCA A/B/C y NC con identidad delegada, impresión física y entrega por correo.
El cero supuesto de otros impuestos en las representaciones actuales no es una
certificación de transparencia fiscal completa.

Referencias oficiales revisadas el 2026-10-03: [manual WSFEv1 de ARCA](https://arca.gob.ar/ws/WSFEV1/documentos/manual-desarrollador-COMPG-v3-4-2.pdf),
[certificado de producción](https://arca.gob.ar/ws/WSAA/WSAA.ObtenerCertificado.pdf)
y [delegación a terceros](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf).
