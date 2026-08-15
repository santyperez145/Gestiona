# Cron jobs

Los trabajos programados viven en `pg_cron` dentro de la base. La mayoría llama
Edge Functions por HTTP; `snapshot-platform-org-health` es la excepción
deliberada: ejecuta una función `SECURITY DEFINER` local para capturar una
fotografía diaria de riesgo, sin depender de una API externa.

## Cómo funciona

Los jobs que llaman Edge Functions pasan por un único helper,
`public.invoke_edge_function(nombre)`, que lee la URL del proyecto y la clave
publicable del **vault** de Supabase:

```sql
SELECT public.invoke_edge_function('check-stock-alerts');
```

Se usa la clave **publicable**, no la `service_role`. Las Edge Functions corren
con `verify_jwt` y tienen su propia service key en el entorno, así que no hace
falta guardar un secreto en la definición de un cron.

## Requisito: dos secretos en el vault

Sin estos, **todos los jobs fallan en silencio**:

| Secreto | Valor |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | la clave publicable (la misma de `VITE_SUPABASE_PUBLISHABLE_KEY`) |

Se cargan una sola vez:

```sql
SELECT vault.create_secret('https://<project-ref>.supabase.co', 'SUPABASE_URL');
SELECT vault.create_secret('<clave-publicable>', 'SUPABASE_ANON_KEY');
```

## Cron con secreto adicional: respaldos semanales

`weekly-org-backups` se programa los domingos a las 03:30 UTC y no usa la anon
key como autorización suficiente. Lee `BACKUP_CRON_SECRET` de Vault y lo pasa
como `x-backup-cron-secret`; la Edge Function compara el mismo secreto guardado
en su entorno antes de enumerar organizaciones o acceder al bucket privado.

El valor no se imprime ni se versiona. Al rotarlo, actualizar ambos destinos y
re-ejecutar la migración `20260815000008_organization_managed_backups.sql` para
que conserve exactamente un job programado. La programación usa el helper
privado con un timeout HTTP de 60 s —el default de 5 s puede terminar antes de
que una corrida multi-organización termine y reportar un falso fallo—. El resultado esperado es que cada
organización con plan `backups_enabled` tenga como máximo un snapshot completo
por ventana de seis días; el cron vuelve a verificar los existentes antes de
considerar la semana cubierta.

## Qué pasó antes (2026-07-28)

Los 13 jobs estaban fallando desde siempre, sin que nada lo avisara:

- La mayoría llamaba `current_setting('app.supabase_url')` y
  `current_setting('app.service_role_key')`, ajustes que nunca se configuraron
  en esta base.
- `send-drip-emails` tenía literalmente los placeholders del ejemplo de la
  documentación: `https://<tu-proyecto>.functions.supabase.co` y
  `Bearer <SERVICE_ROLE_KEY>`.

O sea que no corrían las alertas de stock, los avisos de deuda vencida, la
reactivación de clientes, el KPI diario, el digest semanal, las automatizaciones,
las campañas programadas ni los emails de las secuencias.

## Cómo verificar que están sanos

```sql
-- Definiciones: todas deberían usar invoke_edge_function
SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;

-- Últimas corridas — 'failed' acá es la señal de alarma
SELECT j.jobname, d.status, d.end_time
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
ORDER BY d.end_time DESC
LIMIT 20;

-- Respuestas HTTP reales de las funciones
SELECT status_code, left(coalesce(content, error_msg, ''), 200)
FROM net._http_response
ORDER BY created DESC
LIMIT 10;
```

Para probar una Edge Function a mano sin esperar al horario:

```sql
SELECT public.invoke_edge_function('check-stock-alerts');
-- esperar unos segundos y mirar net._http_response
```

La serie de riesgo se puede refrescar sin HTTP (normalmente no hace falta,
porque se actualiza a las 03:15 ART):

```sql
SELECT public.capture_platform_org_health_snapshot();
```

## Visibilidad para plataforma

`/platform/metricas` → **Operación** consume la vista protegida
`platform_cron_health`. Resume por job:

- nombre, expresión cron y si está activo;
- estado de la última corrida y sus tiempos;
- número de corridas y fallos de los últimos siete días.

La vista sólo responde a `platform_admins` y no incluye `cron.job.command`,
`return_message`, cuerpos de respuestas HTTP ni secretos. Un estado **Sin
ejecuciones** es informativo para un job recién creado: el panel no intenta
deducir atraso parseando la expresión cron, porque un job semanal puede estar
correcto aunque no haya corrido hoy.
