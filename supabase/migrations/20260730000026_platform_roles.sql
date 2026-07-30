-- ─────────────────────────────────────────────────────────────────
-- Separación de superficies: admin DE LA PLATAFORMA vs admin DE LA ORG
--
-- Hasta ahora `platform_admins` era un booleano: o tenías todo el poder
-- sobre toda la plataforma, o nada. Y peor: el front trataba a un
-- platform_admin como si fuera admin de la organización activa, mezclando
-- las dos superficies.
--
-- Esta migración:
--   1. Le da NIVELES al staff de plataforma (superadmin / support / finance).
--   2. Expone `platform_role()` para que RLS y Edge Functions decidan por nivel.
--   3. Amplía los módulos de permisos por rol de organización con los
--      dominios nuevos (ecommerce, envíos, cobros).
-- ─────────────────────────────────────────────────────────────────

-- ── 1. Niveles de staff de plataforma ────────────────────────────
ALTER TABLE public.platform_admins
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'superadmin',
  ADD COLUMN IF NOT EXISTS notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_admins_role_check'
  ) THEN
    ALTER TABLE public.platform_admins
      ADD CONSTRAINT platform_admins_role_check
      CHECK (role IN ('superadmin', 'support', 'finance'));
  END IF;
END $$;

COMMENT ON COLUMN public.platform_admins.role IS
  'superadmin: todo. support: ver orgs/usuarios y asistir, sin tocar planes ni borrar. finance: planes, comisiones y facturación.';

-- ── 2. Nivel de plataforma consultable desde RLS / Edge Functions ─
CREATE OR REPLACE FUNCTION public.platform_role(_user_id uuid DEFAULT auth.uid())
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.platform_admins WHERE user_id = _user_id
$$;

-- True si el usuario es staff de plataforma con al menos uno de los roles dados.
-- `superadmin` satisface cualquier requerimiento.
CREATE OR REPLACE FUNCTION public.has_platform_role(_roles text[], _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = _user_id
      AND (role = 'superadmin' OR role = ANY(_roles))
  )
$$;

-- ── 3. Módulos nuevos en la matriz de permisos por rol de org ─────
-- `seed_default_permissions` se ejecuta al crear una org (trigger de
-- 20260529000007). Se agregan los dominios que aparecieron después:
-- ecommerce, envíos, cobros/comisiones e influencers.
CREATE OR REPLACE FUNCTION public.seed_default_permissions(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  modules text[] := ARRAY[
    'sales','pos','products','customers','crm','reports',
    'expenses','purchases','invoices','inventory','analytics',
    'marketing','support','settings','team','finance',
    'ecommerce','shipping','payments','influencers'
  ];
  m text;
BEGIN
  FOREACH m IN ARRAY modules LOOP
    -- Admin: todo habilitado
    INSERT INTO public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (p_org_id, 'admin', m, true, true, true, true, true)
    ON CONFLICT (org_id, role, module) DO NOTHING;

    -- Vendedor: opera venta y atención; no configura ni borra.
    -- Ve pedidos del ecommerce y despachos (los tiene que preparar),
    -- pero no toca la config de la tienda, envíos ni cobros.
    INSERT INTO public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (p_org_id, 'vendedor', m,
      m NOT IN ('finance','payments','settings','team'),
      m IN ('sales','pos','customers','crm','support'),
      m IN ('sales','pos','customers','ecommerce'),
      false,
      m IN ('sales','customers')
    )
    ON CONFLICT (org_id, role, module) DO NOTHING;

    -- Viewer: solo lectura, sin plata ni configuración
    INSERT INTO public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (p_org_id, 'viewer', m,
      m NOT IN ('settings','team','finance','payments'),
      false,
      false,
      false,
      m IN ('reports','analytics')
    )
    ON CONFLICT (org_id, role, module) DO NOTHING;
  END LOOP;
END;
$$;

-- Backfill: las orgs existentes se quedaron sin filas para los módulos nuevos.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_permissions(r.id);
  END LOOP;
END $$;
