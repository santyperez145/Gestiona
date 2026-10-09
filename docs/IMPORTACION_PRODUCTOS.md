# Importación de productos

**Estado:** contrato vigente, verificado internamente. **Corte:** 2026-10-08.
**Owner:** Commerce / Ingeniería. La certificación comercial vive en
[C22.2](C222_CERTIFICAR_MIGRACION.md), no en los fixtures.

## Flujo y límites

~~~text
archivo local → worker → hoja/columna→destino/moneda → confirmar asignaciones → sesión de validación
→ revisión completa → aprobación → lotes atómicos → reconciliación
~~~

- `.xlsx`, `.xls` (incluyendo archivos XLSX con extensión XLS) y `.csv`;
- hasta 50 MB, 50.000 filas de origen y 128 columnas por hoja;
- lectura y mapeo en Web Worker; selección de hoja y mapeo antes de guardar;
- hasta 250 productos y 1 MB por petición; el cliente deja margen de bytes;
- tabla local y validación del servidor paginadas de 50 en 50; no un `select`
  limitado silenciosamente a las primeras 1.000 filas;
- avance persistido en servidor, sin guardar el catálogo privado en localStorage;
- cada lote es atómico. El archivo completo **no** es una única transacción.

`catalog_import_sessions`/`catalog_import_chunks` coordinan el staging existente,
no son otro catálogo ni otro motor. `stage_catalog_migration` y
`apply_catalog_migration` siguen delegando en `stage_product_import`,
`apply_product_import` y `record_stock_movement`.
La extensión está en `20261003000200_catalog_import_sessions.sql`.

## Detección automática y revisión

- Se examinan las primeras 20 filas del área usada de cada hoja (hasta 128
  columnas); se propone la hoja con encabezados más reconocibles, no siempre
  la primera. Portadas vacías/instrucciones no desplazan un catálogo reconocido.
- Los encabezados se comparan por alias exactos, acentos/espacios normalizados,
  sin IA ni fuzzy matching de identidad o importes. La fila puede corregirse
  antes de preparar; el número físico se guarda en las opciones de sesión.
- Cada columna muestra letra física, encabezado, ejemplos y destino editable,
  incluso en Shopify/Tiendanube. La detección es una propuesta: se puede omitir
  con «No importar», corregir o restaurar; ninguna asignación queda plegada.
- Empates, encabezados repetidos y sinónimos conflictivos se explican. Cada
  destino usa una sola columna; faltan Nombre/identidad/estructura o hay
  asignaciones inválidas, no permite preparar. Los campos opcionales de oferta,
  género, contenido y stock mínimo tampoco se importan por una ruta oculta.
- Cualquier costo asignado sin unidad requiere confirmación ARS/USD, también
  `Importe` manual o `COSTO` de gestión. Cambiar su columna invalida la moneda;
  cambiar hoja/fila recalcula sin arrastrar índices. Los campos omitidos no
  reaparecen desde el parser legacy.
- Shopify/Tiendanube mantienen el parser agrupado y la identidad URL; la hoja
  sigue seleccionable sin convertir variantes en productos independientes.
  Los destinos de URL y pares de propiedades con contenido son estructurales;
  omitirlos bloquea la preparación en vez de perder variantes silenciosamente.
  Si traen costos, exigen confirmar ARS/USD: no suponen USD por ser un export
  de plataforma. La selección identifica moneda, no convierte importes; ventas
  siguen en ARS y un origen en otra moneda exige revisión antes de aprobar.
- Es obligatorio confirmar las asignaciones antes de preparar; cambiar hoja,
  fila, moneda o destino exige nueva revisión. `column_mapping` se conserva en
  las opciones inmutables de sesión; las sesiones anteriores mantienen su
  semántica original al reanudar, no se remapean con reglas nuevas.
- La sugerencia no guarda productos ni aplica inventario. Continúan moneda,
  destino, revisión del servidor, aprobación, idempotencia y reanudación. No hay
  nueva dependencia, RPC, ruta ni migración para esta detección.

