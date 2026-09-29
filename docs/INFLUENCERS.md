# Influencers: alcance y verificación

**Corte:** 2026-09-29. Superficie propia en `/influencer-marketing`.
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
| Creadores | Directorio, permisos, referidos, reputación batch y métricas verificadas por evidencia desde el portal. | Perfil público consentido, verificación de identidad y OAuth directo con redes. |
| Campañas | Brief, presupuesto, selección, invitación privada con expiración, aceptación/rechazo, seguimiento y auditoría. | Certificación con marcas y creadores reales. |
| Entregables | Entrega y reentrega desde portal, revisión de marca, chat por colaboración y prueba de publicación con licencia tipada. | Archivos audiovisuales privados y conectores sociales verificados. |
| Contratos | Versiones inmutables, aceptación de marca y creador por versión, evidencia temporal y acceso del creador por sesión o enlace limitado. | Proveedor de firma cualificada sólo si el marco legal/comercial lo exige. |
| Comisiones | Ventas y payouts históricos; un retiro aprobado genera payout y gasto idempotente en el libro Finance. | Reversas y conciliación bancaria certificada del proveedor externo. |
| Pagos automáticos | No habilitados; no se marca un pago como transferido desde el cliente. | Proveedor/partner, webhook firmado, idempotencia, reembolsos y condiciones legales. |
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
- La UI usa el mismo contexto de permisos que Business; no hay timer de acceso
  simulado ni llamada al entitlement Finance con una clave no soportada.
- La política MFA de la organización también se exige en esta superficie.
- Cache por organización, sin refresco al recuperar foco ni reutilizar datos de
  otro tenant. Errores visibles y recuperables, nunca falsos listados vacíos.

## Migraciones y evidencia

La inspección productiva encontró ausentes las tablas propuestas el 17/09.
`20260921000110` recupera su estructura sin inferir entregables desde canjes ni
duplicar pagos históricos. `influencer_payments` y `brand_portal_profiles` quedan
como compatibilidad de esquema; no son nuevas autoridades de la UI.

Las migraciones base son `20260921000100`, `20260921000110`,
`20260921000120` y `20260922000100_influencer_public_profile.sql`. Los contratos
bilaterales y su liquidación en Finance se consolidan en `20260925001500`,
`20260925001600` y las reparaciones de autoridad `20260925012100` a
`20260925012300`. La verificación reversible
`supabase/verificaciones/20260921_influencer_campaigns.sql` cubre ciclo de campaña,
idempotencia, conflicto de edición, aislamiento, roles, overrides y aprobación con
evidencia; termina en rollback y comprueba cero organizaciones de prueba.
Tests UI: `accessInfluencerMarketing.test.tsx`,
`influencerCampaignsWorkflow.test.tsx`. Los mocks de estos tests no certifican
entregas de correo, redes sociales ni transferencias reales.

## Siguiente secuencia

1. Perfiles públicos consentidos, descubrimiento y moderación superadmin.
2. Archivos audiovisuales privados con versiones y retención definida.
3. OAuth social y atribución externa sobre la evidencia ya verificable.
4. Conciliación bancaria, reversas y comprobantes del proveedor externo.
5. Piloto con marca y creadores reales; certificar móvil, permisos y recuperaciones.
