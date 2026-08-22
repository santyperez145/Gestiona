# Finance Document Inbox — matching y memoria de aliases

**Corte:** 2026-08-22
**Estado:** migración, RPC, tipos, UI y verificación en producción entregados.
**Fase:** F3, slice 17.

El matching convierte una revisión humana de factura en vínculos propuestos
contra proveedores y productos del Business Core. Sigue siendo una etapa sin
efectos: no crea compras, obligaciones, stock ni asientos.

## Flujo de autoridad

~~~text
extracción reviewed + última revisión humana
  → finance_document_run_matching
  → proveedor por alias de CUIT/nombre o nombre exacto
  → producto por alias de SKU, SKU exacto, alias de descripción o nombre exacto
  → 0 candidatos = none | 1 = propuesta | más de 1 = ambiguous
  → persona elige proveedor y producto por línea
  → finance_document_confirm_matching
  → confirmación auditada + aliases tenant-safe
  → la factura siguiente reutiliza el vocabulario confirmado
~~~

La base no usa similitud probabilística. Un typo no se convierte en certeza y
un homónimo no se resuelve por orden de llegada. La búsqueda aproximada puede
existir más adelante como ayuda visual, pero no puede escribir una propuesta
canónica sin otra señal.

## Orden determinístico

Proveedor:

1. CUIT ya confirmado (`tax_alias`);
2. nombre ya confirmado (`name_alias`);
3. nombre canónico exacto normalizado (`exact_name`);
4. ninguno o ambiguo.

Producto, dentro de la organización:

1. SKU aprendido para el proveedor (`supplier_sku_alias`);
2. SKU canónico exacto (`exact_sku`);
3. descripción aprendida para el proveedor (`description_alias`);
4. nombre o marca + nombre exactos (`exact_name`);
5. ninguno o ambiguo.

Las normalizaciones reutilizan las funciones canónicas
`normalize_identity_text`, `normalize_identity_phone` y
`normalize_product_sku`; no se crea otro dialecto de identidad.

## Datos y auditoría

- `finance_document_match_runs`: propuesta por revisión, estado y proveedor
  propuesto/confirmado;
- `finance_document_line_matches`: evidencia extraída, candidato, cantidad de
  coincidencias y decisión humana por línea;
- `finance_supplier_aliases`: nombre/CUIT confirmado dentro del tenant;
- `finance_product_aliases`: SKU/descripción confirmados por proveedor;
- eventos `matching_proposed` y `matching_confirmed` con actor y conteos.

Las tablas son de lectura bajo RLS para miembros con `finance.view`. Toda
mutación directa está revocada. Proponer y confirmar exige `finance.edit` en el
servidor. Un alias no se reasigna: si el mismo CUIT, SKU o descripción ya apunta
a otra entidad, la transacción falla completa y pide resolver el conflicto.

## UI y operación

Después de `Confirmar revisión`, la bandeja ofrece `Buscar coincidencias`. El
diálogo muestra:

- nombre/CUIT extraídos y método de coincidencia;
- proveedor canónico seleccionable;
- descripción/SKU de cada línea;
- producto propuesto o `sin vincular`;
- ambigüedad y cantidad de candidatos;
- alcance explícito de lo que se aprende y de lo que todavía no ocurre.

Aceptar una propuesta y elegir otra manualmente quedan diferenciados. Una línea
puede seguir sin producto; el match rate no se infla para poder avanzar.

## Verificación real

La migración `20260822000012_finance_document_matching.sql` creó un tenant `ZZ`
y dos facturas. La primera encontró al proveedor por nombre exacto y dejó el SKU
externo sin resolver. La persona confirmó proveedor/producto; la segunda resolvió
el proveedor por el CUIT aprendido y el producto por el SKU del proveedor. Dos
productos homónimos quedaron `ambiguous` con dos candidatos.

También verificó:

- outsider bloqueado con rol `authenticated`;
- retry exacto sin duplicar aliases ni eventos;
- cero compras, obligaciones, movimientos de stock y asientos;
- cero filas `ZZ` al terminar;
- libro de migraciones registrado y `db push --dry-run` sin brecha.

Consultas operativas:

~~~sql
select status, supplier_match_method, count(*)
from public.finance_document_match_runs
group by 1, 2 order by 1, 2;

select proposed_method, confirmation_method, count(*)
from public.finance_document_line_matches
group by 1, 2 order by 1, 2;

select alias_type, count(*), sum(confirmation_count) as confirmaciones
from public.finance_product_aliases
group by 1 order by 1;
~~~

Al corte de despliegue, producción quedó con 0 match runs y 0 aliases porque no
hay documentos Finance reales procesados. El gate técnico está cerrado; match
rate y tiempo ahorrado siguen sin evidencia de adopción.

## Próximo límite

El siguiente slice es `Invoice-to-purchase/payable draft`. Debe consumir un
matching confirmado y crear borradores separados, nunca una compra o deuda
efectiva. La aprobación del borrador será otra acción, con idempotencia, estado,
segregación y cero movimiento de stock hasta una recepción real.
