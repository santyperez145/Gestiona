# Auditoria RLS por Tabla (Estado Actual)

Fecha: 2026-05-05

## Alcance revisado

Tablas core relevadas en migraciones recientes:

- `products`
- `sales`
- `purchases`
- `debts`
- `customers`
- `settings`
- `memberships`
- `org_invitations`
- `stock_movements`
- `financial_movements`
- `bank_transactions`
- `subscriptions`
- `plans`
- `tiendanube_connections`

## Estado

- Se detectan politicas RLS en un conjunto amplio de tablas operativas, especialmente en migraciones de mayo (`20260504_*` y `20260505_operational_ledgers.sql`).
- La aplicacion ya trabaja mayoritariamente por `org_id` en el flujo central.
- Persisten consultas legacy por `user_id` fuera del core, por lo que el hardening no esta cerrado al 100%.

## Riesgos abiertos

- En tablas auxiliares o de features nuevas puede haber politicas incompletas o inconsistentes.
- El enforcement de limites por plan aun depende parcialmente de frontend para algunos casos.
- Falta evidencia automatizada de regresion de permisos (tests de seguridad por rol/tenant).

## Acciones recomendadas inmediatas

1. Crear un script SQL de verificacion que liste:
   - tablas sin RLS habilitado
   - tablas sin policy `SELECT/INSERT/UPDATE/DELETE` esperada
2. Definir plantilla estandar de policy por tenant (`org_id = ...`) y aplicarla de forma uniforme.
3. Agregar pruebas de seguridad por rol:
   - admin/vendedor/viewer
   - acceso cruzado entre organizaciones (debe fallar)
4. Extender enforcement server-side para limites de plan en todos los endpoints de escritura.
