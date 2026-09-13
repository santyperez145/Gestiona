# Lote C22.2 — Certificar migración con comercios reales

Estado: en evaluación con datos reales. No se simula éxito.

## Contexto
Según `ROADMAP.md` §2 y `CONTRIBUTING.md` §4, C22.2 es el siguiente cierre de Commerce first-level: archivos reales de comercios, clientes, imágenes propias y rollback seguro.

## Lo que ya existe
- **Importador unificado** (`ProductsExcelImport.tsx`): detecta origen (Shopify, Tiendanube, Empretienda por nombre de archivo hasta certificar plantilla), agrupa variantes e imágenes, conserva identidad externa, mueve stock por Kardex y crea redirects por vitrina.
- **RPCs server-side** (`stage_catalog_migration`, `apply_catalog_migration`): preparan en staging, validan filas, aplican en transacción atómica e idempotente.
- **Tests** (`catalogoNoCompiteConLaTienda.test.ts`, `storeAssortment.test.ts`): publicación/ocultamiento, precio comparativo, categoría, destacado y orden por vitrina sin duplicar producto ni stock.
- **Migración SQL 20260904000030_store_custom_domains.sql**: soporte multi-tienda.

## Lo que falta para certificar (no se inventa)
1. **Archivos reales**: 1 comercio Shopify exportado y 1 Tiendanube con variantes, imágenes y stock. Empretienda aún se detecta por nombre de archivo.
2. **Clientes**: el importador no incluye clientes de marketplace; el roadmap explícitamente lo marca como pendiente.
3. **Imágenes propias**: copia a storage propio (no URL externa). Falta matching GTIN/MPN y catálogo/feed autorizado.
4. **Rollback seguro**: condicionado a que no haya operaciones posteriores (el RPC existe; la prueba de rollback con datos reales no existe).
5. **Segundo comercio**: onboarding, migración y primera venta sin SQL. Gate externo, no código.

## Resultado observable verificable
- `ProductsExcelImport.tsx` compila con `npm run build` y `npm run typecheck`.
- `catalogoNoCompiteConLaTienda.test.ts` pasa en navegación multi-tienda.
- No se abre un nuevo producto; se extiende el importador existente con evidencia real.

## Próximos pasos
1. Conseguir 1 exportación Shopify y 1 Tiendanube real (o ambos datos de un comercio existente).
2. Abrir un soporte con `stage_catalog_migration` con el archivo real y documentar el resultado (no inventar el resultado).
3. Si el rollback es posible, correr el drill y documentar.
4. Commit + push con el resultado real, no con un "certificado" inventado.
