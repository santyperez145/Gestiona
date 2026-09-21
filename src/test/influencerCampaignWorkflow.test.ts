// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state = vi.hoisted(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn().mockResolvedValue({ data: [], error: null });
  return { query, from: vi.fn(() => query), rpc: vi.fn() };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: state.from, rpc: state.rpc } }));
vi.mock("@/lib/orgContext", () => ({ requireActiveOrgId: () => "org-a" }));

import { createInfluencerCampaign, inviteCreatorToCampaign, listInfluencerCampaigns } from "@/lib/influencersDB";

const ROOT = resolve(__dirname, "../..");
const MIGRATION = readFileSync(resolve(ROOT, "supabase/migrations/20260921000200_influencer_campaign_workflow.sql"), "utf8");
const CAMPAIGNS_PAGE = readFileSync(resolve(ROOT, "src/pages/CampaignsPage.tsx"), "utf8");
const DISCOVERY_PAGE = readFileSync(resolve(ROOT, "src/pages/CreatorDiscoveryPage.tsx"), "utf8");
const OVERVIEW_PAGE = readFileSync(resolve(ROOT, "src/pages/InfluencerMarketingPage.tsx"), "utf8");

describe("adaptador de campañas de influencers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.query.order.mockResolvedValue({ data: [], error: null });
    state.rpc.mockResolvedValue({ data: "00000000-0000-4000-8000-000000000001", error: null });
  });

  it("lista únicamente las campañas de la organización activa", async () => {
    await listInfluencerCampaigns();
    expect(state.from).toHaveBeenCalledWith("influencer_campaigns");
    expect(state.query.eq).toHaveBeenCalledWith("org_id", "org-a");
  });

  it("crea mediante RPC transaccional con el tenant derivado del servidor de sesión", async () => {
    await createInfluencerCampaign({
      name: " Lanzamiento ", objective: " Alcance regional ", channel: "instagram",
      budget_ars: 500000, starts_on: "2026-10-01", ends_on: "2026-10-31",
    });
    expect(state.rpc).toHaveBeenCalledWith("influencer_campaign_create", {
      p_org_id: "org-a", p_name: "Lanzamiento", p_objective: "Alcance regional",
      p_channel: "instagram", p_budget_ars: 500000,
      p_starts_on: "2026-10-01", p_ends_on: "2026-10-31",
    });
  });

  it("invita al creador sin aceptar un org_id del navegador", async () => {
    await inviteCreatorToCampaign("campaign-a", "creator-a", 75000);
    expect(state.rpc).toHaveBeenCalledWith("influencer_campaign_invite", {
      p_org_id: "org-a", p_campaign_id: "campaign-a",
      p_influencer_id: "creator-a", p_agreed_fee_ars: 75000,
    });
  });
});

describe("autoridad y UI del workflow", () => {
  it("RLS y RPC validan tenant, permiso, estado y duplicados", () => {
    expect(MIGRATION).toContain("public.has_permission(p_org_id, 'influencers', 'create')");
    expect(MIGRATION).toContain("campaign_id, influencer_id");
    expect(MIGRATION).toContain("now() + interval '72 hours'");
    expect(MIGRATION).toContain("status IN ('draft', 'recruiting')");
  });

  it("campañas y discovery ejecutan acciones reales, no alerts de maqueta", () => {
    expect(CAMPAIGNS_PAGE).toContain("createInfluencerCampaign(form)");
    expect(DISCOVERY_PAGE).toContain("inviteCreatorToCampaign(");
    expect(CAMPAIGNS_PAGE).not.toContain("window.alert");
    expect(DISCOVERY_PAGE).not.toMatch(/\balert\s*\(/);
  });

  it("el resumen enlaza las operaciones sin volver a montar sus páginas", () => {
    for (const path of ["campanas", "creadores", "descubrir", "contratos", "entregables", "pagos"]) {
      expect(OVERVIEW_PAGE).toContain(`/influencer-marketing/${path}`);
    }
    expect(OVERVIEW_PAGE).not.toMatch(/import\s+Influencer(?:Contracts|Deliverables|Payments|Exchanges)Page/);
  });
});
