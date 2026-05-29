-- ─────────────────────────────────────────────────────────────────
-- Audit Log — additions only
-- The `audit_logs` table + `get_audit_summary` RPC + `log_audit_event`
-- helper already exist from migration 20260523000060_audit_log.sql.
--
-- This migration ONLY adds:
--   1. `audit_summary` view (lightweight aggregation)
--   2. `trg_audit_sales` trigger — auto-logs every INSERT/UPDATE/DELETE
--      on the sales table (the most critical entity)
-- ─────────────────────────────────────────────────────────────────

-- ─── 1. Summary view ────────────────────────────────────────────────────────
create or replace view public.audit_summary as
  select
    entity_type,
    action,
    count(*)                        as event_count,
    count(distinct user_id)         as unique_users,
    max(created_at)                 as last_event
  from public.audit_logs
  group by entity_type, action;

comment on view public.audit_summary is
  'Cross-org aggregate of audit events. For org-scoped use the get_audit_summary() RPC.';

-- ─── 2. Sales trigger ────────────────────────────────────────────────────────
-- Matches the existing log_audit_event() signature:
--   log_audit_event(p_org_id, p_user_id, p_user_email, p_action,
--                   p_entity_type, p_entity_id uuid, p_entity_label,
--                   p_old_values, p_new_values, p_severity, p_metadata)

create or replace function public.trg_audit_sales()
returns trigger language plpgsql security definer as $$
declare
  v_label text;
  v_email text;
begin
  -- Best-effort email lookup
  begin
    select email into v_email from auth.users where id = auth.uid();
  exception when others then v_email := null;
  end;

  if TG_OP = 'INSERT' then
    v_label := coalesce(NEW.product_name, NEW.customer_name, 'Venta');
    perform public.log_audit_event(
      NEW.org_id, auth.uid(), v_email,
      'sale.create', 'sale', NEW.id, v_label,
      null, to_jsonb(NEW), 'info', '{}'::jsonb
    );
  elsif TG_OP = 'UPDATE' then
    v_label := coalesce(NEW.product_name, NEW.customer_name, 'Venta');
    perform public.log_audit_event(
      NEW.org_id, auth.uid(), v_email,
      'sale.update', 'sale', NEW.id, v_label,
      to_jsonb(OLD), to_jsonb(NEW), 'info', '{}'::jsonb
    );
  elsif TG_OP = 'DELETE' then
    v_label := coalesce(OLD.product_name, OLD.customer_name, 'Venta');
    perform public.log_audit_event(
      OLD.org_id, auth.uid(), v_email,
      'sale.delete', 'sale', OLD.id, v_label,
      to_jsonb(OLD), null, 'warning', '{}'::jsonb
    );
  end if;
  return coalesce(NEW, OLD);
exception
  when others then
    -- Never let an audit failure block the underlying sale operation
    return coalesce(NEW, OLD);
end;
$$;

-- Recreate trigger idempotently
drop trigger if exists audit_sales_trigger on public.sales;
create trigger audit_sales_trigger
  after insert or update or delete on public.sales
  for each row execute function public.trg_audit_sales();
