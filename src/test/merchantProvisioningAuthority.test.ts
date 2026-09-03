import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260822000003_atomic_merchant_provisioning.sql');
const verification = read('supabase/verificaciones/20260822_atomic_merchant_provisioning.sql');
const edgeAction = read('supabase/functions/platform-admin-action/index.ts');
const platformPage = read('src/pages/PlatformAdminPage.tsx');

describe('autoridad del alta de comercios', () => {
  it('deja el grafo comercial en una única transacción server-side', () => {
    const rpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.provision_platform_organization'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.provision_platform_organization'),
    );
    expect(rpc).toContain('INSERT INTO public.organizations');
    expect(rpc).toContain('INSERT INTO public.memberships');
    expect(rpc).toContain('INSERT INTO public.subscriptions');
    expect(rpc).toContain('INSERT INTO public.settings');
    expect(rpc).toContain('INSERT INTO public.admin_audit_logs');
    expect(rpc).toContain("has_platform_role(ARRAY['superadmin']");
  });

  it('hace idempotente el retry antes de rechazar la membresía recién creada', () => {
    const retry = migration.indexOf('IF v_existing.idempotency_key IS NOT NULL THEN');
    const membershipGuard = migration.indexOf('Owner already belongs to a Gestiona organization');
    expect(retry).toBeGreaterThan(-1);
    expect(membershipGuard).toBeGreaterThan(retry);
    expect(migration).toContain('Idempotency key was already used with different provisioning data');
  });

  it('no permite leer ni escribir la tabla idempotente desde el cliente', () => {
    expect(migration).toContain(
      'REVOKE ALL ON public.platform_organization_provisionings FROM PUBLIC, anon, authenticated',
    );
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.provision_platform_organization');
  });

  it('el trigger reserva las identidades creadas por Platform para el RPC', () => {
    expect(migration).toContain("'platform_invited_owner'");
    expect(migration).toContain("'store_customer'");
    expect(verification).toContain('premature workspace');
  });

  it('la Edge Function no vuelve a ensamblar el tenant con escrituras parciales', () => {
    const createOrg = edgeAction.slice(
      edgeAction.indexOf('if (action === "createOrg")'),
      edgeAction.indexOf('// ── CHECK SECRETS'),
    );
    expect(createOrg).toContain('provision_platform_organization');
    expect(createOrg).toContain('p_idempotency_key: idempotencyKey');
    expect(createOrg).toContain('deleteUser(ownerUserId)');
    expect(createOrg).not.toContain('.from("organizations")');
    expect(createOrg).not.toContain('.from("memberships")');
    expect(createOrg).not.toContain('.from("subscriptions")');
    expect(createOrg).not.toContain('.from("settings")');
  });

  it('pagina identidades y bloquea reutilizar un owner ya vinculado', () => {
    expect(edgeAction).toContain('for (let page = 1; page <= 100; page += 1)');
    expect(edgeAction).toContain('perPage: 1000');
    expect(edgeAction).toContain('Ese email ya pertenece a una organización');
    expect(verification).toContain('rejected provisioning mutated an existing organization');
  });

  it('envía el acceso sin devolver ni renderizar el token', () => {
    expect(edgeAction).toContain('mailAuth.auth.signInWithOtp');
    expect(edgeAction).not.toContain('auth.admin.generateLink');
    expect(edgeAction).not.toContain('action_link');
    expect(edgeAction).not.toContain('hashed_token');
    expect(platformPage).toContain('idempotencyKey: provisioningKey');
    expect(platformPage).toContain('Platform no recibe los datos sensibles');
    expect(platformPage).not.toContain('createdInviteLink');
  });
});
