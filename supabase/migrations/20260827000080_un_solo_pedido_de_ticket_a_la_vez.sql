-- El Ticket de Acceso se pide de a uno, aunque haya cien comercios
--
-- ── El problema que aparece con el segundo comercio ───────────────────────
--
-- En modo delegado todos los comercios facturan con el MISMO certificado, y
-- WSAA entrega el Ticket de Acceso por (certificado, servicio): **rechaza el
-- pedido siguiente mientras el anterior siga vivo**, con
-- `coe.alreadyAuthenticated`, y no da otro hasta que venza (~12 h).
--
-- `afipCredenciales.ts` ya resolvió DÓNDE guardarlo —uno solo, en la fila de la
-- plataforma— pero no la carrera: si dos comercios verifican o facturan al
-- mismo tiempo y todavía no hay ticket, los dos ven «no hay» y los dos le
-- piden uno a ARCA. El segundo recibe el rechazo y queda medio día sin poder
-- facturar, con un mensaje que suena a problema suyo.
--
-- ⚠️ **Con una sola organización esto no se puede reproducir**, y por eso no
-- apareció hasta ahora. Es exactamente la clase de bug que el segundo comercio
-- destapa el primer día — y el segundo comercio es P0-10.
--
-- ── Por qué una tabla de lease y no un advisory lock ──────────────────────
--
-- `pg_advisory_xact_lock` vive en una transacción, y las Edge Functions hablan
-- por PostgREST: cada llamada es su propia transacción y el lock se soltaría
-- antes de que WSAA conteste. Un lease con vencimiento sobrevive a eso y se
-- libera solo si el proceso muere en el medio.
--
-- Es el mismo patrón que ya usa `afip_authorization_locks` para no pedir dos
-- CAE del mismo comprobante.

CREATE TABLE IF NOT EXISTS public.afip_ta_leases (
  clave      text PRIMARY KEY,
  tomado_at  timestamptz NOT NULL DEFAULT now(),
  expira_at  timestamptz NOT NULL
);

COMMENT ON TABLE public.afip_ta_leases IS
  'Permiso de corta duración para pedirle un Ticket de Acceso a WSAA. El '
  'certificado es uno solo para todos los comercios delegados y ARCA no '
  'entrega dos tickets vivos: sin esto, dos comercios simultáneos dejan al '
  'segundo ~12 h sin poder facturar.';

ALTER TABLE public.afip_ta_leases ENABLE ROW LEVEL SECURITY;
-- Cero policies a propósito: sólo la tocan las Edge Functions con
-- `service_role`. No hay nada acá que una pantalla deba leer.

/**
 * Pide permiso para ir a buscar el ticket. Devuelve `true` sólo al que gana.
 *
 * Un lease vencido se puede robar: si el proceso que lo tomó se murió antes de
 * liberarlo, nadie más podría pedir el ticket nunca.
 */
CREATE OR REPLACE FUNCTION public.afip_ta_lease_tomar(
  p_clave text, p_segundos int DEFAULT 45)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.afip_ta_leases (clave, expira_at)
  VALUES (p_clave, now() + make_interval(secs => GREATEST(p_segundos, 5)))
  ON CONFLICT (clave) DO UPDATE
     SET tomado_at = now(),
         expira_at = EXCLUDED.expira_at
   WHERE public.afip_ta_leases.expira_at < now()
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION public.afip_ta_lease_soltar(p_clave text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.afip_ta_leases WHERE clave = p_clave;
$$;

REVOKE ALL ON FUNCTION public.afip_ta_lease_tomar(text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.afip_ta_lease_soltar(text)     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_ta_lease_tomar(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.afip_ta_lease_soltar(text)     TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_a boolean; v_b boolean; v_c boolean;
BEGIN
  PERFORM public.afip_ta_lease_soltar('ZZ:verif');

  -- ── a. El primero gana ──────────────────────────────────────────────────
  v_a := public.afip_ta_lease_tomar('ZZ:verif', 60);
  ASSERT COALESCE(v_a, false), 'el primero no pudo tomar el lease';

  -- ── b. El segundo NO ────────────────────────────────────────────────────
  v_b := public.afip_ta_lease_tomar('ZZ:verif', 60);
  ASSERT NOT COALESCE(v_b, false),
    'el segundo tambien tomo el lease: dos comercios pedirian ticket a la vez';

  -- ── c. ⚠️ Pero un lease vencido se puede robar ──────────────────────────
  -- Sin esto, un proceso que muere en el medio deja el certificado bloqueado
  -- para siempre — y una guarda que nunca suelta es peor que no tenerla.
  UPDATE public.afip_ta_leases SET expira_at = now() - interval '1 second'
   WHERE clave = 'ZZ:verif';
  v_c := public.afip_ta_lease_tomar('ZZ:verif', 60);
  ASSERT COALESCE(v_c, false), 'un lease vencido no se pudo robar: quedaria trabado para siempre';

  -- ── d. Sin restos ───────────────────────────────────────────────────────
  PERFORM public.afip_ta_lease_soltar('ZZ:verif');
  ASSERT NOT EXISTS (SELECT 1 FROM public.afip_ta_leases WHERE clave = 'ZZ:verif'),
    'quedo el lease ZZ sin soltar';

  RAISE NOTICE 'OK: uno gana, el otro no, el vencido se roba, sin restos';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000080', 'un_solo_pedido_de_ticket_a_la_vez')
ON CONFLICT DO NOTHING;
