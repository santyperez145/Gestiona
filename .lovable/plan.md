

# Plan Combinado: Mejoras de Negocio + Fix Fechas + Clientes en Ventas

## Parte 1: Fix de Fechas (Bug crítico)

**Problema:** Las fechas se envían como `"2026-04-10"` sin hora, Supabase las interpreta como UTC midnight, y en Argentina (UTC-3) se muestra el día anterior.

**Fix en archivos:** `SalesPage.tsx`, `PurchasesPage.tsx`, `DebtsPage.tsx`
- Al guardar: `date + "T12:00:00"` en vez de solo `date`
- Al mostrar: usar `new Date(d).toLocaleDateString('es-AR')` con manejo UTC-safe

## Parte 2: Selector de Clientes en Ventas

**Archivo:** `SalesPage.tsx`
- Reemplazar el input de texto libre "Cliente" por un combobox con autocompletado
- Extraer nombres únicos de clientes del historial de ventas (`sales.customer_name`)
- Permitir escribir un nombre nuevo si no existe en la lista
- Mostrar medio de pago en las cards mobile (actualmente falta)

**Archivo:** `supabaseStore.ts`
- Nueva función `getUniqueCustomersDB(userId)` que hace `SELECT DISTINCT customer_name FROM sales WHERE user_id = ?`

## Parte 3: Migración SQL — Productos Destacados

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;
```

Actualizar la vista `products_public` para incluir `featured` y `offer_expires_at`.

## Parte 4: Catálogo Público — Precios Psicológicos + Destacados

**Archivo:** `PublicCatalogPage.tsx`

- **Sección "Destacados"** arriba del grid con productos marcados `featured = true`
- **Countdown timer** en productos con `offer_expires_at` vigente
- **Precio por cuota**: mostrar "3 cuotas de $X" debajo del precio principal
- **Etiqueta "MEJOR PRECIO"** en precio efectivo/transferencia
- **Ahorro en pesos**: mostrar "Ahorrás $15.000" cuando hay descuento
- **Precio tachado** más visible con línea roja
- **Animaciones**: hover lift en cards, lazy loading con skeleton
- **Mobile**: cards de 1 columna en pantallas < 400px, botón WhatsApp más grande
- **Compartir producto**: botón que copia link directo al catálogo o mensaje de WhatsApp

## Parte 5: Panel Admin — Toggle Featured + Margen

**Archivo:** `ProductsPage.tsx`

- Toggle "Destacado" y campo fecha de expiración de oferta en el formulario de producto
- Alerta visual cuando el margen del producto es < 30% (con ícono de warning)
- Botón "Vender" rápido en cada card de producto que abre un mini-dialog de venta

## Parte 6: Dashboard — Análisis de Rentabilidad

**Archivo:** `Dashboard.tsx`

- **Ranking de margen**: tabla/lista de top 5 productos más rentables y bottom 5 menos rentables
- **Alerta margen bajo**: warning en productos con margen < 30%
- **Sugerencia de precio mínimo**: mostrar el precio mínimo para mantener X% de margen
- **Mini-sparklines** en KPI cards mostrando tendencia de los últimos 7 días

## Parte 7: Sidebar — Badge de Notificaciones

**Archivo:** `AppLayout.tsx`

- Consultar notificaciones no leídas del usuario
- Mostrar badge numérico rojo en el ícono de notificaciones del sidebar

---

## Archivos a modificar/crear

| Archivo | Cambio |
|---|---|
| `src/pages/SalesPage.tsx` | Fix fecha, combobox clientes, medio de pago en mobile |
| `src/pages/PurchasesPage.tsx` | Fix fecha |
| `src/pages/DebtsPage.tsx` | Fix fecha |
| `src/pages/PublicCatalogPage.tsx` | Destacados, precios psicológicos, countdown, compartir, animaciones |
| `src/pages/ProductsPage.tsx` | Toggle featured, expiración oferta, alerta margen, venta rápida |
| `src/pages/Dashboard.tsx` | Ranking margen, sparklines, alertas |
| `src/components/AppLayout.tsx` | Badge notificaciones |
| `src/lib/supabaseStore.ts` | `getUniqueCustomersDB()` |
| Migración SQL | `featured`, `offer_expires_at` en products + actualizar vista pública |

## Orden de implementación

1. Migración SQL (featured, offer_expires_at)
2. Fix de fechas en todas las páginas
3. Combobox de clientes en ventas + medio de pago mobile
4. Catálogo público: destacados + precios psicológicos + compartir + animaciones
5. Productos: toggle featured + alerta margen + venta rápida
6. Dashboard: ranking margen + sparklines
7. Sidebar: badge notificaciones

