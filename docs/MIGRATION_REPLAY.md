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

## Reconstrucción completa y backend publicado

- `13dbc906`: puerta local completa, 3.780 tests/424 archivos. El runner
  aplicó las 665 migraciones desde cero en la Preview efímera y sin datos
  `ssmppsjyhvdyrkzpjjpa`; check Supabase aprobado el 2026-10-08 a las 04:36 UTC.
- Allí se repitieron ambos SQL reversibles: QR y alias/roles. Readback final:
  cero usuarios, organizaciones y hallazgos de los cuatro auditores anteriores.
  Esta vez no hubo reparaciones diagnósticas ni copias de datos productivos.
- Producción: se publicaron primero `mercadopago-pos-qr` v15 y
  `mercadopago-webhook` v66, ambos ACTIVE; el webhook conserva validación HMAC
  sin JWT de usuario en el gateway. Después la CLI aplicó y registró únicamente
  `20261007000100`; el dry-run no propuso históricos, seeds ni roles.
- La huella del finalizador original coincide entre Preview y producción
  (`036c75166a8945daef949878c64e2366`). El readback productivo confirma el guard
  registrado y cero funciones/costos expuestos, policies sin tenant o tablas
  públicas sin RLS. No se hicieron escrituras de fixtures en producción:
  se mantiene la alternativa segura de Preview, no se evita la revisión.
- CI de `13dbc906`: tipos/build, dependencias, unit tests y builds nativos
  aprobados. Un E2E móvil detectó contraste transitorio del checkout al resolver
  envío: foreground y fondo se interpolaban entre dos pares válidos.
  La corrección intercambia el par sin animar sus colores y conserva foco;
  el E2E retiene la cotización real y audita estados pendiente/listo.
  Dos E2E locales (desktop/móvil), sin retries, y Axe de ambos estados verdes;
  no se envía el pedido. Se conservaron screenshots para revisión visual.

## Gate de promoción y operación real

El 2026-10-08, los checks requeridos de `86997fba` aprobaron y PR 16 se fusionó
sin bypass a `main` como `b62af837`. El árbol coincide íntegramente; Vercel
`dpl_AyPGAfwfdEhuKHKsP8gU1umWWLDd` quedó READY en producción con ese SHA.
PR 15 se cerró como incluida. No se reaplicó su migración productiva de Auth.

La CI posterior al merge (`37730531705`) detectó otra falla: el catálogo móvil
seguía en skeleton al vencer la espera de productos. La traza confirma assets
200 y sólo `get_store_by_slug` pendiente, sin respuesta ni consultas posteriores.
No prueba una caída de base ni una violación Axe: prueba una espera sin límite.
La corrección acota cada lectura inicial a 4 s, permite un segundo intento con
signal nuevo y cancela al cambiar de tienda/salir. El agotamiento muestra error
recuperable, no 404 ni catálogo vacío; cobros/idempotencia no cambian.

Mantener gates por SHA para la corrección: puerta local completa, CI, E2E,
Supabase Preview y Vercel. Proxy de confianza, SMTP Auth y recepción real
conservan gate propio; publicar código no demuestra configurar proveedores.

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
viejos en masa ni se borraron worktrees ajenos. El 2026-10-08 se retiraron las
ramas Auth/POS ya integradas, conservando tags remotos
`archive/2026-10-08/codex-auth-trusted-devices` (`c08899d9`) y
`archive/2026-10-08/codex-pos-safe-checkout` (`86997fba`).

## Referencias oficiales

- [Supabase: trabajo con ramas](https://supabase.com/docs/guides/deployment/branching/working-with-branches)
  e [integración GitHub](https://supabase.com/docs/guides/deployment/branching/github-integration),
  consultadas 2026-10-08: editar archivos ya aplicados no implica repetirlos;
  recrear la rama efímera prueba el historial sin resetear producción.
- [Supabase: proceso de deployment](https://supabase.com/docs/guides/deployment/branching):
  las migraciones preceden al deploy de funciones; el contrato POS requiere
  prepublicar sus productores para no bloquear cobros con evidencia vieja.
- [Supabase: abortSignal](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal),
  consultado 2026-10-08. El SDK instalado es 2.101.1: se cancela cada fetch y
  también se limita la espera del SDK; no se asumen retries de versiones nuevas.
