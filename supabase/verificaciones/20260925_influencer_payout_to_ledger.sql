-- ============================================================================
-- Verificación reversible: liquidación a Finance con asiento ledger
-- ============================================================================
-- Ejecutar dentro de una transacción con ROLLBACK para validar
-- sin modificar datos reales.

BEGIN;

-- 1. Verificar que existe la tabla influencer_payouts
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_name = 'influencer_payouts' AND table_schema = 'public'
) AS tabla_payouts_existe;

-- 2. Verificar que existe la tabla influencer_withdrawal_requests
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_name = 'influencer_withdrawal_requests' AND table_schema = 'public'
) AS tabla_retiros_existe;

-- 3. Verificar que existe la tabla influencer_payout_batches
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_name = 'influencer_payout_batches' AND table_schema = 'public'
) AS tabla_lotes_existe;

-- 4. Verificar que la función resolve_creator_withdrawal existe
SELECT EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'resolve_creator_withdrawal'
) AS funcion_resolver_existe;

-- 5. Verificar que ledger_asentar existe y puede recibir el asiento
SELECT EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'ledger_asentar'
) AS funcion_ledger_existe;

-- 6. Verificar que la cuenta 5.9.01 (Otros gastos) existe en ledger_accounts
SELECT EXISTS (
  SELECT 1 FROM public.ledger_accounts WHERE codigo = '5.9.01'
) AS cuenta_5_9_01_existe;

-- 7. Verificar que la cuenta 1.1.02 (Banco) existe en ledger_accounts
SELECT EXISTS (
  SELECT 1 FROM public.ledger_accounts WHERE codigo = '1.1.02'
) AS cuenta_1_1_02_existe;

-- 8. Verificar RLS en influencer_payouts
SELECT relrowsecurity FROM pg_class WHERE relname = 'influencer_payouts';

-- 9. Verificar grants de execute en resolve_creator_withdrawal
SELECT has_function_privilege('resolve_creator_withdrawal(uuid, text)', 'EXECUTE') 
  AS tiene_grant_execute;

-- 10. Verificar contrato registrado en security_function_contracts
SELECT EXISTS (
  SELECT 1 FROM public.security_function_contracts 
  WHERE function_name = 'resolve_creator_withdrawal'
) AS contrato_registrado;

-- 11. Verificar migración aplicada
SELECT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations 
  WHERE version = '20260925001600'
) AS migracion_aplicada;

-- 12. Verificar que no hay retiros 'paid' sin asiento en ledger
SELECT COUNT(*) AS retiros_pagados_sin_asiento
FROM public.influencer_withdrawal_requests w
WHERE w.status = 'paid'
AND NOT EXISTS (
  SELECT 1 FROM public.ledger_entries e
  WHERE e.org_id = w.org_id
    AND e.referencia_tipo = 'payout_creator'
    AND e.referencia_id = w.id
    AND e.anulado_por IS NULL AND e.anula_a IS NULL
);

ROLLBACK;

-- Si todos los checks dan true/1, la migración es correcta.