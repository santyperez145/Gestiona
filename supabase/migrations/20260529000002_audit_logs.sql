-- ─────────────────────────────────────────────────────────────────
-- Audit Log — tabla inmutable para trazabilidad de operaciones
-- Sprint A1: seguridad enterprise
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.audit_logs (
  id              bigserial primary key,
  org_id          uuid references public.organizations(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  user_email      text,
  user_role       text,
  action          text not null,             -- create | update | delete | login | logout | export | import
  entity_type     text not null,             -- sale | product | customer | invoice | expense | ...
  entity_id       text,
  entity_label    text,                      -- nombre legible del registro
  old_values      jsonb,
  new_values      jsonb,
  diff            jsonb,                     -- solo los campos que cambiaron
  ip_address      inet,
  user_agent      text,
  severity        text not null default 'info', -- debug | info | warning | error | critical
  tags            text[]    default '{}',
  metadata        jsonb     default '{}',
  created_at      timestamptz not null default now()
);

-- Índices para búsqueda eficiente
create index if not exists audit_logs_org_id_created_at on public.audit_logs(org_id, created_at desc);
create index if not exists audit_logs_entity_type_id    on public.audit_logs(entity_type, entity_id);
create index if not exists audit_logs_action            on public.audit_logs(action);
create index if not exists audit_logs_user_id           on public.audit_logs(user_id);
create index if not exists audit_logs_severity          on public.audit_logs(severity);

-- RLS: solo admins de la org pueden leer sus propios logs
alter table public.audit_logs enable row level security;

create policy "org admins can read own audit logs"
  on public.audit_logs for select
  using (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid()
      and role in ('owner', 'admin')
    )
  );

-- Solo backend (service role) puede insertar
create policy "service role can insert audit logs"
  on public.audit_logs for insert
  with check (true);

-- Vista de resumen para el dashboard de auditoría
create or replace view public.audit_summary as
  select
    entity_type,
    action,
    count(*) as event_count,
    count(distinct user_id) as unique_users,
    max(created_at) as last_event
  from public.audit_logs
  group by entity_type, action;

-- Función para registrar evento desde Edge Functions / triggers
create or replace function public.log_audit_event(
  p_org_id       uuid,
  p_user_id      uuid,
  p_user_email   text,
  p_user_role    text,
  p_action       text,
  p_entity_type  text,
  p_entity_id    text,
  p_entity_label text,
  p_old_values   jsonb default null,
  p_new_values   jsonb default null,
  p_severity     text default 'info',
  p_metadata     jsonb default '{}'
) returns void
language plpgsql security definer
as $$
declare
  v_diff jsonb;
begin
  -- Calcular diff si hay old y new values
  if p_old_values is not null and p_new_values is not null then
    select jsonb_object_agg(key, value)
    into v_diff
    from jsonb_each(p_new_values) as new_vals(key, value)
    where not (p_old_values ? key and p_old_values->>key = p_new_values->>key);
  end if;

  insert into public.audit_logs (
    org_id, user_id, user_email, user_role,
    action, entity_type, entity_id, entity_label,
    old_values, new_values, diff,
    severity, metadata
  ) values (
    p_org_id, p_user_id, p_user_email, p_user_role,
    p_action, p_entity_type, p_entity_id, p_entity_label,
    p_old_values, p_new_values, v_diff,
    p_severity, p_metadata
  );
end;
$$;

-- Trigger automático en ventas (operaciones críticas)
create or replace function public.trg_audit_sales()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' then
    perform public.log_audit_event(
      NEW.org_id, auth.uid(), null, null,
      'create', 'sale', NEW.id::text,
      coalesce(NEW.product_name, 'Venta'),
      null, to_jsonb(NEW), 'info'
    );
  elsif TG_OP = 'UPDATE' then
    perform public.log_audit_event(
      NEW.org_id, auth.uid(), null, null,
      'update', 'sale', NEW.id::text,
      coalesce(NEW.product_name, 'Venta'),
      to_jsonb(OLD), to_jsonb(NEW), 'info'
    );
  elsif TG_OP = 'DELETE' then
    perform public.log_audit_event(
      OLD.org_id, auth.uid(), null, null,
      'delete', 'sale', OLD.id::text,
      coalesce(OLD.product_name, 'Venta'),
      to_jsonb(OLD), null, 'warning'
    );
  end if;
  return coalesce(NEW, OLD);
end;
$$;

create trigger audit_sales_trigger
  after insert or update or delete on public.sales
  for each row execute function public.trg_audit_sales();

-- RPC para el dashboard de auditoría (filtra por org + período)
create or replace function public.get_audit_summary(
  p_org_id uuid,
  p_from   timestamptz,
  p_to     timestamptz
)
returns table(
  entity_type  text,
  action       text,
  event_count  bigint,
  unique_users bigint,
  last_event   timestamptz
)
language sql stable security definer
as $$
  select
    entity_type,
    action,
    count(*)               as event_count,
    count(distinct user_id)::bigint as unique_users,
    max(created_at)        as last_event
  from public.audit_logs
  where org_id      = p_org_id
    and created_at >= p_from
    and created_at <= p_to
  group by entity_type, action
  order by event_count desc;
$$;
