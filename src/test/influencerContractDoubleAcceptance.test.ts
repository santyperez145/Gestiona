import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Paridad Go-Marz: contratos con doble aceptación versionada.
 *
 * ── Por qué existe este test ─────────────────────────────────────────────
 * `is_signed` era un boolean declarado por la marca: el creador nunca
 * intervenía y el "contrato" valía lo que una persona de la marca escribió.
 * Go-Marz cierra el acuerdo con aceptación del creador; este archivo guarda
 * el contrato que lo iguala: versión compartida, aceptación por parte,
 * edición invalida la firma previa y la aceptación es server-side.
 */

const ROOT = resolve(__dirname, "../..");

function leerMigracion(nombre: string): string {
  return readFileSync(resolve(ROOT, "supabase", "migrations", nombre), "utf8");
}

const MIGRACION = "20260925001500_influencer_contract_double_acceptance.sql";
const PORTAL = readFileSync(resolve(ROOT, "src", "pages", "CreatorPortalPage.tsx"), "utf8");
const REGISTROS = readFileSync(resolve(ROOT, "src", "components", "influencers", "InfluencerRecords.tsx"), "utf8");
const INVITACION = readFileSync(resolve(ROOT, "src", "pages", "InfluencerInvitationPage.tsx"), "utf8");

describe("contratos con doble aceptación (Go-Marz parity)", () => {
  it("la migración existe y modela versiones + aceptaciones", () => {
    expect(existsSync(resolve(ROOT, "supabase", "migrations", MIGRACION))).toBe(true);
    const sql = leerMigracion(MIGRACION);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.influencer_contract_versions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.influencer_contract_acceptances");
    // Una firma por parte y versión: la misma versión es lo que ambos firmaron.
    expect(sql).toContain("UNIQUE (contract_id, version, party)");
  });

  it("is_signed lo computa la base desde aceptaciones reales, no lo declara la marca", () => {
    const sql = leerMigracion(MIGRACION);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.recompute_contract_signed");
    // Ambas partes sobre la versión vigente.
    expect(sql).toContain("party = 'brand'");
    expect(sql).toContain("party = 'creator'");
    expect(sql).toContain("SET is_signed = v_brand AND v_creator");
  });

  it("editar condiciones crea una versión nueva e invalida la aceptación previa", () => {
    const sql = leerMigracion(MIGRACION);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.update_influencer_contract_terms");
    expect(sql).toContain("version = version + 1");
    expect(sql).toContain("is_signed = false");
  });

  it("el creador acepta por token público o con sesión, con firma declarada", () => {
    const sql = leerMigracion(MIGRACION);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.accept_influencer_contract_by_token");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.accept_influencer_contract");
    expect(sql).toContain("signature_required");
    expect(sql).toContain("influencer_contract_accept");
    expect(sql).toContain("md5(btrim(p_token))");
    // La lectura pública expone sólo las condiciones de ese contrato.
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.get_influencer_contract_by_token");
    expect(sql).not.toMatch(/get_influencer_contract_by_token[\s\S]*?password|mp_access_token/);
  });

  it("el portal del creador muestra sus contratos y permite aceptarlos", () => {
    const sql = leerMigracion(MIGRACION);
    expect(sql).toMatch(/c\.status, c\.version,\s+c\.is_signed/);
    expect(PORTAL).toContain("creator_my_contracts");
    expect(PORTAL).toContain("accept_influencer_contract");
  });

  it("la marca ya no escribe «Firma declarada» a mano: el estado viene de la base", () => {
    expect(REGISTROS).toContain("influencer_contract_status");
    expect(REGISTROS).not.toContain("Firma declarada");
  });

  it("el token público expone el mínimo y nunca costos internos de otras filas", () => {
    const sql = leerMigracion(MIGRACION);
    // La RPC devuelve un solo jsonb construido por columna, no la fila completa.
    expect(sql).toContain("jsonb_build_object(");
    expect(sql).toContain("WHERE c.creator_token = p_token");
  });

  it("la aceptación por invitación existente sigue intacta (no se rompe el flujo previo)", () => {
    expect(INVITACION).toContain("respondInfluencerInvitation");
    expect(INVITACION).toContain("getInfluencerInvitation");
  });
});
