# Alta de comercios desde Platform

**Corte:** 2026-08-22

**Estado:** infraestructura productiva; el segundo comercio externo todavía es
una tarea comercial.

## Riesgo que cierra

El alta manual anterior distribuía la creación entre la Edge Function y cinco
escrituras independientes. Si una fallaba, podía quedar una organización sin
owner, sin suscripción o sin ajustes. Si el email ya existía, buscaba una
organización de ese usuario y la renombraba: asistir a un cliente nuevo podía
modificar un negocio anterior.

Además, Platform recibía un enlace de sesión para copiar. Aunque su propósito
fuera onboarding, quien veía el enlace podía abrir la cuenta del owner.

## Contrato actual

~~~text
superadmin completa alta
→ Auth crea o encuentra identidad
→ RPC valida identidad sin organización previa
→ org + owner + trial + settings + auditoría + idempotencia (una transacción)
→ Supabase Auth envía el acceso al email
→ Platform recibe estado, nunca token
→ Merchant 360 muestra la ruta a la primera venta
~~~

- `provision_platform_organization` exige `superadmin` y es la única autoridad
  para armar el grafo inicial del comercio.
- La clave idempotente nace al abrir el formulario. Si la respuesta de red se
  pierde y se reintenta, vuelve la misma organización; no extiende el trial ni
  duplica filas. Reusar la clave con otros datos se rechaza.
- El trigger reconoce `account_type = platform_invited_owner` y no crea un
  workspace genérico antes del RPC.
- Una identidad con membresías previas se rechaza. El piloto exige un email de
  owner nuevo porque aún existen superficies públicas legacy identificadas por
  owner; modificar o adivinar otra organización sería inseguro.
- Si se creó una identidad y el RPC falla, la Edge Function la elimina. Las
  escrituras del negocio ya fueron revertidas por PostgreSQL.
- El acceso usa `signInWithOtp` con `shouldCreateUser: false`. Platform sólo ve
  `emailSent`; no recibe `action_link`, token hash ni URL de sesión.
- Reenviar acceso valida que el destinatario siga siendo owner de esa
  organización y deja auditoría sin token ni error crudo del proveedor.

## Experiencia operativa

El diálogo de Platform explica antes de crear que el email debe ser único. Al
terminar muestra dos verdades separadas:

1. si el grafo de la organización quedó confirmado;
2. si el proveedor aceptó el email de acceso.

Un fallo de correo no finge que el alta falló ni vuelve a crear el tenant. Se
puede reenviar y luego abrir directamente Merchant 360 para acompañar los ocho
hitos de activación.

## Verificación productiva

~~~bash
npx supabase db query --linked --file supabase/verificaciones/20260822_atomic_merchant_provisioning.sql
npx supabase db push --linked --dry-run
~~~

La prueba con roles reales y subtransacción reversible confirmó:

- identidad `platform_invited_owner`: 0 workspaces prematuros;
- grafo final: 1 organización, 1 owner, 1 suscripción, 1 settings y 1 registro
  idempotente;
- retry: mismo `org_id`, sin duplicados ni extensión;
- mismo key con otros datos: bloqueado;
- owner previamente vinculado: bloqueado y su organización quedó idéntica;
- actor externo: bloqueado;
- auditoría de creación: 1;
- filas `ZZ`, usuarios técnicos y provisionings residuales: 0.

## Comparación de producto

Crear una cuenta, asignar un trial y enviar una invitación es paridad de una
plataforma SaaS madura. El valor defendible acá es operativo: un alta no puede
corromper otro tenant, el retry no duplica costo ni datos, el staff no recibe
la sesión del cliente y Merchant 360 continúa sobre el mismo Business Core.

Todavía no es tracción. La evidencia que sigue siendo necesaria es que el
segundo comercio reciba el email, elija un perfil, importe su catálogo y haga
su primera venta sin SQL ni correcciones manuales.
