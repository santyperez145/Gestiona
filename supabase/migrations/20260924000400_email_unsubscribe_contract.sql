-- El RPC de baja uno-clic quedó sin contrato al fusionar el lote C28.1:
-- la vista de auditoría lo marcaba como expuesto. Es legítimamente anónimo
-- (el enlace llega por mail), así que se registra como public_token.
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT
  'process_email_campaign_unsubscribe', 'p_token text, p_user_agent text, p_ip inet', 'public_token',
  'Baja uno-clic desde el enlace del mail: el token aleatorio es la credencial.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-24'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'process_email_campaign_unsubscribe'
  AND pg_get_function_identity_arguments(procedure.oid) = 'p_token text, p_user_agent text, p_ip inet'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260924000400', 'email_unsubscribe_contract')
ON CONFLICT DO NOTHING;