# POS operativo — piloto de ferretería

**Estado:** contrato y matriz de cierre, no certificación comercial.
**Corte:** 2026-10-08. **Owner:** Producto / Operación / CTO.

## Propósito y autoridades

Cerrar ventas reales de ferretería con inventario, deuda, caja, comprobante y
rentabilidad trazables. Business comparte productos/clientes/Kardex y ledger
con Commerce, Finance y Profit. No crear otro ERP, otro stock ni un cobro por
cada vista. La ruta sigue `/caja`; compras, ventas, devoluciones y clientes
mantienen sus fichas canónicas.

## Cobro verificable e impresión

- QR: preparar/reservar → Order correlacionada → webhook firmado/consulta del
  recurso → evidencia completa → cierre transaccional único. La cuenta receptora,
  referencia `posqr_<session>`, ARS, un pago `processed/accredited` y los importes
  solicitado/pagado del Order/pago deben coincidir. El importe solicitado no
  reemplaza al efectivamente pagado. La referencia anidada permite consultar
  settlement; una liquidación de otro pago/cuenta no enriquece el ticket.
- El guard `20261007000100` protege el finalizador existente; sólo servidor puede
  llamarlo, el helper interno no se concede a `service_role`. Cierre/stock/caja
  conservan la autoridad previa, bloqueo, permisos e idempotencia. Un refund no
  resucita por un snapshot viejo `processed`.
- Evidencia incompleta pasa a revisión; consultar **el mismo cobro**, nunca
  recobrar por timeout. Cierre recuperado se consulta y reimprime sin alterar el
  carrito actual. Backend puede cerrar aunque el cajero cierre el navegador.
- Transferencia a alias/CVU es manual hasta disponer de feed contratado y
  verificable con identidad/referencia inequívocas. No usar importe, nombre,
  captura o descripción como prueba suficiente de la venta. Los reportes de
  cuenta de MP son asíncronos; la documentación consultada no certifica un evento
  instantáneo de cada transferencia directa. QR es un cobro correlacionado,
  no promesa de detección universal de cualquier entrada a la billetera.
- Impresión opt-in por usuario/organización en ese navegador. Ticket 80 mm desde
  `sale_transactions` + líneas `sales` propias, importes finales guardados y estado
  de cobro. Sin segundo descuento ni HTML del cliente ejecutable; frame aislado.
  Abre diálogo del sistema, permite reimpresión y no vuelve a cobrar. No prueba
  salida física ni permite impresión silenciosa universal.
- La factura ARCA requiere autorización fiscal propia y CAE; ticket comercial
  dice que no es fiscal. Local offline indica pendiente de sincronización;
  automático sólo para ticket persistido y totalmente cobrado. Deuda/parcial no
  se rotula como cobro completo. Fallar impresión no revierte ni repite la venta.

## Solicitud fiscal durable del QR

`20261008000000` fija el opt-in fiscal antes de enviar el Order. `000010` conserva
reintentos de QR anteriores sin habilitar facturación retroactiva. La Edge exige
un booleano y `invoices.edit`; la RPC conserva precios, reservas y clave del
preparador canónico. No permite cambiar la decisión al reusar la clave ni que
otro cajero la reutilice. Solicitar factura sigue siendo opcional, default off.

Sólo la transición acreditada a `completed` prepara el documento mediante
`facturar_venta_pos`, con membresía/permiso actuales del cajero original. La
factura y su evento usan la autoridad ya existente, no otro numerador/ledger.
`factura.creada` mantiene la autorización ARCA en el outbox con sus reintentos,
sin depender del navegador ni llamar a ARCA dentro de la transacción del pago.
Un fallo fiscal conserva venta/pago/stock y un motivo seguro para corregir
desde Ventas. CAE sólo se muestra cuando existe en la factura canónica; un
borrador/cola pendiente no es autorización. El recuperador lee ese estado,
no factura de nuevo. La ruta administrativa se oculta a vendedores.

Despliegue obligatorio: migración nueva → Edge QR → frontend. Sin RPC nueva,
el nuevo servidor rechaza iniciar el cobro; no ignora silenciosamente el opt-in.
Los intents históricos no reciben una solicitud fiscal inventada. El contrato
anterior del navegador conserva su acción fiscal manual idempotente.

