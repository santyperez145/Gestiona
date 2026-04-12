
# Plan: Sección Mayorista en Catálogo + Recompra Automática en Órdenes + Mejoras

## 1. Sección "Precios Mayoristas" en Catálogo Público

**Archivo:** `src/pages/PublicCatalogPage.tsx`

Nueva sección visible en el catálogo público, después de los productos destacados:
- Titulo: "Precios Mayoristas" con ícono
- Muestra todos los productos con su precio mayorista calculado (descuento sobre precio efectivo)
- Texto: "Llevá {threshold}+ unidades y obtené {percent}% OFF"
- Tabla/grid con: producto, precio unitario, precio mayorista, ahorro por unidad
- Botón WhatsApp "Consultar por mayor" con mensaje pre-armado
- Solo se muestra si `volume_discount_threshold` y `volume_discount_percent` están configurados

## 2. Recompra Automática en Órdenes de Compra

**Archivo:** `src/pages/PurchasesPage.tsx` (componente `PurchaseOrderGenerator`)

Agregar botón "Pre-cargar recompra" que:
- Consulta las ventas recientes (últimos 30 días por defecto, configurable)
- Agrupa por `product_id`, suma las cantidades vendidas
- Auto-rellena el formulario de orden de compra con esas cantidades
- Muestra un resumen: "Basado en ventas de los últimos 30 días"
- El usuario puede ajustar cantidades antes de generar el Excel

**Lógica:** `SELECT product_id, SUM(quantity) FROM sales WHERE date > now() - interval '30 days' GROUP BY product_id`

Nuevo helper en `supabaseStore.ts`:
```typescript
export async function getSalesAggregatedDB(userId: string, days: number = 30)
```

## 3. Mejoras adicionales detectadas

### 3a. Decant prices en catálogo público muestran $0
En `PublicCatalogPage.tsx` líneas 799-801, los precios de decants (10ml, 5ml, 2.5ml) están hardcodeados a `price: 0`. Hay que calcularlos usando `calculateDecantPrice` con los settings del negocio (ya disponibles en la página).

### 3b. Badges de volumen en cards del catálogo
Agregar texto sutil en cada card: "Llevá {X}+ = -{Y}% OFF" para incentivar compras mayoristas desde el grid principal.

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/pages/PublicCatalogPage.tsx` | Sección mayorista, fix precios decants $0, badge volumen en cards |
| `src/pages/PurchasesPage.tsx` | Botón "Pre-cargar recompra" en PurchaseOrderGenerator |
| `src/lib/supabaseStore.ts` | Nueva función `getSalesAggregatedDB()` |

## Orden de implementación
1. `supabaseStore.ts` — helper de ventas agregadas
2. `PurchasesPage.tsx` — botón recompra automática
3. `PublicCatalogPage.tsx` — sección mayorista + fix decants + badges
