# Evidencia — Business Copilot del Dashboard

**Fecha:** 2026-08-30  
**Estado:** implementación y Edge Function publicadas; cliente/Vercel y respuesta del proveedor pendientes al crear este corte.

## Hallazgo productivo

En la sesión autenticada de `https://exentryimports.vercel.app/`, una carga del
Dashboard emitió `ai-analysis falló Tu suscripción está cancelada...` aunque la
persona no había pedido IA. Las seis vistas estaban montadas y ocultas por CSS:
Pulso y Proyección ejecutaban efectos automáticos en segundo plano.

El modal Briefing tampoco podía funcionar con el backend vigente:

- armaba instrucciones y cifras en el navegador;
- llamaba `ai-chat` con `{messages, stream}` y sin `orgId`;
- esperaba deltas con forma OpenAI;
- `ai-chat` hoy recibe `{message, history, orgId, model}` y emite otro contrato
  SSE.

## Decisión y límites

- La UI consulta entitlements para orientar y evitar consumo inútil; el servidor
  conserva la autoridad con `exigirBeneficio`.
- Pulso sólo se monta en Resumen y Proyección sólo en Inteligencia.
- `daily_pulse` y `daily_briefing` reciben únicamente intención + `orgId`.
- `ai-analysis` valida JWT, UUID, membresía, suspensión y plan; después relee
  el contexto con el JWT del miembro y RLS.
- No se seleccionan nombres ni ids de clientes. Productos, montos agregados,
  fechas y nombre del negocio son el contexto mínimo del caso de uso.
- Briefing devuelve `content` y el `summary` exacto que alimentó el prompt; las
  cifras visibles no se recalculan desde un filtro local.
- Sin beneficio se muestra **Activar IA → Mi plan**. Error de proveedor o datos
  se muestra con retry y no se convierte en vacío.
- El modelo no puede mutar datos ni ejecutar acciones. El Action Loop y outcome
  continúan abiertos.

## Benchmark oficial

- [Shopify Sidekick](https://help.shopify.com/en/manual/ai-powered-tools/sidekick)
  y [Sidekick Pulse](https://help.shopify.com/en/manual/ai-powered-tools/sidekick/pulse):
  contexto de tienda, oportunidades proactivas, tareas y aprobación antes de
  cambios.
- [QuickBooks Intuit Intelligence](https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-assist/introducing-intuit-intelligence/L189976Da_US_en_US):
  IA/BI sobre datos de la compañía, insights y tareas dentro del flujo.

Gestiona adopta el patrón contexto → tarea → revisión; no copia interfaz ni
afirma impacto.

## Puerta reproducible

~~~text
npm run typecheck
  PASS

npm run lint
  PASS — 0 errores, 139 warnings conocidos

npm test
  PASS — 209 archivos, 2.083 pruebas

npm run check:functions
  PASS — 74 Edge Functions

npm run build
  PASS — PWA, 18 entradas / 2.018,63 KiB

npm run check:dependencies
  PASS — 0 vulnerabilidades

npm run check:enlaces
  PASS — 82 enlaces internos en 50 documentos

npm run check:conteos
  PASS — 74 funciones / 497 migraciones
~~~

Guardia nueva: `src/test/businessCopilotAuthority.test.ts`, 5/5.

## Edge publicada

~~~text
ai-analysis
  status=ACTIVE
  version=43
  verify_jwt=true

POST anónimo
  HTTP 401
  Access-Control-Allow-Origin: *
~~~

La prueba no usó credenciales, no leyó datos y no consumió al proveedor.

## Lo que no se certifica

`ANTHROPIC_API_KEY` no aparece en `supabase secrets list` al corte. Por eso no
hubo respuesta real del modelo ni transferencia de datos al proveedor. Antes de
habilitarla faltan contrato/DPA, subencargados, región/transferencia,
retención/borrado y una prueba autenticada con organización activa. La
publicación del cliente y la matriz visual se agregan a esta evidencia después
del deploy de Vercel; no se anticipan como hechos.
