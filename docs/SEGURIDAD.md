# Seguridad y prevención de fraude

**Estado:** canónico. **Corte:** 2026-09-04.

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
| Workers | `service_role` | una función y un propósito concretos |

Los tokens públicos son capacidades revocables y de alta entropía. No
reemplazan autenticación para stock, costo, pagos acreditados o configuración.

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

`audit_costo_expuesto` inspecciona además el tipo devuelto: usar costo para
calcular un precio público es válido; devolver una columna de costo no lo es.

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
