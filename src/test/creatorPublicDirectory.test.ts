import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260929000900_creator_public_directory.sql", "utf8");
const publicPage = readFileSync("src/pages/InfluencerProfilePage.tsx", "utf8");
const discovery = readFileSync("src/pages/CreatorDiscoveryPage.tsx", "utf8");

describe("directorio publico de creadores", () => {
  it("requiere consentimiento y moderacion antes de exponer un perfil", () => {
    expect(migration).toContain("profile_public AND ca.moderation_status='approved'");
    expect(migration).toContain("creator_update_public_profile");
    expect(migration).toContain("platform_moderate_creator_profile");
    expect(migration).toContain("public_slug");
    expect(migration).toContain("REVOKE INSERT, UPDATE ON public.creator_accounts FROM authenticated");
    expect(migration).toContain("creator_ensure_account");
  });

  it("no vuelve a filtrar PII, UUID internos ni metricas inventadas", () => {
    expect(migration).not.toContain("'email', v_inf.email");
    expect(publicPage).not.toContain('.from("influencers")');
    expect(publicPage).not.toContain("total_earnings_ars");
    expect(publicPage).not.toContain("referral_code");
    expect(publicPage).toContain("Sin datos verificados");
  });

  it("descubre y agrega desde la autoridad transversal sin duplicar pantalla", () => {
    expect(discovery).toContain('rpc("creator_discovery_search"');
    expect(discovery).toContain('rpc("creator_directory_add_to_org"');
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("lower(email)=lower(v_account.email)");
  });

  it("solo publica pruebas verificadas elegidas por el creador", () => {
    expect(migration).toContain("creator_publication_visibility");
    expect(migration).toContain("visibility.visible");
    expect(migration).toContain("proof.verified_by IS NOT NULL");
  });
});
