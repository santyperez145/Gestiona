-- Retenciones sufridas: lo que los clientes le retienen al comercio al pagarle.
--
-- Un agente de retención (empresas grandes, el Estado) le paga al comercio
-- menos y le entrega un certificado: la retención de IVA se descuenta del saldo
-- del mes; las de Ganancias e Ingresos Brutos, de esos impuestos. La posición de
-- IVA de Nerqia (20261021000100) decía «no incluye retenciones sufridas»
-- porque no había dónde registrarlas.
--
-- Una fila por certificado. Mismos permisos que los comprobantes de compra:
-- leen y cargan quienes editan compras o facturación. Idempotente.
-- Reversible: DROP TABLE public.retenciones_sufridas.
BEGIN;

CREATE TABLE IF NOT EXISTS public.retenciones_sufridas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  periodo text NOT NULL CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  fecha date NOT NULL,
  impuesto text NOT NULL CHECK (impuesto IN ('iva', 'ganancias', 'iibb', 'suss')),
  agente_cuit text NOT NULL CHECK (agente_cuit ~ '^[0-9]{11}$'),
  agente_nombre text NOT NULL CHECK (length(btrim(agente_nombre)) BETWEEN 1 AND 200),
  numero_certificado text NOT NULL CHECK (length(btrim(numero_certificado)) BETWEEN 1 AND 40),
  jurisdiccion text CHECK (jurisdiccion IS NULL OR length(jurisdiccion) <= 60),
  importe numeric(15,2) NOT NULL CHECK (importe > 0),
  notas text CHECK (notas IS NULL OR length(notas) <= 500),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retenciones_sufridas_unica UNIQUE (org_id, agente_cuit, impuesto, numero_certificado),
  CONSTRAINT retenciones_sufridas_periodo CHECK (periodo >= to_char(fecha, 'YYYY-MM'))
);

CREATE INDEX IF NOT EXISTS retenciones_sufridas_periodo_idx ON public.retenciones_sufridas (org_id, periodo, fecha);

COMMENT ON TABLE public.retenciones_sufridas IS
  'Certificados de retención que el comercio recibió de sus clientes (IVA, Ganancias, IIBB, SUSS). La de IVA resta en la posición del mes.';

ALTER TABLE public.retenciones_sufridas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS retenciones_sufridas_leer ON public.retenciones_sufridas;
CREATE POLICY retenciones_sufridas_leer ON public.retenciones_sufridas
  FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'purchases', 'edit') OR public.has_permission(org_id, 'invoices', 'edit'));

DROP POLICY IF EXISTS retenciones_sufridas_crear ON public.retenciones_sufridas;
CREATE POLICY retenciones_sufridas_crear ON public.retenciones_sufridas
  FOR INSERT TO authenticated
  WITH CHECK ((public.has_permission(org_id, 'purchases', 'edit') OR public.has_permission(org_id, 'invoices', 'edit'))
              AND created_by = auth.uid());

DROP POLICY IF EXISTS retenciones_sufridas_borrar ON public.retenciones_sufridas;
CREATE POLICY retenciones_sufridas_borrar ON public.retenciones_sufridas
  FOR DELETE TO authenticated
  USING (public.has_permission(org_id, 'purchases', 'delete') OR public.has_permission(org_id, 'invoices', 'delete'));

-- Sin UPDATE: un certificado mal cargado se borra y se vuelve a cargar.
REVOKE ALL ON public.retenciones_sufridas FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.retenciones_sufridas TO authenticated;
GRANT ALL ON public.retenciones_sufridas TO service_role;

COMMIT;
