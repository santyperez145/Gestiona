

# Plan: Detalle de Producto en Catálogo + WhatsApp Directo + Órdenes de Compra Excel

## Resumen

1. **Detalle de producto** — Al clickear una card del catálogo público, se abre un modal/drawer con imagen grande, descripción, precios y botón "Consultar por WhatsApp" con el nombre del producto pre-cargado en el mensaje.
2. **Venta directa por WhatsApp** — El botón de consulta en el detalle envía un mensaje personalizado con el producto seleccionado. Sin pasarela de pago.
3. **Órdenes de compra automáticas** — Nueva página/sección en Compras para generar un Excel (.xlsx) con productos a reponer, agrupados por proveedor, con logo y datos del negocio.

---

## 1. Modal de Detalle de Producto (Catálogo Público)

**Archivo:** `src/pages/PublicCatalogPage.tsx`

- Reemplazar el `selectedProduct` toggle por un **modal/drawer** que se abre al clickear una card
- Contenido del modal:
  - Imagen grande (aspect-ratio libre, max-height limitado)
  - Nombre, marca, categoría, género (si perfume)
  - Descripción del producto (`p.description`)
  - Precios (efectivo/tarjeta) con el mismo diseño actual
  - Indicador de stock bajo
  - Botón "Consultar por WhatsApp" que abre `wa.me` con mensaje: `"Hola! Me interesa el producto: {nombre} — {precio}"`
- Diseño dark consistente con el catálogo, animación de entrada suave
- Responsive: en mobile ocupa pantalla completa como drawer, en desktop es modal centrado

## 2. Campo de Descripción en Productos (Admin)

**Archivo:** `src/pages/ProductsPage.tsx`

- Verificar que el formulario de producto ya tenga campo `description` (textarea)
- Si no existe, agregar un textarea para descripción en el formulario de crear/editar producto
- La descripción se muestra en el catálogo público via la vista `products_public`

**Archivo de migración (si necesario):** Verificar que `products_public` view incluya el campo `description`

## 3. Generador de Órdenes de Compra (Excel)

**Archivo nuevo:** `src/pages/PurchaseOrdersPage.tsx` (o sección dentro de `PurchasesPage.tsx`)

- Sección "Generar Orden de Compra" en la página de Compras
- Interfaz para seleccionar productos a reponer:
  - Lista de productos con stock actual
  - Campo de cantidad a pedir por producto
  - Campo de proveedor por producto (o agrupado)
- Botón "Generar Excel" que crea un `.xlsx` con:
  - Header: logo + nombre del negocio + fecha
  - Columnas: Producto, Cantidad, Precio Unitario USD, Total USD
  - Agrupado por proveedor (una hoja por proveedor o secciones separadas)
  - Fila de totales
- Usa la librería `xlsx` (SheetJS) para generar el archivo client-side
- Solo accesible para admin

**Archivo:** `src/App.tsx` — Agregar ruta si es página separada

## 4. Dependencia

- Instalar `xlsx` para generación de Excel client-side

---

## Archivos a modificar/crear

| Archivo | Cambio |
|---|---|
| `src/pages/PublicCatalogPage.tsx` | Modal detalle producto + WhatsApp directo |
| `src/pages/ProductsPage.tsx` | Verificar/agregar campo descripción |
| `src/pages/PurchasesPage.tsx` | Agregar sección de orden de compra con generación Excel |
| `package.json` | Agregar dependencia `xlsx` |

## Orden de implementación
1. Modal de detalle en catálogo público
2. Verificar campo descripción en formulario de productos
3. Generador de órdenes de compra Excel en PurchasesPage

