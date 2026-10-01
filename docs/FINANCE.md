# Nerqia Finance

**Estado:** contrato vigente. **Revisión:** 2026-10-01. **Owner:** Producto Finance.

Finance es una superficie propia para controlar gasto empresarial. Su benchmark
principal es Mendel; su ventaja es operar sobre el mismo Business Graph que
Commerce y Business.
Growth (CRM/marketing) y Profit (contribución/decisiones) quedan fuera de Finance.
Reutilizan el Graph; Profit no crea otra contabilidad. [ADR 004](ADR_004_GROWTH_PROFIT_SHARED_GRAPH.md).

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

Contrato objetivo, no inventario de rutas completas; el estado comprobado está
en la matriz final. Toda ruta publicada debe tener autoridad y permiso reales.

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

Estado operativo: el contrato de extracción y su verificación reversible están
implementados; la certificación de un documento real persistido sigue abierta.
La prueba SQL del 2026-09-25 usa metadata de Storage y payload preparado: no
certifica HTTP al proveedor ni OCR real. La UI obtiene disponibilidad del servicio,
no la infiere de tablas vacías y no simula éxito. Inspección estructural no es AV externo.

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

El reembolso ya comparte la bandeja y las políticas de solicitudes. Guarda el
destino cifrado, muestra sólo una máscara, exige aprobación antes de revelar la
cuenta al pagador y sólo pasa a pagado con referencia externa. Esa transición
crea un único gasto y asiento; un reintento no duplica ninguno.

El anticipo usa esa misma bandeja, pero conserva la semántica contable: el
desembolso nace en `Anticipos a rendir`, no en gastos. Cada comprobante mueve
su importe a resultados y cada devolución reduce el activo. Referencias
idempotentes y un saldo cero cierran la rendición sin duplicar movimientos.

Desde 2026-09-29 el centro de costo, el medio de pago y la solicitud origen son
dimensiones estructuradas del gasto. Viajan al ledger y al lote contable; no se
reconstruyen desde la descripción o el nombre del proveedor.

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
| Inbox/captura | Contrato técnico verificado con fixture reversible | Original/Edge/proveedor reales y efecto aprobado en Core. |
| Aprobaciones | Política versionada y escalamiento implementados | Configuración del negocio y solicitud real con segregación. |
| Presupuestos | Comprometido/disponible con liberación y traza implementados | Presupuesto real, alertas y límites validados en operación. |
| Gastos/reembolsos | Reembolso + anticipo interno cerrados | Destino cifrado, segregación, rendición/devolución y ledger; falta certificación bancaria externa. |
| Tarjetas | Sin emisión | Feed externo y controles; partner para emitir. |
| Conciliación | CSV/match/confirmación con traza implementados | Extracto real conciliado; feed bancario/tarjetas por certificar. |
| Integración contable | Lotes del ledger, doble entrada e idempotencia verificados internamente | Export validado por responsable contable; no integración ERP genérica. |
| Inteligencia | Base | Excepción → acción aprobada → outcome. |

Evidencia agregada del 2026-10-01 en la base vinculada: 0 documentos Finance,
0 políticas y 0 lotes contables. Reproducir con
`supabase/verificaciones/20261001_finance_product_evidence.sql`.
No demuestra proveedor desconfigurado; sí deja adopción sin evidencia persistida.
Las verificaciones SQL de extracción, políticas, presupuesto, conciliación y
export del 2026-09-25 prueban contratos con rollback, no operación externa.

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

1. Certificar original privado → Edge/proveedor → revisión → efecto aprobado;
   protocolo [F5.1](F5_1_PRIMER_DOCUMENTO_FINANCE_REAL.md), sin hardcodear confianza.
2. Configurar política/presupuesto del negocio y validar solicitud real.
3. Certificar reembolso/anticipo con evidencia bancaria y rendición/reversa.
4. Extracto/export reales; después feed de tarjeta externa y controles preventivos.
5. Acción inteligente con resultado medido, no mutación financiera autónoma.

Cada cierre incluye RLS, estados, reversa, auditoría, tests, navegador y
operación real. El orden global vive en [ROADMAP.md](../ROADMAP.md).
