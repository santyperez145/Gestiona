import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guardia del lote de paridad competitiva:
 *
 * 1. Marz/Go-Marz: pagos automáticos — la liquidación del retiro asienta el
 *    pago en `influencer_payouts` (idempotente por request) y la plataforma
 *    tiene su panel transversal de creadores y retiros.
 * 2. Tiendas/Tiendanube-Shopify: Theme Studio con vista previa en vivo que
 *    usa el MISMO resolver de temas que la vitrina.
 * 3. Contrato versionado para la baja uno-clic (auditoría en cero).
 */

const read = (p: string) => readFileSync(p, "utf8");

describe("paridad competitiva: Marz pagos automáticos", () => {
  const migracion = read("supabase/migrations/20260924000300_creator_withdrawal_settlement_integrity.sql");

  it("resolve_creator_withdrawal asienta la liquidación en influencer_payouts al marcar paid", () => {
    expect(migracion).toContain("CREATE OR REPLACE FUNCTION public.resolve_creator_withdrawal");
    expect(migracion).toContain("INSERT INTO public.influencer_payouts");
    // Idempotencia: reintentos no duplican el pago.
    expect(migracion).toContain("'withdrawal:' || v_row.id::text");
    expect(migracion).toContain("v_payout_exists");
  });

  it("cierra el doble gasto: el asiento ocurre en la MISMA transacción del UPDATE a paid", () => {
    const cuerpo = migracion.slice(
      migracion.indexOf("UPDATE public.influencer_withdrawal_requests"),
      migracion.indexOf("RETURN v_row;"),
    );
    expect(cuerpo).toContain("IF p_status = 'paid' THEN");
    expect(cuerpo).toContain("INSERT INTO public.influencer_payouts");
  });

  it("existe la tabla influencer_withdrawal_requests con RLS por org", () => {
    expect(migracion).toContain("CREATE TABLE IF NOT EXISTS public.influencer_withdrawal_requests");
    expect(migracion).toContain("ALTER TABLE public.influencer_withdrawal_requests ENABLE ROW LEVEL SECURITY");
    expect(migracion).toContain("can_manage_influencers(org_id, 'edit')");
  });

  it("el ciclo completo del creador existe: saldo, solicitar, listar, resolver", () => {
    expect(migracion).toContain("public.get_creator_earnings(p_token text)");
    expect(migracion).toContain("public.request_creator_withdrawal(p_token text, p_amount_ars numeric)");
    expect(migracion).toContain("public.list_creator_withdrawals(p_token text)");
    // Saldo server-side: la marca no confía en el cliente.
    expect(migracion).toContain("GREATEST(v_sales - v_paid - v_pending, 0)");
    expect(migracion).toContain("supera tu saldo disponible");
  });

  it("la plataforma tiene panel transversal de creadores y retiros (superadmin)", () => {
    const panel = read("src/pages/PlatformCreatorsPage.tsx");
    expect(panel).toContain("influencer_withdrawal_requests");
    expect(panel).toContain("Creadores & Retiros");
    expect(panel).toContain("Estancadas");
    // La plata la decide la marca: plataforma audita, no liquida.
    expect(panel).not.toContain("resolve_creator_withdrawal");

    const app = read("src/App.tsx");
    expect(app).toContain('PlatformCreatorsPage = lazy(() => import("@/pages/PlatformCreatorsPage"))');
    expect(app).toContain('<Route path="creadores"');

    const layout = read("src/components/PlatformLayout.tsx");
    expect(layout).toContain("/platform/creadores");
  });
});

describe("paridad competitiva: Tiendas Theme Studio", () => {
  const studio = read("src/components/ecommerce/StoreThemeStudio.tsx");

  it("existe el Theme Studio integrado en la pestaña de diseño", () => {
    expect(studio).toContain("StoreThemeStudio");
    // Paridad Tiendanube/Shopify: vista previa con el MISMO resolver que la tienda.
    expect(studio).toContain("resolveTheme");
    expect(read("src/pages/EcommerceStorePage.tsx")).toContain("import StoreThemeStudio");
  });

  it("usa las variables reales del comprador (--st-*), no una imitación en Tailwind", () => {
    expect(studio).toContain("--st-bg");
    expect(studio).toContain("--st-header");
    expect(studio).toContain("--st-accent");
    expect(studio).toContain("--st-accent-fg");
  });

  it("el color de marca avisa cómo queda el contraste del acento", () => {
    expect(studio).toContain("resumenAccesibilidad");
    expect(studio).toContain("texto oscuro");
    expect(studio).toContain("texto blanco");
  });

  it("presets de color de marca curados, no un campo suelto", () => {
    expect(studio).toContain("PRIMARY_PRESETS");
    expect(studio).toContain("type=\"color\"");
  });
});

describe("contrato de la baja uno-clic (auditoría en cero)", () => {
  const contrato = read("supabase/migrations/20260924000400_email_unsubscribe_contract.sql");

  it("process_email_campaign_unsubscribe está registrado como public_token", () => {
    expect(contrato).toContain("'process_email_campaign_unsubscribe'");
    expect(contrato).toContain("'public_token'");
    expect(contrato).toContain("p_token text, p_user_agent text, p_ip inet");
  });
});

describe("paridad competitiva: Mendel — circuito completo del gasto", () => {
  const migracion = read("supabase/migrations/20260924000600_finance_mark_expense_paid.sql");

  it("registrar pago asienta el gasto real en expenses y marca la solicitud pagada", () => {
    expect(migracion).toContain("CREATE OR REPLACE FUNCTION public.finance_mark_expense_paid");
    expect(migracion).toContain("INSERT INTO public.expenses");
    expect(migracion).toContain("SET status = 'paid'");
    // Idempotencia: el reintento no duplica el gasto en el P&L.
    expect(migracion).toContain("'expense_request:' || v_req.id::text");
    expect(migracion).toContain("v_exists");
  });

  it("autoridad en servidor: sólo owner/admin o permiso explícito de gastos", () => {
    expect(migracion).toContain("has_permission(v_req.org_id, 'expenses', 'edit')");
    expect(migracion).toContain("Solo se pueden pagar solicitudes aprobadas");
    // Sólo pende una solicitud aprobada: servidor decide, no el cliente.
    expect(migracion).toContain("IF v_req.status <> 'approved' THEN");
  });

  it("la bandeja Finance conecta el ciclo: realtime, estado paid y botón de pago", () => {
    const bandeja = read("src/pages/FinanceSolicitudesPage.tsx");
    expect(bandeja).toContain("finance_mark_expense_paid");
    expect(bandeja).toContain("handleMarkPaid");
    expect(bandeja).toContain("Registrar pago");
    expect(bandeja).toContain("pagado");
    // Realtime: la bandeja se actualiza sola.
    expect(bandeja).toContain("postgres_changes");
    expect(bandeja).toContain("finance-solicitudes-");
  });

  it("la tabla está en la publicación realtime", () => {
    const pub = read("supabase/migrations/20260924000500_finance_solicitudes_realtime.sql");
    expect(pub).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_expense_requests");
  });
});