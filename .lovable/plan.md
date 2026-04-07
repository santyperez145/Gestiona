

# Plan: Automatización Completa v7.5

## Resumen
Implementar auto-cálculo de precios en productos, medio de pago en ventas, auto-cálculo en compras, catálogo visual, y ajuste masivo de precios. El usuario solo ingresa costo USD y el sistema calcula todo automáticamente.

---

## 1. Migración de Base de Datos

Agregar columnas faltantes:
- `sales.payment_method TEXT DEFAULT 'efectivo'`
- `products.image_url TEXT`
- `settings.discount_cash_percent NUMERIC DEFAULT 10`
- `settings.discount_transfer_percent NUMERIC DEFAULT 5`
- `settings.discount_debit_percent NUMERIC DEFAULT 0`
- `settings.discount_credit_percent NUMERIC DEFAULT 0`

---

## 2. Auto-cálculo en ProductForm

Al ingresar `cost_usd`, calcular automáticamente:
- `sale_price_ars = (costUSD + costUSD × pasero%) × TC × 2`
- `discount_price_ars = sale_price_ars × (1 - default_discount_percent/100)`

Los campos se auto-completan pero permiten override manual. Se muestra label explicativo con la fórmula aplicada.

**Archivo:** `src/pages/ProductsPage.tsx` — agregar `useEffect` en ProductForm que recalcula cuando cambia `costUSD`.

---

## 3. Medio de Pago en Ventas (reemplaza descuento manual)

Reemplazar los toggles "Normal/Oferta" y "Pagado/Fía" por un único selector de **medio de pago**:
- **Efectivo** → usa `discount_price_ars` (precio con descuento)
- **Transferencia** → usa `discount_price_ars`
- **Débito** → usa `sale_price_ars` (precio normal)
- **Crédito** → usa `sale_price_ars`
- **Fiado** → usa `sale_price_ars` + marca `paid=false` + genera deuda

El precio se aplica automáticamente al seleccionar el medio. Se mantiene la opción de precio personalizado como override.

**Archivo:** `src/pages/SalesPage.tsx` — modificar SaleForm.

---

## 4. Auto-cálculo en PurchaseForm

Al seleccionar producto:
- Auto-completar `unit_cost_usd` desde el producto
- Calcular automáticamente `customs_fee`, `total_usd`, `total_ars`
- TC se toma de Settings

**Archivo:** `src/pages/PurchasesPage.tsx` — ya lo hace parcialmente, verificar que sea completo.

---

## 5. Recálculo Masivo Mejorado en Settings

Al recalcular, además de costos y ganancias, también recalcular:
- `sale_price_ars` con la fórmula `(cost_usd + customs_fee) × TC × 2`
- `discount_price_ars` con la fórmula `sale_price_ars × (1 - default_discount_percent/100)`

Al guardar Settings, si cambió TC/pasero/descuento, mostrar diálogo preguntando si recalcular todos los productos automáticamente.

**Archivo:** `src/pages/SettingsPage.tsx`

---

## 6. Sección Descuentos por Medio de Pago en Settings

Nueva sección en SettingsPage con 4 campos configurables:
- Descuento Efectivo (%), Transferencia (%), Débito (%), Crédito (%)

**Archivo:** `src/pages/SettingsPage.tsx`

---

## 7. Catálogo Visual de Productos

Nueva página `/catalogo` con grid de cards mostrando:
- Foto del producto (nuevo campo `image_url`)
- Nombre, marca, categoría
- Precio normal y precio con descuento
- Filtros por categoría y búsqueda

Upload de imagen en ProductForm.

**Archivos nuevos:** `src/pages/CatalogPage.tsx`
**Modificados:** `src/App.tsx` (ruta), `src/components/AppLayout.tsx` (sidebar), `src/pages/ProductsPage.tsx` (upload imagen)

---

## 8. Ajuste Masivo de Precios

Botón "Ajustar precios" en ProductsPage que abre modal para:
- Seleccionar categoría o todas
- Ingresar porcentaje (+/- X%)
- Elegir campo (venta, descuento, ambos)
- Vista previa y confirmar

**Archivo:** `src/pages/ProductsPage.tsx`, `src/lib/supabaseStore.ts`

---

## Orden de implementación
1. Migración DB
2. Auto-cálculo en ProductForm
3. Medio de pago en SaleForm
4. Recálculo masivo mejorado + descuentos en Settings
5. Catálogo visual + upload de imagen
6. Ajuste masivo de precios

