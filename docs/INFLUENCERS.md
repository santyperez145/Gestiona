# Influencers: alcance y verificación

**Corte:** 2026-10-01. Superficie propia en `/influencer-marketing`.
No está terminada la paridad funcional con GoMarz.

## Referencia contrastada

Fuente oficial: [GoMarz](https://www.go-marz.com/), consultada el 2026-09-21.
Su sitio anuncia briefs asistidos, selección de creadores, invitaciones, chat,
revisión de contenido, seguimiento y pagos sujetos a publicación. Son capacidades
publicadas; no se inspeccionó su aplicación autenticada. Nerqia conserva su marca,
componentes y autoridades de datos, sin copiar activos ni presentar una red ajena
de creadores como propia.

## Estado real

| Trabajo | Implementación | Pendiente |
|---|---|---|
| Navegación | Shell propio, entrada desde Business, rutas canónicas y redirects antiguos. | Barrido autenticado con usuarios finales. |
| Portal y canjes | `/portal-creador` con sesión y seis pestañas persistidas en URL. La marca vincula un perfil de su organización; el creador entrega evidencia HTTPS sin aprobarse ni mover dinero. Los errores de carga permiten reintentar, no simulan saldo cero. | Vincular explícitamente canjes históricos y certificar el recorrido con usuarios reales. |
| Creadores | Directorio transversal consentido, slug revocable, moderación superadmin, alta idempotente en la red de una marca, reputación y métricas verificadas. | Proveedor de verificación de identidad y OAuth directo con redes. |
| Campañas | Brief, presupuesto, selección, invitación privada con expiración, aceptación/rechazo, seguimiento y auditoría. | Certificación con marcas y creadores reales. |
| Entregables | Entrega y reentrega desde portal, archivos privados versionados (video, imagen o PDF), revisión de marca con URL firmada, chat por colaboración y prueba de publicación con licencia tipada. | Conectores sociales verificados y escaneo antimalware asíncrono. |
| Contratos | Versiones inmutables, aceptación de marca y creador por versión, evidencia temporal y acceso del creador por sesión o enlace limitado. | Proveedor de firma cualificada sólo si el marco legal/comercial lo exige. |
| Comisiones | Ventas y payouts son proyecciones de sólo lectura; destinos cifrados para Mercado Pago, CBU/CVU, alias u otra billetera; la transferencia confirmada con referencia genera atómicamente payout, gasto y asiento idempotentes en Finance. Una reversa comprobada conserva el pago y agrega payout/gasto negativos más contraasiento. | Conciliación bancaria certificada del proveedor externo. |
| Pagos automáticos | `Aprobar y pagar` crea un lote atómico e idempotente para una cuenta MP elegida; evita la liquidación manual paralela y conserva la clave original de lotes anteriores. Webhook y conciliación Finance siguen siendo la autoridad del pago. Ualá, Naranja X, Personal Pay y Prex son destinos externos identificables, no APIs de envío. `mp-payouts` permanece cerrado mientras no haya contrato global y autorización explícita de la organización en `MP_PAYOUTS_ALLOWED_ORGS`; nunca se simula una transferencia. | Contrato de proveedor/partner, habilitar secretos, certificación con cuenta real y comprobante de payout; después, un adaptador por otro proveedor con su propio contrato. |
| Mensajería y resultados | Chat, preferencias, publicación verificable y reportes sociales con revisión durable que alimentan reputación. | OAuth de redes y atribución externa certificada. |

Activar o cerrar una campaña es un cambio de seguimiento, no una invitación,
publicación, firma ni movimiento de dinero. El presupuesto no equivale a inversión
pagada. Registrar una revisión no demuestra que una red social haya publicado.

## Autoridades y seguridad

- `influencers` conserva identidad y referidos; Productos mantiene el catálogo.
- `influencer_campaigns`, sus asignaciones y eventos guardan planificación; no son
  publicaciones de `social_posts` ni generan un gasto en Finance.
- RPC transaccional, ID de creación reutilizable, control optimista por versión,
  relaciones por organización y auditoría de cambios de estado.
- Owner/admin con membresía y permisos `influencers.view/create/edit/delete`.
  Los overrides del módulo rigen también sobre el directorio anterior.
- Los canjes se relacionan por `influencer_id` y `org_id`, nunca por nombre o
  código de referido. La identidad del creador exige email confirmado de Auth
  coincidente con su perfil y el contacto de la marca. El vínculo se elige
  explícitamente; un nombre repetido no concede acceso. No se reasigna una
  entrega presentada ni se sobrescribe un canje cerrado desde el portal.
- `/portal-influencer/:token` sólo redirige al portal autenticado descartando
  el token. Ingresos y retiros no tienen RPC pública por token/UUID: se consultan
  con sesión y se solicitan con destino propio cifrado. Los canjes históricos
  sin vínculo permanecen sin asignar hasta una selección autorizada de la marca.
- La UI usa el mismo contexto de permisos que Business; no hay timer de acceso
  simulado ni llamada al entitlement Finance con una clave no soportada.
- La política MFA de la organización también se exige en esta superficie.
- Cache por organización, sin refresco al recuperar foco ni reutilizar datos de
  otro tenant. Errores visibles y recuperables, nunca falsos listados vacíos.
- Los destinos de cobro viven cifrados y en snapshots por retiro. El creador ve
  datos enmascarados; sólo la marca responsable puede revelar el destino al
  liquidar, y debe conservar una referencia de la operación.
- Aprobar o rechazar es autoridad humana; no mueve dinero. Sólo
  `settle_creator_withdrawal`, con referencia externa, confirma el pago. La marca
  y el sincronizador `service_role` usan la misma transición idempotente.
- Para Mercado Pago contratado, la marca puede enviar el retiro desde la misma
  bandeja. El servidor descifra exclusivamente el snapshot del retiro; nunca usa
  el email general del perfil. Un timeout queda `awaiting_confirmation` y sólo
  permite reenviar el mismo lote con la misma clave idempotente.
- Si la cuenta y el webhook están listos, la marca puede aprobar y preparar el
  envío en una sola acción. La RPC es atómica y una transferencia manual no puede
  cerrar el retiro mientras haya un lote incierto. La matriz reversible prueba
  ese bloqueo y siete escenarios con cero restos; no mueve dinero externo.
- Una devolución posterior no borra historia: `reverse_creator_withdrawal`
  exige referencia y motivo, devuelve el saldo con un payout negativo, compensa
  el gasto y contraasienta el libro. Marca y creador ven el estado `Revertido`.
- El perfil público parte desactivado. Publicarlo y aparecer en descubrimiento
  son consentimientos separados; ambos requieren moderación. Nunca expone email,
  teléfono, UUID, ingresos ni métricas autodeclaradas. Cambiar nombre, bio o
  redes reabre la revisión.

## Migraciones y evidencia

La inspección productiva encontró ausentes las tablas propuestas el 17/09.
`20260921000110` recupera su estructura sin inferir entregables desde canjes ni
duplicar pagos históricos. `influencer_payments` y `brand_portal_profiles` quedan
como compatibilidad de esquema; no son nuevas autoridades de la UI.

Las migraciones base son `20260921000100`, `20260921000110`,
`20260921000120` y `20260922000100_influencer_public_profile.sql`. Los contratos
bilaterales y su liquidación en Finance se consolidan en `20260925001500`,
`20260925001600` y las reparaciones de autoridad `20260925012100` a
`20260925012300`. `20260929000500` cierra la autoridad runtime del pago y
`npm run drill:creator-settlements` certifica el recorrido completo contra la
base enlazada, con rollback y cero restos. La verificación reversible
`supabase/verificaciones/20260921_influencer_campaigns.sql` cubre ciclo de campaña,
idempotencia, conflicto de edición, aislamiento, roles, overrides y aprobación con
evidencia; termina en rollback y comprueba cero organizaciones de prueba.
Tests UI: `accessInfluencerMarketing.test.tsx`,
`influencerCampaignsWorkflow.test.tsx`. La matriz certifica la autoridad interna
y la llegada a Finance; no certifica que un banco o billetera externa haya
movido dinero real.

`20261001000300_creator_portal_session_authority.sql` retira cinco RPC legacy,
endurece RLS/columnas de canjes y concede tres RPC autenticadas para lectura,
entrega y vínculo de marca. `20261001_creator_portal_authority.sql` prueba roles
web reales, dos tenants, nombres repetidos, FK de organización, reintentos,
validación, aceptación bilateral y destino de retiro propio; todo termina en
rollback. `creatorContextWorkflow`, `creatorExchangesWorkflow`,
`brandExchangeLinkWorkflow` y `creatorWithdrawalsWorkflow` cubren la UI.
`e2e/creator-portal.spec.ts` verifica desktop/móvil, accesibilidad, pestañas,
redirect sin token y fallas recuperables. Sus casos autenticados interceptan una
sesión sintética: no certifican login de usuarios reales ni transferencias externas.

## Siguiente secuencia

1. **Cerrado (2026-09-29):** perfiles públicos consentidos, descubrimiento y moderación superadmin.
2. **Cerrado (2026-09-29):** archivos audiovisuales privados de hasta 50 MB, versiones inmutables, SHA-256, acceso temporal sólo para las partes y retención mínima de 365 días.
3. Selección pública de publicaciones verificadas desde el portal y escaneo antimalware asíncrono.
4. OAuth social y atribución externa sobre la evidencia ya verificable.
5. Conciliación bancaria, reversas y comprobantes del proveedor externo.
6. Piloto con marca y creadores reales; certificar móvil, permisos y recuperaciones.
