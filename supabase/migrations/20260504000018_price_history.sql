-- Price history: automatically tracks changes to product sale_price_ars
create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  old_price_ars numeric,
  new_price_ars numeric not null,
  old_cost_usd numeric,
  new_cost_usd numeric,
  change_pct numeric,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.price_history enable row level security;

create policy "price_history_org_access" on public.price_history
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists price_history_product_idx on public.price_history (product_id, created_at desc);
create index if not exists price_history_org_idx on public.price_history (org_id, created_at desc);

-- Trigger: auto-record price changes when products.sale_price_ars changes
create or replace function public.record_price_change()
returns trigger language plpgsql security definer as $$
begin
  if (TG_OP = 'UPDATE') and (
    OLD.sale_price_ars is distinct from NEW.sale_price_ars or
    OLD.total_cost_usd is distinct from NEW.total_cost_usd
  ) then
    insert into public.price_history (
      product_id, org_id,
      old_price_ars, new_price_ars,
      old_cost_usd, new_cost_usd,
      change_pct,
      changed_by
    ) values (
      NEW.id, NEW.org_id,
      OLD.sale_price_ars, NEW.sale_price_ars,
      OLD.total_cost_usd, NEW.total_cost_usd,
      case when OLD.sale_price_ars > 0
        then round(((NEW.sale_price_ars - OLD.sale_price_ars) / OLD.sale_price_ars) * 100, 1)
        else null
      end,
      auth.uid()
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_record_price_change on public.products;
create trigger trg_record_price_change
  after update on public.products
  for each row execute function public.record_price_change();
