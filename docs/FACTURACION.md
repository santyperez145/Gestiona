# Facturación y autoridad fiscal

**Estado:** vigente, 2026-10-08. **Responsable:** Business Core / integración ARCA.
Este contrato describe cálculo, persistencia y representación. Configuración
general vive en [CONFIGURACION.md](CONFIGURACION.md); normativa en [LEGAL.md](LEGAL.md).

- POS factura el total persistido de sus ventas, no vuelve a añadir IVA según
  la configuración de precios de lista. Número, cabecera, renglones, vínculo
  con ventas y evento se crean en una transacción bloqueada por ticket.
- Las nuevas ventas POS capturan la tasa server-side. Las históricas conservan
  `fiscal_tax_rate = NULL`: no se les inventa un snapshot; al facturarlas se usa
  la configuración vigente, que requiere revisión si cambió desde la venta.
- QR guarda la solicitud fiscal antes del Order y prepara la factura canónica
  al cerrar el ticket acreditado, aunque el browser esté cerrado. Revalida
  `invoices.edit` del cajero original; una falla fiscal queda recuperable sin
  revertir el cobro. Autorización y reintentos pertenecen al outbox existente.
  Borrador no significa CAE; opt-out no genera factura. Contrato, orden de
  deploy y pruebas en [POS operativo](POS_OPERACION.md).
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
  computador fiscal y consulta el punto de venta CAE activo con
  `FEParamGetPtosVenta`, seguido de `FECompUltimoAutorizado` con la clase del
  emisor. La solicitud no puede
  marcarse verificada desde el navegador. Pendiente, corrección y verificada
  quedan separados y auditados; cambiar CUIT/ambiente/punto invalida el ciclo.
- `FECAESolicitar` se lee con XML estructurado (`leerSolicitudCaeWsfe`): motivo
  en `Errors/Err` y Observaciones del detalle, nunca en `Events`. El manual 4.7
  publica dos formas del detalle (`FEDetResponse > Obs > Observaciones` en el
  esquema, `FECAEDetResponse > Observaciones > Obs` en el ejemplo); se aceptan
  ambas. `arcaRechazos.ts` traduce los códigos leídos en el manual a título,
  qué hacer y estado: 500/501/502 quedan `processing` para conciliar, 600/601
  son `config_error` y las validaciones son `rejected`. Un código desconocido
  conserva el texto oficial, acotado. Respuesta inválida, Fault o aprobación sin
  CAE válido no prueban rechazo: quedan `processing`. El SOAP crudo sólo va al log.
  Las advertencias de un CAE otorgado (p. ej. 10236, tope de Monotributo) se
  registran en el log; persistirlas para el comercio requiere columna propia.
- La bandeja de pendientes fiscales (`fiscalExceptions.ts`) agrupa comprobantes
  sin CAE por acción: conexión, datos del cliente, importes, contador, reintento,
  listos para autorizar y en verificación. Sólo lee estado persistido y filtra
  Facturas con `?fiscal=`; no autoriza ni corrige datos.
