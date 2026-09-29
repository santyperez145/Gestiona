-- La firma anterior guardaba datos bancarios en notes. Ya no debe convivir con
-- la version estructurada porque un parametro DEFAULT volveria ambiguas las RPC.
DROP FUNCTION IF EXISTS public.creator_request_withdrawal(numeric, text);

DELETE FROM public.security_function_contracts
WHERE function_name = 'creator_request_withdrawal'
  AND identity_arguments = 'p_amount_ars numeric, p_notes text';
