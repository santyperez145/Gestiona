import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('supabase/migrations/20260822000002_support_diagnostic_access.sql');
const edgeAction = read('supabase/functions/platform-admin-action/index.ts');
const platformPage = read('src/pages/PlatformAdminPage.tsx');
const merchantPanel = read('src/components/platform/SupportDiagnosticAccessPanel.tsx');
const ownerPanel = read('src/components/settings/SupportAccessAuditSection.tsx');

describe('autoridad de diagnóstico de soporte', () => {
  it('la tabla cruda no es legible ni mutable por clientes', () => {
    expect(migration).toContain('REVOKE ALL ON public.support_diagnostic_access_requests FROM PUBLIC, anon, authenticated');
    expect(migration).toContain("has_org_role(request.org_id, auth.uid(), ARRAY['owner'])");
    expect(migration).toContain("request.requested_by = auth.uid()");
  });

  it('separa solicitud de staff, aprobación owner y lectura del solicitante', () => {
    const requestRpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.request_support_diagnostic_access'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.approve_support_diagnostic_access'),
    );
    const approvalRpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.approve_support_diagnostic_access'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.revoke_support_diagnostic_access'),
    );
    const snapshotRpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.get_support_diagnostic_snapshot'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.request_support_diagnostic_access'),
    );
    expect(requestRpc).toContain("has_platform_role(ARRAY['support']");
    expect(approvalRpc).toContain("has_org_role(v_request.org_id, v_actor, ARRAY['owner'])");
    expect(approvalRpc).toContain('p_duration_minutes NOT IN (15, 30, 60)');
    expect(snapshotRpc).toContain('v_actor <> v_request.requested_by');
    expect(snapshotRpc).toContain('v_request.expires_at <= now()');
    expect(snapshotRpc).toContain('view_count = view_count + 1');
  });

  it('el snapshot usa agregados explícitos y no entidades identificables', () => {
    const snapshotRpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.get_support_diagnostic_snapshot'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.request_support_diagnostic_access'),
    );
    expect(snapshotRpc).toContain("'catalog_quality'");
    expect(snapshotRpc).toContain("'stock_accuracy'");
    expect(snapshotRpc).toContain("'delivery_queue'");
    expect(snapshotRpc).not.toMatch(/customer|product\.name|sale_price|cost_usd|total_ars|access_token|private_key|certificate|last_error/i);
  });

  it('retira la impersonación aun para superadmin y conserva sólo invitación de onboarding', () => {
    expect(edgeAction).toContain('if (action === "generateMagicLink")');
    expect(edgeAction).toContain('impersonation_retired');
    expect(edgeAction.match(/auth\.admin\.generateLink/g)).toHaveLength(1);
    expect(platformPage).not.toContain("adminCall('generateMagicLink'");
    expect(platformPage).not.toContain('handleGenerateMagicLink');
  });

  it('ambas superficies usan vistas/RPC y no la tabla cruda', () => {
    expect(merchantPanel).toContain('requestSupportDiagnosticAccess(orgId, reason)');
    expect(merchantPanel).toContain('getSupportDiagnosticSnapshot(currentRequest.id)');
    expect(ownerPanel).toContain('approveSupportDiagnosticAccess(requestId');
    expect(ownerPanel).toContain('revokeSupportDiagnosticAccess(requestId)');
    expect(merchantPanel).not.toContain("from('support_diagnostic_access_requests')");
    expect(ownerPanel).not.toContain('from("support_diagnostic_access_requests")');
  });
});
