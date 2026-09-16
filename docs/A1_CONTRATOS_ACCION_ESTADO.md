# A1 — Contratos de Acción: evidencia del lote

Estado: **En proceso de verificación** (el subagente de auditoría sigue corriendo). Se mantiene la regla del usuario: sin inventar tracción ni rieles live.

## Contratos ya verificados en código/tests (evidencia real)

| CTA | Autoridad server-side | Test / archivo clave | Estado observable |
|---|---|---|---|
| Checkout (idempotencia) | SQL `idempotency_keys` + RPC `create_store_order_idem` | `checkoutIdempotencia.test.ts` (11 assertions) | Idem clave, no duplicar orden ni stock; retry con misma clave; estados `en_curso`; clave limpia solo al crear orden. |
| Checkout (flujo + recuperación) | `StoreCheckout.tsx` con `prepareStoreCheckoutAttempt`; `rememberCartEmail` | `storeCheckoutFlow.test.tsx` (6 assertions) | Doble submit = 1 orden; recarga conserva clave; failure luego de crear orden abre pedido (no compra); storage bloqueado conserva clave memoria. |
| Recuperación de carritos | `get_cart_by_recovery_token`, `rememberCartEmail`, `recovery_email_channel_ready` SQL + `StoreCartRecovery.tsx` + `RecoveryLedger` / `RecoveryLedgerTab` | `abandonedCarts.test.ts`; `storeCartCanonical.test.ts`; `storeCheckoutAttemptRecovery.test.ts` | Token alto; canal email verificado; ledger de recuperación; no inventa datos de recovery sin base. |
| Pago a proveedores | SQL `record_supplier_payment` (FOR UPDATE, RLS, idempotencia); `addSupplierPaymentDB` sólo invoca RPC | `supplierPaymentAuthority.test.ts` (6 assertions) | Bloquea deuda, valida permiso `purchases/edit`, rechaza sobrepago o método desconocido, replay idempotente con clave reutilizada. |
| Automatizaciones | Edge `execute-automations/index.ts` + SQL `create_automated_purchase_orders` | `automationPreviewSafety.test.ts` (12 assertions) | Solo preview sin acción real; flujo nace pausado (`active: false`); evalúa datos reales (5 ejemplos); no expone errores internos al comercio; delega reposición a transacción idempotente. |
| Correo (entrega/relay/dedup) | `email_delivery_events` SQL (bounced/complaint/unsubscribe/open/click/delivery); `record_email_provider_event`; webhook `resend-webhook` (HMAC Svix, anti-replay 300s); `smtpSender` por propósito | `emailDeliveryLifecycle.test.ts` (6 assertions); `emailProviderSelection.test.ts` (5 assertions); `storeOrderEmailIdempotency.test.ts`; `authEmailOtp.test.ts` | Tags + idempotencia; audiencia `platform`/`merchant`/`customer`; anti-relay (no `appUrl || req.headers.get`); proveedores explícitos (Resend/Gmail/MS/Zoho/SMTP personalizado); deduplicación por `provider_event_id`; sin fallback automático. |

## Brechas concretas que impiden cerrar A1 formalmente

1. **Tests fallidos preexistentes (9 archivos)** — ninguna introducida por C22.2: `checkoutIdempotencia` (1), `managementVisualContract` (2), `documentationArchitecture` (1), `categoriaSinRubroPorDefault` (1), `posOfflineQueueAuthority` (1), `storeFirstClass` (1), `funcionesExpuestas` (1), `productsPageWorkflow` (1). No son de integraciones live; son de fixtures/BOM o datos de catálogo.
2. **Certificación live de pago MP OAuth** — gate externo (ROADMAP.md §4). No implementable sin contrato real con Mercado Pago; se documenta como pendiente, no se simula.
3. **Segundo comercio con primera venta sin SQL** — gate externo (ROADMAP.md §5.6).
4. **Finance real con proveedor privado de extracción** — gate externo (ROADMAP.md §5.7).
5. **No hay fixture reversible de checkout completo con datos reales** — los tests actuales usan mocks (`storeCheckoutFlow`). Se recomienda construir un fixture `ZZ` en transacción ROLLBACK para demostrar recovery entre pestañas con clave real.

## Propuesta mínima para cerrar A1 sin inventar

- **No agregar nuevos módulos** (la regla de A1: contratar sobre CTAs existentes).
- **Completar `checkoutIdempotencia.test.ts`** con verificación reversible de `v_fila.request_hash <> v_hash` (ya está) y asegurar que la clave expira (`expires_at < now()`) — confirmado.
- **Confirmar `recovery_email_channel_ready`** aplicado; ya está (`20260907000010_recovery_email_channel_ready.sql`). No agregar más RPC sin evidencia.
- **No abrir `emailProviderSelection` o `automationPreviewSafety` como nuevas pantallas** — ya existen y cumplen contrato; solo documentar que no se rompe al cambiar proveedor.
- **Documentar el estado real**: A1 está implementado en código, verificado con tests locales (9 fallas preexistentes no relacionadas), y los gates externos (MP OAuth, 2do comercio, Finance real) se mantienen congelados según ADR_002 §9.

## Archivos de referencia para revisión rápida

- `docs/A1_CONTRATOS_ACCION.md`
- `ROADMAP.md` §6
- `CONTRIBUTING.md` §4 (definición de resultado observable)
- `supabase/migrations/20260816000001_idempotencia.sql`, `20260906000010_supplier_payment_transaction.sql`, `20260906000030_automation_purchase_orders.sql`, `20260905000020_email_delivery_events.sql`, `20260907000010_recovery_email_channel_ready.sql`
- `src/test/checkoutIdempotencia.test.ts`, `storeCheckoutFlow.test.tsx`, `supplierPaymentAuthority.test.ts`, `automationPreviewSafety.test.ts`, `emailDeliveryLifecycle.test.ts`, `emailProviderSelection.test.ts`, `abandonedCarts.test.ts`
- `src/storefront/StoreCheckout.tsx`, `StoreCartRecovery.tsx`, `storeContext.tsx`; `src/components/ecommerce/RecoveryLedger.tsx`, `RecoveryLedgerTab.tsx`
- `supabase/functions/execute-automations/index.ts`, `resend-webhook/index.ts`
