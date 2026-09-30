-- Los datos bancarios, retiros y movimientos requieren finance.view, no solo
-- pertenecer a la organizacion. Las vistas ejecutan con permisos del invocador.

BEGIN;

DROP POLICY IF EXISTS wallet_withdrawals_lectura ON public.wallet_withdrawals;
DROP POLICY IF EXISTS wallet_withdrawals_read ON public.wallet_withdrawals;
CREATE POLICY wallet_withdrawals_read ON public.wallet_withdrawals
  FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'finance', 'view'));

CREATE OR REPLACE VIEW public.wallet_movimientos
WITH (security_invoker = true) AS
SELECT
  line.id,
  line.org_id,
  entry.fecha,
  entry.numero AS asiento,
  entry.descripcion,
  entry.referencia_tipo,
  entry.referencia_id,
  account.codigo AS cuenta,
  CASE account.codigo WHEN '1.1.03' THEN 'pendiente' ELSE 'disponible' END AS bolsillo,
  CASE WHEN line.debe > 0 THEN 'entrada' ELSE 'salida' END AS direccion,
  greatest(line.debe, line.haber) AS monto,
  line.debe - line.haber AS delta,
  line.descripcion AS detalle,
  entry.created_at
FROM public.ledger_lines line
JOIN public.ledger_accounts account ON account.id = line.account_id
JOIN public.ledger_entries entry ON entry.id = line.entry_id
WHERE account.codigo IN ('1.1.03', '1.1.04')
  AND public.has_permission(line.org_id, 'finance', 'view');

CREATE OR REPLACE VIEW public.wallet_auditoria
WITH (security_invoker = true) AS
SELECT
  wallet.org_id,
  (public.wallet_saldo(wallet.org_id)->>'disponible')::numeric AS saldo_disponible,
  COALESCE(sum(CASE WHEN account.codigo = '1.1.04' THEN line.debe - line.haber ELSE 0 END), 0) AS segun_el_libro,
  (public.wallet_saldo(wallet.org_id)->>'disponible')::numeric
    - COALESCE(sum(CASE WHEN account.codigo = '1.1.04' THEN line.debe - line.haber ELSE 0 END), 0) AS diferencia
FROM (SELECT DISTINCT org_id FROM public.ledger_lines) wallet
LEFT JOIN public.ledger_lines line ON line.org_id = wallet.org_id
LEFT JOIN public.ledger_accounts account ON account.id = line.account_id
WHERE public.has_permission(wallet.org_id, 'finance', 'view')
GROUP BY wallet.org_id;

REVOKE ALL ON public.wallet_movimientos, public.wallet_auditoria FROM PUBLIC, anon;
GRANT SELECT ON public.wallet_movimientos, public.wallet_auditoria TO authenticated;

COMMIT;
