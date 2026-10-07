# POS operativo — piloto de ferretería

**Estado:** contrato y matriz de cierre, no certificación comercial.
**Corte:** 2026-10-07. **Owner:** Producto / Operación / CTO.

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

## Matriz para reemplazar el sistema del negocio

| Trabajo | Base actual | Gate / siguiente cierre |
|---|---|---|
| Venta/cobro | Carrito, descuentos por medio, variantes, QR, manual, pagos divididos y offline. | Recorrido cajero/encargado con descuentos, concurrencia y proveedor real; nunca confirmar manual como acreditación automática. |
| Caja y turnos | Apertura/cierre, resumen y ventas persistidas. | Arqueo inicial/final, ingresos/egresos, diferencias con responsable y motivo; segunda sucursal y cierre físico conciliados. |
| Seguridad | Membresía/roles/RLS, autoridad SQL y auditoría existentes. | Matriz por acción: vender, ver costo, editar precio/descuento, anular, devolver, fiar y retirar caja; override de encargado, motivo, vigencia y auditoría; MFA reforzado en acciones sensibles. |
| Catálogo de ferretería | Producto/variante/SKU, scanner, importador y Kardex compartidos. | Unidades fraccionadas (metro/kg), presentación/caja, conversión y redondeo; códigos múltiples, margen mínimo y 10.000 artículos medidos con lector real. |
| Cuenta corriente | Clientes, deuda, cobro y ledger existentes. | Límite/aprobación de crédito, vencimiento, anticipo/abono e imputación sin cobrar dos veces; conciliación con cliente. |
| Presupuestos/pedidos | Documentos y venta comparten Core. | Presupuesto versionado → reserva → entrega parcial → factura; congelar condiciones, vigencia, seña y trazabilidad sin duplicar stock. |
| Compras/proveedores | Compras, proveedor y movimientos existentes. | Orden → recepción parcial → costo landed → deuda → pago; factura/remito y devolución al proveedor con conciliación. |
| Inventario | Kardex, ubicaciones, reservas y proyecciones FIFO. | Conteo físico, transferencias, mínimos/reposición y ajustes aprobados; medir exactitud, faltantes y capital, no reconstruir costos históricos. |
| Postventa | Devoluciones y refund separados de venta. | Motivo, garantía/serie/lote cuando corresponda, NC ARCA y dinero restituido; política por comercio, no borrar historia. |
| Dispositivos | Web/PWA, cámara/scanner y shell nativo. | Modelo térmico/driver/ancho, lector y cajón concretos; cola/estado/reintento local para impresión silenciosa sólo tras integración certificada. Point es adaptador futuro, no hardware habilitado por tener Orders. |
| Migración y continuidad | Importador, exports, restore drill y tests internos. | Catálogo/stock/deuda/precios/fiscal reconciliados con sistema anterior, backup restaurado, corte/reversa y primer turno sin SQL. |
| Profit | Contribución/cobertura sobre hechos del Graph. | Primera venta/retorno con costo/fee/logística/impuestos completos; utilidad neta sólo con gastos/política contable. |

## Evidencia y release

Release de código: `npm run verify` verde (3.709 tests / 420 archivos), ocho E2E
POS desktop/móvil y Axe sin violaciones graves del aviso recuperado. Runtime
sin advisories; se conserva la excepción temporal `braces` de toolchain.
El guard se probó reversiblemente, incluida reaplicación y prueba histórica QR;
el despliegue persistente backend y la promoción a producción no se deducen de
esa verificación. Sin operación autorizada de proveedor/hardware todavía.

`supabase/verificaciones/20261007_pos_qr_payment_evidence.sql` es reversible:
nueve pruebas inválidas, cierre válido, duplicado, evento vencido, refund y
snapshot viejo, ACL y rollback con cero restos. Fue ejecutado con el guard dentro
de rollback sobre la base vinculada. No cobró dinero ni llamó a MP.
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

## Referencias oficiales, consultadas 2026-10-07

- [MP QR / Orders](https://www.mercadopago.com.ar/developers/es/docs/qr-code/payment-processing),
  [notificaciones](https://www.mercadopago.com.ar/developers/es/docs/qr-code/notifications)
  y [estados](https://www.mercadopago.com.ar/developers/es/docs/qr-code/resources/status-order-transaction).
- [Reportes de cuenta MP](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-payments/additional-content/reports/account-money/generate)
  y [Point](https://www.mercadopago.com.ar/developers/es/docs/mp-point/payment-processing).
- [Shopify, impresoras compatibles](https://help.shopify.com/en/manual/sell-in-person/hardware/receipt-printers)
  y [caja](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management).
- [Tiendanube, ciclo de venta](https://ayuda.tiendanube.com/es_AR/123288-mis-ventas/como-es-el-proceso-de-venta-en-tiendanube).
- [SCADI](https://test.scadi.com.ar): sólo login accesible, anuncia cuentas por
  sucursal, sesión hasta 12 horas y bloqueo de intentos. Sin credenciales/demo
  no se inspeccionó ni se anuncia paridad de su aplicación privada.

Estos son patrones públicos; no se copian activos ni se garantiza que un solo
piloto reemplace cualquier ERP/CRM. Cada gate se cierra con evidencia del trabajo.
