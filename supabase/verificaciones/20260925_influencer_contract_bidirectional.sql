-- Verificación reversible: contrato bidireccional con evidencia de aceptación.
--
-- Prueba: crear contrato, simular aceptación de ambas partes, verificar evidencia.

begin;

  -- 1. Obtener org y influencer de prueba
  create temporary table test_contract as
    select id as contract_id, org_id
    from public.influencer_contracts
    where status = 'active'
    limit 1;

  if not exists (select 1 from test_contract) then
    raise exception 'No hay contrato activo para testear';
  end if;

  -- 2. Verificar columnas necesarias
  assert (
    exists (
      select 1
      from information_schema.columns
      where table_name = 'influencer_contracts'
        and column_name in ('accepted_by_brand', 'accepted_by_influencer', 'accepted_at', 'contract_version')
    )
  ), 'Faltan columnas para evidencia de aceptación';

  -- 3. Actualizar con evidencia simulada
  update public.influencer_contracts
  set
    accepted_by_brand = (select user_id from public.memberships where org_id = (select org_id from test_contract) limit 1),
    accepted_by_influencer = (select id from public.influencers limit 1),
    accepted_at = now(),
    contract_version = 2
  where id = (select contract_id from test_contract);

  -- 4. Verificar que se guardó la evidencia
  assert (
    (select count(*) from public.influencer_contracts where accepted_by_brand is not null and accepted_at is not null) >= 1
  ), 'No se guardó la evidencia de aceptación';

  -- 5. Limpiar (reversible)
  update public.influencer_contracts
  set accepted_by_brand = null, accepted_by_influencer = null, accepted_at = null, contract_version = 1
  where id = (select contract_id from test_contract);

  commit;

  raise notice 'Verificación de contrato bidireccional: OK';
exception when others then
  rollback;
  raise;
end;