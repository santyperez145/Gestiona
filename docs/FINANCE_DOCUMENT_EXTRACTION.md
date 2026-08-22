# Finance Document Inbox — extracción y revisión

**Corte:** 2026-08-22
**Estado:** autoridad, migración, Edge Function y UI desplegadas; transferencia a
un proveedor externo deshabilitada hasta aprobar privacidad, modelo y benchmark.

La extracción no convierte a un modelo en autoridad financiera. Produce una
propuesta versionada sobre un original ya inspeccionado; Postgres valida el
esquema y las cuentas, y una persona confirma una revisión nueva. Ninguna etapa
crea compras, deudas, stock ni asientos.

## Flujo y límites de confianza

~~~text
usuario con finance.edit envía documentId + versionId
  → finance_document_begin_extraction (JWT, tenant, permiso y scanner clean)
  → lease UUID de 10 minutos
  → Edge descarga el original del bucket privado
  → recalcula SHA-256 y lo compara con la inspección
  → proveedor/modelo aprobado mediante tool call con JSON Schema
  → normalización sin defaults inventados + validación matemática
  → finance_document_complete_extraction (sólo service_role + lease)
  → ready_for_review (>= 0,85 y sin errores) | needs_review | failed
  → editor humano crea una revisión append-only
  → reviewed, todavía sin efectos operativos
~~~

El navegador nunca envía bytes ni base64 a la función, sólo ids. La Edge vuelve
a descargar desde `finance-documents`, comprueba el hash real y no registra el
documento ni el payload en logs. Un completion viejo no puede cerrar un retry
nuevo porque debe presentar el lease vigente.

## Contrato extraído

La revisión conserva, cuando el documento realmente los contiene:

- proveedor, CUIT, número y fecha del comprobante;
- moneda, subtotal, impuestos y total;
- líneas con descripción, cantidad, precio unitario, impuesto y total;
- confianza por campo y confianza total;
- errores de esquema, fecha, moneda y reconciliación matemática.

No se rellenan valores ausentes con cero. Las cuentas se verifican de nuevo en
Postgres; cualquier error limita la confianza a 0,69 aunque el proveedor declare
una cifra superior. Sólo una extracción sin errores y con confianza mínima 0,85
queda `ready_for_review`. Todo lo demás pide revisión explícita.

## Revisiones y autoridad

`finance_document_extractions` representa cada intento y su estado.
`finance_document_extraction_revisions` conserva la respuesta del modelo como
revisión 1 y cada corrección humana como una fila nueva. La UI edita una copia,
nunca la revisión anterior.

La confirmación humana:

- exige nuevamente `finance.edit` y pertenencia al tenant;
- valida estructura y matemática en servidor;
- guarda actor, fecha, nota y payload completo;
- emite eventos `extraction_started`, `extraction_completed`,
  `extraction_failed` o `extraction_reviewed`;
- no toca `purchases`, `supplier_debts`, `products.stock`, `stock_movements` ni
  `journal_entries`.

El matching determinístico quedó entregado el 2026-08-22: propone aliases o
identidades exactas, conserva empates y aprende sólo después de confirmación
humana. Contrato y verificación:
[FINANCE_DOCUMENT_MATCHING.md](FINANCE_DOCUMENT_MATCHING.md). El siguiente
slice crea borradores separados; la revisión ni el matching se convierten en
una compra directa.

## Gate de privacidad y proveedor

Secrets requeridos para permitir una llamada externa:

- `FINANCE_DOCUMENT_EXTRACTION_ENABLED=true`
- `ANTHROPIC_API_KEY`
- `FINANCE_DOCUMENT_MODEL`

Al corte, el flag y el modelo están ausentes en producción. Por eso ningún
comprobante puede salir de la plataforma aunque la función esté desplegada. La
función falla cerrada y deja evidencia de error recuperable.

Antes de configurarlos se debe aprobar y registrar:

1. contrato/DPA, región, subencargados y transferencia internacional;
2. retención cero o plazo mínimo documentado y exclusión de entrenamiento;
3. modelo fijado por nombre/versionado, costo y límites operativos;
4. benchmark con facturas representativas y autorizadas: exactitud por campo,
   reconciliación, latencia, costo, falsos positivos y documentos sin corrección;
5. plan de apagado y borrado de datos del proveedor.

No se habilita un modelo “latest” ni se usa un corpus público. Cambiar de modelo
requiere repetir el benchmark y conservar la versión en cada extracción.

## Verificación y operación

La migración incluye un fixture con roles reales: owner inicia, `service_role`
completa, owner revisa, outsider queda bloqueado, se conservan exactamente dos
revisiones y los efectos operativos son cero. La limpieza usa un permiso
privilegiado explícito; el original sigue siendo inmutable para la aplicación.

Consultas operativas:

~~~sql
select status, provider, model, count(*)
from public.finance_document_extractions
group by 1, 2, 3 order by 1, 2, 3;

select count(*) as leases_vencidos
from public.finance_document_extractions
where status = 'extracting'
  and lease_expires_at < now();

select e.id, e.status, e.overall_confidence,
       count(r.id) as revisiones
from public.finance_document_extractions e
left join public.finance_document_extraction_revisions r
  on r.extraction_id = e.id
group by e.id, e.status, e.overall_confidence;
~~~

Ante un fallo, revisar en este orden: estado de inspección y scanner, lease,
hash, flag, modelo/proveedor, validaciones y eventos. No editar tablas por SQL
para “aprobar” una factura.

## Precursor que no es autoridad

`extract-invoice` sigue existiendo para el importador histórico de Productos.
Recibe base64 desde el cliente y prellena una orden; no satisface este contrato
de privacidad, custodia, versionado o revisión. No se reutiliza dentro de
Finance y deberá retirarse cuando su flujo tenga una migración segura.
