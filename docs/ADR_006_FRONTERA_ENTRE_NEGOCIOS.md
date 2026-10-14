# ADR 006 — la frontera entre negocios se cierra por defecto

- **Estado:** aceptado; implementación incremental.
- **Fecha:** 2026-10-13. **Responsables:** CTO / Seguridad.
- **Complementa:** [Seguridad](SEGURIDAD.md). No reemplaza ADR 001–005.

## Contexto

Nerqia es multi-negocio sobre una sola base. La frontera entre negocios es RLS,
y RLS sólo protege lo que pasa por ella. El 2026-10-13 se auditó con un usuario
real de Famatina y como anónimo, en transacciones revertidas
(`scripts/tablas-lectura-ajena-probar.mjs`, `tablas-escritura-ajena-probar.mjs`,
`buckets-escritura-probar.mjs`, `funciones-anonimas-probar.mjs`). Aparecieron
cuatro clases de fuga, todas cerradas el mismo día:

| Clase | Ejemplo medido (2026-10-13) | Cierre |
|---|---|---|
| Vista sin `security_invoker` | 1.662 filas del kardex de 2 negocios legibles **sin login** | 20261013000500 |
| Vista pública sin filtro | precio y stock de 777 productos de Famatina, sin tienda publicada | 20261013000600 |
| Bucket con política sólo por bucket | subir archivos a la carpeta de otro negocio | 20261013000300 / 0400 |
| Función SECURITY DEFINER sin chequeo para anon | uso de IA y stock exacto de cualquier negocio | 20261013000100 |

La causa raíz no son errores aislados, son tres defaults:

1. **Privilegios por defecto de `postgres` sobre tablas:** `anon` y
   `authenticated` reciben `arwdDxtm` en todo objeto nuevo (`pg_default_acl`,
   medido 2026-10-13). En tablas lo frena RLS, que el event trigger
   `ensure_rls` activa solo. En vistas no hay RLS.
2. **Las vistas corren como su dueño** salvo que se declare
   `security_invoker`. Una vista nueva nace legible por anon y saltea RLS.
3. **Nada mira en forma continua.** Los auditores `audit_*` existen, pero se
   corren a mano. El patrón ya se había cerrado una vez (`org_members`,
   2026-10-07) y volvió en otras seis vistas.

Medición al cierre del 2026-10-13: 91 vistas sin `security_invoker`. De ellas,
14 son legibles desde el navegador y no tienen filtro por usuario en su
definición. Hoy devuelven 0 filas de otro negocio salvo `desvio_de_comisiones`,
y `crm_pipeline_forecast`, `deal_outcome_stats`, `contracts_expiring_soon`,
`vendor_pending_summary` y `active_promotions` están abiertas incluso a anon:
van a filtrar en cuanto un negocio use esos módulos.

Restricción: CI no tiene acceso a la base (sólo la clave publicable), y no se
guardan credenciales de usuarios de prueba en CI.

## Decisión

Lo que se olvida queda cerrado; abrir algo exige declararlo.

1. **Vistas invoker por defecto.** Un event trigger en `CREATE VIEW` (espejo de
   `ensure_rls`) pone `security_invoker = true` a toda vista de `public` que no
   lo declare. Una vista que de verdad necesita correr como dueño lo escribe
   explícito (`WITH (security_invoker = false)`) y lleva un `COMMENT` con el
   motivo.
2. **Anon no recibe nada por defecto.** `ALTER DEFAULT PRIVILEGES` saca a
   `anon` de los privilegios por defecto de tablas y vistas creadas por
   `postgres`, como ya se hizo con funciones el 2026-10-01. Lo público se
   concede en la migración que lo crea. Falla cerrado: un olvido da «permiso
   denegado», no una fuga.
3. **Lo público se lee por id, no por listado.** El navegador anónimo lee datos
   de negocios con funciones que piden el id o el slug y tienen tope por IP
   (`get_store_catalog_products`, `catalogo_publico`), nunca con una vista
   que permite listar a todos.
4. **Un auditor más y vigilancia diaria.** `audit_vistas_abiertas` lista las
   vistas sin invoker, legibles desde el navegador y sin filtro por usuario,
   salvo las marcadas como públicas en su comentario. Un cron diario corre los
   auditores críticos y, si alguno da filas, lo deja en `app_errores`, que se
   ve en Platform. Los cuatro scripts con usuario real se corren en cada
   cambio de seguridad: necesitan la base y no pueden ir en CI.

