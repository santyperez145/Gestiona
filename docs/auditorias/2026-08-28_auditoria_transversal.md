# Auditoría transversal — 2026-08-28

Esta fotografía no significa «no puede existir otro bug». Significa que cada
afirmación de abajo tiene un comando o una consulta reproducible, y que lo que
no pudo probarse quedó abierto en vez de declararse sano por intuición.

## Alcance ejecutado

- remoto y worktree;
- libro de migraciones y dry-run contra la base vinculada;
- 19 vistas de auditoría/consistencia y RLS de todas las tablas públicas;
- ACL reales de funciones `SECURITY DEFINER`;
- columnas con nombres de credenciales y presencia de secretos heredados;
- buckets y objetos de Storage;
- salud de pg_cron y respuesta real de Edge Functions;
- compilación de las 71 Edge Functions;
- enlaces y números documentales;
- árbol de dependencias productivas y `npm audit --omit=dev`.

## Resultado medido

| Superficie | Evidencia al 2026-08-28 | Estado |
|---|---|---|
| Git | remoto alineado, worktree limpio al iniciar | Verde |
| Migraciones | 488 archivos / 488 registradas al cierre del 2026-08-29; `db push --dry-run` sin brecha | Verde |
| Edge estática | 71 funciones pasan `npm run check:functions` | Verde |
| Documentación | 68 enlaces internos en 41 documentos al 2026-08-29; backlog de 41 IDs reconciliado con el roadmap canónico | Verde |
| RLS | 0 tablas públicas sin RLS; policies sin tenant, índices tenant, settings faltantes y stock negativo en 0 | Verde |
| Secretos heredados | SMTP retiró siete columnas, API/MP/ML/Evolution otras ocho y webhooks seis entre `settings/webhook_configs`; 0 valores antes de cada retiro. Secret de endpoint ahora privado y one-time | Verde; queda auditar transportistas al activarlos |
| Storage | 25 backups privados, 52 imágenes de producto y 2 de marketing; Finance y comprobantes privados. `expense-receipts` cerró antes del primer objeto | Verde: path por tenant, RLS por permiso y URL firmada de 60 s |
| Cron | 25 jobs activos; 22.254 éxitos y 3 fallas en 7 días al cierre del 2026-08-29. Las tres fueron `expire-overdue-trials` y sus últimas 12 corridas ya son exitosas | Resuelto, conservar señal |
| Edge runtime | Corte inicial: 215 invocaciones / 12 fallas en 24 h; 429 / 42 en 7 días; 0 huérfanas | Corregido y desplegado; falta observar la próxima corrida natural de cotización/cumpleaños |
| Pagos | 2 pagos ARS 1 anteriores a la traza; sin pérdida actual y documentados como prueba histórica | Deuda histórica, no incidente actual |
| Dependencias | `npm audit` completo: 0 alertas productivas o de tooling; comando reproducible desde moderado | Verde; `xlsx` conserva su guarda separada por venir del CDN oficial |

## Hallazgo crítico cerrado en esta auditoría

Seis RPC internas conservaban `EXECUTE` explícito para `anon` aunque las
migraciones revocaban `PUBLIC`. La diferencia importa: `PUBLIC` es el conjunto
implícito; no borra un grant directo ya asentado para un rol.

`20260828000160_las_funciones_internas_no_son_anonimas.sql` cerró:

- lectura/aplicación de cambios de precio;
- registro de consumo/costo de IA;
- registro, reconciliación y poda de telemetría Edge.

Cada función tiene ahora dos barreras: ACL exclusiva de `service_role` y guarda
interna. La prueba contra la base real ejecutó los seis ataques como anon,
conservó el camino service role, dejó `audit_costo_expuesto = 0` y 0 restos.

## Dependencias: evidencia, no reputación

`npm audit --omit=dev` encontró:

- `nanoid 3.3.16`, CVE-2026-67213 alta; parche 3.3.18;
- `DOMPurify 3.4.12`, XSS moderada; parche 3.4.13;
- React Router 6.30.4, dos vectores de redirect/XSS; la línea segura completa
  exige React Router 7.18 o posterior.

