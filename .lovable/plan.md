

# Plan: Exentry Imports v7.0 — Version Final Profesional

## Resumen

Llevar el sistema al nivel final profesional con un nuevo modulo de Canjes/Influencers, mejoras criticas faltantes, y pulido completo. Despues de esto, no deberia quedar nada por agregar.

---

## 1. Modulo de Canjes con Influencers (NUEVO)

**Tabla `influencer_exchanges`** en base de datos:
- `id`, `user_id`, `influencer_name`, `influencer_instagram`, `influencer_followers` (int), `product_id`, `product_name`, `quantity`, `product_value_ars` (valor de mercado del producto entregado), `exchange_type` (canje | regalo | colaboracion), `status` (pendiente | entregado | publicado | completado), `expected_posts` (int), `actual_posts` (int), `notes`, `delivery_date`, `created_at`

**Pagina `/canjes`** con:
- KPIs: total canjes, valor total entregado, tasa de cumplimiento (publicaciones hechas vs esperadas), influencers activos
- Formulario para registrar canje: seleccionar producto del inventario, influencer (nombre + @instagram + seguidores), tipo de canje, posts esperados, notas
- Al registrar un canje se descuenta stock automaticamente (como una venta pero sin ingreso de dinero)
- Lista de canjes con filtros por estado y buscador
- Seguimiento: marcar cuando la influencer publico, registrar cantidad de posts reales
- Calculo de ROI estimado del canje: valor del producto vs alcance estimado (seguidores * posts)

**Ruta en sidebar:** icono Gift, entre Marketing y IA Insights

---

## 2. Mejoras Criticas Faltantes

### 2a. Edicion de ventas y compras
- Agregar boton de edicion en ventas (actualmente solo se puede crear/eliminar)
- Modal de edicion con recalculo de stock y ganancia
- Lo mismo para compras

### 2b. Log de auditoria visible en Admin
- En AdminPage, agregar pestaña/seccion "Actividad Reciente" que muestre los ultimos 50 registros de `audit_logs`
- Mostrar: fecha, usuario, accion, entidad, detalles

### 2c. Validacion de formularios mejorada
- Agregar mensajes de error inline en todos los formularios (no solo toast)
- Validar rangos numericos (precio > 0, stock >= 0, etc.)

### 2d. Busqueda en Command Palette
- Agregar busqueda de clientes y ventas recientes al CommandPalette (actualmente solo busca paginas y productos)

---

## 3. Pulido UX Final

### 3a. Breadcrumbs
- Agregar breadcrumb sutil debajo del titulo de cada pagina ("Dashboard > Ventas > Nueva Venta")

### 3b. Animaciones
- Agregar `animate-fade-in` a las cards y modales para transiciones mas suaves

### 3c. Footer en sidebar
- Mostrar version del sistema y nombre del negocio en el footer del sidebar

### 3d. Empty states mejorados en Marketing y IA
- Usar el componente EmptyState existente en las paginas que aun no lo usan (Marketing, IA)

---

## 4. Dashboard — Periodo comparativo

- Agregar selector de periodo en el dashboard (7d, 30d, 90d, YTD)
- Mostrar variacion porcentual vs periodo anterior en los KPI cards (flecha verde/roja con %)

---

## Detalles Tecnicos

### Migracion de base de datos
```sql
CREATE TABLE public.influencer_exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  influencer_name TEXT NOT NULL,
  influencer_instagram TEXT,
  influencer_followers INTEGER DEFAULT 0,
  product_id UUID,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  product_value_ars NUMERIC NOT NULL DEFAULT 0,
  exchange_type TEXT NOT NULL DEFAULT 'canje',
  status TEXT NOT NULL DEFAULT 'pendiente',
  expected_posts INTEGER DEFAULT 1,
  actual_posts INTEGER DEFAULT 0,
  notes TEXT,
  delivery_date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.influencer_exchanges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own exchanges"
  ON public.influencer_exchanges FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### Archivos nuevos
- `src/pages/InfluencerExchangesPage.tsx` — Pagina completa de canjes
- Funciones CRUD en `supabaseStore.ts` para influencer_exchanges

### Archivos modificados
- `src/App.tsx` — agregar ruta `/canjes`
- `src/components/AppLayout.tsx` — agregar item en sidebar
- `src/pages/SalesPage.tsx` — agregar edicion de ventas
- `src/pages/PurchasesPage.tsx` — agregar edicion de compras
- `src/pages/AdminPage.tsx` — agregar seccion de audit logs
- `src/components/shared/CommandPalette.tsx` — agregar busqueda de clientes
- `src/pages/Dashboard.tsx` — agregar filtro de periodo

### Orden de implementacion
1. Migracion DB para influencer_exchanges
2. Modulo de Canjes (pagina + CRUD + sidebar)
3. Edicion de ventas y compras
4. Audit log visible en Admin
5. Dashboard con filtro de periodo
6. Pulido UX (breadcrumbs, animaciones, empty states)

