import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guardia: reputación verificada en el descubrimiento (Go-Marz discovery).
 *
 * Go-Marz, medido 2026-09-25: la marca elige creador viendo historial de
 * colaboraciones reales, reviews con rating y performance — no a ciegas.
 * Antes, el descubrimiento Nerqia mostraba seguidores/engagement/tier y la
 * reputación quedaba sólo en el perfil público por token (N+1, invisible en
 * la grilla).
 */

const root = process.cwd();
const page = readFileSync(resolve(root, "src/pages/CreatorDiscoveryPage.tsx"), "utf8");
const db = readFileSync(resolve(root, "src/lib/influencersDB.ts"), "utf8");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260925001900_influencer_social_metric_reports.sql"),
  "utf8",
);

describe("descubrimiento con reputación verificada — elegir con datos, no a ciegas", () => {
  it("la grilla muestra rating, reviews y colaboraciones por creador", () => {
    expect(page).toContain("ReputationPanel");
    expect(page).toContain("reviews_count");
    expect(page).toContain("collaborations_count");
    expect(page).toContain("on_time_rate");
    expect(page).toContain("verified_publications");
  });

  it("sin datos muestra reputación cero honesta, nunca un rating inventado", () => {
    expect(page).toContain("Sin reviews todavía");
    // No hay valor por defecto de rating (el perfil público viejo usaba 3.5 fijo).
    expect(page).not.toMatch(/rating\s*\?\?\s*3/);
  });

  it("el filtro de rating mínimo y el orden por rating existen", () => {
    expect(page).toContain('aria-label="Rating mínimo"');
    expect(page).toContain('"rating"');
    expect(page).toContain("Mejor rating");
  });

  it("la reputación llega en UNA llamada batch (RPC), no N+1 por tarjeta", () => {
    expect(db).toContain("influencer_reputation_map");
    expect(db).toContain("new Map(rows.map");
  });

  it("el RPC de reputación es server-side, con guard de permiso y scope por org", () => {
    expect(migration).toContain("can_manage_influencers(p_org_id, 'view')");
    expect(migration).toContain("WHERE i.org_id = p_org_id");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.influencer_reputation_map");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.influencer_reputation_map");
  });

  it("la reputación se computa de datos reales: reviews, entregables a tiempo y pruebas verificadas", () => {
    expect(migration).toContain("FROM public.influencer_reviews");
    expect(migration).toContain("delivery_date <= d.due_date");
    expect(migration).toContain("FROM public.influencer_publication_proofs");
    expect(migration).toContain("p.verified_by IS NOT NULL");
    expect(migration).toContain("verified_metrics boolean");
    expect(migration).toContain("last_verified_at timestamptz");
  });
});
