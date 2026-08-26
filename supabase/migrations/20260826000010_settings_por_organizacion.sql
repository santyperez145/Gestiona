-- ═══════════════════════════════════════════════════════════════════════════
-- La configuración es del comercio, no del usuario
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido el 2026-08-25: **4 organizaciones, 2 filas de `settings`, 2
-- organizaciones sin ninguna**.
--
-- `settings.org_id` ya era NOT NULL y UNIQUE — el modelo estaba bien. Lo que
-- estaba de más era un índice **único sobre `user_id`**: obliga a una sola
-- configuración por usuario, así que un dueño con dos comercios no puede tener
-- configuración para el segundo. El INSERT falla con
-- `settings_user_id_key`, y el comercio queda sin fila.
--
-- ── Qué significa quedarse sin `settings` ──────────────────────────────────
--
-- No es cosmético. Sin esa fila:
--
--   `afip_tipo_emisor` NULL  → `trg_iva_de_orden` no sabe quién emite y la
--                              orden puede salir con IVA que no corresponde;
--   `exchange_rate` NULL     → el ledger asienta la venta **con costo cero**
--                              (ver 20260825000061) y el margen sale mejor de
--                              lo que es;
--   `tax_enabled`, umbrales, listas de precio, marca: todo en default o vacío.
--
-- ⚠️ **Y le pega de frente al segundo comercio**, que es la condición de salida
-- de la fase: `provision_platform_organization` crea la organización desde
-- `/platform`, y si el usuario que la recibe ya tenía otra, el alta se rompe
-- justo ahí.
--
-- ── Por qué el índice único no se puede simplemente dropear y listo ────────
--
-- Se verificó antes de tocarlo:
--
--   - Las políticas de RLS de `settings` filtran por **`org_id`**, no por
--     usuario: no dependen de la unicidad.
--   - Los tres lugares que insertan —`handle_new_user_create_org`,
--     `provision_platform_organization`, `seed_demo_data`— usan
--     `ON CONFLICT (org_id)`, no `(user_id)`. Dropearlo no rompe el alta.
--   - El cliente hace `upsert(..., { onConflict: 'org_id' })`.
--
-- Lo único atado a la unicidad es el **catálogo heredado** (`/catalogo/:userId`),
-- que lee por usuario con `.maybeSingle()`. Se ajusta del lado del cliente en
-- este mismo commit para que tome la más antigua en vez de fallar.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La configuración deja de ser por usuario ────────────────────────────

ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_user_id_key;
DROP INDEX IF EXISTS public.settings_user_id_key;

-- Se conserva un índice NO único: el catálogo heredado busca por ahí y sin
-- índice pasaría a recorrer la tabla entera.
CREATE INDEX IF NOT EXISTS settings_user_id_idx ON public.settings (user_id);

COMMENT ON COLUMN public.settings.user_id IS
  'Quien creo la configuracion. NO es la clave: la clave es org_id, que es UNIQUE. Un dueno con dos comercios tiene dos filas.';

-- ── 2. Ninguna organización puede quedar sin configuración ─────────────────
--
-- Tres funciones crean settings hoy y todas lo hacen bien. El problema es la
-- cuarta que aparezca: un camino nuevo que cree una organización y se olvide.
-- La invariante va en la base, no en la memoria de quien escribe el próximo.

CREATE OR REPLACE FUNCTION public.trg_organizacion_tiene_settings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  -- ⚠️ Sin dueño, o con un dueño que ya no existe en `auth.users`, este INSERT
  -- violaría `settings_user_id_fkey` y **haría fallar la creación de la
  -- organización**. Un trigger de conveniencia que rompe el alta es peor que el
  -- hueco que viene a tapar.
  --
  -- No es hipotético: al aplicar esta migración, dos organizaciones de prueba
  -- tenían `owner_user_id` apuntando a usuarios borrados, y el backfill falló
  -- exactamente ahí.
  IF NEW.owner_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.owner_user_id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.settings (org_id, user_id, business_name)
  VALUES (NEW.id, NEW.owner_user_id, NEW.name)
  ON CONFLICT (org_id) DO NOTHING;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_organizacion_tiene_settings ON public.organizations;
CREATE TRIGGER trg_organizacion_tiene_settings
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.trg_organizacion_tiene_settings();

