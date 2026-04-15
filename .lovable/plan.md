

# Plan: Sistema de Variantes (Sabores) para Vapers + Profesionalización General

## Concepto clave: Variantes sin duplicar productos

En vez de crear un producto por cada sabor de vaper, se agrega una tabla `product_variants` que almacena los sabores/variantes de cada producto. El stock se trackea **por variante**, y las ventas registran qué variante se vendió. El producto padre mantiene el stock total (suma de variantes).

```text
┌─────────────────┐       ┌──────────────────────┐
│   products      │ 1───N │  product_variants     │
│                 │       │                      │
│ VAPORESSO X     │       │ variant: "Menta"     │
│ stock: 15 (sum) │       │ stock: 5             │
│                 │       │ variant: "Frutilla"  │
│                 │       │ stock: 4             │
│                 │       │ variant: "Uva"       │
│                 │       │ stock: 6             │
└─────────────────┘       └──────────────────────┘
```

---

## 1. Migración SQL

**Nueva tabla `product_variants`:**
- `id`, `product_id` (FK), `user_id`, `variant_name` (ej: "Menta", "Uva Ice"), `stock` (integer), `sku` (opcional), `active`, `created_at`
- Constraint UNIQUE en `(product_id, variant_name)`
- RLS: mismo patrón que products (admin full, authenticated read own, anon read)

**Columna en `sales`:** `variant_id UUID` nullable para registrar qué sabor se vendió.

## 2. Gestión de Variantes en ProductsPage

- En el formulario de producto, si la categoría es `vaper`, aparece sección "Sabores / Variantes"
- Input para agregar sabores con stock individual: `[Menta: 5] [Frutilla: 3] [+ Agregar]`
- El stock total del producto = suma de stocks de variantes
- Al editar un producto existente, se cargan las variantes actuales
- Botón "Importar sabores" que permite pegar lista separada por comas

## 3. Variantes en SalesPage

- Al seleccionar un producto tipo vaper que tiene variantes, aparece un selector extra "Sabor/Variante"
- Solo muestra variantes con stock > 0
- Al registrar la venta, se descuenta stock de la variante específica y se actualiza el total del producto
- El `product_name` registrado incluye el sabor: "VAPORESSO X (Menta)"

## 4. Profesionalización General

### 4a. Dashboard financiero avanzado
- **Flujo de caja proyectado**: ventas promedio diarias × 30 - compras promedio mensuales
- **Punto de equilibrio**: costos fijos / margen promedio por unidad
- **Simulador tipo de cambio**: slider que muestra impacto en márgenes globales

### 4b. Reportes mejorados
- Nuevo reporte "Rentabilidad por Producto" con columnas: Margen %, ROI individual, velocidad de rotación (ventas/mes vs stock)
- Reporte de variantes más vendidas (para vapers)

### 4c. UX del catálogo público
- Filtros avanzados: slider de precio, filtro por marca, "solo con stock"
- Favoritos con localStorage + sección "Mis favoritos"
- Carrito con localStorage + botón "Pedir todo por WhatsApp"

### 4d. Mejoras en la tabla de productos
- Indicador visual de variantes (badge con cantidad de sabores)
- Tooltip hover que muestra los sabores disponibles y stock de cada uno

---

## Archivos a crear/modificar

| Archivo | Cambio |
|---|---|
| Migración SQL | Tabla `product_variants` + `variant_id` en sales |
| `src/lib/supabaseStore.ts` | CRUD variantes, helpers financieros |
| `src/pages/ProductsPage.tsx` | Sección variantes en form, badge en tabla |
| `src/pages/SalesPage.tsx` | Selector de variante, descuento stock variante |
| `src/pages/Dashboard.tsx` | Flujo caja, punto equilibrio, simulador TC |
| `src/pages/ReportsPage.tsx` | Reporte rentabilidad, reporte variantes |
| `src/pages/PublicCatalogPage.tsx` | Carrito, favoritos, filtros avanzados, variantes |

## Orden de implementación
1. Migración SQL (product_variants + variant_id en sales)
2. Store helpers para variantes
3. ProductsPage: gestión de variantes para vapers
4. SalesPage: selector de variante + descuento stock
5. Dashboard: herramientas financieras avanzadas
6. Catálogo público: carrito + favoritos + filtros + variantes
7. Reportes: rentabilidad por producto + variantes

