# Matriz de Permisos (Base)

## Roles

- `owner`: control total de la organización
- `admin`: operación completa de negocio
- `vendedor`: ventas, clientes y caja limitada
- `viewer`: solo lectura o acceso restringido
- `platform_admin`: soporte global (fuera de tenant)

## Permisos por módulo

- Dashboard:
  - owner/admin/vendedor/viewer: ver
- Productos e inventario:
  - owner/admin: crear/editar/eliminar
  - vendedor/viewer: ver
- Ventas/POS:
  - owner/admin/vendedor: operar ventas
  - viewer: no
- Caja y cierre:
  - owner/admin: apertura/cierre/ajustes
  - vendedor: movimientos permitidos según políticas
  - viewer: no
- Deudas y cobranzas:
  - owner/admin: gestionar
  - vendedor: registrar cobros limitados
  - viewer: ver o no según policy
- Compras/proveedores:
  - owner/admin: gestionar
  - vendedor/viewer: no
- Facturación:
  - owner/admin: emitir/anular/reintentar AFIP
  - vendedor/viewer: no
- Configuración e integraciones:
  - owner/admin: gestionar
  - vendedor/viewer: no

## Principios de enforcement

- Todas las operaciones deben filtrarse por `org_id`.
- Ninguna acción sensible depende solo de UI.
- Las Edge Functions deben validar usuario + membresía.
- Para cambios críticos (finanzas, roles, facturación), registrar auditoría.