Referencias oficiales comprobadas el 2026-10-08:
[Tiendanube carga masiva](https://ayuda.tiendanube.com/es_AR/122710-importar-y-exportar-productos/como-completar-el-excel-de-carga-masiva-de-productos)
conserva el identificador URL entre variantes;
[Shopify CSV](https://help.shopify.com/en/manual/products/import-export/using-csv)
documenta dependencias de columnas y sobrescritura, y su
[selector de encabezados](https://help.shopify.com/en/manual/products/import-export/common-import-issues)
permite corregir columnas no reconocidas. Tiendanube documenta una plantilla
estándar; no se atribuye un mapper arbitrario no observado. Nerqia mantiene una decisión
más conservadora: celdas vacías no borran campos y la detección no aprueba cambios.
[Inventario Shopify](https://help.shopify.com/en/manual/inventory-and-locations/setup/inventory-csv)
comprueba stock actual frente al exportado; paridad de concurrencia de stock y
certificación con export comercial real siguen siendo gates, no esta prueba local.

## Semántica del origen

Las celdas vacías no borran datos existentes. Los códigos de texto y formatos
numéricos con ceros se conservan, incluso en hojas que no empiezan en A1.
Una lectura recortada por el límite físico de filas se rechaza, nunca se
presenta como catálogo completo. Una fórmula no se ejecuta: sólo puede usarse
su valor previamente calculado en el archivo, sujeto a validación.

Para exportaciones de gestión con `CODIGO`, `DESCRIPCION`, `COSTO`, `VENTA`,
`PRECIO DE LISTA` y códigos de barras numerados:

- `DESCRIPCION` es el nombre; `CODIGO` es el SKU;
- `COSTO` se propone en ARS, pero exige confirmar moneda antes de validar;
- `PRECIO DE LISTA` es el precio normal;
- `VENTA` puede ser un precio condicionado a efectivo/transferencia. Se conserva
  en auditoría, **no** se transforma en una oferta para todos los medios ni
  configura automáticamente un descuento del comercio receptor;
- efectivo/transferencia reutilizan los descuentos existentes de POS y tienda,
  que el comercio debe revisar expresamente; no se crea otra autoridad de precio;
- los códigos de barras adicionales se guardan en `products.barcode_aliases` y
  se buscan en Productos/POS. Un código compartido exige elegir el producto;
- rubro y clasificación se conservan como categoría y etiqueta, sin adivinar rubro;
- marcadores `***SIN DATOS***` se tratan como ausencia, no como marcas reales;
- las columnas no mapeadas quedan en `normalized.source_record`, con encabezados
  y valores ordenados: dos columnas `CODIGO PROVEEDOR` no se sobreescriben;
- la columna asignada como **Proveedor** (alias exactos: proveedor, proveedor
  principal, distribuidor, supplier) asocia el producto a un proveedor de la
  organización por nombre, sin distinguir mayúsculas ni espacios, o lo crea al
  aplicar (`20261009000100`, trigger `product_import_assign_supplier`). Validar
  no crea proveedores; avisa si se creará uno o si el nombre es ambiguo. Una
  celda vacía o una importación sin esa columna conserva el proveedor actual;
- código de artículo del proveedor y fecha original no crean entidades
  financieras ni reemplazan fechas del sistema automáticamente. Una fila de
  origen superior a 16 KB queda inválida para revisión;
- antes de validar, `productImportDiagnosis` agrupa los problemas por causa
  (sin nombre, código repetido, precio/costo/stock inválido, sin precio, sin
  cotización, oferta no menor) con explicación, arreglo y ejemplos por fila.
  Las correcciones son explícitas: quitar filas, conservar la última aparición
  de un código, no importar el stock o el costo de esas filas, o activar el
  precio sugerido. Nunca redondea stock ni inventa precios sin la opción
  elegida; el servidor vuelve a validar y sus errores muestran su arreglo.

El costo ARS es nativo: no requiere inventar cotización ni pasar por USD para
calcular margen/Kardex. Un costo USD sí exige cotización válida. Los campos
heredados en USD no convierten una cotización ausente en un dólar supuesto.
El carrito POS, los kits y recomendaciones preservan esa moneda; margen y
ticket offline reutilizan el costo unitario canónico. Si un costo USD no puede
convertirse, el resultado queda desconocido, no una ganancia calculada sobre cero.

Shopify/Tiendanube conservan agrupación de variantes, imágenes, dimensiones,
visibilidad, identidad externa y redirects. Su registro de origen declara
`scope: first_row` y cantidad de filas: sólo conserva los valores de la primera
fila del grupo, para no rechazar grupos grandes por el límite de auditoría de
16 KB. Las variantes normalizadas completas, el mapeo y la huella permanecen
en la sesión; esta muestra no es un archivo original íntegro. Su agrupación no se
reinterpreta con el mapeo genérico. Empretienda sigue sin certificación de una
plantilla real; reconocer un nombre de archivo no prueba compatibilidad total.

## Identidad, inventario y permisos

- Identidad externa primero; con SKU explícito, sólo ese código determina el
  producto. Dos códigos distintos pueden compartir descripción.
- Sin código, un nombre ambiguo se invalida. Claves, SKU o destinos de producto
  repetidos entre lotes se revisan sobre el archivo completo antes de aprobar.
- Un alta cuyo código apareció después de validar falla sin crear un duplicado;
  exige revisar nuevamente el catálogo.
- El inventario actual admite enteros no negativos. Stock negativo/fraccionario
  no se redondea ni se convierte a cero. En modo reemplazo queda inválido; en
  modo conservar queda auditado pero no mueve unidades. Para productos nuevos,
  conservar inventario deja stock inicial cero hasta un conteo autorizado.
- Las altas nacen con stock cero y los ajustes pasan exclusivamente por Kardex.
- La tienda elegida recibe el surtido/redirects existentes; importar sólo al
  catálogo no publica automáticamente en vitrinas.
- Sólo owner/admin con `products.view` pueden preparar/leer la auditoría; crear
  o actualizar exige el permiso correspondiente también en servidor. Se vuelve
  a comprobar al aplicar cada lote, incluyendo permisos revocados.
- El cupo del plan se comprueba antes de aprobar; el trigger canónico sigue
  protegiendo cada alta. No se escriben productos ni staging desde el navegador.

## Recuperación

| Sesión | Acción |
|---|---|
| `preparing` | Retomar con el mismo archivo, huella, hoja y opciones. No cambió el catálogo. |
| `ready` | Revisar todas las filas; aprobar u omitir inválidas expresamente. |
| `applying` | Reanudar desde el último lote confirmado; los anteriores se conservan. |
| `completed` | Consultar contadores conciliados; reintentar no reaplica cambios. |
| `cancelled` | Descarta pendientes; no revierte lotes ya aplicados. |

Una respuesta perdida no implica que el servidor haya fallado: recuperar estado
y reintentar la misma sesión. Posiciones y payloads son idempotentes; las opciones
no cambian después del inicio. Pausar/cerrar detiene las peticiones posteriores,
no una transacción que el servidor ya recibió. El historial permite retomar
después de recargar. Una reimportación intencional crea una sesión nueva.

Cada error queda visible con recuperación; un resultado parcial no se presenta
como éxito. No existe un deshacer ciego: puede haber operaciones posteriores.
Corregir unidades siempre por inventario/Kardex, nunca `products.stock` directo.
La copia de imágenes externas es posterior; pendientes/errores no se anuncian
como imágenes ya independientes del proveedor.

## Verificación y operación

~~~bash
npx vitest run src/test/productImportWorkbook.test.ts src/test/productImportColumnMapping.test.ts src/test/catalogImportSession.test.ts src/test/productCatalogPaging.test.ts
npx supabase db query --linked --file supabase/verificaciones/20261003_catalog_import_sessions.sql
npx supabase db query --linked --file supabase/tests/catalog_migration_smoke.sql
npx supabase db push --linked --dry-run
npm run verify
~~~

El SQL usa organizaciones ZZ, identidades reales con roles/overrides y rollback:
501 filas, tres lotes, duplicados entre lotes, repetición tras respuesta perdida,
fallo sin avance después de revocar permisos, dos tenants, costo ARS en Kardex,
stock inválido/conservado y cero restos. El E2E autenticado intercepta las
escrituras del escenario de recuperación; no importa en producción.

Referencia local autorizada, 2026-10-03: 11.926 productos, 688 stocks negativos,
38 fraccionarios, sin códigos repetidos; cero diferencias al mapear costo/lista/
código/stock. Lectura y partición medidas en esta PC: 961 ms y 48 lotes.
**El archivo de otro negocio no se subió ni importó.** No es una certificación
comercial ni un SLO para cualquier equipo. La capacidad de 50.000 filas se
verifica con datos sintéticos; aún falta medir importación real autorizada,
latencia móvil, catálogo completo/POS offline y primera venta por cohorte.

Referencias técnicas oficiales consultadas el 2026-10-03:
[SheetJS Workers](https://docs.sheetjs.com/docs/demos/bigdata/worker/),
[opciones de lectura](https://docs.sheetjs.com/docs/api/parse-options/) y
[Shopify, importación de CSV](https://help.shopify.com/en/manual/products/import-export/import-products/).

Diagnóstico acotado: owner/admin puede consultar `catalog_import_status(id)` y
las filas de esa sesión, paginadas. Medir preparados/completados, tiempo total,
filas inválidas, abandonos, causa de fallos e intervención de soporte. El listado
compartido de productos usa páginas por ID para no truncar catálogos grandes;
no promete que descargar todo el catálogo sea una búsqueda instantánea.
