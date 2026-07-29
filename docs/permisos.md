# Roles y Permisos

El sistema tiene **dos superficies separadas**. No se heredan permisos entre ellas.

```
┌─ Superficie de PLATAFORMA (/platform) ──────────┐
│  Quién: tabla `platform_admins`                 │
│  Sobre qué: todos los tenants, planes, precios  │
│  Chrome: PlatformLayout (acento violeta)        │
└─────────────────────────────────────────────────┘
┌─ Superficie de ORGANIZACIÓN (/) ────────────────┐
│  Quién: tabla `memberships`                     │
│  Sobre qué: el negocio propio                   │
│  Chrome: AppLayout (acento dorado)              │
└─────────────────────────────────────────────────┘
```

**Ser staff de plataforma no da ningún permiso dentro de una organización.** Para
entrar a una org hay que tener una membresía real, o usar "Ver como" (magic link)
desde el panel de plataforma — que queda auditado. Antes esto estaba mezclado:
`useUserRole` devolvía `admin` a cualquier `platform_admin`, así que el staff
operaba tenants sin dejar rastro. Ya no.

---

## Roles de organización (`memberships.role`)

| Rol | Alcance |
|---|---|
| `owner` | Control total. No se le puede quitar acceso ni removerlo del equipo. |
| `admin` | Operación completa del negocio. Configurable por módulo. |
| `vendedor` | Ventas, POS, clientes y CRM. Prepara pedidos del ecommerce. Sin finanzas ni configuración. |
| `viewer` | Solo lectura, sin plata ni configuración. |

### Matriz por módulo

Los permisos finos viven en `role_permissions (org_id, role, module, can_*)` y se
editan desde **Admin → Permisos**. Módulos disponibles:

```
sales · pos · products · customers · crm · reports · expenses · purchases
invoices · inventory · analytics · marketing · support · settings · team
finance · ecommerce · shipping · payments · influencers
```

Defaults al crear una org (`seed_default_permissions()`):

- **admin** — todo habilitado en todos los módulos.
- **vendedor** — ve todo menos `finance`, `payments`, `settings`, `team`. Crea en
  `sales`/`pos`/`customers`/`crm`/`support`. Edita `sales`/`pos`/`customers`/`ecommerce`
  (tiene que poder marcar un pedido como despachado). Nunca borra.
- **viewer** — solo lectura, sin `settings`/`team`/`finance`/`payments`. Exporta
  `reports` y `analytics`.

El `owner` no pasa por la matriz: siempre tiene todo.

### Cómo consultarlos

- Front: `useModulePermissions(module)` / `useHasPermission(module, action)`
  (`src/lib/usePermissions.ts`). Es **UX**, no seguridad — sirve para no ofrecer
  botones que van a fallar.
- Base / Edge Functions: RPC `has_permission(org_id, module, action)`.

---

## Roles de plataforma (`platform_admins.role`)

| Nivel | Puede |
|---|---|
| `superadmin` | Todo, incluido borrar orgs, banear usuarios, alta/baja de staff y cambio de roles de miembros. |
| `finance` | Planes y precios, cambio de plan, extender trial, suspender/reactivar orgs, comisiones y facturación. Además todo lo de lectura. |
| `support` | Ver orgs y usuarios, actividad, logs, generar magic links y resets de contraseña. **No** toca planes, no borra, no banea. |

`superadmin` satisface cualquier requerimiento de nivel.

### Cómo se aplican

- Front: `usePlatformAccess()` decide qué secciones se dibujan en `PlatformLayout`.
- Server: `platform-admin-action` tiene un mapa `ACTION_ROLES` que autoriza cada
  acción por nivel. Una acción **sin entrada en el mapa queda reservada a
  `superadmin`** — agregar una acción nueva es seguro por default. Los intentos
  rechazados se registran como `DENIED:<action>` en `admin_audit_logs`.
- Base: `platform_role()` y `has_platform_role(roles[])` para usar en RLS.

Las altas de staff entran como `support` a propósito: subir a `superadmin` es un
acto explícito, no el default de tocar un switch. Nadie puede cambiar su propio
nivel ni quitarse el acceso.

---

## Principios de enforcement

- Toda operación de tenant se filtra por `org_id` (RLS).
- Ninguna acción sensible depende solo de la UI.
- Las Edge Functions validan usuario + membresía (o nivel de plataforma).
- Cambios críticos (finanzas, roles, facturación, acciones de staff) quedan
  auditados: `audit_logs` para el tenant, `admin_audit_logs` para la plataforma.
