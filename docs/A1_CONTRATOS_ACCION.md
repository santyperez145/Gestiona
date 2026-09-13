# Lote A1 — Contratos de acción (2026-09-12)

Estado: verificado en código + tests. No se inventa tracción ni rieles live.

## Contexto
Según `ROADMAP.md` §6 y `CONTRIBUTING.md` §4, el slice A1 requiere que cada CTA crítica tenga test reversible/sandbox y resultado observable. No es una lista de pantallas nuevas; es un contrato de accountability sobre las acciones que ya existen en Commerce/Business.

## Decisión (CEO/CTO/CFO/PM/PO/inversor)
- Commerce es la puerta; no abrir un octavo producto para compensar un contract gap.
- Elegir las CTAs que ya mueven dinero o stock: Checkout, Recuperación, Pago proveedor, Automate, Correo.
- Cada una se valida con: (a) autoridad server-side, (b) test reversible, (c) resultado observables, (d) sin inventar datos.

## Verificaciones en repositorio (estado actual)
- Checkout (`StoreCheckout.tsx`): idempotencia (`prepareStoreCheckoutAttempt`), recuperación entre pestañas (`readStoreCheckoutAttempt`), persistencia (`storeCheckoutPayloadFingerprint`), estados `creating_order/securing_order/opening_payment`. Tests `checkoutIdempotencia.test.ts`, `storeCheckoutFlow.test.tsx` cubren doble submit y recuperación con misma clave.
- Recuperación (`abandonedCarts` / `StoreCartRecovery`): email `rememberCartEmail`, `recovery_email_channel_ready` SQL, canal observable.
- Proveedor (`supplierPaymentAuthority`): `record_supplier_payment` bloquea deuda, valida tenant, impide sobrepago, clave idempotente. Test `supplierPaymentAuthority.test.ts`.
- Automate (`execute-automations` / `automationPreviewSafety`): flujo nace pausado, evalúa datos reales, muestra 5 ejemplos. Test `automationPreviewSafety.test.ts`.
- Correo (`emailDeliveryLifecycle`): contrato de entrega/rebote/queja, deduplicación, ledger firmado, seleccionado por propósito (Resend/SMTP/Google/Microsoft/Zoho). No usa fallback automático de credenciales.

## Gaps aún no cerrados (no se simulan como cerrados)
- Certificación live de pago aprobado/rechazado/timeout con MP OAuth real (gate externo, `ROADMAP.md` §4).
- Segundo comercio con primera venta sin SQL (`ROADMAP.md` §5.6).
- Finance real con proveedor privado de extracción (`ROADMAP.md` §5.7).
- Capital, Ship, multi-store: congelados (`ADR_002` §9).

## Resultado observable
- `npm test` confirma tests de checkout, recuperación, proveedor, automatización, correo.
- `npm run typecheck` y `npm run lint` verdes (0 errores, warnings conocidos).
- Push a `main` con evidencia de cada contrato, sin inventar tracción.

## Referencias
- `ROADMAP.md` §6 (próximos slices A1–A10).
- `CONTRIBUTING.md` §4 ( definición de resultado observable).
- `docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md` §3 (acción primaria cobalto, estados completos).
- `docs/ADR_002_COMMERCE_OPERATING_SYSTEM.md` §4 (módulo completo = punta a punta, no pantalla aislada).
