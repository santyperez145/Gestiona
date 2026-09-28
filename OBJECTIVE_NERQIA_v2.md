# Objetivo Nerqia v2.0 — Lote 1 (Commerce / Storefront / Checkout)

Estado: objetivo activo (seleccionado por usuario). Prioridad: ATM (primera venta sin SQL).
Referencia: docs/ESTRATEGIA.md (§5 Paridad Commerce), docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md (§5, §13, §15), reglas workspace (.cursor/rules/lineamiento-competitivo.mdc).

## Definición de terminado (lote 1)
- Storefront publica catálogo real con productos, variantes, imágenes, búsqueda, colecciones.
- Checkout honesto: dimensiones estables, carga progresiva, estados (idle/creating/securing/opening/error), idempotencia (crypto.randomUUID + persistencia localStorage + RPC), recuperación de intento tras recarga.
- Carrito persistente por sesión (storeCart / cartToken) con sincronización multi-tab (storeCartMultiTabSync.test.ts).
- Orden confirmada con número, acceso privado (orderAccessFragment), notificación por email (store-order-email edge), pago (Nerqia Pay / transferencia / efectivo), cupón (check_store_coupon RPC), envío por zona (quote_store_shipping RPC).
- Recuperación de abandono: email pre-cargado, recuperación por token, reenvío de notificación.
- Páginas legales (términos + privacidad) publicadas y verificadas; branding (logo, meta, slug) configurado.
- Estado vacío, error, offline, parcial, conflicto cubiertos en cada pantalla (sección 9 del estándar).
- Responsive 390/768/1024/1280/1440; teclado y foco; contraste WCAG 2.2 AA.
- No se copian assets/textos de competidor; traducción de patrones ( Shopify / Tiendanube / Empretienda / Go-Marz / Mendel ).

## Faltantes detectados en codebase hoy (para cerrar en siguientes lotes)
1. Reviews / preguntas de producto (ProductQuestions existe parcialmente; falta moderación y evidencia).
2. Colecciones / surtido por tienda (CategorySelect existe; falta flujo de creación con preview).
3. SEO técnico y analytics first-party (analytics/ module existe parcialmente; falta evento de atribución por canal).
4. Migración con preview, mapeo, redirects, reconciliación y rollback (falta módulo de importación masiva con preview).
5. POS + inventario único por ubicación (POSPage existe; falta sincronización exacta entre POS y storefront en tiempo real).
6. Finance Inbox + extracción (falta módulo de captura de documentos con confianza y revisión humana para paridad Mendel).
7. Automatizaciones con señal → acción con log (falta flujo de recuperación de carrito abandonado automático y notificaciones por evento).

## Secuencia de ejecución (lotes verdes, sin esperar confirmación)
1. Lote 1 — Commerce (este objetivo): completar faltantes detectados arriba, commit + push a main con tests/typecheck/lint verdes.
2. Lote 2 — POS / Inventario único por ubicación.
3. Lote 3 — Finance Inbox (paridad Mendel).
4. Lote 4 — Platform / Automate.

## Dependencias / tecnologías
- Stack aprobado: React 18, TypeScript, Vite, TanStack Query, Tailwind, Radix, Lucide, Supabase/PostgreSQL, Vitest, Playwright.
- Nuevas dependencias solo si gap > 80/100 (sección 13 del estándar) con benchmark, prueba mínima, rollback, owner.
- No reescribir a otro framework sin medición de SLO/SEO/aislamiento.
- No usar AWS pago ni retainer sin autorización expresa.
- Benchmarks (BIND / Dock / tapi / Pismo / Pomelo / Wibond) solo como referencia, nunca como conector.

## Regla de commit/push
- Cada lote pasa: `npm run test` (vitest run), `npm run typecheck` (tsc --noEmit), `npm run lint` (eslint, 0 errors, warnings documentados).
- Commit con mensaje descriptivo y referencia al lote.
- Push a origin/main inmediatamente tras validación.
- No inventar tracción, rieles live ni clientes fuera del Business Core.
