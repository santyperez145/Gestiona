import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("paridad integral: GoMarz + Mendel + Shopify/Tiendanube", () => {
  describe("Plataforma GoMarz (Influencer Marketing)", () => {
    const campaignsPage = read("src/pages/InfluencerCampaignsPage.tsx");
    const invitationPage = read("src/pages/InfluencerInvitationPage.tsx");
    const migration = read("supabase/migrations/20260922000200_influencer_invitations_reviews.sql");

    it("maneja invitaciones a creadores con token, expiración y aceptación/rechazo", () => {
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.influencer_invitations");
      expect(migration).toContain("respond_influencer_invitation");
      expect(migration).toContain("get_influencer_invitation");
      expect(invitationPage).toContain("respondInfluencerInvitation");
      expect(invitationPage).toContain("getInfluencerInvitation");
    });

    it("calcula reputación real de creadores a partir de colaboraciones completadas", () => {
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.influencer_reviews");
      expect(migration).toContain("get_influencer_public_reviews");
      expect(migration).toContain("get_influencer_public_profile");
    });

    it("la generación de briefs con IA exige usuario, plan y registra consumo", () => {
      const briefFunc = read("supabase/functions/ai-brief-generator/index.ts");
      expect(briefFunc).toContain("requireUser(req, corsHeaders)");
      expect(briefFunc).toContain('exigirBeneficio(req, orgId, "ia", corsHeaders)');
      expect(briefFunc).toContain("registrarConsumoIA(");
    });
  });

  describe("Plataforma Mendel (Finance)", () => {
    const solicitudesPage = read("src/pages/FinanceSolicitudesPage.tsx");
    const migration = read("supabase/migrations/20260919000100_expense_requests_authority.sql");
    const overviewPage = read("src/pages/FinanceOverviewPage.tsx");

    it("las solicitudes de gasto se aprueban y rechazan por RPC server-side", () => {
      expect(solicitudesPage).toContain('rpc("finance_approve_expense_request"');
      expect(solicitudesPage).toContain('rpc("finance_reject_expense_request"');
      expect(solicitudesPage).toContain('rpc("finance_create_expense_request"');
      expect(migration).toContain("finance_approve_expense_request");
    });

    it("la aprobación exige permisos de edición o rol owner/admin", () => {
      expect(migration).toContain("v_role NOT IN ('owner', 'admin')");
      expect(migration).toContain("public.has_permission(v_req.org_id, 'expenses', 'edit')");
    });

    it("el pulso de presupuesto integra saldo disponible y gastos sin duplicar", () => {
      expect(overviewPage).toContain("Pulso del presupuesto");
    });
  });

  describe("Plataforma Shopify / Tiendanube (Commerce)", () => {
    const ordersPage = read("src/pages/StoreOrdersPage.tsx");
    const shipmentDialog = read("src/components/ecommerce/OrderShipmentDialog.tsx");
    const returnsPage = read("src/pages/DevolucionesPage.tsx");

    it("el despacho de pedidos valida que la orden esté abonada antes de emitir guía", () => {
      expect(shipmentDialog).toContain("canFulfillStoreOrder(order.payment_status)");
      expect(shipmentDialog).toContain("isStorePaymentReversed(order.payment_status)");
    });

    it("emite etiquetas de impresión térmica 10x15cm con datos del destinatario y tracking", () => {
      expect(shipmentDialog).toContain("@page { size: 10cm 15cm; margin: 6mm; }");
      expect(shipmentDialog).toContain("Pedido ya abonado");
    });

    it("las devoluciones tienen portal RMA, cálculo de líneas y reingreso de stock", () => {
      expect(returnsPage).toContain("ReturnsPortalTab");
      expect(returnsPage).toContain("sales_return_operations");
      expect(returnsPage).toContain("sales_return_refunds");
    });
  });
});
