-- ============================================================================
-- STRIPE PRICE IDs
-- Ejecutar DESPUÉS de crear los productos y precios en el dashboard de Stripe.
-- Reemplazá cada price_xxxx con el ID real de tu cuenta Stripe.
-- ============================================================================

-- Paso 1: En Stripe Dashboard (dashboard.stripe.com) creá los productos:
--   - Gestiona Starter  → Precio mensual $29/mes USD  → copiá el price ID
--   - Gestiona Starter  → Precio anual  $290/año USD  → copiá el price ID
--   - Gestiona Pro      → Precio mensual $79/mes USD  → copiá el price ID
--   - Gestiona Pro      → Precio anual  $790/año USD  → copiá el price ID
--   - Gestiona Business → Precio mensual $199/mes USD → copiá el price ID
--   - Gestiona Business → Precio anual  $1990/año USD → copiá el price ID

-- Paso 2: Reemplazá los valores de abajo y ejecutá este SQL en el SQL Editor de Supabase.

UPDATE public.plans SET
  stripe_price_id_monthly = 'price_STARTER_MONTHLY',   -- reemplazar
  stripe_price_id_yearly  = 'price_STARTER_YEARLY'     -- reemplazar
WHERE code = 'starter';

UPDATE public.plans SET
  stripe_price_id_monthly = 'price_PRO_MONTHLY',        -- reemplazar
  stripe_price_id_yearly  = 'price_PRO_YEARLY'          -- reemplazar
WHERE code = 'pro';

UPDATE public.plans SET
  stripe_price_id_monthly = 'price_BUSINESS_MONTHLY',   -- reemplazar
  stripe_price_id_yearly  = 'price_BUSINESS_YEARLY'     -- reemplazar
WHERE code = 'business';

-- El plan 'trial' no necesita price IDs (es gratis).

-- Paso 3: Deployar las Edge Functions:
--   supabase functions deploy create-checkout
--   supabase functions deploy stripe-webhook
--   supabase functions deploy cancel-subscription

-- Paso 4: Agregar secrets en Supabase:
--   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
--   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

-- Paso 5: Registrar el webhook en Stripe Dashboard:
--   URL: https://wkpzfriwtelbtvadloap.supabase.co/functions/v1/stripe-webhook
--   Eventos a escuchar:
--     checkout.session.completed
--     customer.subscription.created
--     customer.subscription.updated
--     customer.subscription.deleted
--     invoice.payment_failed