Readback de producción del 2026-10-08: suscripción fiscal activa, cron de
outbox y conciliación QR activos; últimas consultas QR HTTP 200 sin timeout.
Hay conexión OAuth MP y secreto webhook en Edge, pero ninguna caja QR activa.
Completar sucursal/caja con datos reales mediante el POS antes del primer cobro.
Esto no prueba recepción de notificaciones, dinero, CAE ni papel.

`20261008_pos_qr_durable_fiscal.sql` se ejecutó el 2026-10-08 en la Preview vacía
`aihxgfebanfqbnekkvfu`: 666 migraciones desde cero y `000010` incremental, 667
registradas; diez grupos de checks en rollback. Evidencia incompleta, cierre,
opt-out, permiso
revocado, identidad fiscal ausente, duplicados de venta/factura/outbox, QR legacy y ACL;
rol authenticated real sin escritura del opt-in y cuenta sin membresía sin
lectura del QR/factura. Las pruebas QR/alias anteriores también pasaron.
Readback final: cero usuarios, organizaciones, sesiones, facturas y outbox;
sin hallazgos de exposición, costo público, policies sin tenant o RPC de
stock/dinero sin permiso. No hubo fixtures ni proveedores en producción.

Puerta local del 2026-10-08: 3.793 tests en 426 archivos, gramática de las 667
migraciones, Edge, lint sin errores, tipos/build y runtime sin advisories.
Dieciséis E2E POS desktop/móvil verdes sin retries con red interceptada.
E2E/Axe/capturas cubren solicitud, borrador/CAE, reload y vendedor sin ruta de
admin. CI completo de `daa6911d`, Supabase Preview y Vercel aprobaron.
Con autorización explícita del dueño se aplicaron únicamente `000000` y
`000010` en producción y se desplegó `mercadopago-pos-qr` v16 ACTIVE con JWT.
Readback 2026-10-08: 667 migraciones, hashes de preparación/trigger/respuesta iguales a
Preview, finalizador de pago canónico intacto, trigger activo y sin permisos
para anon/ejecución directa autenticada del trigger. Webhook v66 y ARCA v67
se conservaron. CLI restaurada a Preview; sin cobros/ventas/facturas de prueba.
PR18 integrada en main `4fcd814aec9b75ede4a45c0c1c17c0ddbc44eaa5`, Vercel
`dpl_HzAUBF8DcN1ZBfG7c6jtDcChJ9VS` READY para ese SHA y alias asignado.
Estos controles no certifican MP/ARCA/impresión física reales ni un feed CVU.

## Matriz para reemplazar el sistema del negocio

Requisito reafirmado por el dueño el 2026-10-08: automatizar alias/CVU, además
del QR. La implementación debe empezar por comprobar el feed de la cuenta
receptora con una transferencia autorizada y su referencia inequívoca. Consulta
de Payments no acredita cobertura de todos los ingresos CVU. Los reportes de
cuenta pueden no traer `EXTERNAL_REFERENCE` para envíos de dinero; su webhook
anuncia un archivo generado, no una acreditación instantánea por venta.
Sin referencia única no se autoasigna por monto, nombre, comprobante ni texto.
El siguiente gate es contrato/acceso del proveedor y prueba de cobertura,
después inbox de entradas no vinculadas, confirmación inequívoca y cierre sobre
las autoridades POS/stock/fiscal actuales, con duplicados, devolución y pagos
tardíos ensayados en Preview. Una cuenta recaudadora por operación requiere
partner; no crear CVU, contratar un PSP ni cobrar nuevas tarifas por inferencia.
Esta investigación no habilita un feed ni confirma pagos de clientes.

