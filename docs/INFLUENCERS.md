# Influencers: alcance y verificación

**Corte:** 2026-09-21. Superficie propia en `/influencer-marketing`.
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
| Creadores | Un directorio `influencers`, alta/edición/baja, permisos, enlaces de referido. | Perfil público consentido, verificación de identidad y métricas sociales verificadas. |
| Campañas | Brief manual, presupuesto previsto, canal, fecha, selección de creadores; guardar, pausar, activar y cerrar seguimiento interno. | Invitaciones con aceptación/rechazo y expiración, ofertas y contratación. |
| Entregables | Relación con campaña/creador, enlace HTTPS, entrega y aprobación interna con nota de revisión obligatoria. | Archivos privados, versionado audiovisual, comentarios y verificación de publicación. |
| Contratos | Registro interno de condiciones y vigencia. | Aceptación de ambas partes, firma con evidencia y derechos/licencias versionados. |
| Comisiones | Lectura de ventas atribuidas y pagos históricos desde `influencer_sales`/`influencer_payouts`. | Liquidación transaccional con comprobante y enlace a Finance, reversas y conciliación. |
| Pagos automáticos | No habilitados; no se marca un pago como transferido desde el cliente. | Proveedor/partner, webhook firmado, idempotencia, reembolsos y condiciones legales. |
| Mensajería y resultados | No se anuncian envíos inexistentes, CPM ni conversiones sin fuentes válidas. | Chat por colaboración, notificaciones consentidas y analítica con atribución verificable. |

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

Las migraciones nuevas son `20260921000100`, `20260921000110` y
`20260921000120`. La verificación reversible
`supabase/verificaciones/20260921_influencer_campaigns.sql` cubre ciclo de campaña,
idempotencia, conflicto de edición, aislamiento, roles, overrides y aprobación con
evidencia; termina en rollback y comprueba cero organizaciones de prueba.
Tests UI: `accessInfluencerMarketing.test.tsx`,
`influencerCampaignsWorkflow.test.tsx`. Los mocks de estos tests no certifican
entregas de correo, redes sociales ni transferencias reales.

## Siguiente secuencia

1. Invitación privada, oferta y aceptación con expiración e historial.
2. Chat y revisión audiovisual por colaboración, archivos privados y versiones.
3. Publicación verificable, derechos de uso y analítica consentida.
4. Obligación en Finance, liquidación, proveedor y conciliación: sin caja paralela.
5. Piloto con marca y creadores reales; certificar móvil, permisos y recuperaciones.
