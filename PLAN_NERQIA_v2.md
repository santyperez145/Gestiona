# Plan de push — Nerqia v2.0 (Lote 1: Commerce / Storefront / Checkout)

Fecha: 2026-09-28. Estado: lote 1 iniciado y en curso.
Referencia: OBJECTIVE_NERQIA_v2.md.

## Lotes definidos

Lote 1 — Commerce (este archivo):
- [x] OBJECTIVE_NERQIA_v2.md (adjuntado)
- [x] PLAN_NERQIA_v2.md (este archivo)
- [x] src/lib/storeCollection.ts (colecciones / surtido por canal)
- [x] src/lib/channelAttribution.ts (atribucción por canal)
- [x] src/components/products/CollectionEditor.tsx (editor de colecciones)
- [x] src/components/products/MigrationWizard.tsx (importación masiva preview → mapeo → ejecución)
- [x] src/lib/storefrontSeo.ts (SEO técnico y atribución)
- [x] src/storefront/StoreInventory.tsx (stock por ubicación POS + tienda)
- [ ] Integración de CollectionEditor en página de productos (pendiente de UI)
- [ ] Tests adicionales (Vitest) para los nuevos módulos

Lote 2 — POS / Inventario único por ubicación (pendiente):
- Resolver sincronización exacta POS ↔ storefront.
- Agregar RPC reserve_stock / commit_sale.
- Completar StoreInventory con sincronización realtime.

Lote 3 — Finance (pendiente):
- Finance Inbox + extracción (paridad Mendel/Rindegastos).
- Agregar componente FinanceDocumentInbox.
- Tests de extracción con confianza.

Lote 4 — Platform / Automate (pendiente):
- Automatización recuperación carrito abandonado.
- Webhook firmado y guardián de pago.
- Log de auditoría por acción.

## Regla de commit/push
- Cada lote pasa: npm run test (vitest run), npm run typecheck (tsc --noEmit), npm run lint (eslint, 0 errors).
- Commit con mensaje descriptivo y referencia al lote.
- Push a origin/main inmediatamente tras validación.
- No inventar tracción ni rieles live.
- Benchmarks (BIND / Dock / tapi / Pismo / Pomelo / Wibond) solo como referencia, nunca como conector.

## Estado actual del lote 1
- Typecheck: corriendo (sin errores por nuevos archivos; se espera confirmación).
- Lint: 0 errors, 138 warnings documentados (existentes, no introducidos por lote 1).
- Tests: corriendo en paralelo.
- Dependencias: no se installó nada nuevo; se reutilizaron react, lucide y las librerías existentes.

## Faltantes restantes para completar lote 1
1. Integrar CollectionEditor en la UI de productos.
2. Integrar MigrationWizard en la página de productos / importación.
3. Agregar tests mínimos para storeCollection, channelAttribution, storefrontSeo.
4. Verificar que StoreInventory se renderiza correctamente en la ficha de producto.

## Commit / push esperado
- git add OBJECTIVE_NERQIA_v2.md PLAN_NERQIA_v2.md src/lib/storeCollection.ts src/lib/channelAttribution.ts src/components/products/CollectionEditor.tsx src/components/products/MigrationWizard.tsx src/lib/storefrontSeo.ts src/storefront/StoreInventory.tsx
- git commit -m "Lote 1 Nerqia v2.0 — Commerce: colecciones, migración, SEO, inventario"
- git push origin main (tras confirmar typecheck verde)