| Trabajo | Base actual | Gate / siguiente cierre |
|---|---|---|
| Venta/cobro | Carrito, descuentos por medio, variantes, QR, manual, pagos divididos y offline. | Recorrido cajero/encargado con descuentos, concurrencia y proveedor real; nunca confirmar manual como acreditación automática. |
| Caja y turnos | Apertura/cierre, resumen y ventas persistidas. | Arqueo inicial/final, ingresos/egresos, diferencias con responsable y motivo; segunda sucursal y cierre físico conciliados. |
| Seguridad | Membresía/roles/RLS, autoridad SQL y auditoría existentes. | Matriz por acción: vender, ver costo, editar precio/descuento, anular, devolver, fiar y retirar caja; override de encargado, motivo, vigencia y auditoría; MFA reforzado en acciones sensibles. |
| Catálogo de ferretería | Producto/variante/SKU, scanner, importador y Kardex compartidos. Unidad de medida por producto (kg/metro/litro/m²) con cantidades de hasta tres decimales en stock, Kardex, ventas, compras, devoluciones y transferencias (`20261009000800`); el POS carga la cantidad exacta y el controlador fiscal imprime la unidad. | Presentación/caja y conversión entre unidades; importación con stock fraccionado; tienda online sigue en unidades; 10.000 artículos medidos con lector real. |
| Cuenta corriente | Clientes, deuda, cobro y ledger existentes. | Límite/aprobación de crédito, vencimiento, anticipo/abono e imputación sin cobrar dos veces; conciliación con cliente. |
| Presupuestos/pedidos | Documentos y venta comparten Core. | Presupuesto versionado → reserva → entrega parcial → factura; congelar condiciones, vigencia, seña y trazabilidad sin duplicar stock. |
| Compras/proveedores | Compras, proveedor y movimientos existentes. | Orden → recepción parcial → costo landed → deuda → pago; factura/remito y devolución al proveedor con conciliación. |
| Inventario | Kardex, ubicaciones, reservas y proyecciones FIFO. | Conteo físico, transferencias, mínimos/reposición y ajustes aprobados; medir exactitud, faltantes y capital, no reconstruir costos históricos. |
| Postventa | Devoluciones y refund separados de venta. | Motivo, garantía/serie/lote cuando corresponda, NC ARCA y dinero restituido; política por comercio, no borrar historia. |
| Dispositivos | Web/PWA, cámara/scanner y shell nativo. | Modelo térmico/driver/ancho, lector y cajón concretos; cola/estado/reintento local para impresión silenciosa sólo tras integración certificada. Point es adaptador futuro, no hardware habilitado por tener Orders. |
| Migración y continuidad | Importador, exports, restore drill y tests internos. | Catálogo/stock/deuda/precios/fiscal reconciliados con sistema anterior, backup restaurado, corte/reversa y primer turno sin SQL. |
| Profit | Contribución/cobertura sobre hechos del Graph. | Primera venta/retorno con costo/fee/logística/impuestos completos; utilidad neta sólo con gastos/política contable. |

## Evidencia y release

Release de código: `npm run verify` verde (3.732 tests / 421 archivos), ocho E2E
POS desktop/móvil y Axe sin violaciones graves del aviso recuperado. Runtime
sin advisories; se conserva la excepción temporal `braces` de toolchain.
El guard se probó reversiblemente, incluida reaplicación y prueba histórica QR;
el despliegue persistente backend y la promoción a producción no se deducen de
esa verificación. Sin operación autorizada de proveedor/hardware todavía.

La PR 16 expuso un fallo previo al POS al reconstruir desde cero: `20260430000005`
modificaba una tabla creada en `000006`. Se guarda el orden correcto/columna,
los cron históricos dejan de usar `ON CONFLICT` sobre un `SELECT`, payment links
referencia `quotes`, el ledger agrega sus columnas sobre el Kardex existente y
Stripe events aplica RLS al crear la tabla, no antes de que exista. Los bloques
cron de gastos recurrentes, limpieza y campañas usan delimitadores distintos.
`check:migrations` analiza todos los SQL con el parser PostgreSQL 17 (sólo dev,
sin ejecutar consultas); valida gramática, no cuerpos PL/pgSQL/orden/permisos.
Estos cambios son de replay, no un reset/reparación de versiones productivas.
La reconstrucción expuso incompatibilidades de kits, listas y logs webhook:
se conservan `price_ars`/`is_active` y `event`/`delivered`, se agregan los campos
operativos antes de indexarlos y se completa el tenant del item desde su lista.
Cobros recurrentes de clientes usan `customer_subscriptions`, nunca la
suscripción SaaS; lecturas de miembros y escritura owner/admin. Proveedores y
clientes apuntan a `suppliers`/`customers`; defaults criptográficos resuelven
`extensions`, sin depender del search path. No se despliegan esos históricos
sobre datos productivos. No reparar versiones, resetear producción ni omitir
el check para salvar el POS.
Replay incremental del 2026-10-08 alcanzó `20261007000100`; se resolvieron
expansiones de auditoría, dependencias, identidades, RLS y fixtures ligados a
datos productivos. Pruebas reversibles de QR/alias verdes y auditorías sin
hallazgos, cero usuarios/organizaciones residuales. [Evidencia y límites del
replay](MIGRATION_REPLAY.md): Preview nueva `ssmppsjyhvdyrkzpjjpa` instaló las
665 migraciones desde cero el 2026-10-08 y repitió QR/roles sin residuos/hallazgos.
La promoción del frontend sigue el gate completo de su propio SHA.