- Salud fiscal (`fiscalHealth.ts`) puntúa siete controles con la vista
  `afip_connection_status` y los últimos 50 comprobantes, usando la misma regla
  de la bandeja. No consulta ARCA: un puntaje alto no certifica emisión. El
  certificado de plataforma no es visible para el comercio y se controla en Platform.
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
respuesta incompleta, cero legítimo, CRT/KEY distinto, vigencia y CUIT. Las
migraciones `20261003000100`/`00110`/`00120` están aplicadas en la base vinculada y las funciones
`afip-platform-cert` v21 y `afip-authorize` v67 quedaron desplegadas. Esto prueba
el control interno. `00110` recifra la credencial legada y agrega un trigger
que impide futuras escrituras en claro; no reemplaza una llamada con certificado
productivo real ni valida retroactivamente la vigencia del PEM ya almacenado.
`00120` agrega la solicitud idempotente, cola de Platform y confirmación sólo
backend; la cola productiva tenía cero solicitudes al verificarla, por lo que
todavía no prueba una aceptación real de un comercio.
La lectura WSFE usa XML estructurado, valida el envelope/operación y rechaza
DTD, entidades, payloads mayores a 1 MB, números ausentes/fuera de rango y
puntos bloqueados, dados de baja o CAEA. Una caída transitoria no revoca una
conexión comprobada; los diagnósticos no exponen SOAP ni secretos. Comercio
respeta `invoices.edit` y la revisión fiscal exige superadmin, sin concederle
membresía del tenant. Soporte/Finance no pueden confirmar solicitudes. La cola
distingue error de lectura de vacío y conserva el reintento.
Verificación del 2026-10-03: 3.619 tests internos en 407 archivos; ocho casos
Playwright en escritorio/móvil con red fiscal interceptada, permisos, errores,
reintento y Axe. Capturas en seis anchos y menú móvil de Platform sin apilar
grupos. Las verificaciones SQL de contexto y cola se repitieron sobre la base
vinculada con rollback y cero organizaciones fixture restantes. Al 2026-10-03,
las 661 migraciones están alineadas; OPTIONS público pasa y POST sin sesión devuelve
401 en v67. Estos controles no llaman a ARCA ni emiten comprobantes reales.
El CAE de la fixture POS es
**simulado sólo dentro del rollback**; no certifica emisión ni recepción real.

Siguen pendientes la revisión explícita de pedidos históricos/correcciones,
otros tributos reales, certificación
ARCA A/B/C y NC con identidad delegada, impresión física y entrega por correo.
El cero supuesto de otros impuestos en las representaciones actuales no es una
certificación de transparencia fiscal completa.

## Decisión técnica y próximo cierre

Owner: integración ARCA. `fast-xml-parser` 5.11.2 reemplaza extracción regex
para las lecturas de conexión en la autoridad existente `wsfeRespuesta`; no
crea otro servicio ni entra en el bundle del navegador. Puntaje según el
estándar: gap 10×3, UX 8×2, seguridad 9×2, rendimiento 9, mantenimiento 9,
salida 9 = 91/100. Benchmark local del 2026-10-03: validar y parsear 10.000
envelopes de 182 bytes tomó 207 ms; no mide la latencia externa. Parser fijado
en Edge y npm; pruebas usan la misma versión mediante alias exclusivo de Vitest.
Éxito: resultado íntegro y punto CAE activo antes de confirmar. Reversa: volver
al release fiscal anterior, conservando versionado y sin habilitar aceptación
implícita de respuestas incompletas.

Siguiente cierre: unificar lectura/estado de la guía y formulario, validación
inline/dirty state y navegación breve. Después, aceptación real autorizada y
certificación A/B/C/NC, impresión y entrega. No declarar esos gates completos
con red interceptada o fixtures.

**Actualización de referencias, 2026-10-08:** la [página oficial](https://www.arca.gob.ar/fe/ayuda/webservice.asp)
publica WSFEv1 4.7 y [homologación externa](https://www.arca.gob.ar/fe/ayuda/homologacion_externa.asp)
publica 4.8. La lectura histórica 4.1 no certifica conformidad con esas versiones.
El 2026-10-09 se contrastaron con el manual 4.7 la estructura de respuesta de
`FECAESolicitar`, los errores de infraestructura y los códigos traducidos
(`src/test/arcaRechazos.test.ts`); siguen pendientes 4.8 de homologación, el
resto de validaciones del request y una emisión real.
Simplificar mediante delegación guiada, padrón autorizado, detección de puntos
CAE y diagnóstico; no pedir clave fiscal ni eliminar autorizaciones de ARCA.
`ws_sr_constancia_inscripcion` reemplaza al padrón A5 según el
[catálogo oficial](https://www.arca.gob.ar/ws/documentacion/catalogo.asp);
su conexión/permiso se verifica por separado de WSFE. Un certificado privado
por comercio contradice el contrato actual: requeriría un ADR y revisión de seguridad.

Referencias históricas revisadas el 2026-10-03: [manual WSFEv1 4.1 de ARCA](https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-1.pdf),
[certificado de producción](https://arca.gob.ar/ws/WSAA/WSAA.ObtenerCertificado.pdf)
y [delegación a terceros](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf).
