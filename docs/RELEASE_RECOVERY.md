# Promoción y recuperación de producción

**Estado:** runbook implementado. **Revisión:** 2026-10-03. **Owner:** CTO / guardia.

Vercel continúa desplegando cada push a `main`. Este runbook no cambia ese flujo:
agrega una ruta manual, acotada y auditable para volver a un deploy que ya sirvió
producción o para promover el deploy elegido y reactivar la asignación automática.

## Preparación única

Estado verificado el 2026-10-03: el environment `production-recovery` existe,
acepta sólo ramas protegidas y exige aprobación de `santyperez145`. Como el repo
tiene un único colaborador, `prevent_self_review` permanece desactivado. Agregar
un segundo responsable y activarlo es un gate organizacional, no uno de código.

En GitHub, crear o revisar el environment `production-recovery`:

1. exigir al menos un reviewer distinto de quien dispara la acción;
2. guardar `VERCEL_TOKEN` como secreto del environment, limitado al proyecto
   `nerqia` y con rotación definida;
3. restringir deployment branches a `main`.

El token nunca entra al bundle, a Supabase ni a argumentos del proceso. La
acción usa Vercel CLI `59.10.0`, la versión probada al escribir este runbook.

## Ejecución

Desde GitHub Actions → **Production Recovery** → **Run workflow**:

- `rollback`: URL inmutable `https://...vercel.app` de un deploy `READY` que ya
  sirvió como producción; confirmación exacta `ROLLBACK NERQIA`;
- `promote`: URL inmutable del deploy `READY` elegido; confirmación exacta
  `PROMOTE NERQIA`.

Antes de mutar dominios, `scripts/vercel-production-recovery.mjs` inspecciona el
deploy y exige proyecto `nerqia`, ID inmutable y estado `READY`. Para rollback
exige además `target=production`. Después comprueba que `nerqia.app` quedó en ese
ID y que `/`, `/estado` y `/sitemap.xml` responden con el tipo esperado.

## Alcance y recuperación completa

Instant Rollback cambia los dominios a un build anterior: no revierte Supabase,
migraciones, Storage, secretos, webhooks ni efectos de proveedores. Toda
migración desplegada debe seguir siendo compatible con la versión anterior o
tener un procedimiento de forward-fix. No usar el workflow para “probar” una
URL ni durante una operación fiscal/pago cuyo estado externo sea desconocido.

Después de un rollback, Vercel desactiva la asignación automática de dominios.
Una vez corregido y verificado el incidente, usar `promote` sobre el deploy
aprobado para restaurarla. Registrar inicio, fin, síntoma, deploy anterior,
deploy elegido, impacto y reconciliación de efectos externos.

## Gate pendiente

El mecanismo queda implementado y probado por contrato, pero no se ejecutó un
rollback productivo sólo para generar evidencia. Falta cargar un `VERCEL_TOKEN`
dedicado y revocable, sumar un segundo revisor para impedir autoaprobación y
realizar un game day autorizado con un deploy sin cambios de esquema ni
transacciones externas. La sesión personal local no se reutiliza como secreto CI.

Referencias oficiales consultadas el 2026-10-03:
[Vercel CLI rollback](https://vercel.com/docs/cli/rollback),
[promoción de previews](https://vercel.com/docs/deployments/promote-preview-to-production) e
[Instant Rollback](https://vercel.com/docs/instant-rollback).
