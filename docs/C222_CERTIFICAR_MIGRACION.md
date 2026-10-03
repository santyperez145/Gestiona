# Lote C22.2 — Certificar migración con comercios reales

Estado: contratos verificados internamente; certificación comercial pendiente.
Corte: 2026-10-03. Owner: Commerce / Operación.

## Contexto
Según `ROADMAP.md` §2 y `CONTRIBUTING.md` §4, C22.2 es el siguiente cierre de Commerce first-level: archivos reales de comercios, clientes, imágenes propias y rollback seguro.

## Lo que ya existe
- **Importador unificado** (`ProductsExcelImport.tsx`): detecta origen (Shopify, Tiendanube, Empretienda por nombre de archivo hasta certificar plantilla), agrupa variantes e imágenes, conserva identidad externa, mueve stock por Kardex y crea redirects por vitrina.
- **Sesión reanudable**: worker, mapeo, costo ARS/USD, páginas completas y lotes de hasta 250 productos sobre los RPC existentes; atomicidad por lote, no por archivo. Autoridad: [Importación de productos](IMPORTACION_PRODUCTOS.md).
- **Tests** (`catalogoNoCompiteConLaTienda.test.ts`, `storeAssortment.test.ts`): publicación/ocultamiento, precio comparativo, categoría, destacado y orden por vitrina sin duplicar producto ni stock.
- **Migración SQL 20260904000030_store_custom_domains.sql**: soporte multi-tienda.

## Lo que falta para certificar (no se inventa)
1. **Archivos reales**: 1 comercio Shopify exportado y 1 Tiendanube con variantes, imágenes y stock. Empretienda aún se detecta por nombre de archivo.
2. **Clientes**: certificar la migración canónica existente con datos/consentimientos autorizados; no duplicar el customer store.
3. **Imágenes propias**: certificar entrega desde Storage y recuperación de copias fallidas; el consumidor ya existe. Falta matching GTIN/MPN y catálogo/feed autorizado.
4. **Rollback seguro**: no hay deshacer ciego de sesiones aplicadas. Diseñar compensación condicionada a ausencia de operaciones posteriores y certificar con autorización.
5. **Segundo comercio**: onboarding, migración y primera venta sin SQL. Gate externo, no código.

## Resultado observable verificable
- `ProductsExcelImport.tsx` compila con `npm run build` y `npm run typecheck`.
- `catalogoNoCompiteConLaTienda.test.ts` pasa en navegación multi-tienda.
- No se abre un nuevo producto; se extiende el importador existente con evidencia real.

## Próximos pasos
1. Conseguir 1 exportación Shopify y 1 Tiendanube real (o ambos datos de un comercio existente).
2. Obtener autorización expresa para organización/tienda y opciones de moneda, precio e inventario. Una referencia de otro negocio no autoriza importarla.
3. Completar la sesión de validación, revisar todos los lotes y aprobar sólo el alcance autorizado; conservar reconciliación e incidencias.
4. Medir latencia, búsqueda/listado grande, POS offline y primera venta. Evaluar compensación segura si corresponde.
5. Publicar evidencia agregada sin datos privados, no un "certificado" inventado.
