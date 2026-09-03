import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('supabase/migrations/20260822000008_finance_product_surface.sql');
const app = read('src/App.tsx');
const businessLayout = read('src/components/AppLayout.tsx');
const financeLayout = read('src/components/finance-product/FinanceLayout.tsx');
const financeGate = read('src/components/finance-product/FinanceProductGate.tsx');
const overview = read('src/pages/FinanceOverviewPage.tsx');
const platformEdge = read('supabase/functions/platform-admin-action/index.ts');
const platformPanel = read('src/components/platform/ProductAccessPanel.tsx');

describe('autoridad de la superficie Gestiona Finance', () => {
  it('separa entitlement de permisos y feature flags', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.organization_product_access');
    expect(migration).toContain("public.has_permission(p_org_id, 'finance', 'view')");
    expect(migration).not.toContain('feature_flag_habilitada');
  });

  it('no expone las tablas de acceso al navegador', () => {
    expect(migration).toContain('REVOKE ALL ON public.organization_product_access FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('REVOKE ALL ON public.organization_product_access_events FROM PUBLIC, anon, authenticated');
    expect(migration).toContain("has_table_privilege('authenticated', 'public.organization_product_access', 'SELECT')");
  });

  it('el tenant solicita pero sólo Platform decide', () => {
    const requestRpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.request_product_access'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.platform_product_access_set'),
    );
    const platformRpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.platform_product_access_set'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.finance_core_snapshot'),
    );
    expect(requestRpc).toContain("v_role IS NULL OR v_role NOT IN ('owner', 'admin')");
    expect(requestRpc).not.toContain("status = 'enabled'");
    expect(platformRpc).toContain("role IN ('superadmin', 'finance')");
    expect(platformRpc).toContain('organization_product_access_events');
    expect(platformRpc).toContain('admin_audit_logs');
  });

  it('Finance comparte identidad y organización pero tiene chrome propio', () => {
    expect(app).toContain('<Route path="/finance/*" element={<FinanceRoutes />} />');
    expect(app).toContain('<FinanceLayout>');
    expect(app).toContain('<FinanceProductGate>');
    expect(financeLayout).toContain('Gestiona Business');
    expect(financeLayout).toContain('OrgSwitcher');
    expect(businessLayout).toContain('Gestiona Finance');
  });

  it('no hereda onboarding de Business ni acceso de staff sin membresía', () => {
    const financeRoutes = app.slice(app.indexOf('function FinanceRoutes()'), app.indexOf('function ProtectedRoutes()'));
    expect(financeRoutes).not.toContain('onboarding_completed');
    expect(financeRoutes).toContain('if (!activeOrg || !activeRole)');
    expect(financeRoutes).toContain('platformRole ? <Navigate to="/platform"');
    expect(financeGate).toContain('module_permission_denied');
  });

  it('lee un snapshot agregado y no arma joins de Core en el navegador', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.finance_core_snapshot');
    expect(migration).toContain('FROM public.suppliers');
    expect(migration).toContain('FROM public.purchase_orders');
    expect(migration).toContain('FROM public.supplier_debts');
    expect(migration).toContain('FROM public.ledger_entries');
    expect(overview).not.toMatch(/\.from\(['"](?:suppliers|purchase_orders|supplier_debts|ledger_entries)/);
    expect(overview).toContain('Business Core compartido');
  });

  it('Platform aplica la misma matriz de roles en Edge y base', () => {
    expect(platformEdge).toContain('getProductAccess: ["support", "finance"]');
    expect(platformEdge).toContain('setProductAccess: ["finance"]');
    expect(platformEdge).toContain('admin.rpc("platform_product_access_set"');
    expect(platformPanel).toContain("action: 'setProductAccess'");
    expect(platformPanel).not.toContain("from('organization_product_access')");
  });

  it('no presenta el OCR precursor como Finance terminado', () => {
    expect(overview).toContain('OCR precursor');
    expect(overview).toContain('No tiene cadena de custodia, deduplicación ni aprobación');
    expect(overview).toContain('Ningún archivo mueve stock');
  });

  it('el Foco de Finance es Pulse: evidencia, tope de cinco, sin clonar Core', () => {
    expect(overview).toContain('financeFocoFromSnapshot');
    expect(overview).toContain('Hasta cinco movimientos');
    const db = read('src/lib/financeProductDB.ts');
    expect(db).toContain('return items.slice(0, 5)');
    expect(db).toContain('to: "/finance/documentos"');
    expect(db).toContain('to: "/ordenes-compra"');
    expect(db).not.toContain('INSERT INTO public.expenses');
  });

  it('enlace al Core sin clonar pantallas de compras o gastos', () => {
    expect(overview).toContain('sin duplicar');
    expect(overview).toContain('to="/gastos"');
    expect(overview).toContain('to="/ordenes-compra"');
    expect(overview).toContain('to="/libro"');
    expect(overview).toContain('to="/banco"');
    expect(overview).not.toContain('ExpensesPage');
    expect(financeLayout).toContain('En el Core');
    expect(financeLayout).toContain("to: '/gastos'");
  });
});
