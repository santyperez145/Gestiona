# Nerqia Finance

**Estado:** contrato vigente. **Corte:** 2026-09-04.

Finance es una superficie propia para controlar gasto empresarial. Su benchmark
principal es Mendel; su ventaja es operar sobre el mismo Business Graph que
Commerce y Business.

## Límite

Finance tiene:

- layout y navegación en /finance;
- entitlement de producto;
- permisos view/edit/approve/pay;
- documentos, versiones, políticas, aprobaciones y eventos propios.

Finance reutiliza:

- organización, miembros y roles;
- proveedores y centros de costo;
- órdenes de compra y recepciones;
- gastos, obligaciones y pagos;
- productos, costo, impuestos y ledger.

No se crean copias Finance de esas entidades. Platform staff no entra sin una
membresía real de la organización.

## Arquitectura de información

| Área | Trabajo |
|---|---|
| Inicio | Posición, pendientes, excepciones, presupuesto y acciones. |
| Gastos | Documentos, gastos de tarjeta externa, reembolsos y detalle 360. |
| Solicitudes | Crear, revisar, aprobar/rechazar y escalar por política/SLA. |
| Presupuestos | Disponible, comprometido, consumido y reglas preventivas. |
| Medios de pago | Conexiones, tarjetas externas y transacciones. |
| Conciliación | Match de banco/tarjeta/documento, obligaciones y exportación. |
| Configuración | Categorías, centros, cuentas, políticas, permisos e integraciones. |

Una entidad tiene una ficha y una ruta canónica. Tabs separan vistas del mismo
trabajo; no se replican páginas de proveedores, compras o contabilidad.

## Flujo objetivo

    solicitud
      → política y presupuesto
      → aprobación
      → compra/gasto/tarjeta externa
      → documento original
      → inspección y extracción
      → revisión y matching
      → obligación/recepción/asiento aprobado
      → conciliación y cierre

Cada transición registra actor, timestamp, motivo, estado anterior, estado
nuevo y correlación. Las mutaciones son idempotentes.

## Document Inbox

Estado técnico construido:

- bucket privado finance-documents;
- intención de carga emitida por servidor;
- paths no elegidos libremente por el cliente;
- versiones y eventos append-only;
- original inmutable;
- MIME/tamaño/hash real e inspección;
- cuarentena y deduplicación;
- extracción estructurada sin defaults financieros;
- confianza y revisión por campo;
- matching de proveedor/orden con aliases por tenant;
- borradores separados de factura, compra y deuda;
- aprobación y entrega al Core.

Estado operativo pendiente: configurar proveedor privado de
inspección/extracción y procesar un documento real completo. Hasta entonces la
UI debe mostrar “no configurado”; no simula éxito.

### Estados

    upload_pending → awaiting_inspection → ready_for_extraction
    → extracting → review_required → matched → draft_ready
    → approval_pending → approved → delivered

Ramas explícitas: quarantined, duplicate, extraction_failed, rejected,
delivery_failed y superseded. Un retry no crea una segunda obligación.

## Solicitudes y políticas

Una solicitud incluye solicitante, importe/moneda, categoría, centro de costo,
proyecto, proveedor opcional, motivo y adjuntos. La política puede decidir:

- aprobación automática, revisión o bloqueo;
- nivel/es por monto, categoría, equipo o excepción;
- presupuesto a comprometer;
- documentación obligatoria;
- proveedor/país/horario permitido;
- separación entre creator, approver y payer.

Las políticas son versionadas. Una decisión conserva la versión evaluada para
que una edición futura no cambie el pasado.

## Presupuestos

El saldo se expresa siempre como:

    asignado - comprometido - consumido + liberado = disponible

Comprometer y liberar son movimientos, no updates silenciosos. Se soportan
período, recurrencia, categoría, centro, proyecto, persona y moneda. Toda
conversión guarda tipo, fuente y fecha.

## Gastos y reembolsos

Un gasto puede originarse en documento, compra, tarjeta externa, caja o carga
manual autorizada. Un reembolso agrega beneficiario, cuenta validada,
liquidación y comprobante; no crea otro proveedor si la persona ya existe.

