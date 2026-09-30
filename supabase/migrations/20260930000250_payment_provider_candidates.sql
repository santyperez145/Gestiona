-- Proveedores de cobro con API documentada. El catálogo no implica una
-- conexión operativa: el orquestador excluye `integracion = 'declarado'`.
BEGIN;

ALTER TABLE public.payment_providers
  DROP CONSTRAINT IF EXISTS payment_providers_conexion_valida;
ALTER TABLE public.payment_providers
  ADD CONSTRAINT payment_providers_conexion_valida
  CHECK (conexion IN ('oauth', 'ninguna', 'plataforma', 'contrato'));

INSERT INTO public.payment_providers (
  codigo, nombre, nombre_publico, metodos, monedas, soporta_split,
  soporta_cuotas, conexion, integracion, descripcion, pais, orden
) VALUES
  ('ualabis', 'Ualá Bis', 'Ualá Bis', ARRAY['tarjeta'], ARRAY['ARS'],
   false, false, 'contrato', 'declarado',
   'API de cobros online. Requiere credenciales comerciales e integración certificada; hoy no procesa pagos desde Nerqia.', 'AR', 35),
  ('payway', 'Payway', 'Payway', ARRAY['tarjeta'], ARRAY['ARS'],
   false, false, 'contrato', 'declarado',
   'Adquirencia y APIs para comercios. Requiere acuerdo, credenciales e integración certificada; hoy no procesa pagos desde Nerqia.', 'AR', 45),
  ('dlocal', 'dLocal', 'dLocal', ARRAY['tarjeta'], ARRAY['ARS'],
   false, false, 'contrato', 'declarado',
   'Pasarela con cobertura en Argentina. Requiere contrato y adaptador certificado; hoy no procesa pagos desde Nerqia.', 'AR', 55)
ON CONFLICT (codigo) DO UPDATE SET
  nombre_publico = EXCLUDED.nombre_publico,
  descripcion = EXCLUDED.descripcion,
  conexion = EXCLUDED.conexion,
  integracion = EXCLUDED.integracion,
  orden = EXCLUDED.orden;

COMMIT;
