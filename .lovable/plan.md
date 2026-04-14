

# Plan: Mega Mejoras — Cupones, Comisiones, Ventas Automáticas, Finanzas y Catálogo

## 1. Sistema de Cupones de Descuento

**Migración SQL:** Nueva tabla `coupons`
```sql
id, user_id, code (unique), discount_percent, discount_fixed_ars,
max_uses, current_uses, valid_from, valid_until, active, created_at
```

**En SalesPage:** Campo "Código de cupón" que valida en tiempo real, muestra el descuento y lo aplica al total. Se registra `coupon_id` en la venta.

**En SettingsPage o nueva sección:** CRUD de cupones — crear códigos como EXENTRY10, definir % o monto fijo, usos máximos, vigencia.

**En catálogo público:** Input para ingresar cupón antes de contactar por WhatsApp, mostrando el precio final con descuento.

## 2. Metas y Comisiones para Vendedores

**Migración SQL:** Nueva tabla `seller_goals`
```sql
id, user_id (vendedor), month (date), target_ars, commission_percent,
total_sales_ars, total_commission_ars, created_at
```

**En AdminPage:** Sección para asignar metas mensuales y % de comisión por vendedor.

**En Dashboard (vendedor):** Barra de progreso hacia la meta, monto de comisión ganada, ranking si hay múltiples vendedores.

**En Dashboard (admin):** Vista consolidada de rendimiento de vendedores con comisiones acumuladas.

## 3. Remarketing por WhatsApp

**En CustomersPage:** Botón "Enviar mensaje" por segmento (dormidos, en riesgo, VIP) con templates pre-armados:
- Dormidos: "¡Te extrañamos! Tenemos novedades que te van a encantar 🔥"
- En riesgo: "Hola {nombre}, hace tiempo no nos visitás. ¿Querés que te reserve algo?"
- VIP: "Como cliente VIP tenés acceso a ofertas exclusivas"

Genera link `wa.me/{phone}?text=...` con mensaje personalizado.

## 4. Gestión Financiera Avanzada

**En Dashboard:** Nuevas cards:
- **Flujo de caja proyectado** (ventas promedio × 30 - gastos fijos estimados)
- **Punto de equilibrio**: unidades necesarias para cubrir costos del mes
- **Simulador tipo de cambio**: slider que muestra impacto en márgenes si el dólar sube/baja

**En ReportsPage:** Nuevo reporte "Rentabilidad por producto" con columnas de margen %, ROI, velocidad de rotación (stock / ventas mensuales).

## 5. Mejoras del Catálogo Público

- **Comparador de perfumes**: Seleccionar 2-3 perfumes y ver tabla comparativa (precio, duración, notas, género)
- **Favoritos con localStorage**: Corazón en cada producto, sección "Mis favoritos" persistente
- **Filtros avanzados**: Por rango de precio (slider), género, marca, "solo ofertas", "solo con stock"
- **SEO básico**: Meta tags dinámicos con nombre de producto en el título

## 6. Carrito y Checkout Simplificado

**En PublicCatalogPage:** Botón "Agregar al carrito" (localStorage). Vista de carrito flotante con resumen. Botón "Pedir por WhatsApp" que envía todo el carrito en un solo mensaje con detalle de productos, cantidades, tamaños (decant/completo) y total.

---

## Archivos a crear/modificar

| Archivo | Cambio |
|---|---|
| Migración SQL | Tablas `coupons`, `seller_goals` + RLS |
| `src/pages/SalesPage.tsx` | Input cupón, validación, aplicar descuento |
| `src/pages/SettingsPage.tsx` | CRUD cupones |
| `src/pages/AdminPage.tsx` | Metas y comisiones por vendedor |
| `src/pages/Dashboard.tsx` | Progreso vendedor, flujo de caja, simulador TC |
| `src/pages/CustomersPage.tsx` | Botones remarketing WhatsApp por segmento |
| `src/pages/ReportsPage.tsx` | Reporte rentabilidad por producto |
| `src/pages/PublicCatalogPage.tsx` | Carrito, comparador, favoritos, filtros avanzados |
| `src/lib/supabaseStore.ts` | Helpers cupones, metas, validaciones |

## Orden de implementación
1. Migración SQL (coupons + seller_goals)
2. Sistema de cupones (CRUD + aplicación en ventas)
3. Metas y comisiones vendedores
4. Remarketing WhatsApp en clientes
5. Dashboard financiero avanzado (flujo caja, simulador TC)
6. Catálogo: carrito + favoritos + comparador + filtros
7. Reportes de rentabilidad por producto

