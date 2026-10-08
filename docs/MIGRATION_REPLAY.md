# Instalación reproducible y gate de integración

**Corte:** 2026-10-08. **Owner:** Ingeniería / Seguridad.

## Problema y alcance

La PR 16 encontró dependencias del historial de migraciones en el esquema,
grants, usuarios, datos y configuración que sólo existían en producción.
Que una migración estuviera registrada allí no probaba que una instalación
nueva pudiera reconstruirse ni ejecutar sus funciones PL/pgSQL.

Las correcciones históricas son exclusivamente para instalaciones nuevas.
No resetear producción, reparar su journal ni volver a ejecutar históricos
con `--include-all`. Una corrección necesaria en producción requiere una
migración nueva, comparación contra el esquema desplegado y gate propio.

| Causa | Corrección del replay | Límite |
|---|---|---|
| Esquemas incompatibles | Expandir auditoría, kits, listas, logs, FX y demanda antes de indexar; conservar nombres y datos canónicos. | Gramática no prueba renglones ni operación comercial. |
| Identidades paralelas | `suppliers`, `customers`, `auth.users`, `memberships` y sus aliases controlados; suscripción de clientes separada de SaaS. | No crear un segundo ERP ni completar datos por adivinación. |
| Entorno vacío | Omitir con aviso solamente fixtures que necesitan identidades preexistentes; conservar comprobaciones universales. | Fixture omitido no equivale a prueba funcional aprobada. |
| Conteos productivos fijos | Comparar identidades/snapshots del entorno y deltas, no exigir dos comercios, 25 clientes o 50 imágenes. | Evidencia fiscal/de pago existente se preserva; no fabricarla en Preview. |
| Cron sin secretos | Instalar contratos/agenda, exigir configuración coherente cuando existe y seguir rechazando invocaciones sin secreto. | Ausencia de Vault no certifica backups ni entrega de mensajes. |
| RLS/grants alojados | Cachés/catálogo interno deny-by-default, conciliaciones por capacidad; alias invoker con SELECT de su fuente bajo RLS. | Sin escritura vía alias ni bypass del auditor de seguridad. |
| Influencers fuera de orden | Bootstrap con Auth canónico, sin convertir canjes en entregas/pagos; preservar helper de provisioning y mapa de reputación ampliado. | Rutas monetarias legacy no se legitiman por referral code; portal final usa sesión. |
| Alta de usuario | Triggers separados para perfil y workspace; nunca llamar una función trigger como función normal; límites usan `joined_at`. | Producción conserva su configuración vigente; el historial no la reemplaza. |
| Journal duplicado | Retirar 148 auto-registraciones; la CLI/integración Supabase registra cada archivo aplicado. | No modificar ni reparar versiones productivas; una consulta SQL aislada no registra un deploy. |

## Evidencia interna ejecutada

- Preview descartable POS `rjmxkybpwxskoovqlzra`: continuación incremental
  hasta `20261007000100`, el 2026-10-08. No es un replay íntegro desde cero:
  se aplicaron reparaciones diagnósticas puntuales sobre el mismo entorno.
- `20261007_pos_qr_payment_evidence.sql`: actor y organización propios;
  nueve evidencias inválidas sin venta ni movimiento, cierre válido, duplicado,
  stock único, snapshot vencido/refund y denegación del helper interno al
  servidor. Todo dentro de rollback; cero usuarios/organizaciones residuales.
- `20261007_legacy_membership_view_security.sql`: dos altas de usuario,
  provisioning del comercio, viewer propio/ajeno, escalada denegada, lectura
  servidor y rollback. El SELECT requiere el grant de `memberships` bajo RLS,
  no privilegios definer de una vista.
- Readback final: cero usuarios, organizaciones, funciones expuestas, RPC con
  costo expuesto, policies sin tenant y tablas públicas sin RLS.
- `migrationReplay.test.ts` protege contratos estructurales y los límites del
  parser PostgreSQL 17. No sustituye la ejecución contra PostgreSQL real.
- Comparación de producción sólo lectura: `handle_new_user()` ya crea sólo el
  perfil; su `memberships.created_at` sí existe. Ambos fallos observados en
  Preview son diferencias de reconstrucción, no incidentes productivos probados.

## Gate todavía abierto

1. Checkpoint `4b4b706d` pusheado a PR 16: `npm run verify` verde, 3.749 tests
   en 421 archivos. Integrar Auth en la misma PR y repetir el gate del conjunto;
   incluir `20261004000100`, ya registrado en producción, sin reparar el journal.
   Conjunto `a871f306`: gate local de 3.779 tests/424 archivos y CI verde;
   Preview nueva `uxsffufotnlizjlyywog` falló por doble registro de `20260814000003`.
   Eliminar la auto-registración del SQL y repetir la reconstrucción completa.
2. Recrear la Preview efímera y confirmar la aplicación desde el primer archivo
   del historial corregido, sin datos ni secretos productivos copiados.
3. Repetir ambos SQL reversibles en esa base nueva; comprobar auditorías y
   residuos. El check Supabase Preview debe terminar aprobado, no saltarse.
4. Publicar primero los productores Edge de evidencia QR, luego el guard SQL;
   después promover frontend por el flujo protegido normal de `main`.
5. Cerrar PR 15 y retirar ambas ramas sólo después de comprobar su contenido
   integrado a `main`. Proxy de confianza, SMTP Auth y recepción real mantienen
   gate propio; el código pusheado no demuestra configuración de proveedores.

La continuación incremental, las suites sintéticas y un deploy Vercel no
certifican el banco, impresión física, homologación ARCA ni reemplazo de un ERP.

## Ramas y recuperación

El 2026-10-07 se eliminaron seis ramas cuyos commits ya pertenecían a `main`:
`codex/finance-product-surface`, `hotfix/dashboard-activeorg`,
`fix/seo-sitemap-crawler-20261004`, `claude/laughing-brattain-26919c`,
`docs/seo-production-evidence-20261004` y `feature/saas-billing-entitlements`.

Dos ramas antiguas con parches únicos se conservaron antes de retirarlas:
`archive/2026-10-07/codex-repository-quality-cleanup` apunta a `ee3a1171` y
`archive/2026-10-07/claude-nostalgic-shirley-ec0434` a `7e9f4597`.
Los tags remotos permiten recuperar el contenido; no se fusionaron sus cambios
viejos en masa ni se borraron worktrees ajenos. Las dos ramas activas de
integración se conservan hasta cerrar sus PRs.

## Referencias oficiales

- [Supabase: trabajo con ramas](https://supabase.com/docs/guides/deployment/branching/working-with-branches)
  e [integración GitHub](https://supabase.com/docs/guides/deployment/branching/github-integration),
  consultadas 2026-10-08: editar archivos ya aplicados no implica repetirlos;
  recrear la rama efímera prueba el historial sin resetear producción.
- [Supabase: proceso de deployment](https://supabase.com/docs/guides/deployment/branching):
  las migraciones preceden al deploy de funciones; el contrato POS requiere
  prepublicar sus productores para no bloquear cobros con evidencia vieja.
