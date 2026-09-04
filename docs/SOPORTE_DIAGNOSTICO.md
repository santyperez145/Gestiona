# Diagnóstico temporal de soporte

**Estado:** contrato vigente. **Corte:** 2026-09-04.

## Decisión

Nerqia retiró `Ver como` mediante magic link. Un enlace emitido como otra
persona abre una sesión con los permisos de esa persona y puede continuar más
allá de cualquier ventana aprobada. Auditar que se generó no limita el acceso ni
equivale a consentimiento.

El reemplazo es un diagnóstico agregado, temporal y consentido:

~~~text
Support solicita motivo cerrado
→ owner ve quién y para qué
→ autoriza 15 / 30 / 60 minutos
→ cada lectura revalida actor + rol + vencimiento + revocación
→ Merchant 360 recibe sólo métricas sanitizadas
→ owner puede revocar y ve el contador de lecturas
~~~

## Datos incluidos

- avance de activación y evidencia fiscal;
- cantidades de calidad del catálogo, sin nombres de productos;
- precisión agregada de stock y Kardex;
- cantidades/antigüedad de la cola de eventos;
- estado y frescura de integraciones, sin errores crudos;
- rubro, versión de Business Profiler y cantidades de tipos.

No incluye clientes, órdenes, productos nominales, direcciones, emails de
compradores, teléfonos, montos, precios, costos, payloads, errores crudos,
tokens, claves, certificados ni sesiones.

## Autoridad

- `support_diagnostic_access_requests` tiene RLS y cero privilegios de cliente.
- Support/Superadmin solicita por `request_support_diagnostic_access`; el motivo
  pertenece a un vocabulario cerrado, sin notas libres.
- Sólo `owner` aprueba por `approve_support_diagnostic_access`. Repetir la
  aprobación no extiende el vencimiento original.
- Owner o el mismo staff solicitante pueden revocar. Nunca se borran filas.
- Sólo el mismo staff que solicitó puede ejecutar
  `get_support_diagnostic_snapshot`; Superadmin no hereda una autorización ajena.
- La función aumenta `view_count` y `last_viewed_at` en cada lectura.
- Las vistas separan la superficie del comercio y la de Platform; anon no ve
  ninguna y los staff de soporte no ven solicitudes de otros salvo Superadmin.

La UI vuelve a inspeccionar las claves del JSON y rechaza PII, secretos o campos
monetarios prohibidos. Es defensa adicional; la autoridad principal sigue en la
función SQL.

## Verificación

~~~bash
npx supabase db query --linked --file supabase/verificaciones/20260822_support_diagnostic_access.sql
npx supabase db push --linked --dry-run
~~~

La prueba productiva del 2026-08-22 confirmó:

- dos solicitudes iguales → una fila y un ID;
- una solicitud pendiente no puede leer;
- un tercero no puede aprobar ni ver la bandeja del owner;
- aprobar 15 minutos y reintentar con 60 no extiende consentimiento;
- dos snapshots → contador 2;
- contrato sanitizado y sin claves prohibidas;
- revocar bloquea la siguiente lectura;
- residuos después del rollback: 0.

La línea de base real es 0 solicitudes y 0 diagnósticos consumidos. La capacidad
reduce riesgo de soporte, pero todavía debe probarse acompañando al segundo
comercio.

## Comparación de producto

Impersonar usuarios o abrir sesiones remotas es una herramienta operativa común;
no es una ventaja defendible y aumenta riesgo. Nerqia prioriza consentimiento
del dueño, alcance de sólo diagnóstico, expiración evaluada en cada lectura y
minimización de datos. El diferencial sólo quedará demostrado si permite bajar
tiempo de soporte sin ampliar incidentes ni exponer PII.
