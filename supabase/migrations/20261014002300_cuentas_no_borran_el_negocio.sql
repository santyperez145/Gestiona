-- Borrar la cuenta de un usuario no puede borrar datos del negocio.
--
-- Medido el 2026-10-14: nueve tablas de negocio referían a auth.users con ON
-- DELETE CASCADE. Borrar la cuenta de quien cargó los datos (desde el panel de
-- Supabase o una futura «eliminar mi cuenta») se llevaba sus productos, ventas,
-- compras (y revertía el stock), deudas, negocios del CRM, ajustes del
-- negocio, comunicaciones con clientes, liquidaciones y publicaciones. Los
-- 11.518 productos de Famatina son todos de un mismo usuario.
--
-- Ahora es RESTRICT (los ajustes, SET NULL): si el usuario tiene registros del negocio, borrar la
-- cuenta se rechaza y hay que decidir qué pasa con esos datos (transferir o
-- borrar el negocio, que sí borra en cascada por org_id). Lo personal
-- (sesiones del asistente, avisos push, tutorial, perfil, roles) sigue
-- borrándose con la cuenta.
-- Idempotente.
BEGIN;

ALTER TABLE public.customer_communications DROP CONSTRAINT IF EXISTS customer_communications_user_id_fkey;
ALTER TABLE public.customer_communications ADD CONSTRAINT customer_communications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.customer_communications VALIDATE CONSTRAINT customer_communications_user_id_fkey;
ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_user_id_fkey;
ALTER TABLE public.deals ADD CONSTRAINT deals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.deals VALIDATE CONSTRAINT deals_user_id_fkey;
ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_user_id_fkey;
ALTER TABLE public.debts ADD CONSTRAINT debts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.debts VALIDATE CONSTRAINT debts_user_id_fkey;
ALTER TABLE public.marketing_posts DROP CONSTRAINT IF EXISTS marketing_posts_user_id_fkey;
ALTER TABLE public.marketing_posts ADD CONSTRAINT marketing_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.marketing_posts VALIDATE CONSTRAINT marketing_posts_user_id_fkey;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_user_id_fkey;
ALTER TABLE public.products ADD CONSTRAINT products_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.products VALIDATE CONSTRAINT products_user_id_fkey;
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_user_id_fkey;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.purchases VALIDATE CONSTRAINT purchases_user_id_fkey;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_user_id_fkey;
ALTER TABLE public.sales ADD CONSTRAINT sales_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.sales VALIDATE CONSTRAINT sales_user_id_fkey;
ALTER TABLE public.seller_payouts DROP CONSTRAINT IF EXISTS seller_payouts_user_id_fkey;
ALTER TABLE public.seller_payouts ADD CONSTRAINT seller_payouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.seller_payouts VALIDATE CONSTRAINT seller_payouts_user_id_fkey;
-- Los ajustes son del negocio (se leen por org_id) y cada alta crea los suyos:
-- con RESTRICT ninguna cuenta se podría borrar. Al borrar la cuenta quedan
-- sin autor, no se pierden.
ALTER TABLE public.settings ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_user_id_fkey;
ALTER TABLE public.settings ADD CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;