Anticipos y fondos rinden contra gastos y devuelven sobrantes. Excepciones
quedan en cola con owner y SLA.

## Medios de pago

Primera etapa: importar/conectar tarjetas externas y cuentas para conciliar
transacciones. Se normalizan emisor, últimos cuatro, titular, moneda, estado y
controles sin almacenar PAN/CVV.

Emitir tarjetas o mover fondos exige partner regulado, contrato, KYC/KYB,
riesgo, fraude, soporte, conciliación y economics. La UI no promete emisión
mientras esos gates estén abiertos.

## Conciliación y contabilidad

El motor propone matches por importe, fecha, moneda, proveedor, referencia y
documento. La confianza se explica. Auto-match sólo corre sobre reglas
determinísticas aprobadas y umbral versionado.

Cada salida contable:

- evita duplicados por clave externa;
- mapea cuenta, centro, impuesto y dimensión;
- permite preview y validación;
- registra lote, resultado y error por fila;
- puede reintentarse sin duplicar;
- conserva vínculo al documento y hecho original.

## Inteligencia

Casos permitidos:

- detectar faltantes, duplicados, anomalías y gasto fuera de política;
- sugerir categoría, match, aprobador o acción;
- explicar impacto y confianza;
- preparar un borrador.

La recomendación no aprueba, paga, cambia beneficiario ni crea asiento por sí
sola. Acción sensible = regla determinística + permiso + confirmación humana +
auditoría.

## Seguridad y fraude

- Entitlement, membership y permiso se validan server-side.
- Archivos privados usan URL firmada breve.
- Ningún secreto financiero llega al navegador o logs.
- Uploads se inspeccionan antes de extraer.
- Webhooks verifican firma, timestamp y replay.
- Cambiar cuenta/beneficiario requiere reautenticación y período de control.
- Límites de velocidad y monto se aplican antes de reservar idempotencia.
- Acciones de alto riesgo generan alertas y revisión separada.
- Auditoría financiera es append-only y exportable.

## Paridad Mendel-class

Fuentes oficiales consultadas 2026-09-04:
[producto](https://mendel.com/ar/producto/),
[tarjetas](https://mendel.com/ar/producto/tarjetas-mendel/) e
[integraciones](https://mendel.com/ar/producto/integraciones/).

| Trabajo | Estado Nerqia | Gate siguiente |
|---|---|---|
| Inbox/captura | Base técnica | Documento real de punta a punta. |
| Aprobaciones | Parcial | Política versionada y escalamiento. |
| Presupuestos | Parcial | Comprometido/disponible y alertas. |
| Gastos/reembolsos | Parcial | Flujo y settlement externo. |
| Tarjetas | Sin emisión | Feed externo y controles; partner para emitir. |
| Conciliación | Parcial | Banco/tarjeta y export certificado. |
| Integración contable | Parcial | Preview, lotes y no duplicación verificados. |
| Inteligencia | Base | Excepción → acción aprobada → outcome. |

## Métricas

- tiempo desde captura hasta ready/review/aprobado/contabilizado;
- porcentaje de extracción corregida y match automático;
- solicitudes por estado, SLA y excepción;
- presupuesto comprometido, consumido y excedido;
- gastos sin documento y fuera de política;
- duplicados evitados;
- tiempo de conciliación/cierre;
- acciones sugeridas, aprobadas, ejecutadas y revertidas;
- incidentes, fraude, falsos positivos y pérdidas evitadas.

## Próximos cierres

1. Proveedor privado y primer documento real.
2. Solicitud, política versionada y compromiso de presupuesto.
3. Reembolso/anticipo con segregación.
4. Feed de tarjeta externa y controles preventivos.
5. Conciliación bancaria/contable con export auditable.
6. Acción inteligente con resultado medido.

Cada cierre incluye RLS, estados, reversa, auditoría, tests, navegador y
operación real. El orden global vive en [ROADMAP.md](../ROADMAP.md).