Fuentes primarias: [nanoid GHSA](https://github.com/advisories/GHSA-2v37-7h3g-55p8),
[DOMPurify GHSA](https://github.com/advisories/GHSA-55q2-fjhq-7xh7),
[React Router redirect/XSS](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2)
y [bypass por backslash](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6).

No se aplicó `npm audit fix` a ciegas: proponía React Router 6.30.6, que elimina
una alerta de `react-router-dom` pero sigue dentro del rango vulnerable de
`react-router`.

El slice posterior cerró la superficie completa:

- React Router/DOM 7.18.3, DOMPurify 3.4.14 y nanoid 3.3.18;
- Vite 8.2.2 + esbuild 0.28.2, `vite-plugin-pwa` 1.3.0 y el plugin React
  estándar 6.1.1; el engine mínimo quedó en Node 20.19, que es el contrato de
  Vite 8;
- `npm run check:dependencies` audita producción **y tooling** desde severidad
  moderada. Una vulnerabilidad del build también corre con acceso al repo y
  secretos del deploy, por lo que el chequeo reproducible no usa `--omit=dev`;
- 11 guardas fijan líneas mínimas, engine y el comando de auditoría para que una instalación
  distraída no reabra los avisos;
- la paleta Ctrl+K dejó de montarse dos veces y ahora tiene un único dueño lazy
  en `AppLayout`, sin duplicar listeners globales;
- Vitest y Vite comparten el plugin estándar, los alias usan
  `import.meta.dirname`, y el selector CSS que Vite 8 detectó como inválido fue
  reemplazado por una selección de token de clase válida;
- la puerta completa detectó una regresión propia de la migración: Rolldown
  absorbía recursivamente helpers compartidos dentro de PDF/charts y volvía a
  precargarlos en Storefront. Utils/PDF/charts/xlsx desactivan esa captura;
  React/Query/Radix/Supabase conservan su grafo para no generar ciclos de
  ejecución. Un intento demasiado agresivo dejó la tienda en el splash y el
  E2E lo rechazó antes del commit. La configuración final bajó el entry de
  185,76 a 150,45 KiB gzip y el precache de 2.025,05 a 1.986,06 KiB, sin quitar
  offline del POS ni romper la tienda.

Evidencia: `npm audit` 0, 89/89 imports de páginas, 32/32 E2E públicos en
desktop/mobile contra el bundle local de producción y build completo en 4,03 s
en la medición final. El PWA precachea 18 entradas / 1.986,06 KiB. El primer E2E con dev server tuvo 1 retry
por transformación fría (31 s, luego 3,1 s); la puerta ahora ejecuta
`build + vite preview`; la repetición final terminó sin retries en 38,2 s.
La puerta final completó typecheck, lint con 0 errores/140 warnings conocidos y
1.955/1.955 tests en 187 archivos al cierre del SMTP privado (2026-08-29).

⚠️ `vite-plugin-pwa` 1.3.0 —última versión instalada al corte— todavía pasa
`inlineDynamicImports` al build del service worker y Vite 8 lo marca deprecado.
El build termina y el SW se genera; es deuda upstream visible, no se parcheó
`node_modules` ni se silenció el warning.

⚠️ La credencial OAuth disponible en esta PC no tiene scope `workflow`:
GitHub rechazó el intento de elevar el job bloqueante de `critical` a
`moderate`. El workflow conserva el audit completo informativo y el repo expone
`npm run check:dependencies`; elevar esa puerta en GitHub sigue pendiente de una
credencial con permiso para editar Actions. El código y el deploy no quedaron
bloqueados por esa limitación de transporte.

## Edge runtime: dos verdes de cron no eran dos funciones sanas

La traza real separó tres invocaciones: `fetch-usd-rate` tuvo 1/1 respuesta 401
el 2026-08-28; `send-birthday-whatsapp` tuvo 2/2 respuestas 500 el 27 y 28. No
se volvieron a invocar manualmente porque una tarea de comunicación no se prueba
contra clientes reales.

La causa de cotización estaba en el control de flujo: `exigirCronOUsuario`
aceptaba el secreto del cron y, dos líneas después, el cuerpo hacía
`auth.getUser()` sobre la anon key. El 401 era inevitable. Tampoco había un job
registrado. La función desplegada distingue cron/persona, actualiza todas las
filas existentes con `service_role` en el primer caso y exige `org_id` explícito
y membresía en el segundo; tres fuentes DolarAPI respondieron con venta positiva
y timestamp en una consulta directa de sólo lectura. Una fuente parcial ya no
borra el último valor sano. `fetch-usd-rate-daily` quedó activo a las 08:15 AR.

Cumpleaños fallaba antes de ver que hoy hay 0 candidatos: `birthday` es `date` y
PostgREST le aplicaba `LIKE`. Aun superado eso, la función exigía una conexión
Evolution —0 en producción y retirada deliberadamente— mientras el helper ya
enviaba por Meta, y el contenido era texto libre proactivo. Ahora un RPC
service-only compara mes/día en SQL, exige opt-in del comercio, consentimiento
vigente y ausencia de baja; una plantilla Meta aprobada de Plataforma es
obligatoria. La tabla privada de entregas reserva `org/cliente/fecha` antes del
efecto externo: un crash ambiguo omite el retry en vez de duplicar marketing.
El canal actual sigue en `ninguno`, plantilla NULL, 0 candidatos y 0 entregas;
por eso el cron responde deshabilitado hasta la activación real, sin fallback
engañoso. El fixture transaccional seleccionó el opt-in ZZ, bloqueó el claim
duplicado, negó el RPC a `authenticated` y dejó 0 restos. Migración 483/483,
dos funciones activas y dry-run sin brecha.

## Storage: un recibo no es una imagen de catálogo

El seguimiento del hallazgo encontró tres implementaciones contradictorias:

- el bucket `expense-receipts` era público;
- `ReceiptScanner` intentaba subir `receipts/{user}/...`, pero la policy exigía
  que la primera carpeta fuera el usuario, por lo que ese upload no podía pasar;
- `ExpensesPage` guardaba la carga manual en `product-images` y persistía su URL
  pública. Ese bucket debe seguir público porque sirve fotos del storefront.

La medición previa evitó adivinar una migración: había 0 objetos en
`expense-receipts`, 0 paths `receipts/%` en `product-images` y 0 filas de
`expenses` con `receipt_url`. `20260828000170` pudo entonces establecer
`{org_id}/{user_id}/{uuid}.{ext}`, bucket privado, 10 MiB, MIME explícitos y
policies que llaman a `has_permission(org, 'expenses', acción)`. La columna
histórica conserva su nombre, pero guarda el path; `createSignedUrl` entrega el
original por 60 segundos después de la SELECT RLS.

El escáner ya no sube antes de que exista el gasto: conserva el blob local, el
formulario valida tipo/tamaño y sube al confirmar. Si el alta falla, intenta
retirar ese objeto; si un reemplazo termina, retira el anterior. La prueba real
como `authenticated` demostró create/read del miembro, bloqueo de carpeta ajena,
0 filas para un outsider con el path exacto y 0 restos después del rollback.
`storage.protect_delete()` rechazó correctamente el primer intento de limpiar el
catálogo con SQL; la prueba se corrigió para no simular la Storage API saltando
esa protección. El libro registra 482/482 y el dry-run queda sin brecha.

La regresión autenticada, de sólo lectura, pasó contra el build local conectado
a producción: Gastos abre un único Dialog, expande el scanner dentro de ese
focus trap, conserva las tres entradas de archivo esperadas y renderiza 0 URLs
públicas; la interacción terminó sin errores de consola o página.

**Cierre incorporado al ROADMAP, slice 76 (2026-08-30).** Esta auditoría no
había detectado que el scanner enviaba el documento al contrato SSE de
`ai-chat`, ni que la `extract-receipt` activa no tenía fuente en `main`. Ambos
puntos quedaron cerrados: 74/74 funciones versionadas/activas, Edge dedicada,
tenant/plan/flag/revisión humana, error visible y archivo local hasta confirmar.
La operación real sigue bloqueada con seguridad porque faltan DPA/proveedor,
clave, flag y benchmark autorizado; no se reetiqueta como validada.

**Cierre adicional incorporado al ROADMAP, slice 77 (2026-08-30).** La
auditoría sí había dejado “jobs y costos de IA” y “IA operacional” abiertos,
pero no detectó que Dashboard montaba dos consumidores aunque sus vistas fueran
invisibles ni que Briefing conservaba un contrato viejo. Producción mostró el
402 de una suscripción cancelada en una carga normal. Pulso y Proyección ahora
dependen de entitlement + vista activa; Briefing/Pulso reconstruyen contexto
con JWT/RLS, omiten PII de clientes y muestran error/retry. Cinco guardas y la
puerta 2.083/2.083 fijan el cierre técnico. Proveedor/DPA/clave, respuesta real,
`AI Action Rate` e impacto siguen abiertos; no se presentan como auditados.

## SMTP: la contraseña sí llegaba al servidor, y a todos los miembros

Configuración decía que la clave SMTP no salía del dispositivo, pero ejecutaba
un `UPDATE settings.smtp_pass`. Como `settings` tiene SELECT para los miembros,
RLS protegía el tenant pero no la columna: un empleado del comercio podía leer
la contraseña. Antes de migrar se midieron 0 configuraciones reales.

`20260828000190/200` crean `merchant_smtp_connections` con RLS, cero policies y
acceso exclusivo de `service_role`; una vista tenant-safe expone host, remitente
y estado, nunca la contraseña. Dueño/admin guarda o revoca por `test-smtp`, que
prueba primero contra el email autenticado y conserva una clave existente sólo
dentro del backend. Once emisores leen el mismo helper privado y Resend conserva
el fallback. Las siete columnas SMTP salieron de `settings` sin `CASCADE`, y la
tabla completa quedó excluida de snapshots y restore drill.

La primera puerta completa encontró una lectura residual en el generador de
páginas legales. No se reemplazó con la dirección SMTP saneada: el remitente
técnico puede no ser el contacto legal, por lo que ese dato vuelve a pedirse al
dueño. La misma corrida mostró falsos timeouts por decenas de workers leyendo
el mismo árbol; Vitest quedó limitado a cuatro workers y 1.955/1.955 pruebas
pasaron con el timeout estricto original de 5 s.

La prueba productiva usó una credencial `ZZ` transaccional sin abrir red: el
miembro vio el estado, no pudo leer la tabla, un outsider obtuvo 0 filas y el
rollback dejó 0 restos. Producción quedó con 0 conexiones, 0 columnas SMTP en
`settings` y libro 485/485. No se simuló entregabilidad: sigue pendiente una
conexión real, su correo de prueba y la observación de entrega/rebote.

## Ocho columnas vacías seguían invitando a guardar tokens en `settings`

La ausencia de valores no vuelve seguro un campo de credencial: mientras la
columna exista, un cliente viejo o una implementación paralela puede volver a
escribirla. El corte productivo del 2026-08-29 midió 0 valores en `api_key`, los
tres campos históricos de Evolution, los dos tokens de MercadoLibre y los dos
campos de Mercado Pago. `20260828000210` verifica esa precondición y elimina los
ocho sin `CASCADE`; la API pública, MP, ML y Evolution conservan únicamente sus
almacenes privados canónicos.

La verificación posterior encontró que `payment_connections` y
`meli_connections` tenían RLS y cero policies pero todavía grants de tabla para
el navegador. No devolvían filas, pero dependían de una sola barrera. Se
revocaron los grants: las tres conexiones de comercio quedaron con RLS, 0
policies, `anon_lee=false` y `authenticated_lee=false`; las vistas saneadas
siguen resolviendo el estado del tenant correcto. Producción conserva 1 conexión
de pago, 0 de MercadoLibre y 0 de Evolution sin imprimir ninguna credencial.

El consumidor más viejo, `mercadopago-link`, reveló dos fallas independientes:
no comprobaba pertenencia al `orgId` y enviaba `sale:<id>` mientras
`payment_links.external_ref` guardaba `link-<timestamp>`, por lo que el webhook
nunca podía confirmar la fila. Ahora exige `sales.create`, toma el token OAuth
privado, valida importe, calcula `marketplace_fee`, incluye `notification_url` y
reutiliza la referencia canónica. Coincide con la API oficial de
[crear preferencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/preferences/create-preference/post)
y sólo agrega `back_urls` si `PUBLIC_BASE_URL` es HTTPS, como exige la
[guía oficial de retorno](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/configure-back-urls).
No se creó un cobro real para probar: queda como gate operativo explícito.
La puerta completa posterior pasó 1.969/1.969 tests en 190 archivos, typecheck,
lint con 0 errores/140 warnings conocidas, build/PWA, las 71 Edge Functions,
dependencias en 0 y los 63 enlaces internos.

## Dos paneles de webhooks y un secret predecible

Integraciones ofrecía dos sistemas incompatibles. El primero escribía
`settings.webhook_url/events/secret`, una fila visible para todos los miembros;
el segundo leía `webhook_configs` con `select('*')`, incluida `secret_value`, y
el botón de prueba hacía el POST desde el navegador. La Edge elegía además la
primera membresía del usuario —incorrecto en multi-organización— y, si faltaba
clave, firmaba con el propio `org_id`. Las automatizaciones tenían otros dos
`fetch` sin firma. Producción permitió retirar la duplicación sin migrar uso:
0 configs, 0 activas, 0 secrets y 0 entregas.

`20260828000220` crea `webhook_signing_secrets` con RLS, cero policies y cero
grants para roles cliente. Los RPC de owner/admin administran configuración,
emiten una clave aleatoria por endpoint una sola vez y permiten rotarla; la UI
sólo lee columnas saneadas. Prueba y retry ocurren en `send-webhook`, pero el
dispatch de ventas ya no está disponible al navegador. El transporte compartido
usa HTTPS, bloquea
destinos locales obvios, no sigue redirects, acota timeout/reintentos y firma
`timestamp.payload` con HMAC-SHA256; el sobre y header llevan versión
`2026-08-29`. Cada intento termina correlacionado al config con estado, HTTP,
latencia y cuerpo truncado. Las dos ejecuciones de automatización usan el mismo
camino y el catálogo visible se redujo de 18 promesas a los dos eventos que hoy
tienen emisor real.

El primer fixture como owner creó la config, leyó sólo la superficie saneada, recibió
el secret one-time, fue rechazado al leer la tabla privada y al escribir tablas
directas, rotó la clave, eliminó y dejó 0 configs ZZ, 0 huérfanos y 0 entregas.
Las tres Edge iniciales quedaron ACTIVE; libro 487/487 y dry-run sin brecha.

`20260829000010` cerró la ventana de pérdida: cada config sincroniza una
suscripción server-managed a `venta.registrada`, y el trigger del ticket crea el
Domain Event y la fila de outbox en el mismo commit. El worker se identifica con
el secreto de cron; `dispatch-outbound-webhook` revalida evento, suscripción y
tenant, relee las líneas y delega retry/backoff/DLQ/replay a la cola. El sobre
conserva `event_id` entre intentos y separa `delivery_id`. El POS ya no dispara
una Edge y `send-webhook` no acepta dispatch manual, eliminando pérdida y
duplicación. Los miembros quedaron sin INSERT/UPDATE/DELETE sobre
`event_subscriptions`. Una fixture transaccional probó siete invariantes y 0
restos; el preflight permitió retirar 12 descartados de fixtures sin líneas y
confirmó 0 descartados con líneas. La nueva Edge quedó ACTIVE v1 y una llamada
sin secreto respondió 401.

El 2026-08-29 se cerró también el contrato: OpenAPI 3.1 público describe los
tres requests entregables, la guía y el receptor Node muestran validación del
cuerpo crudo/deduplicación, y el panel los hace visibles antes de configurar.
Los dos emisores de `automation.triggered` se normalizaron a un schema sin
contactos internos. `npm run certify:webhooks` envió `test.ping` sintético con
el builder productivo a Webhook.site, recuperó el request, recalculó HMAC,
confirmó seis headers y borró el receptor con 204. Evidencia:
[`2026-08-29_webhook_externo.md`](../evidencias/2026-08-29_webhook_externo.md).

La misma traza mostró dos jobs activos sobre `automation_flows`:
`execute-automations-daily` a las 05:00 AR y `run-automation-flows-daily` a las
08:00 AR. Con una regla activa, ambos podían ejecutar el mismo efecto y emitir
dos webhooks. Quedó un solo job, `execute-automations-daily`, a las 08:00 AR.
La función sigue aceptando el cron global, pero su rama de botón ahora exige
`org_id` válido y `marketing.edit`; antes una sesión real podía pasar el tenant
de otro comercio y la consulta service-role ejecutaba sus flujos.

El contrato sigue fuentes primarias consultadas el 2026-08-29:
[GitHub recomienda secret de alta entropía, HMAC-SHA256 y comparación segura](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries),
[Stripe firma el timestamp y documenta retry/falta de orden](https://docs.stripe.com/webhooks),
[OpenAPI 3.1 modela webhooks iniciados por el proveedor](https://spec.openapis.org/oas/v3.1.1.html#openapi-object),
[Webhook.site ofrece tokens y lectura de requests efímeros](https://docs.webhook.site/api/about.html)
y [OWASP exige validar protocolo/destino y no seguir redirects frente a SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

## La API pública tenía seguridad de key, pero no un contrato completo

P1-13 no estaba cerrado por tener hashes y scopes. La comparación entre UI,
Edge, SQL y respuesta real encontró seis divergencias:

1. `rate_limit_rpm` se mostraba por key, pero el runtime aplicaba 120 requests
   por IP y por instancia; dos réplicas no compartían autoridad;
2. `products:read` seleccionaba `stock` aunque faltara `stock:read`;
3. `sales:write` hacía `.select().single()` y devolvía costos/margen aunque
   faltara `costs:read`;
4. reserva idempotente, insert y cierre eran tres requests: una falla parcial
   podía dejar venta y clave en estados incompatibles;
5. `/products` sin versión seguía funcionando y parámetros inválidos llegaban
   a Postgres;
6. el `X-Request-Id` de respuesta no era el que quedaba en el log, mientras el
   429 compartido volvía a agregar CORS `*`.

`20260829000020` convierte el cupo en contador atómico por key y encierra la
venta completa en `api_v1_crear_venta`, que revalida key/scope/tenant/producto,
lee owner/costo en servidor y toma advisory lock por idempotency key. La Edge
exige `/v1`, valida UUID, fechas, tamaños y precisión antes de la base, y
allowlistea la respuesta según scopes incluso en replay. Stock/cantidades son
enteros de PostgreSQL; montos nominales usan ARS 2 y USD 4 decimales. CORS de
navegador está deshabilitado deliberadamente: exponer una key `gst_live_…` en
un frontend contradice el modelo server-to-server.

La superficie pública ya no depende de leer el repo:
`/developer/api/openapi.json` pasó Redocly sin errores/warnings,
`/developer/api/changelog.json` publica lifecycle y `docs/API_PUBLICA.md`
explica integración, errores, cupo e idempotencia. El panel no lee `key_hash`,
retiró campos sin backend y enlaza los tres contratos. En producción la
fixture real devolvió replay sobre una única venta, movimiento exacto de stock,
conflicto con payload distinto y **0 restos**. La Edge `public-api` ACTIVE v42
respondió 401 con el mismo request id en header/body, rechazó el alias sin
versión con 404 y no entregó `Access-Control-Allow-Origin` al preflight.

Fuentes primarias consultadas el 2026-08-29:
[GitHub exige versión explícita y anuncia deprecaciones](https://docs.github.com/en/rest/about-the-rest-api/api-versions),
[Shopify mantiene versiones solapadas](https://shopify.dev/docs/api/usage/versioning),
[Stripe define idempotencia de requests](https://docs.stripe.com/api/idempotent_requests),
[Stripe documenta unidades monetarias](https://docs.stripe.com/currencies#minor-units-in-api-amounts)
y [RFC 9745 estandariza el header `Deprecation`](https://www.rfc-editor.org/rfc/rfc9745.html).

## Orden de continuación

1. Confirmar la próxima corrida natural de cotización y cumpleaños en
   `edge_invocation_log`; no invocarlas a mano ni declarar recuperación antes.
2. P1-14 quedó cerrado con contrato público y receptor externo; mantener
   compatibilidad y medir la primera integración real, sin inventar más eventos
   sin emisor.
3. P1-13 quedó cerrado técnicamente; medir la primera key e integración reales
   antes de autorizar OAuth de apps, sandbox o marketplace.
4. P1-04 ya aplica `payments.edit` al refund; completar únicamente la prueba
   cross-branch cuando existan dos ubicaciones reales aptas.
