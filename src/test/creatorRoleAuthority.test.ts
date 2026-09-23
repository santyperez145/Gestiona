import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Autoridad del rol CREADOR (influencer) — paridad Go-Marz.
 *
 * Un influencer NO es un comercio: no recibe organización, ni membresía
 * owner, ni trial de 14 días. El rol se declara en el signup
 * (`account_type='creator'`), el trigger lo reserva como ya lo hace con
 * `store_customer` y `platform_invited_owner`, y una tabla `creator_accounts`
 * le da su propia superficie: campañas, entregables e ingresos de todas sus
 * marcas, ligadas por email.
 */
const ROOT = process.cwd();
const migration = readFileSync(
  resolve(ROOT, "supabase/migrations/20260922000400_creator_accounts_role.sql"),
  "utf8",
);
const authLib = readFileSync(resolve(ROOT, "src/lib/auth.tsx"), "utf8");
const authPage = readFileSync(resolve(ROOT, "src/pages/AuthPage.tsx"), "utf8");
const landing = readFileSync(resolve(ROOT, "src/pages/LandingPage.tsx"), "utf8");
const portal = readFileSync(resolve(ROOT, "src/pages/CreatorPortalPage.tsx"), "utf8");
const context = readFileSync(resolve(ROOT, "src/lib/creatorContext.tsx"), "utf8");
const manifest = readFileSync(resolve(ROOT, "src/app/routeManifest.ts"), "utf8");

describe("rol creador: el influencer no es un comercio", () => {
  it("el trigger reserva 'creator' junto a store_customer y platform_invited_owner", () => {
    expect(migration).toContain("'creator'");
    expect(migration).toContain("'store_customer'");
    expect(migration).toContain("'platform_invited_owner'");
    // El cuerpo de negocio sigue intacto: org + trial + flows.
    expect(migration).toContain("INSERT INTO public.organizations");
    expect(migration).toContain("PERFORM public.seed_default_automation_flows(new_org_id)");
  });

  it("creator_accounts existe con RLS de fila propia, no por organización", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.creator_accounts");
    expect(migration).toContain("user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("user_id = auth.uid()");
    // No hay org_id: la cuenta es del usuario, no de un tenant.
    expect(migration.slice(migration.indexOf("CREATE TABLE IF NOT EXISTS public.creator_accounts"), migration.indexOf("-- ── El rol creator")))
      .not.toMatch(/org_id/);
  });

  it("el signup declara el rol y AuthPage lo pide antes de crear la cuenta", () => {
    expect(authLib).toContain("accountType?: 'creator' | 'store_customer'");
    expect(authLib).toContain("account_type: accountType");
    expect(authPage).toContain(">Soy negocio<");
    expect(authPage).toContain(">Soy creador<");
    expect(authPage).toContain("role === 'creator' ? 'creator' : undefined");
    // La landing deja las dos puertas visibles.
    expect(landing).toContain("Soy creador");
    expect(landing).toContain("mode=register&role=creator");
  });

  it("el portal del creador se sirve desde RPCs server-side, no desde tablas", () => {
    expect(context).toContain('rpc("creator_linked_profiles"');
    expect(context).toContain('rpc("creator_campaigns"');
    expect(context).toContain('rpc("creator_deliverables"');
    expect(context).toContain('rpc("creator_earnings"');
    // La identidad por email vive server-side: el cliente no declara su email
    // de marca.
    expect(migration).toContain("lower(i.email) = lower(ca.email)");
  });

  it("los RPCs de creador son SECURITY DEFINER con grants explícitos", () => {
    const funciones = ["creator_linked_profiles", "creator_campaigns", "creator_deliverables", "creator_earnings", "creator_upsert_own_profile"];
    for (const fn of funciones) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
    }
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.creator_campaigns() TO authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.creator_earnings() TO authenticated");
  });

  it("el portal muestra ingresos, campañas y entregables, y un perfil editable", () => {
    expect(portal).toContain("Portal de creador");
    expect(portal).toContain("saveProfile"); // edición de perfil vía useCreator
    expect(context).toContain('rpc("creator_upsert_own_profile"');
    expect(portal).toContain("Disponible");
    expect(portal).toContain("Entregables");
    expect(portal).toContain("Tus campañas");
  });

  it("la ruta del portal vive en el manifest, no escrita a mano en App", () => {
    expect(manifest).toContain('path: "/portal-creador"');
    const app = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
    expect(app).not.toContain('path="/portal-creador"');
  });

  it("las ganancias las calcula el servidor con saldos reales", () => {
    // El mismo guard de saldo del portal público: disponible >= 0 y nunca
    // doble-contado con retiros pendientes.
    expect(migration).toContain("GREATEST(v_total - v_paid - v_pending, 0)");
    expect(migration).toContain("w.status IN ('pending', 'approved')");
  });
});
