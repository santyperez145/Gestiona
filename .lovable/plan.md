

# Plan: Roles (Admin/Vendedor/Viewer) + Seguridad + Catálogo Público Seguro

## Resumen

Implementar sistema de 3 roles con restricciones reales en DB y UI, proteger datos sensibles del catálogo público, y actualizar todas las páginas afectadas.

---

## 1. Migración de Base de Datos

**SQL a ejecutar:**

- Agregar `'viewer'` al enum `app_role`
- Crear function `get_user_role(uuid)` (security definer) que retorna el rol o `'viewer'` por defecto
- Crear function `is_approved(uuid)` que verifica si el usuario tiene rol asignado (admin o vendedor)
- Actualizar trigger `auto_assign_admin`: primer usuario = admin, resto no recibe rol (queda como viewer implícito)
- Crear vista `products_public` (solo campos no sensibles: name, brand, category, gender, sale_price_ars, discount_price_ars, stock, image_url, description, user_id) — sin cost_usd, profit, customs
- Crear vista `settings_public` (solo business_name, logo_url, primary_color, secondary_color, user_id)
- Actualizar RLS en `products`: quitar policy pública "Public can read products" sobre tabla base, agregar SELECT público solo en la vista
- Actualizar RLS en `settings`: quitar "Public can read settings" sobre tabla base, agregar SELECT público solo en la vista
- Actualizar RLS en tablas de datos para verificar rol:
  - `products`, `purchases`, `marketing_posts`, `influencer_exchanges`, `settings`: solo admin (CRUD completo)
  - `sales`: admin = todo, vendedor = INSERT + SELECT propias
  - `debts`: admin = todo, vendedor = SELECT propias

## 2. Hook `useUserRole`

Nuevo archivo `src/lib/useUserRole.ts`:
- Consulta `user_roles` para obtener el rol del usuario actual
- Retorna `{ role: 'admin' | 'vendedor' | 'viewer', loading: boolean }`
- Cache con estado local

## 3. Gate de Acceso en App.tsx

- Importar `useUserRole` en `ProtectedRoutes`
- Si `role === 'viewer'`: mostrar pantalla "Esperando aprobación del administrador" con mensaje de contactar al admin + link al catálogo público
- Si `role === 'vendedor'`: solo permitir rutas `/`, `/ventas`, `/clientes`
- Si `role === 'admin'`: acceso completo

## 4. AppLayout — Sidebar Filtrado por Rol

- Importar `useUserRole`
- Filtrar `navItems` según rol:
  - **vendedor**: Dashboard, Ventas, Clientes solamente
  - **admin**: todo + Admin
  - **viewer**: no llega aquí (gateado en App.tsx)

## 5. SalesPage — Restricciones para Vendedor

- Vendedor puede crear ventas pero NO editar ni eliminar
- Ocultar botones Edit y Delete si rol !== 'admin'
- El botón "Nueva Venta" sigue visible

## 6. AdminPage — Selector de 3 Roles

- Agregar opción `viewer` al `AssignRoleDialog`
- Badge con 3 colores: admin (dorado), vendedor (azul), viewer (gris)
- Mostrar rol actual de cada usuario
- Opción de eliminar rol (volver a viewer)

## 7. Catálogo Público — Usar Vistas Seguras

- `PublicCatalogPage.tsx`: cambiar queries de `products` a `products_public` y `settings` a `settings_public`
- El PDF en `CatalogPage.tsx` ya usa los campos correctos (no muestra costos), no necesita cambios

---

## Archivos a modificar/crear

| Archivo | Cambio |
|---|---|
| Migración SQL | enum + functions + vistas + RLS |
| `src/lib/useUserRole.ts` | **Nuevo** — hook de rol |
| `src/App.tsx` | Gate por rol en ProtectedRoutes |
| `src/components/AppLayout.tsx` | Filtrar nav por rol |
| `src/pages/SalesPage.tsx` | Ocultar edit/delete para vendedor |
| `src/pages/AdminPage.tsx` | 3 roles + viewer badge |
| `src/pages/PublicCatalogPage.tsx` | Usar vistas públicas |

## Orden de implementación
1. Migración DB
2. Hook useUserRole
3. App.tsx + AppLayout (gate + nav)
4. SalesPage restricciones
5. AdminPage 3 roles
6. PublicCatalogPage vistas seguras

