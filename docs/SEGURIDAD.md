# Seguridad y prevención de fraude

**Estado:** canónico. **Corte:** 2026-10-07.

Este documento define la línea base de seguridad de Nerqia. La arquitectura
funcional está en [ARQUITECTURA](ARQUITECTURA.md), los roles en
[permisos](permisos.md) y la operación de secretos en
[CONFIGURACIÓN](CONFIGURACION.md).

## Principios

1. **Denegar por defecto.** Toda tabla tiene RLS y toda función privilegiada
   revoca `PUBLIC` antes de conceder una audiencia concreta.
2. **El servidor decide.** Precios, costos, stock, descuentos, comisiones,
   permisos e idempotencia no dependen del navegador.
3. **Tenant explícito.** Cada lectura o escritura privada demuestra membresía,
   rol o capacidad sobre `org_id`.
4. **Menor privilegio.** El comprador, el miembro, el staff y `service_role`
   tienen contratos distintos. Ser staff no crea membresía comercial.
5. **Secretos sin retorno.** Tokens y contraseñas viven en secretos de Edge
   Functions o tablas sin policies; la UI consume estados sanitizados.
6. **Evidencia antes que confianza.** Los controles se verifican contra el
   catálogo y los grants reales de PostgreSQL.

## Superficies de confianza

| Superficie | Identidad | Autoridad mínima |
|---|---|---|
| Tienda pública | anónima, slug o token | catálogo, carrito y checkout limitados |
| Organización | JWT + `memberships` | módulo, acción y tenant |
| Finance | JWT + producto + capacidad | `finance_document_can` y permisos Finance |
| Plataforma | JWT + `platform_admins` + MFA | rol de staff específico |
| Creador | JWT + email confirmado + perfil propio | campañas, canjes y retiros propios |
| Workers | `service_role` | una función y un propósito concretos |

Los tokens públicos son capacidades revocables y de alta entropía. No
reemplazan autenticación para stock, costo, pagos acreditados o configuración.

## Segundo factor y dispositivos

El TOTP verifica una **sesión**, no todos los futuros inicios del navegador.
Supabase conserva la sesión AAL2 en `localStorage` y renueva sus tokens; una
recarga o reapertura del mismo origen no debe pedir otro código mientras la
sesión siga vigente. Un logout revoca esa sesión; el login siguiente arranca
en AAL1. Nunca se almacena el TOTP ni su secreto para repetirlo en segundo
plano. Desde 2026-10-04, error de lectura AAL/factores = panel cerrado con
reintento; el alta obligatoria del factor ocurre dentro del gate.

El acceso recordado es opt-in durante siete días **también después de logout**:

1. Contraseña y TOTP real reciente permiten registrar el navegador.
2. `/api/trusted-device` custodia una credencial aleatoria de 256 bits en cookie
   `__Host-nerqia-mfa-device`, Secure, HttpOnly, SameSite=Strict, Path=/ y **sin
   Domain**. Nunca se comparte con tiendas ni se entrega en JSON o JS storage.
3. La Edge `trusted-device` valida el JWT con Auth y pasa sólo su hash SHA-256
   y claims verificados a `trusted_device_command`, exclusivo de service_role.
   Sólo acepta este transporte desde el proxy first-party autenticado por
   `NERQIA_TRUST_PROXY_SECRET`; no entrega credenciales a llamadas directas.
   El mismo secreto se guarda como variable privada en Vercel y secreto de
   Supabase Edge, nunca en el bundle del navegador.
4. Cada login nuevo sigue requiriendo contraseña. La base comprueba usuario,
   sesión Auth viva y credential; registra un grant para ese `session_id`, con
   el vencimiento original. No se extiende por actividad ni por otro login.
5. Perfil y Seguridad de mi cuenta en Plataforma permiten olvidar este
   navegador o revocar dispositivos propios, también al staff sin organización.
   Cambiar contraseña, email o factores verificados invalida la huella privada
   y los grants existentes; no depende del formulario que haga el cambio.

El JWT nuevo permanece AAL1: el permiso recordado no se presenta como AAL2
ni como MFA fresco. No hay OTP, secreto TOTP ni contraseña persistidos por
esta capacidad. Se limita la lista a veinte dispositivos activos. Las tablas
viven en `nerqia_auth`, sin acceso directo web; guardan alta, uso y revocación.
La web sirve el permiso mediante transporte first-party; el cliente nativo
continúa con TOTP, sin prometer persistencia de una cookie entre protocolos.
Un fallo del servicio ofrece TOTP normal y nunca abre el gate. El perfil exige
TOTP real de los últimos cinco minutos para cambios de seguridad; la contraseña
actual se comprueba con una sesión aislada sin reemplazar la sesión principal.

