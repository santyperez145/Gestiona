-- ─────────────────────────────────────────────────────────────────
-- Role Permissions — permisos granulares por módulo
-- Sprint A1: seguridad enterprise
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.role_permissions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  role        text not null check (role in ('admin', 'vendedor', 'viewer')),
  module      text not null,   -- sales | pos | products | customers | reports | expenses | ...
  can_view    boolean not null default true,
  can_create  boolean not null default false,
  can_edit    boolean not null default false,
  can_delete  boolean not null default false,
  can_export  boolean not null default false,
  updated_at  timestamptz not null default now(),
  unique (org_id, role, module)
);

create index if not exists role_permissions_org_role on public.role_permissions(org_id, role);

alter table public.role_permissions enable row level security;

create policy "org admins can manage role permissions"
  on public.role_permissions for all
  using (org_id in (
    select org_id from public.memberships
    where user_id = auth.uid() and role in ('owner', 'admin')
  ));

create policy "org members can read own permissions"
  on public.role_permissions for select
  using (org_id in (select org_id from public.memberships where user_id = auth.uid()));

-- RPC para checar permiso (usada desde Edge Functions)
create or replace function public.has_permission(
  p_org_id  uuid,
  p_module  text,
  p_action  text   -- view | create | edit | delete | export
) returns boolean
language plpgsql stable security definer
as $$
declare
  v_role   text;
  v_result boolean;
begin
  -- Obtener rol del usuario en esta org
  select role into v_role
  from public.memberships
  where org_id = p_org_id and user_id = auth.uid();

  -- Owners y admins siempre tienen acceso total si no hay override
  if v_role in ('owner', 'admin') then
    -- Revisar si hay override explícito
    select
      case p_action
        when 'view'   then can_view
        when 'create' then can_create
        when 'edit'   then can_edit
        when 'delete' then can_delete
        when 'export' then can_export
        else false
      end
    into v_result
    from public.role_permissions
    where org_id = p_org_id and role = 'admin' and module = p_module;

    return coalesce(v_result, true);
  end if;

  -- Para vendedor/viewer, buscar permiso explícito
  select
    case p_action
      when 'view'   then can_view
      when 'create' then can_create
      when 'edit'   then can_edit
      when 'delete' then can_delete
      when 'export' then can_export
      else false
    end
  into v_result
  from public.role_permissions
  where org_id = p_org_id and role = v_role and module = p_module;

  -- Si no hay registro explícito, usar defaults por rol
  if v_result is null then
    return case
      when v_role = 'vendedor' and p_action in ('view', 'create') then true
      when v_role = 'viewer'   and p_action = 'view'              then true
      else false
    end;
  end if;

  return v_result;
end;
$$;

-- Función para seed de permisos por defecto al crear org
create or replace function public.seed_default_permissions(p_org_id uuid)
returns void language plpgsql security definer as $$
declare
  modules text[] := array[
    'sales','pos','products','customers','crm','reports',
    'expenses','purchases','invoices','inventory','analytics',
    'marketing','support','settings','team','finance'
  ];
  m text;
begin
  foreach m in array modules loop
    -- Admin: todo habilitado
    insert into public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    values (p_org_id, 'admin', m, true, true, true, true, true)
    on conflict (org_id, role, module) do nothing;

    -- Vendedor: ver + crear en módulos de venta, sin borrar ni configurar
    insert into public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    values (p_org_id, 'vendedor', m,
      true,
      m in ('sales','pos','customers','crm','support'),
      m in ('sales','pos','customers'),
      false,
      m in ('sales','customers')
    )
    on conflict (org_id, role, module) do nothing;

    -- Viewer: solo lectura y algunos exports
    insert into public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    values (p_org_id, 'viewer', m,
      m not in ('settings','team','finance'),
      false,
      false,
      false,
      m in ('reports','analytics')
    )
    on conflict (org_id, role, module) do nothing;
  end loop;
end;
$$;
