-- ─────────────────────────────────────────────────────────────────
-- Auto-seed permissions on org creation
-- Sprint C1: every new org instantly gets sensible per-module defaults
-- from seed_default_permissions() (defined in migration 004).
--
-- Also backfills existing orgs that don't have any role_permissions
-- rows yet — so historical orgs adopt the new system without manual
-- intervention.
-- ─────────────────────────────────────────────────────────────────

-- ─── 1. Trigger: seed on new org ────────────────────────────────────────────
create or replace function public.trg_seed_org_permissions()
returns trigger language plpgsql security definer as $$
begin
  -- Best-effort seed — never block org creation if it fails
  begin
    perform public.seed_default_permissions(NEW.id);
  exception when others then
    raise warning 'seed_default_permissions failed for org %: %', NEW.id, SQLERRM;
  end;
  return NEW;
end;
$$;

drop trigger if exists seed_org_permissions_trigger on public.organizations;
create trigger seed_org_permissions_trigger
  after insert on public.organizations
  for each row execute function public.trg_seed_org_permissions();

-- ─── 2. Backfill existing orgs ──────────────────────────────────────────────
-- For every org that has zero role_permissions rows, seed defaults now.
do $$
declare
  o uuid;
begin
  for o in
    select id from public.organizations
    where id not in (select distinct org_id from public.role_permissions where org_id is not null)
  loop
    perform public.seed_default_permissions(o);
  end loop;
end $$;

comment on function public.trg_seed_org_permissions() is
  'Auto-seeds role_permissions for every new organization. Sprint C1.';
