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
entrar a una org hay que tener una membresía real. La impersonación mediante
"Ver como"/magic link fue retirada el 2026-08-22: una sesión emitida como otra
persona puede sobrevivir a la ventana de soporte. Para diagnosticar, Support
solicita desde Merchant 360 un snapshot agregado y el owner lo autoriza por 15,
30 o 60 minutos. Cada lectura revalida actor, rol, expiración y revocación.

Los dueños ven en **Ajustes → Sistema → Acceso de soporte** las solicitudes,
quién las hizo, motivo, vencimiento, revocación y cantidad de lecturas. El
historial previo de magic links permanece visible y marcado como mecanismo
retirado; no se reescribe la historia.

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
- Dentro de una RPC: `exigir_permiso(org, módulo, acción, qué)`, que llama a la
  anterior y **falla** con `insufficient_privilege`. Va después del chequeo de
  membresía, nunca en su lugar: son dos preguntas distintas —de qué comercio
  sos, y qué podés hacer adentro—.

### ⚠️ Membresía no es permiso

Hasta el 2026-08-27 las funciones que mueven el stock chequeaban **sólo**
membresía. Medido contra producción como `authenticated` real, con una
membresía `vendedor` real y dentro de una transacción revertida:

```
matriz: puede editar inventario  →  false
abrir_conteo(...)                →  PASÓ
```

Cerrar ese conteo llama a `record_stock_movement`, la única autoridad sobre
`products.stock`. Es decir: el comercio desmarcaba «Inventario» para un
empleado, la pantalla desaparecía del menú, y el empleado reescribía el stock
igual llamando la RPC.

Nueve funciones exigen el permiso desde `20260827000030`: las cuatro de la Toma
Física (`abrir_conteo`, `registrar_conteo`, `cerrar_conteo`, `cancelar_conteo`),
`transfer_stock_between_locations`, `asignar_a_ubicacion`, `adjust_stock`,
`record_member_stock_movement` y `wallet_solicitar_retiro`.

📌 `exigir_permiso` deja pasar a `service_role` a propósito: la matriz responde
«¿esta **persona** puede?» y cuando corre una Edge Function no hay persona a la
que preguntarle. La API pública ajusta stock por ese camino.

**La guardia es la vista `audit_rpc_sin_permiso`, que tiene que estar vacía**
(medido 0 el 2026-08-27). Lista funciones llamables desde el navegador que
mueven stock o plata sin exigir permiso ni rol. Del lado del repo,
`permisoEnElServidor.test.ts` falla si una migración futura regenera una de las
nueve y se lleva puesta la guarda — que es el modo de falla realista, porque
regenerar desde `pg_get_functiondef` es el procedimiento recomendado.

**Lo que todavía NO exige permiso**, dicho de frente: el resto de las RPC de
escritura que hoy chequean rol `owner`/`admin` (más estricto que la matriz, así
que no es un agujero) y `medio_de_pago_habilitar`, que hoy sólo se frena porque
tropieza antes con «conectá tu cuenta de MercadoPago» — eso es una precondición
de negocio, no una autorización.

---

## Roles de plataforma (`platform_admins.role`)

| Nivel | Puede |
|---|---|
| `superadmin` | Todo, incluido borrar orgs, banear usuarios, alta/baja de staff y cambio de roles de miembros. |
| `finance` | Planes y precios, cambio de plan, extender trial, suspender/reactivar orgs, comisiones y facturación. Además todo lo de lectura. |
| `support` | Ver señales agregadas, solicitar diagnóstico temporal y enviar accesos/resets por email sin ver el token. **No** impersona, no toca planes, no borra, no banea. |

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
- **RLS separa comercios; no separa personas dentro de un comercio.** Evita que
  una organización vea los datos de otra, y eso es todo lo que hace: no dice
  «este empleado puede ver stock, pero no ajustarlo». Esa pregunta la contesta
  `exigir_permiso` dentro de la RPC. Confundir las dos es lo que dejó el stock
  abierto hasta el 2026-08-27.
- Ninguna acción que mueva stock o plata depende sólo de la UI — verificado por
  `audit_rpc_sin_permiso`. Para el resto de las escrituras, la puerta es el rol.
- Las Edge Functions validan usuario + membresía (o nivel de plataforma).
- Cambios críticos (finanzas, roles, facturación, acciones de staff) quedan
  auditados: `audit_logs` para el tenant, `admin_audit_logs` para la plataforma.
- Diagnóstico de soporte usa una tabla sin acceso cliente, vistas separadas y
  RPCs con consentimiento owner. Detalle y prueba en
  [SOPORTE_DIAGNOSTICO.md](SOPORTE_DIAGNOSTICO.md).
- El alta de una organización queda reservada a `superadmin`: un RPC crea el
  grafo completo, bloquea emails ya vinculados y el acceso llega directo al
  owner. Detalle en [ALTA_COMERCIOS.md](ALTA_COMERCIOS.md).
