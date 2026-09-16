# C20 — Estados de Checkout

Estado: **En progreso** (post-A1, pre-certificación live).

Según `ROADMAP.md` §6 y `CONTRIBUTING.md` §4, C20 requiere:
- Intento persistido (idempotencia de clave)
- Recuperación de lectura/pago desde el pedido
- Aislamiento al navegar y refresco digital secuencial acotado
- Certificación de concurrencia con claves distintas (pendiente según `checkoutIdempotencia.test.ts`)

## Contratos ya verificados (evidencia real del repo)

- `StoreCheckout.tsx`: `claveIdem = useRef`, `prepareStoreCheckoutAttempt`, `persistedAttempt?.idempotencyKey`
- `checkoutIdempotencia.test.ts`: clave limpia solo cuando orden creada; retry con misma clave; `v_fila.request_hash <> v_hash`; `expires_at`; RLS sin policies
- `storeCheckoutFlow.test.tsx`: recuperación entre pestañas; clave mantenida; failure luego de crear orden abre pedido; storage bloqueado mantiene clave memoria
- SQL `idempotency_keys`: `PRIMARY KEY (org_id, operacion, clave)`; `en_curso`; `idempotencia_fallar`; `expires_at`

## Brechas para cerrar C20 (sin inventar)

1. **Concurrencia con claves distintas** — `checkoutIdempotencia.test.ts` lo marca como pendiente (`C20 pendiente: certificar concurrencia con claves distintas`). No se inventa evidencia; se documenta como pendiente hasta ejecutar con datos reales.
2. **Refresco digital secuencial acotado** — no verificado con fixture reversible.
3. **Recuperación completa entre pestañas con clave distinta** — `storeCheckoutFlow` cubre misma clave; falta distinta.

## Propuesta mínima para C20 (sin inventar integraciones live)

- Confirmar que `idempotency_keys` tiene `PRIMARY KEY (org_id, operacion, clave)` (ya está)
- Confirmar que `prepareStoreCheckoutAttempt` conserva clave entre recargas (ya está, `storeCheckoutFlow` l. 85-95)
- Documentar la brecha de concurrencia con claves distintas como pendiente (no simular éxito)
- No agregar nuevos módulos; C20 es verificación de contrato existente, no feature factory

## Referencias

- `docs/A1_CONTRATOS_ACCION.md`
- `docs/ROADMAP.md` §6 (C20)
- `src/storefront/StoreCheckout.tsx`
- `src/test/checkoutIdempotencia.test.ts`
- `supabase/migrations/20260816000001_idempotencia.sql`
