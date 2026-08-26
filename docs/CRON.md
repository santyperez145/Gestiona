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

## ⚠️ Que un cron diga `succeeded` NO significa que la función corrió

Esto costó entenderlo y conviene tenerlo presente antes de mirar cualquier
panel de salud.

`invoke_edge_function` termina en `net.http_post`, y **pg_net es asíncrono**:
devuelve un id apenas encola el request y vuelve. El job termina en ~0,2 s sin
haber esperado la respuesta. Lo que `cron.job_run_details` registra es que el
despacho salió, no que la función respondiera ni que devolviera 200.

Medido el 2026-08-26: los 20 jobs en verde con **0 fallas en 7 días**, y al
mismo tiempo, en la ventana de retención de pg_net, **4 respuestas con error y
1 timeout sobre 42**. ~10% fallando, 0% visible.

Desde el 2026-08-26 el resultado real se registra y se puede mirar:

```sql
-- Qué contestó de verdad cada Edge Function invocada por cron
SELECT * FROM public.platform_edge_invocation_health;   -- staff de plataforma

-- Crudo, si hace falta el detalle
SELECT function_name, status_code, timed_out, error_msg,
       responded_at - invoked_at AS latencia
  FROM public.edge_invocation_log
 ORDER BY invoked_at DESC LIMIT 20;
```

Cómo está armado, y por qué así:

- `edge_invocation_log` guarda el id que devuelve `net.http_post` junto al
  nombre de la función. Hace falta porque `net._http_response` **no guarda el
  nombre** y `net.http_request_queue` —que sí tiene la URL— se vacía al
  procesar. Sin ese puente, un 500 no se puede atribuir a nadie.
- `reconciliar_invocaciones()` corre cada 5 minutos porque **pg_net poda sus
  respuestas a las ~6 horas**. Si no se copian antes, el resultado se pierde.
- Una invocación reconciliada sin `status_code` **es una falla**, no un
  silencio neutro. Un timeout deja el status en NULL, así que contar errores
  como `status_code >= 400` los dejaba afuera — la vista tenía el mismo agujero
  que venía a tapar.
- Lo que todavía no se reconcilió no cuenta ni como éxito ni como falla.
  Adivinar hacia el verde esconde el problema; adivinar hacia el rojo entrena a
  ignorar la alarma.

⚠️ **El P95 mide encolado → respuesta registrada por pg_net.** Incluye la cola.
**No** es el tiempo de ejecución de la función: ese dato no existe de este lado,
y presentarlo como si lo fuera sería inventar un número.

### El despacho espera 30 s, no 5

`net.http_post` tiene un default de **5 segundos** y `invoke_edge_function` no
lo pisaba. `recover-abandoned-carts` cortó a los 5.000 ms exactos **con 0
carritos para procesar**, así que no era una función lenta haciendo trabajo.

⚠️ Y acá la lectura fácil es la equivocada: pg_net **no cancela** la Edge
Function. El request sigue del lado del servidor y el trabajo probablemente se
hace. Lo que el timeout rompía era la **observabilidad**: no llegaba el status
ni el cuerpo. No era "los carritos no se recuperan", era "no hay forma de
saberlo".

### Si faltan los secretos del vault, ahora explota

Antes `invoke_edge_function` hacía `RAISE WARNING` + `RETURN NULL`, así que el
cron terminaba **`succeeded` sin haber despachado nada** — la peor forma de
fallar, porque nadie la mira. Ahora lanza excepción y queda en
`cron.job_run_details` con el motivo.

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
