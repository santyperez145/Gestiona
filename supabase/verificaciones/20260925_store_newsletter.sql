-- Verificación: newsletter en tiendas (reversible).
--
-- Prueba: suscribir email en una tienda, confirmar existencia, dar de baja (simular opt-out).
--
-- NOTA: requiere una tienda activa y un org_id.

begin;

  -- 1. Preparar datos de prueba
  create temporary table test_store as
    select id as org_id, slug as store_slug
    from public.stores
    where active = true
    limit 1;

  if not exists (select 1 from test_store) then
    raise exception 'No hay tienda activa para testear';
  end if;

  -- 2. Suscribir email
  perform public.subscribe_store_newsletter(
    (select store_slug from test_store),
    'test@newsletter.example.com',
    'Newsletter Tester',
    'test'
  );

  -- 3. Verificar que el suscriptor existe
  assert (
    exists (
      select 1
      from public.store_newsletter_subscribers s
      join test_store t on s.org_id = t.org_id and s.store_slug = t.store_slug
      where s.email = 'test@newsletter.example.com'
    )
  ), 'El suscriptor debería existir después de suscribir';

  -- 4. Verificar idempotencia: suscribir de nuevo no duplica
  perform public.subscribe_store_newsletter(
    (select store_slug from test_store),
    'test@newsletter.example.com',
    'Newsletter Tester',
    'test'
  );

  assert (
    (select count(*) from public.store_newsletter_subscribers where email = 'test@newsletter.example.com') = 1
  ), 'No debería haber duplicados tras suscripción idempotente';

  -- 5. Simular baja global: insertar en email_unsubscribes
  insert into public.email_unsubscribes (org_id, email, unsubscribed_at)
  select org_id, 'test@newsletter.example.com', now()
  from test_store
  on conflict (org_id, email) do update set unsubscribed_at = excluded.unsubscribed_at;

  -- 6. Volver a intentar suscripción: debería fallar por opt-out
  perform public.subscribe_store_newsletter(
    (select store_slug from test_store),
    'test@newsletter.example.com',
    'Newsletter Tester',
    'test'
  );

  assert (
    not exists (
      select 1
      from public.store_newsletter_subscribers s
      join test_store t on s.org_id = t.org_id and s.store_slug = t.store_slug
      where s.email = 'test@newsletter.example.com' and s.confirmed = true
    )
  ), 'No debería quedar suscriptor confirmado tras opt-out global';

  -- 7. Limpiar datos de prueba (reversible)
  delete from public.store_newsletter_subscribers
  where email = 'test@newsletter.example.com';

  delete from public.email_unsubscribes
  where email = 'test@newsletter.example.com';

  drop table test_store;

  commit;

  raise notice 'Verificación de newsletter en tiendas: OK';
exception when others then
  rollback;
  raise;
end;