La revisión detectó además `org_members` sólo en la base alojada, como vista
definer con grants de lectura/escritura al navegador. `20261007000000` sí se
aplicó persistentemente el 2026-10-07: invoker RLS, alias sólo lectura, anon sin
acceso. Readback de grants/opciones/versión verde y prueba reversible con dos
usuarios ficticios: own/foreign, escalada denegada, lectura servidor y cero
restos. El historial ahora crea la misma compatibilidad sin duplicar membresías.
Eso no habilita por sí solo el release POS ni certifica todos los controles.

`supabase/verificaciones/20261007_pos_qr_payment_evidence.sql` es reversible:
nueve pruebas inválidas, cierre válido, duplicado, evento vencido, refund y
snapshot viejo, ACL y rollback con cero restos. Ejecutado con el guard dentro
de rollback sobre la base vinculada y, el 2026-10-08, en Preview incremental
con actor propio y también en la Preview reconstruida desde cero.
No cobró dinero ni llamó a MP; no se escribieron fixtures en producción.
Unit tests ejecutan el helper de Orders y el cargador/impresor con fuentes
controladas; comprobar ticket íntegro, XSS, deuda, tenant y error sin recobro.
E2E `pos-checkout.spec.ts` usa red totalmente interceptada: QR nuevo pendiente
→ cierre server-side → impresión única, recuperación/reimpresión sin recobro,
revisión del mismo intento, deuda y preferencia tras reload en desktop/móvil.
El diálogo de impresora se intercepta; no se certifica papel ni dinero.
La versión desplegada, proveedor y hardware deben registrarse al certificarlos;
no deducir éxito productivo de una suite sintética.

Orden backend: publicar primero las funciones que producen la evidencia
(`mercadopago-pos-qr`, `mercadopago-webhook`), luego el guard SQL. Invertirlo
haría que el servidor viejo no cumpla el contrato nuevo. No abrir el finalizador
interno para salvar una migración. El browser se despliega después del gate.
El 2026-10-08 se publicaron QR v15 y webhook v66 ACTIVE, después se aplicó
`20261007000100` mediante la CLI: sólo esa migración pendiente, con journal
del runner. La huella del finalizador coincide con Preview y los auditores
productivos siguen sin hallazgos. No certifica recepción de dinero, impresión
física ni emisión ARCA: esos gates requieren una operación controlada real.

## Referencias oficiales, consultadas 2026-10-07

- [MP QR / Orders](https://www.mercadopago.com.ar/developers/es/docs/qr-code/payment-processing),
  [notificaciones](https://www.mercadopago.com.ar/developers/es/docs/qr-code/notifications)
  y [estados](https://www.mercadopago.com.ar/developers/es/docs/qr-code/resources/status-order-transaction).
- [Reportes de cuenta MP](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-payments/additional-content/reports/account-money/generate)
  y [Point](https://www.mercadopago.com.ar/developers/es/docs/mp-point/payment-processing).
- Alias/CVU, consulta ampliada 2026-10-08: [campos y referencia ausente](https://www.mercadopago.com.ar/developers/es/docs/links-and-debts/additional-content/reports/account-money/report-fields),
  [generación asíncrona y webhook del reporte](https://www.mercadopago.com.ar/developers/es/docs/reports/account-money/api)
  y [Payments Search](https://www.mercadopago.com.ar/developers/en/reference/online-payments/subscriptions/search-payments/get).
- [Shopify, impresoras compatibles](https://help.shopify.com/en/manual/sell-in-person/hardware/receipt-printers)
  y [caja](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management).
- [Tiendanube, ciclo de venta](https://ayuda.tiendanube.com/es_AR/123288-mis-ventas/como-es-el-proceso-de-venta-en-tiendanube).
- [SCADI](https://test.scadi.com.ar): sólo login accesible, anuncia cuentas por
  sucursal, sesión hasta 12 horas y bloqueo de intentos. Sin credenciales/demo
  no se inspeccionó ni se anuncia paridad de su aplicación privada.

Estos son patrones públicos; no se copian activos ni se garantiza que un solo
piloto reemplace cualquier ERP/CRM. Cada gate se cierra con evidencia del trabajo.