-- ── 3. Y el alta sigue poniendo el nombre bueno ────────────────────────────
--
-- ⚠️ El trigger corre ANTES de que `handle_new_user_create_org` llegue a su
-- propio INSERT, así que con `ON CONFLICT (org_id) DO NOTHING` el
-- `business_name` del trigger —el nombre de la organización, "Santiago
-- Workspace"— ganaría sobre el que pone el alta —"Santiago"—. Pasa a
-- `DO UPDATE`: el trigger garantiza que la fila exista, el alta la afina.

CREATE OR REPLACE FUNCTION public.handle_new_user_create_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_org_id uuid;
  display_name text;
  trial_plan_id uuid;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'account_type', '') IN (
    'store_customer',
    'platform_invited_owner'
  ) THEN
    RETURN NEW;
  END IF;

  display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    'Mi Negocio'
  );

  SELECT id INTO trial_plan_id FROM public.plans WHERE code = 'trial' LIMIT 1;

  INSERT INTO public.organizations (name, slug, owner_user_id, plan_id, trial_ends_at)
  VALUES (
    display_name || ' Workspace',
    public.generate_org_slug(display_name),
    NEW.id,
    trial_plan_id,
    now() + interval '14 days'
  )
  RETURNING id INTO new_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  INSERT INTO public.subscriptions (org_id, plan_id, status, current_period_end)
  VALUES (new_org_id, trial_plan_id, 'trialing', now() + interval '14 days');

  -- ⚠️ DO UPDATE y no DO NOTHING.
  --
  -- Desde 20260826000010 hay un trigger en `organizations` que garantiza que
  -- ninguna organizacion quede sin `settings`. Ese trigger corre ANTES de
  -- llegar aca, con `business_name` = nombre de la organizacion ("Santiago
  -- Workspace"). Con DO NOTHING ese nombre ganaria sobre el que corresponde
  -- ("Santiago"). El trigger garantiza que la fila exista; el alta la afina.
  INSERT INTO public.settings (org_id, user_id, business_name)
  VALUES (new_org_id, NEW.id, display_name)
  ON CONFLICT (org_id) DO UPDATE
    SET business_name = EXCLUDED.business_name,
        user_id       = EXCLUDED.user_id;

  RETURN NEW;
END;
$function$
;

-- ── 4. Las que ya quedaron sin configuración ───────────────────────────────

-- El dueño de la organización si todavía existe; si no, cualquier miembro que
-- exista. `settings.user_id` es NOT NULL con FK a `auth.users`, así que una
-- organización cuyo dueño fue borrado y sin ningún miembro vivo no puede tener
-- configuración — y eso queda visible en `audit_org_sin_settings` en vez de
-- taparse.
INSERT INTO public.settings (org_id, user_id, business_name)
SELECT o.id, u.id, o.name
  FROM public.organizations o
  JOIN LATERAL (
    SELECT au.id
      FROM auth.users au
     WHERE au.id = o.owner_user_id
     UNION ALL
    SELECT m.user_id
      FROM public.memberships m
      JOIN auth.users au2 ON au2.id = m.user_id
     WHERE m.org_id = o.id
     ORDER BY 1
     LIMIT 1
  ) u ON true
 WHERE NOT EXISTS (SELECT 1 FROM public.settings s WHERE s.org_id = o.id)
ON CONFLICT (org_id) DO NOTHING;

-- ── 5. La guarda ───────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.audit_org_sin_settings AS
SELECT
  o.id AS org_id,
  o.name,
  o.created_at,
  -- El motivo, para no tener que averiguarlo cada vez.
  CASE
    WHEN o.owner_user_id IS NULL THEN 'sin dueno asignado'
    WHEN NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = o.owner_user_id)
      THEN 'el dueno fue borrado de auth.users'
    ELSE 'motivo desconocido: revisar'
  END AS motivo,
  (SELECT count(*) FROM public.memberships m
     JOIN auth.users au ON au.id = m.user_id
    WHERE m.org_id = o.id)::int AS miembros_vivos,
  (SELECT count(*) FROM public.sales v WHERE v.org_id = o.id)::int AS ventas
FROM public.organizations o
WHERE NOT EXISTS (SELECT 1 FROM public.settings s WHERE s.org_id = o.id);

COMMENT ON VIEW public.audit_org_sin_settings IS
  'Organizaciones sin fila en settings. Deberia estar VACIA: sin esa fila el IVA no sabe quien emite y el ledger asienta con costo cero.';

REVOKE ALL ON public.audit_org_sin_settings FROM anon, authenticated;
