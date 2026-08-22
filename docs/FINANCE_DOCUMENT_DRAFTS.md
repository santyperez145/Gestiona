# Finance Document Inbox — borradores, aprobación y recepción

**Corte:** 2026-08-22
**Estado:** migración, RPC, UI, fixture productivo y libro de migraciones entregados.
**Fase:** F3, slice 18.

Este slice convierte un matching confirmado en tres objetos distintos. Esa
separación evita que “revisé la factura” signifique a la vez “debo dinero” y
“recibí mercadería”.

## Flujo de autoridad

~~~text
última revisión humana + matching confirmado
  → finance_document_create_drafts
  → Supplier Invoice Draft (evidencia fiscal)
  → Purchase Draft + líneas (preparación operativa)
  → Payable Draft (preparación monetaria)
  → owner/admin resuelve líneas, vencimiento y TC
  → finance_document_approve_drafts
  → purchase_orders(status=confirmed) + purchase_order_items
  → supplier_debts(status=pending)
  → recepción posterior mediante receive_purchase_order(_idem)
  → purchases + trigger único de stock/Kardex
~~~

Crear borradores produce cero filas en `purchase_orders`, `supplier_debts`,
`purchases`, `stock_movements` y `ledger_entries`. Aprobar produce una orden y
una deuda, pero sigue sin crear `purchases`, stock ni ledger. La entrada física
queda deliberadamente en el workflow de recepción que ya protege el Core.

## Los tres borradores

- `finance_supplier_invoice_drafts`: snapshot de proveedor, número, fecha,
  moneda, impuestos y total de la última revisión humana;
- `finance_purchase_drafts` y `finance_purchase_draft_lines`: destino operativo
  de cada renglón y link a la orden aprobada;
- `finance_payable_drafts`: moneda original, tipo de cambio, importe ARS,
  vencimiento y link a la obligación aprobada.

Una línea sólo puede quedar como:

- `inventory`: exige un producto activo del mismo tenant;
- `non_inventory`: flete, servicio u otro cargo declarado explícitamente;
- `unresolved`: permite guardar el borrador, pero bloquea aprobación.

El Core actual recibe cantidades enteras. Una cantidad fraccionaria permanece
visible como bloqueo; no se redondea ni se trunca silenciosamente.

## Segregación e idempotencia

- leer exige entitlement Finance y `finance.view`;
- crear/regenerar borradores exige `finance.edit`;
- aprobar exige además rol `owner` o `admin`;
- staff de Platform sin membresía no cruza el tenant;
- las cuatro tablas son `SELECT` bajo RLS y no aceptan escrituras directas desde
  `authenticated`;
- el estado aprobado es la clave idempotente: un retry devuelve los mismos IDs
  sin duplicar orden, deuda o evento;
- una factura aprobada no admite otra revisión de extracción. Una corrección
  fiscal debe entrar como nueva versión o nota de crédito, no reescribir hechos.

El número normalizado de factura es único por organización y proveedor. Así un
archivo visualmente distinto no puede crear dos obligaciones para el mismo
comprobante sólo por evadir el hash del original.

## Moneda y dinero

La factura conserva ARS o USD. `supplier_debts` es autoridad en ARS:

- ARS usa tipo de cambio 1;
- USD exige que owner/admin confirme un tipo de cambio positivo;
- el monto de deuda es `round(total × tipo_de_cambio, 2)`;
- `remaining_ars` no se escribe: es una columna generada por la base.

Este último contrato apareció al ejecutar el fixture contra producción; los
tipos generados no distinguen por sí solos una columna calculada.

## UI

La bandeja muestra `Preparar borradores`, `Revisar borradores` o `Ver aprobación`
según el estado. El diálogo conserva las tres tarjetas separadas, permite
resolver cada línea contra catálogo o como no inventariable, pide vencimiento y
tipo de cambio y explica el efecto antes del CTA.

Después de aprobar muestra los IDs de orden y deuda, y mantiene visible que la
orden sigue sin recepción. No ofrece un atajo para escribir stock.

## Verificación real

`20260822000013_finance_document_drafts.sql` creó un tenant `ZZ`, una factura
con producto y flete, y verificó:

- borradores visibles para owner y ocultos al outsider;
- `lines_unresolved` antes de clasificar el flete;
- cero efectos del Core al preparar;
- aprobación owner/admin con una línea inventariable y otra no inventariable;
- una orden `confirmed`, dos líneas y `quantity_received = 0`;
- una obligación pendiente;
- retry exacto con una sola orden y una sola deuda;
- stock del producto sin cambios y cero `purchases`, Kardex o ledger;
- borrado del tenant de prueba y cero restos.

Después del fixture, producción quedó con 0 borradores reales y el libro respondió
`upToDate`. El gate técnico está cerrado; todavía no hay evidencia de una factura
de un comercio procesada de punta a punta.

Consultas operativas:

~~~sql
select status, currency, count(*)
from public.finance_supplier_invoice_drafts
group by 1, 2 order by 1, 2;

select disposition, count(*)
from public.finance_purchase_draft_lines
group by 1 order by 1;

select i.status,
       count(*) filter (where p.purchase_order_id is not null) as ordenes,
       count(*) filter (where d.supplier_debt_id is not null) as obligaciones
from public.finance_supplier_invoice_drafts i
join public.finance_purchase_drafts p on p.invoice_draft_id = i.id
join public.finance_payable_drafts d on d.invoice_draft_id = i.id
group by i.status;
~~~

## Próximo límite

F3 ya tiene la cadena técnica completa. Para cumplir su condición de salida falta
un proveedor privado de scanner/extracción aprobado y facturas autorizadas que
midan accuracy, tiempo, match rate y excepciones. El siguiente trabajo puramente
técnico no debe inventar amplitud: corresponde endurecer la recepción Finance
end-to-end/E2E o retomar D2.5 estados visuales mientras llega esa evidencia.