El grant que consulta `get_session_mfa_status` sólo se crea en el servidor
después de canjear la cookie HttpOnly y se liga al `session_id` Auth vivo,
dispositivo, huella privada y vencimiento. La función no recibe la cookie en
cada consulta RLS; por eso el contrato no equivale a enforcement global hasta
integrarlo y probarlo en todos sus consumidores.

**Límite vigente:** este slice valida server-side el dispositivo y su grant,
pero no transforma las policies tenant, Storage/Realtime ni todas las Edge
existentes en enforcement MFA uniforme. `get_session_mfa_status` es el contrato
propio autenticado para ese siguiente trabajo; no basta agregarlo sin conectar
los consumidores. El bootstrap OrgProvider precede al gate y debe conservar
un contrato mínimo antes de aplicar guards globales. RLS/Edge y step-up de
credenciales fiscales, pagos o acciones de Platform siguen en ROADMAP como
puerta pendiente: una protección de pantalla no demuestra esa garantía.

Verificación 2026-10-04: migración `20261004000100` aplicada, Edge desplegada,
smoke SQL con rollback y cero residuos; `scripts/test-trusted-device-live.mjs`
pasó contra Auth y Edge reales con un comprador ZZ confirmado sin correo:
TOTP → registro → logout → contraseña/nuevo SID AAL1 → grant, mismo vencimiento,
revocación y cambio de contraseña. El usuario temporal se eliminó y la lectura
posterior verificó limpieza. Ese drill sólo corre con aprobación explícita,
proyecto fijo y credenciales server-side por entorno; nunca imprime secretos.
Los tests de navegador con Auth interceptado acreditan UX, no entrega de correo.
Fuentes oficiales consultadas el 2026-10-04:
[MFA](https://supabase.com/docs/guides/auth/auth-mfa),
[sesiones](https://supabase.com/docs/guides/auth/sessions) y
[seguridad de acceso Shopify](https://help.shopify.com/en/manual/your-account/logging-in/secure-sign-in).

## Base de datos

### RLS

- Todas las tablas del esquema `public` tienen RLS.
- Una policy abierta sólo es válida para catálogos públicos documentados.
- Al 2026-09-04 las únicas excepciones son `plans`, `payment_providers` y
  `payment_provider_fees`: tres catálogos sin credenciales ni datos de tenant.
- `audit_policies_sin_tenant` y `audit_rpc_sin_permiso` deben devolver cero.

### Funciones privilegiadas

`SECURITY DEFINER` eleva permisos y exige uno de estos contratos:

- una guarda interna reconocible (`is_org_member`, `has_permission`, rol de
  plataforma o `exigir_permiso`);
- ejecución exclusiva de `service_role`;
- una excepción registrada en `security_function_contracts`.

El registro guarda nombre, firma, audiencia, motivo y hash del cuerpo. Si una
función pública cambia, `audit_funciones_expuestas` vuelve a mostrarla hasta
revisar el contrato. No se aceptan allowlists sin motivo o sin fecha.

Corte 2026-10-03: las 14 funciones pendientes se revisaron contra su definición
y ACL efectivas. `20261003000130` versiona sus contratos; el newsletter suma
rate limit, inserción concurrente idempotente y respuesta indistinguible para no
enumerar altas o bajas. La verificación vinculada exige cero filas en los cuatro
auditores críticos y mantiene sólo los tres catálogos públicos declarados. La
migración está aplicada y el escenario reversible pasó sin residuos.

`20261001000300` elimina cinco RPC legacy de portal/ingresos/retiros por token,
revoca ejecución web del helper interno de contratos y acceso anónimo a campañas.
Las funciones futuras creadas por `postgres` no reciben ejecución pública ni de
`anon`/`authenticated` por defecto. PostgreSQL exige revocar `PUBLIC` globalmente:
un REVOKE por esquema no resta ese privilegio global. No se modifican defaults
de roles administrados por Supabase; cada migración concede su audiencia explícita.

El portal canónico exige sesión; los enlaces antiguos descartan el token y
redirigen a `/portal-creador`. Los canjes requieren `influencer_id` y organización
coincidentes, email confirmado de Auth y perfil propio. La marca vincula el perfil
explícitamente con permisos `influencers.view/edit`; no se infiere por nombre.
RLS separa lectura, alta, edición y baja; el cliente no puede alterar identidad,
tenant ni evidencia de entrega directamente. Una publicación declarada no aprueba
el canje ni mueve dinero. `20261001_creator_portal_authority.sql` verifica roles,
aislamiento, contratos y retiros canónicos con rollback y cero residuos.

`audit_costo_expuesto` inspecciona además el tipo devuelto: usar costo para
calcular un precio público es válido; devolver una columna de costo no lo es.

### Autoridad del surtido

`store_product_publications` valida que tienda, producto, categoría y actor
pertenezcan al mismo tenant. Los miembros pueden leer; sólo owner, admin o
manager escriben. El navegador nunca modifica stock ni precio Core.

Carrito y checkout fijan el `store_id` dentro de wrappers públicos y llaman a
los resolutores internos. `resolve_store_line` y `normalize_store_cart_items`
no tienen ejecución para `anon` ni `authenticated`: así un precio visible u
ocultamiento por tienda se vuelve a comprobar antes de crear la orden. La
verificación C21.2 prueba Core sin contexto, aislamiento entre dos vitrinas y
precio autoritativo dentro de una transacción con rollback.

## Secretos y proveedores

- Mercado Pago, Mercado Libre y proveedores equivalentes usan OAuth cuando
  existe. El token nunca se pega ni vuelve al navegador.
- SMTP, WhatsApp, AFIP y claves de proveedores se leen desde un worker
  privilegiado. Un comercio sólo ve disponibilidad y remitente público.
- Las API keys públicas se emiten una vez, se almacenan como SHA-256 y tienen
  scopes mínimos.
- Logs, toasts, analytics y auditoría no registran tokens, contraseñas ni JWT.
- La rotación de un secreto invalida el anterior y deja evento de auditoría.

## Fraude y abuso

| Riesgo | Control |
|---|---|
| Precio o descuento manipulado | recálculo completo en PostgreSQL |
| Doble compra, cobro o recepción | idempotencia reservada después de validar |
| Pago falso | sólo webhook firmado o confirmación manual autorizada acredita |
| Enumeración de pedidos | token aleatorio o número + correo coincidente |
| Spam y scraping | rate limit por sujeto hasheado, sin almacenar PII cruda |
| Stock inventado | `record_stock_movement` como única autoridad |
| Escalada entre tenants | RLS + guarda de módulo/rol + pruebas de outsider |
| SSRF en webhooks | bloqueo de hosts locales, privados y metadata |
| Documento malicioso | storage privado, hash, MIME, tamaño, scanner y lease |
| Staff comprometido | MFA, rol mínimo, auditoría y sesiones revocables |

Los límites públicos deben considerar IP normalizada, token, comercio y ventana
temporal. Una validación fallida no puede reservar una clave de idempotencia.

## Aplicación y cadena de suministro

- CSP y headers reducen XSS, framing y filtración de referencias.
- Inputs se validan también en la base o Edge Function, con tamaño máximo.
- Dependencias entran con versión fija, revisión de licencia, mantenimiento,
  accesibilidad y costo de salida.
- `npm audit --audit-level=moderate` debe quedar en cero antes de publicar.
- El parser de planillas usa SheetJS 0.20.3 fijado por integridad; no se vuelve
  al paquete vulnerable del registro npm.
- Los buckets privados no generan URLs permanentes; usan autorización o links
  firmados de vida corta.
- El service worker no cachea REST privada ni archivos firmados. Sólo conserva
  medios de buckets públicos, chunks y shell. Al activarse elimina las cachés
  REST/Storage legacy antes de controlar pestañas; no reutiliza respuestas de
  otra sesión. El POS conserva sus snapshots y cola offline, no una caché REST
  común. Los tests con sesión sintética bloquean workers para interceptar toda
  petición y no enviar credenciales ficticias a proveedores reales.

## Verificación obligatoria

Antes de publicar un cambio de seguridad:

```bash
npm run check:functions
npm audit --audit-level=moderate
NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck
npm run lint
npm test
npm run build
npx supabase db push --linked --dry-run
```

Consultas de cierre:

```sql
select * from public.audit_funciones_expuestas;
select * from public.audit_costo_expuesto;
select * from public.audit_policies_sin_tenant;
select * from public.audit_rpc_sin_permiso;
select * from public.rls_audit_open_policies;
```

Las primeras cuatro deben estar vacías. La última debe contener exactamente los
tres catálogos públicos declarados arriba. La comprobación se ejecuta con los
roles `anon`, `authenticated` outsider, miembro y staff, no como superusuario.

## Respuesta a incidentes

1. Contener: revocar sesión, key, token o función afectada.
2. Preservar: guardar eventos, actor, tenant, ventana e ids sin secretos.
3. Medir: determinar datos y operaciones alcanzables, no sólo intentos.
4. Corregir: cerrar la autoridad en servidor y agregar una prueba regresiva.
5. Recuperar: rotar credenciales, reconciliar stock/plata y reintentar outbox.
6. Comunicar: informar con hechos, impacto y acciones según la obligación legal.
7. Aprender: actualizar este documento, el roadmap y la amenaza asociada.

## Definition of Done de seguridad

Una feature sensible no está terminada hasta demostrar:

- autenticación y autorización server-side;
- aislamiento entre dos organizaciones;
- validación, límites y errores observables;
- idempotencia o protección anti-replay cuando escribe;
- auditoría sin secretos;
- recuperación ante timeout o proveedor caído;
- tests unitarios, de integración y navegador según el riesgo.
