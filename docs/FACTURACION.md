# Facturación y autoridad fiscal

**Estado:** vigente, 2026-10-09. **Responsable:** Business Core / integración ARCA.
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

### Gestión argentina y espacio del contador — pendiente, no otra plataforma

Auditoría de código del 2026-10-09, secuenciada en el roadmap:

1. **Maestros fiscales únicos:** `customers` y `suppliers` todavía no tienen
   identidad fiscal estructurada completa. Extender esas entidades, sin crear
   copias fiscales: razón social, tipo/número de documento, condición IVA y
   domicilio fiscal separado del domicilio de entrega; validación server-side,
   permisos y diagnóstico por campo. Consultar padrón sólo con autorización;
   no pedir clave fiscal ni inferir condición por CUIT/nombre. Facturación,
   presupuestos, compras, POS y Commerce reutilizan el maestro, pero los
   comprobantes conservan el snapshot original y nunca se reescriben por editar
   un cliente. CUIT/DNI no se exportan a audiencias ni se exponen al público.
2. **Presupuesto → venta:** la conversión actual envía una venta agregada sin
   `product_id` y la autoridad POS la rechaza; pierde renglones/variantes y crea
   una nueva key por intento. Reparar con transacción bloqueada por presupuesto,
   replay idempotente, IDs de cliente/producto/variante, precio autorizado,
   Kardex y permisos. Aceptar no significa cobrar ni emitir CAE; preservar
   estados y reversas. No aflojar la validación de precio para aceptar ids nulos.
3. **ND A/B/C:** no hay creación funcional de notas de débito en la pantalla
   actual. Extender `invoices` con motivo, comprobante asociado, numeración,
   renglones/IVA, saldo, autorización/idempotencia y outbox existentes. No copiar
   la semántica negativa de una NC ni usar un ajuste interno como documento ARCA.
4. **Paquete contador:** el CSV del libro diario es real; el CSV resumido de
   facturas no acredita un archivo fiscal importable. Preparar período/emisor,
   comprobantes emitidos/recibidos, alícuotas, NC/ND, CAE, faltantes y conciliación
   con el ledger. Reproducir el diseño vigente de Portal IVA/IVA Simple, encoding,
   tamaños y relación cabecera/alícuotas; pruebas golden y una importación
   autorizada revisada por contador. Nunca completar otros tributos con ceros
   supuestos. Un archivo generado no demuestra presentación ni aceptación.
5. **Acceso contador:** reutilizar identidad/organizaciones/permisos y el ledger
   existente; acceso explícito por comercio, lectura/export granular, selección
   multiorganización, auditoría y revocación. No requiere ser Platform ni tener
   facultad para cobrar, facturar o modificar stock. No crear otro ledger ni
   copiar Finance; navegación y roles se completan antes de anunciar una ruta.
6. **Caja versus X/Z:** `pos_cash_session_close` es un cierre operativo. X/Z y
   reportes firmados de un controlador fiscal no se fabrican desde un CSV/PDF:
   requieren identificar equipo/protocolo homologado, adapter, comandos,
   relectura/reconciliación y prueba física autorizada. Sin ese conector la UI
   debe decir “cierre de caja interno”, no “cierre fiscal”. Factura electrónica
   Web Services y controlador fiscal son circuitos distintos, no sustitutos
   declarados por el nombre del botón. El dueño informó Epson para el piloto;
   faltan modelo exacto, generación fiscal, firmware e interfaz; la marca sola
   tampoco acredita que sea un controlador fiscal y no una ticketera. No elegir un
   driver por marca ni enviar comandos Z a ciegas. Quiere también Web Services
   y Comprobantes en línea: mantener puntos de venta por sistema, registrar
   origen e identificador fiscal del comprobante externo (CUIT emisor, punto
   de venta, tipo y número), con CAE, para conciliar y evitar doble emisión.
   No pedir ni almacenar la clave fiscal del portal. Comprobantes en línea
   sigue siendo un circuito manual ARCA,
   no una segunda emisión automática de la venta ya facturada por WS.

Revisar también notas de proveedor/export Finance que hoy omiten el error de
escritura y `TaxManagementPage` que registra presentación/pago manual sin acuse;
separar registro interno, archivo exportado, aceptado y presentado. El reporte
de caja ahora escapa texto no confiable antes de imprimir: eso corrige XSS,
no certifica hardware ni un cierre X/Z.

Referencias oficiales consultadas el 2026-10-09: [datos del comprobante](https://www.arca.gob.ar/fe/emision-autorizacion/datos-comprobantes.asp),
[confección IVA Simple](https://www.arca.gob.ar/iva/iva-simple/confeccion-declaracion.asp),
[diseños/importación](https://www.arca.gob.ar/iva/iva-simple/especificaciones-especiales.asp)
y [controladores fiscales, RG 3561 vigente](https://biblioteca.arca.gob.ar/search/query/norma.aspx?p=t%3ARAG%7Cn%3A3561%7Co%3A3%7Ca%3A2013%7Cf%3A09%2F12%2F2013),
con [puntos de venta diferenciados por sistema](https://www.arca.gob.ar/facturacion/documentos/puntos-de-venta.pdf).
La revisión técnica no sustituye dictamen profesional ni homologación externa.

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
publica 4.8. La lectura histórica 4.1 no certifica conformidad con esas versiones:
queda pendiente contrastar validaciones, fixtures y rechazos del contrato vigente.
Simplificar mediante delegación guiada, padrón autorizado, detección de puntos
CAE y diagnóstico; no pedir clave fiscal ni eliminar autorizaciones de ARCA.
`ws_sr_constancia_inscripcion` reemplaza al padrón A5 según el
[catálogo oficial](https://www.arca.gob.ar/ws/documentacion/catalogo.asp);
su conexión/permiso se verifica por separado de WSFE. Un certificado privado
por comercio contradice el contrato actual: requeriría un ADR y revisión de seguridad.

Referencias históricas revisadas el 2026-10-03: [manual WSFEv1 4.1 de ARCA](https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-1.pdf),
[certificado de producción](https://arca.gob.ar/ws/WSAA/WSAA.ObtenerCertificado.pdf)
y [delegación a terceros](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf).