## Opciones consideradas

### A. Como hasta ahora: auditorías a mano

| Dimensión | Evaluación |
|---|---|
| Complejidad | Baja |
| Costo | Nulo hoy; alto cuando falla (fuga real) |
| Escala | No escala: depende de acordarse |
| Familiaridad | Total |

**A favor:** no cambia nada. **En contra:** el mismo agujero ya volvió una
vez; cada vista nueva nace abierta.

### B. Prueba anónima en CI por REST con la clave publicable

| Dimensión | Evaluación |
|---|---|
| Complejidad | Media |
| Costo | Bajo |
| Escala | Buena para anon; nula para «usuario de otro negocio» |
| Familiaridad | Alta (el E2E ya pega al backend) |

**A favor:** corre en cada push. **En contra:** sólo ve lo anónimo. Probar
entre negocios exige guardar credenciales de un usuario de prueba en CI, que
no se hace. Además pega a producción en cada push.

### C. Defaults cerrados en la base + auditor + vigilancia diaria (elegida)

| Dimensión | Evaluación |
|---|---|
| Complejidad | Media: un event trigger, un default, un auditor y un cron |
| Costo | Bajo; corre en la base |
| Escala | Cubre todo objeto nuevo sin depender de quien lo escribe |
| Familiaridad | Alta: copia `ensure_rls` y el default de funciones |

**A favor:** ataca la causa (los defaults), no los síntomas. Falla cerrado.
También detecta cambios hechos fuera de migraciones. **En contra:** una vista
que necesita correr como dueño exige declararlo, y lo público hay que
concederlo a mano.

### D. Revocar hoy todo acceso anon a tablas y vistas existentes

| Dimensión | Evaluación |
|---|---|
| Complejidad | Alta |
| Costo | Riesgo de romper la tienda y el portal en producción |
| Escala | Total |
| Familiaridad | Media |

**A favor:** cierre inmediato y completo. **En contra:** sin inventario de qué
lee anon de verdad, es un corte a ciegas en producción. Se hace de a una, con
simulacro, como el catálogo (20261013000600).

## Análisis

A deja la seguridad en manos de la memoria, y la memoria ya falló. B sólo ve
lo anónimo. D es correcto como destino, pero hoy rompería sin aviso. C cambia
el default para que el error de mañana falle cerrado. Lo existente se va
cerrando con D, una pieza por vez y siempre con simulacro.

## Consecuencias

- **Más fácil:** una vista o tabla nueva no puede filtrar por olvido. El que
  rompe algo ve «permiso denegado» en desarrollo, no una fuga en producción.
- **Más difícil:** exponer algo público requiere un GRANT explícito y, si es
  una vista definer, justificarlo en el comentario.
- **A revisar:** las 14 vistas sin filtro medidas el 2026-10-13, y si conviene
  llevar los scripts con usuario real a un job que tenga acceso a la base.

## Acciones

1. [x] Cerrar las vistas por negocio abiertas: pasar a `security_invoker` las
   de CRM, contratos, proveedores y promociones, y `desvio_de_comisiones`;
   marcar como públicas las de referencia (planes, tarifas, catálogo de
   integraciones). Con simulacro.
   Hecho el 2026-10-13: migración 20261013000700, `scripts/vistas-abiertas-matrix.sql`
   3/3; convención de marca `@publica:` / `@revisada:` en el comentario de la vista.
2. [ ] Event trigger de vistas invoker por defecto, probado en una transacción
   revertida (crear vista sin opción → queda invoker; con
   `security_invoker = false` explícito → se respeta).
3. [ ] `ALTER DEFAULT PRIVILEGES … REVOKE ALL ON TABLES FROM anon` para
   `postgres` en `public`.
4. [ ] `audit_vistas_abiertas` en cero y sumado a los auditores críticos de
   [Seguridad](SEGURIDAD.md).
5. [ ] Cron diario de auditores críticos que escribe en `app_errores`.
6. [ ] Actualizar SEGURIDAD.md con la regla y los cuatro scripts.
