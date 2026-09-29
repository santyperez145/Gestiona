import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260929001000_creator_private_deliverables.sql', 'utf8');
const externalAuthority = readFileSync('supabase/migrations/20260929001010_creator_external_deliverable_authority.sql', 'utf8');
const upload = readFileSync('src/lib/creatorDeliverableFiles.ts', 'utf8');
const portal = readFileSync('src/pages/CreatorPortalPage.tsx', 'utf8');
const brandReview = readFileSync('src/components/influencers/InfluencerRecords.tsx', 'utf8');

describe('entregables audiovisuales privados', () => {
  it('usa un bucket privado y no permite reemplazar ni borrar desde el navegador', () => {
    expect(migration).toContain("'creator-deliverables'");
    expect(migration).toContain('public = false');
    expect(migration).toContain("FOR INSERT TO authenticated");
    expect(migration).toContain("FOR SELECT TO authenticated");
    expect(migration).not.toContain('FOR UPDATE TO authenticated');
    expect(migration).not.toContain('FOR DELETE TO authenticated');
    expect(migration).toContain("has_table_privilege('authenticated', 'public.influencer_deliverable_files', 'DELETE')");
  });

  it('vincula cada version al creador asignado y a una invitacion aceptada', () => {
    expect(migration).toContain('creator_prepare_deliverable_file');
    expect(migration).toContain('influencer_campaign_creators assignment');
    expect(migration).toContain("invitation.status = 'accepted'");
    expect(migration).toContain('UNIQUE (deliverable_id, version_number)');
    expect(migration).toContain('pg_advisory_xact_lock');
  });

  it('finaliza solo cuando el objeto existe y conserva hash y retencion', () => {
    expect(migration).toContain("object.bucket_id = 'creator-deliverables'");
    expect(migration).toContain('v_object.metadata->>\'size\'');
    expect(migration).toContain("sha256 ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain('current_date + 365');
    expect(migration).toContain('influencer_deliverable_files_immutable');
  });

  it('conecta carga, revision privada y compatibilidad con enlaces externos', () => {
    expect(upload).toContain(".upload(intent.storagePath, file");
    expect(upload).toContain("creator_finalize_deliverable_file");
    expect(upload).toContain('createSignedUrl(file.storage_path, 60)');
    expect(portal).toContain('Archivo privado');
    expect(portal).toContain('Enlace externo');
    expect(brandReview).toContain('Abrir versión');
    expect(brandReview).toContain('hasPrivateFile');
  });

  it('aplica la misma autoridad al enlace externo y bloquea reemplazos durante revision', () => {
    expect(externalAuthority).toContain('influencer_campaign_creators assignment');
    expect(externalAuthority).toContain("invitation.status = 'accepted'");
    expect(externalAuthority).toContain("v_row.status = 'entregado'");
    expect(externalAuthority).toContain("v_row.status = 'completado'");
    expect(externalAuthority).toContain('pg_advisory_xact_lock');
  });
});
