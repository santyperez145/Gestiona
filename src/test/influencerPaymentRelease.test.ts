import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Go-Marz parity: el pago se libera al verificar la publicación.
 *
 * ── Por qué existe este test ─────────────────────────────────────────────
 * Medido 2026-09-25 (go-marz.com): «paga automáticamente cuando publican» /
 * «retenemos tu pago hasta que el creador publique». Nerqia ya tenía
 * `register_publication_proof` (verificación con licencia) y pagos con
 * retiros MP, pero eran dos flujos sueltos: nada conectaba la publicación
 * verificada con la habilitación del pago.
 *
 * Traducción sin custodia de fondos: la verificación marca `released_at`
 * (señal que habilita); la marca sigue ejecutando el pago desde retiros.
 * La plataforma jamás mueve plata por sí sola.
 */

const ROOT = resolve(__dirname, "../..");

function leer(nombre: string): string {
  return readFileSync(resolve(ROOT, ...nombre.split("/")), "utf8");
}

const MIGRACION = "20260925001800_payment_release_on_publication.sql";
const DB = leer("src/lib/influencersDB.ts");

describe("pago retenido hasta publicación verificada (Go-Marz parity)", () => {
  it("la migración existe y modela la retención", () => {
    expect(existsSync(resolve(ROOT, "supabase", "migrations", MIGRACION))).toBe(true);
    const sql = leer(`supabase/migrations/${MIGRACION}`);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS release_condition");
    expect(sql).toContain("'publication_verified'");
    expect(sql).toContain("released_at");
  });

  it("la verificación de publicación libera los pagos retenidos (trigger)", () => {
    const sql = leer(`supabase/migrations/${MIGRACION}`);
    expect(sql).toContain("release_payments_on_publication_proof");
    expect(sql).toContain("AFTER INSERT ON public.influencer_publication_proofs");
    expect(sql).toContain("p.campaign_id = new.campaign_id");
    expect(sql).toContain("new.verified_by IS NULL");
    // Libera sólo lo retenido y pendiente: nunca toca lo ya pagado.
    expect(sql).toContain("p.released_at IS NULL");
    expect(sql).toContain("p.status IN ('pending', 'processing')");
  });

  it("la liberación avisa por el canal que la marca ya mira (alert_events)", () => {
    const sql = leer(`supabase/migrations/${MIGRACION}`);
    expect(sql).toContain("INSERT INTO public.alert_events");
    expect(sql).toContain("'influencers'");
    // alert_events.priority sólo acepta low/medium/high/critical: 'info' viola
    // el CHECK y revienta en runtime.
    expect(sql).not.toContain("'info'");
    // El mensaje lleva nombre humano del creador, nunca el UUID crudo.
    expect(sql).toContain("v_creator_name");
    expect(sql).not.toMatch(/' \|\| new\.influencer_id \|/);
  });

  it("la marca crea el pago retenido server-side; no elige liberarlo a mano", () => {
    const sql = leer(`supabase/migrations/${MIGRACION}`);
    expect(sql).toContain("create_influencer_held_payment");
    expect(sql).toContain("can_manage_influencers(p_org_id, 'edit')");
    expect(sql).toContain("creator_not_assigned_to_campaign");
    // El cliente nunca escribe released_at a mano: sólo el trigger.
    expect(sql).not.toMatch(/GRANT.*(UPDATE|ALL).*influencer_payments/);
  });

  it("la vista computa held/payable y el frontend traduce el estado", () => {
    const sql = leer(`supabase/migrations/${MIGRACION}`);
    expect(sql).toContain("CREATE OR REPLACE VIEW public.influencer_payment_release_status");
    expect(sql).toContain("AS is_payable");
    // helpers tipados + label humano, sin IDs crudos.
    expect(DB).toContain("create_influencer_held_payment");
    expect(DB).toContain("listPaymentsWithRelease");
    expect(DB).toContain("Retenido hasta publicación");
  });
});
