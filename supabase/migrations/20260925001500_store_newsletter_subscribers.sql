-- Newsletter en las tiendas: tabla de suscriptores por slug.
--
-- ── Por qué ────────────────────────────────────────────────────────────────
-- El footer de `StoreLayout` no tenía formulario de newsletter conectado a la
-- base. El "botón Suscribir" no hacía nada: no existía tabla ni RPC para
-- capturar emails desde la vitrina.
--
-- Esta tabla persiste los suscriptores anónimos de cada tienda. La doble
-- identidad: un mismo email puede ser cliente + suscriptor; no se confunden
-- porque la suscripción es por `org_id` (la casa editorial), no por store
-- slug. Se respeta el opt-out global de `email_unsubscribes`: un email que
-- dio de baja no vuelve a entrar por newsletter.

create table if not exists public.store_newsletter_subscribers (
  id          uuid        primary key default gen_random_uuid(),
  org_id      uuid        not null references public.organizations(id) on delete cascade,
  store_slug  text        not null,
  email       text        not null,
  name        text,
  source      text        not null default 'footer',
  subscribed_at timestamptz not null default now(),
  confirmed   boolean     not null default false,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists store_newsletter_subscribers_org_email_idx
  on public.store_newsletter_subscribers(org_id, lower(trim(email)));
create index if not exists store_newsletter_subscribers_store_idx
  on public.store_newsletter_subscribers(store_slug);
create index if not exists store_newsletter_subscribers_confirmed_idx
  on public.store_newsletter_subscribers(org_id, confirmed, subscribed_at desc);

alter table public.store_newsletter_subscribers enable row level security;

-- Las tiendas permiten suscribirse anónimamente (anon). La RLS sólo filtra
-- por org_id; un buyer nunca ve la de otra tienda.
revoke all on public.store_newsletter_subscribers from public, anon, authenticated;
grant usage on schema public to anon;
grant select, insert, update on public.store_newsletter_subscribers
  to anon, authenticated using (
    org_id in (
      select org_id from public.stores where stores.slug = current_setting('app.current_store_slug', true)::text
    )
  );
grant select, insert, update on public.store_newsletter_subscribers
  for all using (org_id in (select org_id from public.memberships where user_id = auth.uid()));

-- El subscriber no puede dar de baja a otro: ON CONFLICT resuelve por email.
create unique index if not exists store_newsletter_subscribers_email_lower_idx
  on public.store_newsletter_subscribers(store_slug, lower(trim(email)));

comment on table public.store_newsletter_subscribers is
  'Suscriptores del newsletter de vitrina. connected to email_campaigns / email_unsubscribes.';

-- ─── Trigger: updated_at ─────────────────────────────────────────────────
create or replace function public.touch_store_newsletter_subscriber()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger store_newsletter_subscribers_touch
  before update on public.store_newsletter_subscribers
  for each row execute function public.touch_store_newsletter_subscriber();

-- ─── RPC: suscribir un email a la newsletter de una tienda ───────────────
-- Idempotente: ON CONFLICT no inserta duplicado. Respeto el opt-out global.
create or replace function public.subscribe_store_newsletter(
  p_store_slug text,
  p_email text,
  p_name text default null,
  p_source text default 'footer'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_clean text := lower(trim(p_email));
begin
  select org_id into v_org
  from public.stores
  where slug = p_store_slug;

  if v_org is null then
    return jsonb_build_object('ok', false, 'error', 'store_not_found');
  end if;

  -- Respeto opt-out global: un desuscripto no vuelve.
  if exists (
    select 1 from public.email_unsubscribes
    where org_id = v_org and email = v_clean
  ) then
    return jsonb_build_object('ok', false, 'error', 'unsubscribed');
  end if;

  insert into public.store_newsletter_subscribers(org_id, store_slug, email, name, source, confirmed, confirmed_at)
  values (v_org, p_store_slug, v_clean, p_name, p_source, true, now())
  on conflict (store_slug, lower(trim(email))) do update
    set unsubscribed_at = null,
        confirmed = true,
        confirmed_at = least(coalesce(store_newsletter_subscribers.confirmed_at, now()), now()),
        updated_at = now()
    where store_newsletter_subscribers.unsubscribed_at is not null
       or store_newsletter_subscribers.confirmed = false;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.subscribe_store_newsletter(text, text, text, text)
  to anon, authenticated;
