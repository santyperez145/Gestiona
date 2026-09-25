import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guardia — Publicación verificable con derechos de uso versionados (fila 11).
 *
 * La revisión de entregables cierra el loop marca↔creador, pero sin evidencia
 * de la publicación real no hay paridad con GoMarz:
 * - `influencer_publication_proofs` guarda URL + captura + plataforma, con
 *   licencia de uso tipada y vencimiento para usos pagados/cesión total;
 * - `register_publication_proof` exige permiso influencer edit, entregable en
 *   revisión/aprobado y URLs https; el servidor resuelve org e influencer;
 * - cada verificación es una fila nueva: historial, no sobrescritura;
 * - el portal del creador ve si su publicación fue verificada.
 */

const read = (p: string) => readFileSync(p, "utf8");

describe("Publicación verificable — proofs con licencia versionada", () => {
  const migracion = read("supabase/migrations/20260925000200_influencer_publication_proofs.sql");
  const panel = read("src/components/influencers/InfluencerRecords.tsx");
  const portal = read("src/pages/CreatorPortalPage.tsx");

  it("existe la tabla de proofs con licencia tipada y auditoría", () => {
    expect(migracion).toContain("CREATE TABLE IF NOT EXISTS public.influencer_publication_proofs");
    expect(migracion).toContain("license_type text NOT NULL DEFAULT 'uso_campaña'");
    expect(migracion).toContain("'organico', 'uso_campaña', 'paid_ampliado', 'cesion_total'");
    expect(migracion).toContain("verified_by uuid");
    expect(migracion).toContain("CONSTRAINT publication_url_https");
  });

  it("la licencia pagada o cedida exige vencimiento", () => {
    expect(migracion).toContain("license_type IN ('paid_ampliado', 'cesion_total')");
    expect(migracion).toContain("license_expiry_required");
  });

  it("RLS: sólo la marca con permiso de edición gestiona proofs", () => {
    expect(migracion).toContain("ALTER TABLE public.influencer_publication_proofs ENABLE ROW LEVEL SECURITY");
    expect(migracion).toContain("public.can_manage_influencers(org_id, 'edit')");
    expect(migracion).toContain("REVOKE ALL ON TABLE public.influencer_publication_proofs FROM anon, authenticated");
  });

  it("el trigger amarra org/influencer/estado del entregable", () => {
    expect(migracion).toContain("CREATE TRIGGER trg_validate_publication_proof");
    expect(migracion).toContain("IF v_deliverable.org_id <> NEW.org_id THEN");
    expect(migracion).toContain("IF NEW.influencer_id <> v_deliverable.influencer_id THEN");
    expect(migracion).toContain("IF v_deliverable.status NOT IN ('entregado', 'completado') THEN");
  });

  it("cada verificación es una fila nueva (historial, no overwrite)", () => {
    // No existe UPDATE sobre proofs: la política es FOR ALL pero el flujo del
    // panel sólo inserta; el índice por (deliverable, created_at DESC) lee el
    // último estado.
    expect(migracion).toContain("CREATE INDEX IF NOT EXISTS idx_pub_proofs_deliverable");
    expect(panel).toContain("registerPublicationProof");
    expect(panel).not.toContain("UPDATE");
  });

  it("RPC del servidor con contrato de seguridad registrado", () => {
    expect(migracion).toContain("FUNCTION public.register_publication_proof");
    expect(migracion).toContain("IF NOT public.can_manage_influencers(v_org, 'edit') THEN");
    expect(migracion).toContain("'authenticated_delegate'");
    expect(migracion).toContain("REVOKE ALL ON FUNCTION public.register_publication_proof");
  });

  it("el creador ve la verificación de su publicación en el portal", () => {
    expect(migracion).toContain("publication_url text");
    expect(migracion).toContain("publication_verified_at timestamptz");
    expect(portal).toContain("publication_verified_at");
  });

  it("el panel de marca verifica desde la fila del entregable", () => {
    expect(panel).toContain("Verificar publicación");
    expect(panel).toContain("tipo de licencia");
  });
});
