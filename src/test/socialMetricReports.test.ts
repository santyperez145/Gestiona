import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Guardia: métricas sociales verificadas por evidencia (Go-Marz parity).
 *
 * El descubrimiento de creadores decidía con seguidores/engagement
 * autodeclarados: cualquier número sin evidencia. Go-Marz pesa performance
 * medida. Este slice agrega `influencer_social_metric_reports`: reportes con
 * ventana temporal medida que el creador sube desde su portal y la marca
 * verifica; la reputación del descubrimiento pondera hechos verificados.
 */
const migration = read(
  "supabase/migrations/20260925001900_influencer_social_metric_reports.sql",
);
const db = read("src/lib/influencersDB.ts");
const inbox = read("src/components/influencers/SocialMetricReportsInbox.tsx");
const paymentsPage = read("src/pages/InfluencerPaymentsPage.tsx");
const runtime = read("supabase/migrations/20260929000200_creator_metric_reports_runtime.sql");
const creatorContext = read("src/lib/creatorContext.tsx");
const creatorPortal = read("src/pages/CreatorPortalPage.tsx");
const creatorForm = read("src/components/creator/CreatorMetricReportsCard.tsx");

describe("métricas sociales verificadas por evidencia", () => {
  it("la tabla de reportes existe con ventana temporal medida y evidencia https", () => {
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.influencer_social_metric_reports",
    );
    expect(migration).toContain("platform text NOT NULL");
    expect(migration).toContain("metric_kind text NOT NULL DEFAULT 'captura'");
    expect(migration).toContain("evidence_url text NOT NULL");
    expect(migration).toContain("period_start date NOT NULL");
    expect(migration).toContain("period_end date NOT NULL");
    expect(migration).toContain("CONSTRAINT periodo_coherente CHECK (period_end >= period_start)");
    expect(migration).toContain("CONSTRAINT evidencia_https CHECK (evidence_url ~ '^https://[^[:space:]]+$')");
  });

  it("RLS: la marca gestiona con permiso y el creador sólo ve lo suyo vía sesión", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("public.can_manage_influencers(org_id, 'edit')");
    expect(migration).toContain("ca.user_id = auth.uid()");
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.influencer_social_metric_reports FROM anon, authenticated",
    );
  });

  it("el creador sólo reporta métricas de sí mismo: la relación viene de creator_accounts", () => {
    expect(migration).toMatch(
      /FROM public\.influencers i\s+JOIN public\.creator_accounts ca\s+ON lower\(ca\.email\) = lower\(i\.email\)/,
    );
    // El período no puede ser futuro ni eterno.
    expect(migration).toContain("IF p_period_end > CURRENT_DATE THEN");
    expect(migration).toContain("IF p_period_start < CURRENT_DATE - INTERVAL '366 days' THEN");
  });

  it("la decisión de la marca es durable y con guard de permiso", () => {
    expect(migration).toMatch(/status = p_status/);
    expect(migration).toContain(
      "public.can_manage_influencers(v_row.org_id, 'edit')",
    );
    expect(migration).toContain("IF v_row.status <> 'submitted' THEN");
  });

  it("la bandeja de la marca exige permiso en el RPC SECURITY DEFINER", () => {
    expect(migration).toMatch(
      /WHERE r\.org_id = p_org_id\s+AND public\.can_manage_influencers\(p_org_id, 'view'\)/,
    );
  });

  it("la reputación se pondera con hechos verificados de los últimos 180 días", () => {
    expect(migration).toContain("bool_or(r.status = 'verified')");
    expect(migration).toContain("r.created_at >= now() - INTERVAL '180 days'");
    expect(migration).toContain("verified_metrics boolean");
    expect(migration).toContain("last_verified_at timestamptz");
  });

  it("anon no ejecuta ningún RPC del módulo", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.submit_social_metric_report(uuid, text, text, date, date, numeric, numeric, numeric, numeric, text, text) FROM PUBLIC, anon",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.review_social_metric_report(uuid, text, text) FROM PUBLIC, anon",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.list_social_metric_reports(uuid) FROM PUBLIC, anon",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.influencer_reputation_map(uuid) FROM PUBLIC, anon",
    );
  });

  it("el frontend llama los RPC con la firma real y muestra el sello en descubrimiento", () => {
    expect(db).toContain("sb.rpc('list_social_metric_reports', { p_org_id: orgId })");
    expect(db).toContain("verified_metrics: boolean");
    expect(db).toContain("last_verified_at: string | null");
    // La pestaña de pagos monta la bandeja de revisión.
    expect(paymentsPage).toContain("<SocialMetricReportsInbox activeOrgId={activeOrg?.id ?? null} />");
    // La bandeja verifica y rechaza vía RPC.
    expect(inbox).toContain("reviewSocialMetricReport(report.id, status, notes[report.id]?.trim() || null)");
  });

  it("persiste impresiones y evita duplicar el mismo reporte al reintentar", () => {
    expect(runtime).toContain("period_start, period_end, followers, reach, impressions,");
    expect(runtime).toContain("p_followers, p_reach, p_impressions,");
    expect(runtime).toContain("AND r.evidence_url = p_evidence_url");
    expect(runtime).toContain("metric_report_rate_limited");
  });

  it("el creador sólo consulta reportes ligados al email de su sesión", () => {
    expect(runtime).toContain("CREATE OR REPLACE FUNCTION public.creator_my_social_metric_reports()");
    expect(runtime).toContain("ca.user_id = auth.uid()");
    expect(runtime).toContain("lower(ca.email) = lower(i.email)");
    expect(runtime).toContain("REVOKE ALL ON FUNCTION public.creator_my_social_metric_reports() FROM PUBLIC, anon");
  });

  it("el portal completa el circuito creador → revisión → reputación", () => {
    expect(creatorPortal).toContain("<CreatorMetricReportsCard />");
    expect(creatorContext).toContain('read("creator_my_social_metric_reports")');
    expect(creatorContext).toContain('rpc("submit_social_metric_report"');
    expect(creatorForm).toContain("Enviar para revisión");
    expect(creatorForm).not.toContain("p_impressions");
    expect(creatorForm).toContain("metricReports.map");
  });
});
