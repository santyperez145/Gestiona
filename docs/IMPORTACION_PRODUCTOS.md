# Importación de productos

La importación Excel/CSV es una entrada al Business Core, no un atajo para
escribir la tabla `products`. Desde `20260821000060_product_import_staging.sql`
el contrato es:

~~~text
archivo → normalización local → staging server-side → validación
        → aprobación explícita → aplicación atómica → reconciliación
~~~

## Qué garantiza

- acepta `.xlsx`, `.xls` y `.csv`, hasta 5.000 filas por lote;
- una celda vacía no borra un campo existente;
- resuelve por SKU y, como fallback, por nombre dentro de la organización;
- marca como conflicto un SKU ambiguo, un nombre ambiguo, claves repetidas en
  el archivo o SKU y nombre que apuntan a productos distintos;
- sólo `owner` o `admin` pueden preparar y aprobar;
- el navegador no puede escribir los lotes ni llamar directamente al motor de
  stock;
- los productos nuevos nacen con stock cero y toda diferencia pasa por
  `record_stock_movement`, con `reference_type = 'product_import'`;
- una falla al aplicar revierte todas las filas válidas del lote;
- reintentar el mismo `batch_id` completado devuelve el resultado anterior sin
  duplicar productos ni movimientos;
- volver a subir el mismo archivo después de completar crea un lote nuevo: es
  una reimportación intencional, no un retry técnico.

## Estados operativos

| Estado | Significado | Acción |
|---|---|---|
| `staged` | Validado; todavía no mutó el catálogo. | Corregir el archivo, cancelar o aprobar. |
| `applying` | Aplicación en curso con el lote bloqueado. | Esperar; no ejecutar SQL manual. |
| `completed` | Todas las filas fueron aplicadas. | Revisar la reconciliación. |
| `completed_with_errors` | Las válidas se aplicaron y las inválidas se omitieron con aprobación. | Corregir y subir sólo las omitidas. |
| `failed` | La transacción se revirtió. | Leer `error_message`, corregir la causa y preparar un lote nuevo. |
| `cancelled` | Descartado antes de aplicar. | No requiere reversión. |

## Diagnóstico sin ver datos de otros comercios

Ejecutar como miembro de la organización; RLS limita las filas visibles:

~~~sql
SELECT id, filename, status, total_rows, valid_rows, invalid_rows,
       created_count, updated_count, stock_movements_count,
       skipped_count, error_message, created_at, applied_at
FROM public.product_import_batches
ORDER BY created_at DESC
LIMIT 20;
~~~

Para reconciliar un lote concreto:

~~~sql
SELECT
  b.id,
  b.valid_rows,
  count(*) FILTER (WHERE r.status = 'applied') AS aplicadas,
  b.invalid_rows,
  count(*) FILTER (WHERE r.status = 'skipped') AS omitidas,
  b.stock_movements_count,
  count(DISTINCT sm.id) AS movimientos_en_kardex
FROM public.product_import_batches b
JOIN public.product_import_rows r ON r.batch_id = b.id
LEFT JOIN public.stock_movements sm
  ON sm.reference_type = 'product_import' AND sm.reference_id = b.id
WHERE b.id = '<batch-id>'::uuid
GROUP BY b.id;
~~~

La autoridad de cierre son los contadores que el RPC reconcilia dentro de la
misma transacción.

## Métricas para la primera cohorte

- lotes preparados → completados;
- tiempo de archivo a aplicación;
- porcentaje de filas inválidas;
- archivos abandonados después del staging;
- lotes fallidos y causa;
- filas creadas versus actualizadas;
- movimientos de stock por lote;
- minutos de intervención de soporte.

La importación de catálogo es paridad competitiva. Lo que Nerqia debe probar
como ventaja es que incorporar datos no rompe la verdad de stock, costo y margen
ni exige que soporte repare media importación con SQL.

## Reversión

Antes de aprobar, cancelar no requiere rollback porque el staging no toca
productos. Después de completar no se ofrece un «deshacer» ciego: otro usuario
podría haber vendido, comprado o corregido esos productos desde entonces.

Si el archivo aprobado era incorrecto:

1. conservar el `batch_id` y revisar qué filas se aplicaron;
2. corregir catálogo y precios con una nueva importación explícita;
3. corregir unidades mediante conteo/ajuste de inventario para mantener Kardex;
4. nunca actualizar `products.stock` por SQL o desde el cliente.
