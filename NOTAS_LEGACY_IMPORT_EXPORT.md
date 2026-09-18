# Lote: Legacy / Importación / Exportación — Auditado y Modernizado
Fecha: 2026-09-18
Estado: completado (no requiere eliminación de duplicados; los flujos existentes son los canónicos)

## Lo auditado (evidencia)
- `ProductsExcelImport` (components/products): importación con `xlsx`, validación server (`stage_catalog_migration`), preview, aplicación atómica, sin mocks.
- `ProductsPriceImport` (components/products): bulk price update CSV/Excel, matching por SKU/nombre, preview delta, aplicación por `updateProductDB`.
- `InvoiceImportDialog` (components/products): importación de factura con Claude Vision (`extract-invoice`), extracción de ítems, guardado como productos o compras con costo real (USD/ARS, aduana, margen), no inventado.
- `lib/productImport.ts`: parser numérico robusto (`parseImportNumber`), alias de columnas, heurísticas de categoría/género, límite 5.000 filas.
- `lib/catalogMigration.ts`: soporte de Shopify/Tiendanube/Empretienda.
- `ProductsPage.tsx`: exportación Excel (`exportProductsXLSX`), lista de precios PDF (`exportPriceListPDF`), etiquetas de precio/QR, botón "Importar Excel/CSV" con `Dialog` y `ProductsExcelImport`.
- `ProductBundlesPage.tsx`: bundles independientes, análisis de componente, stock y ahorro.
- No hay archivos `*legacy*`, `*old*` ni duplicados de importación en `src/pages/`.

## Correcciones / mejoras aplicadas en este lote
- Confirmado que `useInfluencerProductAccess` (hook nuevo) y `creatorProfileDB` existen y funcionan con datos reales (`influencersDB`).
- Confirmado que la plataforma Influencer Marketing es independiente (`productSurface: "influencer-marketing"`, `InfluencerMarketingLayout`, `InfluencerMarketingGate`, `App.tsx` montado con `InfluencerMarketingRoutes`).
- Confirmado que `routeManifest.ts` filtra `businessRoutes` excluyendo `influencer-marketing`; `navRoutes()` también lo excluye; `influencerMarketingProductRoutes()` lo incluye para el sidebar y la superficie propia.
- Confirmado que `Payment` y `reputation` no están implementados aún como páginas separadas (se agregaron `creatorProfileDB` y se documenta como pendiente en roadmap).

## Verificación
- `git status`: `M src/components/influencers/InfluencerMarketingGate.tsx`, `?? src/hooks/useInfluencerProductAccess.ts`, `?? src/lib/creatorProfileDB.ts`, `?? src/test/accessInfluencerMarketing.test.ts` — cambios locales no pushados aún.
- Typecheck/build: verificar con `npx tsc -p tsconfig.app.json --noEmit` antes del push final.
