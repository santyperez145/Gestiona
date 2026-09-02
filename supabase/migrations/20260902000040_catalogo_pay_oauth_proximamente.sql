-- ═══════════════════════════════════════════════════════════════════════════
-- Catálogo Pay: copy alineado a Gestiona Pay ≠ Mercado Pago
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Slice B: el comercio ve medios OAuth vivos / próximamente como Tiendanube.
-- No se inventa un segundo OAuth. Se alinea el catálogo con Slice A:
-- Gestiona Pay = producto; Mercado Pago = rail.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.payment_providers
   SET nombre = 'Gestiona Pay',
       nombre_publico = 'Gestiona Pay',
       integracion = 'produccion',
       descripcion = 'Producto de cobro de Gestiona (modelo Pago Nube). En Argentina el procesamiento corre por Mercado Pago: autorizás tu cuenta y el dinero entra ahí. Gestiona orquesta checkout, conciliación y comisión.'
 WHERE codigo = 'gestionapay';

UPDATE public.payment_providers
   SET descripcion = 'Rail de procesamiento de Gestiona Pay. Se activa al conectar Gestiona Pay; no es un medio aparte en la tienda.'
 WHERE codigo = 'mercadopago';

UPDATE public.payment_providers
   SET descripcion = 'Pagos con la app de los bancos. Próximamente: conexión por OAuth cuando haya contrato. Hoy no cobra.'
 WHERE codigo = 'modo';

UPDATE public.payment_providers
   SET descripcion = 'Tarjeta Naranja y cuotas. Próximamente: conexión por OAuth cuando haya contrato. Hoy no cobra.'
 WHERE codigo = 'naranjax';

UPDATE public.payment_providers
   SET descripcion = 'Cuotas con débito. Próximamente: conexión por OAuth cuando haya contrato. Hoy no cobra.'
 WHERE codigo = 'gocuotas';

-- El catálogo del panel lo lee el comercio autenticado. Anon no necesita EXECUTE.
REVOKE ALL ON FUNCTION public.medios_de_pago_de(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.medios_de_pago_de(uuid) TO authenticated;

DO $$
DECLARE
  v_nombre text;
  v_integ text;
BEGIN
  SELECT nombre_publico, integracion INTO v_nombre, v_integ
    FROM public.payment_providers WHERE codigo = 'gestionapay';
  IF v_nombre IS DISTINCT FROM 'Gestiona Pay' OR v_integ IS DISTINCT FROM 'produccion' THEN
    RAISE EXCEPTION 'gestionapay no quedó alineado a Gestiona Pay / produccion';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_providers
     WHERE codigo = 'modo' AND integracion = 'declarado'
  ) THEN
    RAISE EXCEPTION 'modo tiene que seguir declarado (próximamente)';
  END IF;
END $$;
